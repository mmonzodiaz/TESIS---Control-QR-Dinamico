"""Utilidades compartidas entre archivos de test. No es un modulo de la app."""

import itertools

from app.database import SessionLocal
from app.models import Event, Gate, Lane, Role, Ticket, User
from app.rut import check_digit
from app.security import generate_ticket_code, hash_password, hash_ticket_code

DEFAULT_PASSWORD = "test-password-123"

# RUTs distintos por test para no chocar con la restriccion (event_id, document_id).
_rut_bodies = itertools.count(10_000_000)


def create_user(email: str, role: Role, password: str = DEFAULT_PASSWORD) -> None:
    db = SessionLocal()
    db.add(User(email=email, full_name=email, role=role, password_hash=hash_password(password)))
    db.commit()
    db.close()


def login(client, email: str, password: str = DEFAULT_PASSWORD) -> str:
    res = client.post("/auth/login", data={"username": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def new_rut() -> str:
    body = str(next(_rut_bodies))
    return f"{body}-{check_digit(body)}"


def create_event(name: str = "Evento test", gates: int = 1) -> tuple[int, list[int]]:
    db = SessionLocal()
    event = Event(name=name)
    event.gates = [Gate(name=f"Puerta {i + 1}", lane=Lane.FAST) for i in range(gates)]
    db.add(event)
    db.commit()
    result = event.id, [g.id for g in event.gates]
    db.close()
    return result


def create_ticket(event_id: int, holder_name: str = "Asistente Test") -> tuple[int, str, str]:
    """Devuelve (ticket_id, rut, codigo en claro)."""
    rut, code = new_rut(), generate_ticket_code()
    db = SessionLocal()
    ticket = Ticket(
        event_id=event_id,
        holder_name=holder_name,
        document_id=rut.replace("-", ""),
        code_hash=hash_ticket_code(code),
    )
    db.add(ticket)
    db.commit()
    ticket_id = ticket.id
    db.close()
    return ticket_id, rut, code


def claim(client, rut: str, code: str) -> str:
    res = client.post("/tickets/claim", json={"rut": rut, "code": code})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def attendee_session(client, event_id: int | None = None) -> tuple[int, str]:
    """Crea una entrada (y evento si no se entrega) y la reclama. Devuelve (ticket_id, jwt)."""
    if event_id is None:
        event_id, _ = create_event()
    ticket_id, rut, code = create_ticket(event_id)
    return ticket_id, claim(client, rut, code)
