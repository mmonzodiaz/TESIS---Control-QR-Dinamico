from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..config import settings
from ..credential import b64e
from ..database import get_db
from ..deps import require_roles
from ..issuer import issuer_public_key
from ..models import Event, Gate, Role, unix_now
from ..schemas import EventCreate, EventOut, GateCreate, GateOut, VerifierOut

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


@router.get("/{event_id}/verifier", response_model=VerifierOut, dependencies=[staff])
def verifier_keys(event_id: int, db: Session = Depends(get_db)):
    """Claves para que el escaner lea y verifique los QR localmente. La privada del evento solo
    llega al personal autenticado; en produccion viviria en un almacen seguro del escaner."""
    event = get_event_or_404(db, event_id)
    return VerifierOut(
        event_id=event.id,
        event_private_key=event.qr_private_key,
        issuer_public_key=b64e(issuer_public_key()),
        ttl_seconds=settings.qr_ttl_seconds,
        clock_skew_seconds=settings.qr_clock_skew_seconds,
        server_time=unix_now(),
    )
