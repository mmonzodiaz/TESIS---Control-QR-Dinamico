from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..config import settings
from ..credential import b64e
from ..database import get_db
from ..deps import require_roles
from ..issuer import issuer_public_key, verifier_private_key
from ..models import BannedPerson, Event, Gate, Role, Ticket, unix_now
from ..revocation import revocations
from ..schemas import ContingencyOut, EventCreate, EventOut, GateCreate, GateOut, VerifierOut
from ..security import contingency_seal

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
    """Claves para que el escaner lea y verifique las cedulas localmente (incluso sin red). La clave
    de lectores solo llega al personal autenticado; en produccion viviria en un almacen seguro del
    lector. Se pide por evento para que el escaner confirme que el evento existe."""
    get_event_or_404(db, event_id)
    return VerifierOut(
        verifier_private_key=b64e(verifier_private_key()),
        issuer_public_key=b64e(issuer_public_key()),
        ttl_seconds=settings.qr_ttl_seconds,
        clock_skew_seconds=settings.qr_clock_skew_seconds,
        server_time=unix_now(),
    )


@router.get("/{event_id}/contingencia", response_model=ContingencyOut, dependencies=[staff])
def contingency(event_id: int, db: Session = Depends(get_db)):
    """Copia de contingencia para operar sin conexion (ADR-15): quienes tienen entrada, quienes ya
    ingresaron, prohibiciones y cedulas revocadas. El escaner la pide cada minuto mientras hay red y la
    guarda solo en memoria. Son datos personales (RUT): solo al personal autenticado."""
    get_event_or_404(db, event_id)
    tickets = db.query(Ticket.document_id, Ticket.admitted_at).filter(Ticket.event_id == event_id).all()
    revoked, revocation_issued_at = revocations.snapshot()
    generated_at = unix_now()
    return ContingencyOut(
        event_id=event_id,
        generated_at=generated_at,
        seal=contingency_seal(event_id, generated_at),
        max_age_seconds=settings.contingency_max_age_seconds,
        ticket_ruts=sorted(rut for rut, _ in tickets),
        admitted_ruts=sorted(rut for rut, admitted_at in tickets if admitted_at is not None),
        banned_ruts=sorted(rut for (rut,) in db.query(BannedPerson.document_id).all()),
        revoked_ids=sorted(revoked),
        revocation_list_issued_at=revocation_issued_at,
    )
