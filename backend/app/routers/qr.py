"""Validacion en linea del QR dinamico (ADR-8, ADR-11).

El QR lo genera el telefono sin conexion (app/credential.py::build_qr) y el escaner lo descifra y
verifica localmente: firma del Registro Civil, foto, nombre y RUT. Despues consulta aqui, SIN la
foto, lo que solo el servidor puede decidir: que el QR lo firmo el dispositivo ligado a la entrada,
que no se uso antes, que la entrada no ingreso ya y que la persona no tiene prohibicion de ingreso.

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
from ..credential import CredentialError, b64d, device_message, parse_core, verify, verify_issuer
from ..database import get_db
from ..deps import require_roles
from ..issuer import issuer_public_key
from ..models import AccessLog, Gate, QRCheck, QRUse, Role, Ticket, User, is_banned, utcnow
from ..schemas import QRValidateIn, QRValidateOut
from .tickets import attendee_out

router = APIRouter(prefix="/qr", tags=["qr"])


def _signatures_ok(payload: QRValidateIn, ticket: Ticket) -> bool:
    """Firma del emisor sobre la credencial, credencial del titular de la entrada, y firma del
    dispositivo ligado a la entrada sobre este QR en particular."""
    try:
        core_bytes = b64d(payload.credential_core)
        if not verify_issuer(issuer_public_key(), core_bytes, b64d(payload.issuer_sig, 64)):
            return False
        if parse_core(core_bytes).rut != ticket.document_id:
            return False
        message = device_message(core_bytes, ticket.event_id, ticket.id, bytes.fromhex(payload.nonce), payload.issued_at)
        return verify(b64d(ticket.device_public_key, 32), message, b64d(payload.device_sig, 64))
    except CredentialError:
        return False


@router.post("/validate", response_model=QRValidateOut)
def validate_qr(
    payload: QRValidateIn,
    guard: User = Depends(require_roles(Role.GUARD, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    started = time.perf_counter()
    now = utcnow()
    now_unix = calendar.timegm(now.timetuple())

    gate = None
    if payload.gate_id is not None:
        gate = db.get(Gate, payload.gate_id)
        if gate is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Puerta no encontrada")

    reason, ticket = _evaluate(payload, gate, db, now, now_unix)

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
            gate_id=gate.id if gate else None,
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


def _evaluate(payload: QRValidateIn, gate: Gate | None, db: Session, now, now_unix: int) -> tuple[str, Ticket | None]:
    """Todo lo que decide si el QR sirve, sin modificar nada. Devuelve (motivo, entrada)."""
    ticket = db.get(Ticket, payload.ticket_id)
    if ticket is None or ticket.device_public_key is None or not _signatures_ok(payload, ticket):
        # Credencial falsificada, QR armado sin la clave del dispositivo, o entrada liberada por soporte.
        return "invalid", None
    if gate is not None and gate.event_id != ticket.event_id:
        return "wrong_event", ticket
    if payload.issued_at > now_unix + settings.qr_clock_skew_seconds:
        return "invalid", ticket  # fechado en el futuro: seria una forma de alargar la vigencia
    if now_unix - payload.issued_at > settings.qr_ttl_seconds + settings.qr_clock_skew_seconds:
        # Vencido, salvo que el guardia lo haya verificado a tiempo y este confirmando la foto.
        check = db.get(QRCheck, payload.nonce) if payload.action != "check" else None
        in_window = (
            check is not None
            and check.ticket_id == ticket.id
            and (now - check.checked_at).total_seconds() <= settings.qr_confirm_window_seconds
        )
        if not in_window:
            return "expired", ticket
    if is_banned(db, ticket.document_id):
        # Se revisa en la puerta para que una prohibicion agregada a ultima hora aplique.
        # No consume el QR ni registra ingreso.
        return "banned", ticket
    if payload.action == "check":
        # Vista previa de lo que haria "admit", para no pedirle al guardia que mire la foto en vano.
        if db.get(QRUse, payload.nonce) is not None:
            return "already_used", ticket
        if ticket.admitted_at is not None:
            return "already_admitted", ticket
    return "ok", ticket
