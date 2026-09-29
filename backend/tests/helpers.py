"""Utilidades compartidas entre archivos de test. No es un modulo de la app."""

import itertools
import pathlib

from app.credential import ed25519_public, new_secret_key
from app.database import SessionLocal
from app.models import Event, Gate, Lane, Role, Ticket, User
from app.rut import check_digit
from app.security import hash_password
from scripts.qr_clients import Phone, Scanner
from scripts.registro_civil_sim import (
    compress_photo,
    demo_avatar,
    ensure_issuer_keys,
    issue_credential,
    verifier_public_key,
)

TEST_ISSUER_DIR = pathlib.Path(__file__).parent / ".issuer"
ISSUER_SECRET = ensure_issuer_keys(TEST_ISSUER_DIR)
VERIFIER_PUBLIC = verifier_public_key(TEST_ISSUER_DIR)

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


def create_ticket(event_id: int, rut: str, holder_name: str = "Asistente Test") -> int:
    db = SessionLocal()
    ticket = Ticket(event_id=event_id, holder_name=holder_name, document_id=rut.replace("-", ""))
    db.add(ticket)
    db.commit()
    ticket_id = ticket.id
    db.close()
    return ticket_id


def phone_for(rut: str, name: str = "Asistente Test", issuer_secret: bytes = ISSUER_SECRET) -> Phone:
    """Telefono con la cedula digital de esa persona, ya enrolada (con su propia clave)."""
    device_secret = new_secret_key()
    credential = issue_credential(
        issuer_secret, name, rut, compress_photo(demo_avatar(rut + name)), ed25519_public(device_secret)
    )
    return Phone(credential, device_secret, VERIFIER_PUBLIC)


def person_with_ticket(event_id: int, name: str = "Asistente Test") -> tuple[int, Phone]:
    """Una persona con cedula digital y entrada para el evento. Devuelve (ticket_id, telefono)."""
    rut = new_rut()
    return create_ticket(event_id, rut, name), phone_for(rut, name)


def guard_scanner(client, email: str, event_id: int) -> tuple[str, Scanner]:
    create_user(email, Role.GUARD)
    token = login(client, email)
    return token, Scanner(client, token, event_id)
