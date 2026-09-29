"""Validacion en linea de la cedula digital en la puerta (ADR-8, ADR-11, ADR-12).

La cedula es de la persona: el telefono genera el QR sin conexion (app/credential.py::build_qr) y el
lector lo descifra y verifica localmente (firma del Registro Civil, firma del telefono dueno de la
cedula, foto, nombre y RUT). Despues consulta aqui, SIN la foto, lo que decide el recinto: que la
cedula y el QR son autenticos, que el QR no se uso antes, que ese RUT tiene entrada para el evento,
que no ingreso ya y que no tiene prohibicion de ingreso.

Dos pasos (ADR-12): "check" verifica sin consumir; el guardia compara la foto y confirma con "admit"
o rechaza con "reject". Asi una foto que no coincide no quema la entrada del titular real.
"""

import calendar
import time

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from ..config import settings
from ..credential import CredentialError, IdentityCore, b64d, check_signatures
from ..database import get_db
from ..deps import require_roles
from ..issuer import issuer_public_key
from ..models import AccessLog, Gate, QRCheck, QRUse, Role, Ticket, User, is_banned, utcnow
from ..schemas import QRValidateIn, QRValidateOut
from .tickets import attendee_out

router = APIRouter(prefix="/qr", tags=["qr"])


def _identity(payload: QRValidateIn) -> IdentityCore | None:
    """Cedula emitida por el Registro Civil y QR firmado por el telefono dueno de esa cedula."""
    try:
        return check_signatures(
            b64d(payload.credential_core),
            b64d(payload.issuer_sig, 64),
            bytes.fromhex(payload.nonce),
            payload.issued_at,
            b64d(payload.device_sig, 64),
            issuer_public_key(),
        )
    except CredentialError:
        return None


@router.post("/validate", response_model=QRValidateOut)
def validate_qr(
    payload: QRValidateIn,
    guard: User = Depends(require_roles(Role.GUARD, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    started = time.perf_counter()
    now = utcnow()
    now_unix = calendar.timegm(now.timetuple())

    gate = db.get(Gate, payload.gate_id)
    if gate is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Puerta no encontrada")

    identity = _identity(payload)
    reason, ticket = _evaluate(payload, identity, gate, db, now, now_unix)

    if payload.action == "check":
        if reason == "ok":
            # Paso 1 de 2 (ADR-12): todo en orden, falta que el guardia confirme la foto. No se consume
            # nada ni se registra en el historial; se anota el "check" para permitir la confirmacion
            # aunque el QR venza mientras el guardia mira la foto.
            db.execute(
                sqlite_insert(QRCheck)
                .values(nonce=payload.nonce, ticket_id=ticket.id, checked_at=now)
                .on_conflict_do_nothing(index_elements=["nonce"])
            )
            db.commit()
            return QRValidateOut(
                granted=False,
                reason="ok",
                pending=True,
                attendee=attendee_out(ticket),
                latency_ms=round((time.perf_counter() - started) * 1000, 3),
            )
    elif payload.action == "reject" and reason == "ok":
        # El guardia vio que la foto no es la de quien esta en la puerta. Se inutiliza ESTE QR (para
        # que no se reintente en otra fila) pero no se registra ingreso: el titular real todavia
        # puede entrar con un QR nuevo.
        db.execute(
            sqlite_insert(QRUse)
            .values(nonce=payload.nonce, ticket_id=ticket.id, used_at=now)
            .on_conflict_do_nothing(index_elements=["nonce"])
        )
        reason = "photo_mismatch"
    elif payload.action == "admit" and reason == "ok":
        # Uso unico: con varias puertas escaneando en paralelo, solo un INSERT del nonce puede ganar
        # (clave primaria). En PostgreSQL es el mismo ON CONFLICT DO NOTHING.
        consumed = db.execute(
            sqlite_insert(QRUse)
            .values(nonce=payload.nonce, ticket_id=ticket.id, used_at=now)
            .on_conflict_do_nothing(index_elements=["nonce"])
        ).rowcount
        if not consumed:
            reason = "already_used"
        else:
            admitted = db.execute(
                update(Ticket).where(Ticket.id == ticket.id, Ticket.admitted_at.is_(None)).values(admitted_at=now)
            ).rowcount
            reason = "ok" if admitted else "already_admitted"

    granted = reason == "ok"
    latency_ms = round((time.perf_counter() - started) * 1000, 3)
    db.add(
        AccessLog(
            token_id=payload.nonce,
            ticket_id=ticket.id if ticket else None,
            document_id=identity.rut if identity else None,
            gate_id=gate.id,
            scanned_by_id=guard.id,
            granted=granted,
            reason=reason,
            latency_ms=latency_ms,
        )
    )
    db.commit()
    if ticket is not None:
        db.refresh(ticket)

    return QRValidateOut(
        granted=granted,
        reason=reason,
        attendee=attendee_out(ticket) if ticket else None,
        latency_ms=latency_ms,
    )


def _evaluate(
    payload: QRValidateIn, identity: IdentityCore | None, gate: Gate, db: Session, now, now_unix: int
) -> tuple[str, Ticket | None]:
    """Todo lo que decide si la persona entra, sin modificar nada. Devuelve (motivo, entrada)."""
    if identity is None:
        # Cedula falsificada o QR armado sin la clave del telefono dueno de la cedula.
        return "invalid", None
    if payload.issued_at > now_unix + settings.qr_clock_skew_seconds:
        return "invalid", None  # fechado en el futuro: seria una forma de alargar la vigencia
    ticket = (
        db.query(Ticket).filter(Ticket.event_id == gate.event_id, Ticket.document_id == identity.rut).first()
    )
    if now_unix - payload.issued_at > settings.qr_ttl_seconds + settings.qr_clock_skew_seconds:
        # Vencido, salvo que el guardia lo haya verificado a tiempo y este confirmando la foto.
        check = db.get(QRCheck, payload.nonce) if payload.action != "check" else None
        in_window = (
            check is not None
            and ticket is not None
            and check.ticket_id == ticket.id
            and (now - check.checked_at).total_seconds() <= settings.qr_confirm_window_seconds
        )
        if not in_window:
            return "expired", ticket
    if is_banned(db, identity.rut):
        # Se revisa en la puerta para que una prohibicion agregada a ultima hora aplique.
        return "banned", ticket
    if ticket is None:
        return "no_ticket", None  # la cedula es valida, pero ese RUT no tiene entrada para este evento
    if payload.action == "check":
        # Vista previa de lo que haria "admit", para no pedirle al guardia que mire la foto en vano.
        if db.get(QRUse, payload.nonce) is not None:
            return "already_used", ticket
        if ticket.admitted_at is not None:
            return "already_admitted", ticket
    return "ok", ticket
