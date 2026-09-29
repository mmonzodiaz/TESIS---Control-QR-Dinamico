"""Validacion en linea de la cedula digital en la puerta (ADR-8, ADR-11, ADR-12, ADR-14, ADR-15).

La cedula es de la persona: el telefono genera el QR sin conexion (app/credential.py::build_qr) y el
lector lo descifra y verifica localmente (firma del Registro Civil, firma del telefono dueno de la
cedula, foto, nombre y RUT). Despues consulta aqui, SIN la foto, lo que decide el recinto: que la
cedula y el QR son autenticos, que la cedula no esta revocada, que el QR no se uso antes, que ese RUT
tiene entrada para el evento, que no ingreso ya y que no tiene prohibicion de ingreso.

Dos pasos (ADR-12): "check" verifica sin consumir; el guardia compara la foto y confirma con "admit"
o rechaza con "reject". Asi una foto que no coincide no quema la entrada del titular real.

Sin conexion (ADR-15) el escaner decide con su copia de contingencia y al volver la red envia sus
decisiones a /qr/sync, que las reverifica y deja alertas si el servidor no habria dejado pasar.
"""

import calendar
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from ..config import settings
from ..credential import CredentialError, IdentityCore, b64d, check_signatures, credential_id
from ..database import get_db
from ..deps import require_roles
from ..issuer import issuer_public_key
from ..models import AccessLog, Gate, QRCheck, QRUse, Role, Ticket, User, is_banned, utcnow
from ..ratelimit import RateLimiter
from ..revocation import revocations
from ..schemas import OfflineDecision, OfflineSyncIn, OfflineSyncResult, QRValidateIn, QRValidateOut
from .tickets import attendee_out

router = APIRouter(prefix="/qr", tags=["qr"])

# Por guardia: con un token robado no se pueden sondear cedulas a gran velocidad (A5).
validate_rate_limiter = RateLimiter(
    settings.qr_validate_rate_limit_per_guard,
    detail="Demasiadas validaciones seguidas desde esta cuenta. Espera un momento.",
)

staff = require_roles(Role.GUARD, Role.ADMIN)


def _identity(payload: QRValidateIn | OfflineDecision) -> IdentityCore | None:
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


def _consume(db: Session, nonce: str, ticket: Ticket, now: datetime) -> bool:
    """Uso unico: con varias puertas escaneando en paralelo, solo un INSERT del nonce puede ganar
    (clave primaria). En PostgreSQL es el mismo ON CONFLICT DO NOTHING."""
    return bool(
        db.execute(
            sqlite_insert(QRUse)
            .values(nonce=nonce, ticket_id=ticket.id, used_at=now)
            .on_conflict_do_nothing(index_elements=["nonce"])
        ).rowcount
    )


def _admit(db: Session, nonce: str, ticket: Ticket, now: datetime) -> str:
    if not _consume(db, nonce, ticket, now):
        return "already_used"
    admitted = db.execute(
        update(Ticket).where(Ticket.id == ticket.id, Ticket.admitted_at.is_(None)).values(admitted_at=now)
    ).rowcount
    return "ok" if admitted else "already_admitted"


@router.post("/validate", response_model=QRValidateOut)
def validate_qr(payload: QRValidateIn, guard: User = Depends(staff), db: Session = Depends(get_db)):
    validate_rate_limiter.hit(f"guard:{guard.id}")
    started = time.perf_counter()
    now = utcnow()
    now_unix = calendar.timegm(now.timetuple())

    gate = db.get(Gate, payload.gate_id)
    if gate is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Puerta no encontrada")

    identity = _identity(payload)
    reason, ticket = _evaluate(payload, payload.action, identity, gate, db, now, now_unix)

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
        _consume(db, payload.nonce, ticket, now)
        reason = "photo_mismatch"
    elif payload.action == "admit" and reason == "ok":
        reason = _admit(db, payload.nonce, ticket, now)

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


