"""Crea usuarios demo: admin, guardia y dos residentes.

Uso: uv run python -m app.seed
"""

from .database import Base, SessionLocal, engine
from .models import Role, User
from .security import hash_password

DEMO_USERS = [
    dict(email="admin@demo.cl", full_name="Admin Demo", role=Role.ADMIN, password="admin123"),
    dict(email="guardia@demo.cl", full_name="Portero Demo", role=Role.GUARD, password="guardia123"),
    dict(email="residente1@demo.cl", full_name="Residente Uno", role=Role.RESIDENT, password="residente123"),
    dict(email="residente2@demo.cl", full_name="Residente Dos", role=Role.RESIDENT, password="residente123"),
]


def run():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        for data in DEMO_USERS:
            if db.query(User).filter(User.email == data["email"]).first():
                continue
            db.add(
                User(
                    email=data["email"],
                    full_name=data["full_name"],
                    role=data["role"],
                    password_hash=hash_password(data["password"]),
                )
            )
        db.commit()
        print("Usuarios demo listos:")
        for data in DEMO_USERS:
            print(f"  - {data['email']} / {data['password']} ({data['role'].value})")
    finally:
        db.close()


if __name__ == "__main__":
    run()
