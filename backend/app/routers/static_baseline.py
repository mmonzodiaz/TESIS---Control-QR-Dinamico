"""LINEA BASE para experimentos: emula el QR estatico del carnet fisico. NO es parte de la propuesta.

Solo se monta si ENABLE_STATIC_BASELINE=1 (ver scripts/attack_experiment.py). Modela lo que
verifica hoy la lectura del QR del carnet en un evento: que el documento exista y este vigente, y
que ese RUT tenga entrada. El QR es FIJO: el mismo en todos los eventos y durante toda la vida del
documento.

Para que la comparacion con el QR dinamico sea justa, la linea base tiene la misma admision unica
por entrada (Ticket.admitted_at, actualizacion atomica). Asi la unica diferencia entre ambos modos
es que la credencial sea estatica o dinamica.
"""

import hashlib
import time

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import update
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_roles
from ..models import AccessLog, Gate, Role, Ticket, User, is_banned, utcnow
from ..schemas import QRValidateOut
from .tickets import attendee_out

router = APIRouter(prefix="/baseline", tags=["baseline (experimentos)"])

STATIC_PREFIX = "CARNET"


class StaticValidateIn(BaseModel):
    qr: str
    gate_id: int


def card_serial(document_id: str) -> str:
    # Numero de serie del documento: fijo por persona, no por evento (como el del carnet).
    return hashlib.sha256(f"serie:{document_id}".encode()).hexdigest()[:9].upper()


def static_qr_for(document_id: str) -> str:
    return f"{STATIC_PREFIX}:{document_id}:{card_serial(document_id)}"


@router.post("/static-validate", response_model=QRValidateOut)
def validate_static(
    payload: StaticValidateIn,
    guard: User = Depends(require_roles(Role.GUARD, Role.ADMIN)),
    db: Session = Depends(get_db),
):
    started = time.perf_counter()
    gate = db.get(Gate, payload.gate_id)
    if gate is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Puerta no encontrada")

    ticket = None
    parts = payload.qr.split(":")
    if len(parts) == 3 and parts[0] == STATIC_PREFIX and parts[2] == card_serial(parts[1]):
        ticket = db.query(Ticket).filter(Ticket.event_id == gate.event_id, Ticket.document_id == parts[1]).first()

    if ticket is None:
        reason = "invalid"
    elif is_banned(db, ticket.document_id):
        reason = "banned"
    else:
        admitted = db.execute(
            update(Ticket).where(Ticket.id == ticket.id, Ticket.admitted_at.is_(None)).values(admitted_at=utcnow())
        ).rowcount
        reason = "ok" if admitted else "already_admitted"

    latency_ms = round((time.perf_counter() - started) * 1000, 3)
    db.add(
        AccessLog(
            token_id=None,
            ticket_id=ticket.id if ticket else None,
            gate_id=gate.id,
            scanned_by_id=guard.id,
            granted=reason == "ok",
            reason=reason,
            latency_ms=latency_ms,
        )
    )
    db.commit()
    if ticket is not None:
        db.refresh(ticket)
    return QRValidateOut(
        granted=reason == "ok",
        reason=reason,
        attendee=attendee_out(ticket) if ticket else None,
        latency_ms=latency_ms,
    )
