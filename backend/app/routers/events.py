from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import require_roles
from ..models import Event, Gate, Role
from ..schemas import EventCreate, EventOut, GateCreate, GateOut

router = APIRouter(prefix="/events", tags=["events"])

staff = Depends(require_roles(Role.ADMIN, Role.GUARD))
admin_only = Depends(require_roles(Role.ADMIN))


def get_event_or_404(db: Session, event_id: int) -> Event:
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Evento no encontrado")
    return event


@router.get("", response_model=list[EventOut], dependencies=[staff])
def list_events(db: Session = Depends(get_db)):
    return db.query(Event).order_by(Event.created_at.desc()).all()


@router.post("", response_model=EventOut, status_code=status.HTTP_201_CREATED, dependencies=[admin_only])
def create_event(payload: EventCreate, db: Session = Depends(get_db)):
    event = Event(name=payload.name, starts_at=payload.starts_at)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.get("/{event_id}/gates", response_model=list[GateOut], dependencies=[staff])
def list_gates(event_id: int, db: Session = Depends(get_db)):
    return get_event_or_404(db, event_id).gates


@router.post("/{event_id}/gates", response_model=GateOut, status_code=status.HTTP_201_CREATED, dependencies=[admin_only])
def create_gate(event_id: int, payload: GateCreate, db: Session = Depends(get_db)):
    get_event_or_404(db, event_id)
    gate = Gate(event_id=event_id, name=payload.name, lane=payload.lane)
    db.add(gate)
    db.commit()
    db.refresh(gate)
    return gate
