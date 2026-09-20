"""Utilidades compartidas entre archivos de test. No es un modulo de la app."""

from app.database import SessionLocal
from app.models import Role, User
from app.security import hash_password

DEFAULT_PASSWORD = "test-password-123"


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
