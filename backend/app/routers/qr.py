import time
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import update
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import get_current_ticket, require_roles
from ..models import AccessLog, Gate, QRToken, Role, Ticket, User, is_banned, utcnow
from ..schemas import QRGenerateOut, QRValidateIn, QRValidateOut
from .tickets import attendee_out

router = APIRouter(prefix="/qr", tags=["qr"])


@router.post("/generate", response_model=QRGenerateOut)
def generate_qr(ticket: Ticket = Depends(get_current_ticket), db: Session = Depends(get_db)):
    if ticket.admitted_at is not None:
        # Anti pass-back (A9): quien ya ingreso no puede sacar otro QR para "pasarlo" a alguien.
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="already_admitted")

    now = utcnow()

    # Invalida cualquier QR anterior sin usar para que solo exista un codigo vigente por entrada.
    db.query(QRToken).filter(
        QRToken.ticket_id == ticket.id,
        QRToken.used.is_(False),
    ).update({"used": True, "used_at": now})

    token = QRToken(
        ticket_id=ticket.id,
        expires_at=now + timedelta(seconds=settings.qr_ttl_seconds),
    )
    db.add(token)
    db.commit()
    db.refresh(token)

    return QRGenerateOut(token=token.id, expires_at=token.expires_at, ttl_seconds=settings.qr_ttl_seconds)


@router.post("/validate", response_model=QRValidateOut)
def validate_qr(
    payload: QRValidateIn,
    guard: User = Depends(require_roles(Role.GUARD, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    started = time.perf_counter()
    now = utcnow()

    gate = None
    if payload.gate_id is not None:
        gate = db.get(Gate, payload.gate_id)
        if gate is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Puerta no encontrada")

    token = db.get(QRToken, payload.token)
    ticket = token.ticket if token else None

    if token is None:
        reason = "invalid"
    elif gate is not None and gate.event_id != ticket.event_id:
        reason = "wrong_event"
    elif is_banned(db, ticket.document_id):
        # Se revisa en la puerta (no al generar) para que una prohibicion agregada a ultima hora aplique.
        # No consume el QR ni registra ingreso.
        reason = "banned"
    else:
        # Consumo atomico: con varias puertas escaneando en paralelo, solo un UPDATE
        # puede pasar used de 0 a 1. Leer y luego escribir dejaba una carrera.
        consumed = db.execute(
            update(QRToken)
            .where(QRToken.id == token.id, QRToken.used.is_(False), QRToken.expires_at >= now)
            .values(used=True, used_at=now)
        ).rowcount
        if not consumed:
            db.refresh(token)
            reason = "already_used" if token.used else "expired"
        else:
            admitted = db.execute(
                update(Ticket).where(Ticket.id == ticket.id, Ticket.admitted_at.is_(None)).values(admitted_at=now)
            ).rowcount
            reason = "ok" if admitted else "already_admitted"

    granted = reason == "ok"
    latency_ms = round((time.perf_counter() - started) * 1000, 3)
    db.add(
        AccessLog(
            token_id=token.id if token else None,
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
