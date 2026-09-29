"""Entradas nominativas: la lista de RUT que tienen entrada para un evento.

No hay activacion ni codigo en el telefono: la persona solo muestra su cedula digital (que es suya,
no del evento). En la puerta, el lector verifica la identidad y el servidor coteja el RUT firmado
de la cedula con esta lista, como hoy se coteja la entrada nominativa con el carnet.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_roles
from ..models import Role, Ticket
from ..rut import is_valid_rut, mask_rut, normalize_rut
from ..schemas import AttendeeOut, EventOut, TicketCreate, TicketOut
from .events import get_event_or_404

router = APIRouter(tags=["tickets"])

admin_only = Depends(require_roles(Role.ADMIN))


def attendee_out(ticket: Ticket) -> AttendeeOut:
    return AttendeeOut(
        ticket_id=ticket.id,
        holder_name=ticket.holder_name,
        rut_masked=mask_rut(ticket.document_id),
        event=EventOut.model_validate(ticket.event),
        admitted_at=ticket.admitted_at,
    )


@router.get("/events/{event_id}/tickets", response_model=list[TicketOut], dependencies=[admin_only])
def list_tickets(event_id: int, db: Session = Depends(get_db)):
    get_event_or_404(db, event_id)
    return db.query(Ticket).filter(Ticket.event_id == event_id).order_by(Ticket.created_at.desc()).all()


@router.post(
    "/events/{event_id}/tickets",
    response_model=TicketOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[admin_only],
)
def create_ticket(event_id: int, payload: TicketCreate, db: Session = Depends(get_db)):
    get_event_or_404(db, event_id)
    if not is_valid_rut(payload.rut):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="RUT inválido")
    ticket = Ticket(event_id=event_id, holder_name=payload.holder_name, document_id=normalize_rut(payload.rut))
    db.add(ticket)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ese RUT ya tiene entrada para este evento")
    db.refresh(ticket)
    return ticket


@router.delete("/tickets/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[admin_only])
def delete_ticket(ticket_id: int, db: Session = Depends(get_db)):
    ticket = db.get(Ticket, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entrada no encontrada")
    db.delete(ticket)
    db.commit()
