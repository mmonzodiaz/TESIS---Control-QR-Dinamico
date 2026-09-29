"""Utilidades compartidas entre archivos de test. No es un modulo de la app."""

import itertools
import pathlib

from app.database import SessionLocal
from app.models import Event, Gate, Lane, Role, Ticket, User
from app.rut import check_digit
from app.security import generate_ticket_code, hash_password, hash_ticket_code
from scripts.qr_clients import Phone, Scanner
from scripts.registro_civil_sim import compress_photo, demo_avatar, ensure_issuer_keys, issue_credential

TEST_ISSUER_DIR = pathlib.Path(__file__).parent / ".issuer"
ISSUER_SECRET = ensure_issuer_keys(TEST_ISSUER_DIR)

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


def issue_identity(rut: str, name: str = "Asistente Test", issuer_secret: bytes = ISSUER_SECRET):
    """Cedula digital emitida por el Registro Civil simulado de los tests."""
    return issue_credential(issuer_secret, name, rut, compress_photo(demo_avatar(rut + name)))


def phone_for(rut: str, name: str = "Asistente Test") -> Phone:
    return Phone(issue_identity(rut, name))


def claim(client, rut: str, code: str, phone: Phone | None = None) -> str:
    phone = phone or phone_for(rut)
    res = phone.claim(client, rut, code)
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def attendee_phone(client, event_id: int | None = None) -> tuple[int, Phone]:
    """Crea una entrada (y evento si no se entrega) y la activa en un telefono. Devuelve (ticket_id, telefono)."""
    if event_id is None:
        event_id, _ = create_event()
    ticket_id, rut, code = create_ticket(event_id)
    phone = phone_for(rut)
    claim(client, rut, code, phone)
    return ticket_id, phone


def attendee_session(client, event_id: int | None = None) -> tuple[int, str]:
    """Como attendee_phone, pero devuelve el JWT de la sesion del asistente."""
    ticket_id, phone = attendee_phone(client, event_id)
    return ticket_id, phone.session


def guard_scanner(client, email: str, event_id: int) -> tuple[str, Scanner]:
    create_user(email, Role.GUARD)
    token = login(client, email)
    return token, Scanner(client, token, event_id)
