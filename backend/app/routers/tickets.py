"""Entradas nominativas y el flujo publico "RUT + codigo de entrada -> QR dinamico".

Por que no basta un solo dato (ej. RUT): el RUT identifica pero no autentica; es
conocido por terceros, asi que cualquiera podria generar el QR de otra persona (A7 en
docs/threat-model.md). El codigo de la entrada agrega un factor de posesion.

Al activar, el telefono entrega su clave publica y la credencial del Registro Civil sin la foto
(ADR-11). Desde ahi genera los QR solo, sin conexion.
"""

import hmac

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..credential import CredentialError, b64d, parse_core, verify_issuer
from ..database import get_db
from ..deps import claim_rate_limiter, get_current_ticket, require_roles
from ..issuer import issuer_public_key
from ..models import Role, Ticket, unix_now, utcnow
from ..rut import is_valid_rut, mask_rut, normalize_rut
from ..schemas import (
    AttendeeOut,
    EventOut,
    QRParamsOut,
    TicketClaimIn,
    TicketClaimOut,
    TicketCreate,
    TicketCreatedOut,
    TicketOut,
    TicketSessionOut,
)
from ..security import create_access_token, generate_ticket_code, hash_ticket_code, new_claim_session
from .events import get_event_or_404

router = APIRouter(tags=["tickets"])

admin_only = Depends(require_roles(Role.ADMIN))

# Mismo mensaje para RUT inexistente, codigo incorrecto o RUT que no calza: no revela
# si un RUT tiene entrada (enumeracion).
INVALID_CLAIM = "RUT o codigo de entrada invalido"


def attendee_out(ticket: Ticket) -> AttendeeOut:
    return AttendeeOut(
        ticket_id=ticket.id,
        holder_name=ticket.holder_name,
        rut_masked=mask_rut(ticket.document_id),
        event=EventOut.model_validate(ticket.event),
        admitted_at=ticket.admitted_at,
    )


def qr_params(ticket: Ticket) -> QRParamsOut:
    return QRParamsOut(
        event_id=ticket.event_id,
        ticket_id=ticket.id,
        event_public_key=ticket.event.qr_public_key,
        ttl_seconds=settings.qr_ttl_seconds,
        server_time=unix_now(),
    )


@router.post("/tickets/claim", response_model=TicketClaimOut, dependencies=[Depends(claim_rate_limiter)])
def claim_ticket(payload: TicketClaimIn, db: Session = Depends(get_db)):
    unauthorized = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=INVALID_CLAIM)
    if not is_valid_rut(payload.rut):
        raise unauthorized
    ticket = db.query(Ticket).filter(Ticket.code_hash == hash_ticket_code(payload.code)).first()
    if ticket is None or not hmac.compare_digest(ticket.document_id, normalize_rut(payload.rut)):
        raise unauthorized

    if ticket.claim_session is not None:
        # Vinculo a dispositivo (A8): una entrada filtrada o revendida no se puede
        # "abrir" en un segundo telefono. Soporte puede liberarla (POST /tickets/{id}/reset).
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Esta entrada ya esta vinculada a otro dispositivo. Acude a soporte del evento.",
        )

    # Despues de validar RUT + codigo ya se puede ser especifico: no hay enumeracion posible.
    try:
        b64d(payload.device_public_key, 32)
        core_bytes = b64d(payload.credential_core)
        if not verify_issuer(issuer_public_key(), core_bytes, b64d(payload.issuer_sig, 64)):
            raise CredentialError("firma")
        core = parse_core(core_bytes)
    except CredentialError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La cedula importada no es valida (no la emitio el Registro Civil o fue alterada)",
        )
    if not hmac.compare_digest(core.rut, ticket.document_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La cedula importada es de otra persona: la entrada es nominativa",
        )

    ticket.claim_session = new_claim_session()
    ticket.device_public_key = payload.device_public_key
    ticket.claimed_at = utcnow()
    db.commit()
    db.refresh(ticket)

    token = create_access_token(subject=f"ticket:{ticket.id}", extra={"sid": ticket.claim_session})
    return TicketClaimOut(access_token=token, attendee=attendee_out(ticket), qr=qr_params(ticket))


@router.get("/tickets/me", response_model=TicketSessionOut)
def my_ticket(ticket: Ticket = Depends(get_current_ticket)):
    return TicketSessionOut(attendee=attendee_out(ticket), qr=qr_params(ticket))


@router.get("/events/{event_id}/tickets", response_model=list[TicketOut], dependencies=[admin_only])
def list_tickets(event_id: int, db: Session = Depends(get_db)):
    get_event_or_404(db, event_id)
    return db.query(Ticket).filter(Ticket.event_id == event_id).order_by(Ticket.created_at.desc()).all()


@router.post(
    "/events/{event_id}/tickets",
    response_model=TicketCreatedOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[admin_only],
)
def create_ticket(event_id: int, payload: TicketCreate, db: Session = Depends(get_db)):
    get_event_or_404(db, event_id)
    if not is_valid_rut(payload.rut):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="RUT invalido")
    code = generate_ticket_code()
    ticket = Ticket(
        event_id=event_id,
        holder_name=payload.holder_name,
        document_id=normalize_rut(payload.rut),
        code_hash=hash_ticket_code(code),
    )
    db.add(ticket)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ese RUT ya tiene entrada para este evento")
    db.refresh(ticket)
    return TicketCreatedOut(**TicketOut.model_validate(ticket).model_dump(), code=code)


@router.post("/tickets/{ticket_id}/reset", response_model=TicketOut, dependencies=[admin_only])
def reset_ticket_device(ticket_id: int, db: Session = Depends(get_db)):
    ticket = db.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entrada no encontrada")
    ticket.claim_session = None
    ticket.device_public_key = None
    ticket.claimed_at = None
    db.commit()
    db.refresh(ticket)
    return ticket