@router.post("/sync", response_model=list[OfflineSyncResult])
def sync_offline(payload: OfflineSyncIn, guard: User = Depends(staff), db: Session = Depends(get_db)):
    """Decisiones tomadas sin conexion (ADR-15). Cada una se reverifica como si se hubiera validado en
    linea a la hora del escaneo. El historial registra lo que paso en la puerta (si el guardia dejo
    pasar, la persona entro) y marca como alerta lo que el servidor no habria permitido: por ejemplo,
    la misma persona admitida en dos puertas durante la caida. Reenviar el mismo lote no duplica nada."""
    validate_rate_limiter.hit(f"guard:{guard.id}")
    now_unix = calendar.timegm(utcnow().timetuple())
    results = []
    for decision in payload.decisions:
        # Ya registrado: un lote reenviado, o un "Dejar pasar" que alcanzo a llegar antes de que se
        # cayera la red (el escaner no supo la respuesta y lo guardo como pendiente).
        previous = db.query(AccessLog).filter(AccessLog.token_id == decision.nonce).first()
        if previous is not None:
            results.append(OfflineSyncResult(nonce=decision.nonce, reason=previous.reason, alert=_is_alert(previous)))
            continue
        gate = db.get(Gate, decision.gate_id)
        if gate is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Puerta no encontrada")
        # La hora del escaneo la declara el escaner del guardia (personal autenticado); no puede ser futura.
        scanned_unix = min(decision.scanned_at, now_unix)
        scanned = datetime.fromtimestamp(scanned_unix, timezone.utc).replace(tzinfo=None)
        identity = _identity(decision)
        reason, ticket = _evaluate(decision, "admit", identity, gate, db, scanned, scanned_unix)
        if reason == "ok":
            reason = _admit(db, decision.nonce, ticket, scanned) if decision.decision == "admit" else "photo_mismatch"
            if decision.decision == "reject":
                _consume(db, decision.nonce, ticket, scanned)
        entry = AccessLog(
            token_id=decision.nonce,
            ticket_id=ticket.id if ticket else None,
            document_id=identity.rut if identity else None,
            gate_id=gate.id,
            scanned_by_id=guard.id,
            # Lo que paso en la puerta: si el guardia dejo pasar, la persona entro.
            granted=decision.decision == "admit",
            reason=reason,
            latency_ms=0.0,
            offline=True,
            created_at=scanned,
        )
        db.add(entry)
        db.commit()
        results.append(OfflineSyncResult(nonce=decision.nonce, reason=reason, alert=_is_alert(entry)))
    return results


def _is_alert(entry: AccessLog) -> bool:
    """Ingreso sin conexion que el servidor no habria permitido."""
    return entry.granted and entry.reason != "ok"


def _evaluate(
    payload: QRValidateIn | OfflineDecision,
    action: str,
    identity: IdentityCore | None,
    gate: Gate,
    db: Session,
    now: datetime,
    now_unix: int,
) -> tuple[str, Ticket | None]:
    """Todo lo que decide si la persona entra, sin modificar nada. Devuelve (motivo, entrada)."""
    if identity is None:
        # Cedula falsificada o QR armado sin la clave del telefono dueno de la cedula.
        return "invalid", None
    if payload.issued_at > now_unix + settings.qr_clock_skew_seconds:
        return "invalid", None  # fechado en el futuro: seria una forma de alargar la vigencia
    if revocations.is_revoked(credential_id(b64d(payload.credential_core))):
        # Telefono perdido o cedula activada en otro telefono (ADR-14): esta emision ya no vale.
        return "revoked", None
    ticket = (
        db.query(Ticket).filter(Ticket.event_id == gate.event_id, Ticket.document_id == identity.rut).first()
    )
    if now_unix - payload.issued_at > settings.qr_ttl_seconds + settings.qr_clock_skew_seconds:
        # Vencido, salvo que el guardia lo haya verificado a tiempo y este confirmando la foto.
        check = db.get(QRCheck, payload.nonce) if action != "check" else None
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
    if action == "check":
        # Vista previa de lo que haria "admit", para no pedirle al guardia que mire la foto en vano.
        if db.get(QRUse, payload.nonce) is not None:
            return "already_used", ticket
        if ticket.admitted_at is not None:
            return "already_admitted", ticket
    return "ok", ticket
