"""Crea datos demo: personal (admin + 2 guardias), un evento con dos filas y la lista de RUT con
entrada, e inscribe a esas tres personas en el padron del Registro Civil simulado
(scripts/registro_civil_sim.py) para que activen su cedula digital en el telefono con RUT + clave
de activacion (claves fijas para poder repetir la demostracion).

Uso: uv run python -m app.seed

En un despliegue (deploy/start.sh) las contrasenas del personal demo vienen de DEMO_ADMIN_PASSWORD y
DEMO_GUARD_PASSWORD, porque las de abajo son publicas, y el padron va en REGISTRO_CIVIL_DIR.
"""

import os
import pathlib

from scripts.registro_civil_sim import DEFAULT_DIR, seed_demo_padron

from .database import Base, SessionLocal, engine
from .models import Event, Gate, Lane, Role, Ticket, User
from .rut import check_digit
from .security import hash_password

DEMO_USERS = [
    dict(email="admin@demo.cl", full_name="Admin Demo", role=Role.ADMIN, password="admin-demo-2026"),  # nosec B106: cuenta de demostracion
    dict(email="guardia@demo.cl", full_name="Guardia Fila Cédula Digital", role=Role.GUARD, password="guardia-demo-2026"),  # nosec B106: cuenta de demostracion
    dict(email="guardia2@demo.cl", full_name="Guardia Fila Normal", role=Role.GUARD, password="guardia-demo-2026"),  # nosec B106: cuenta de demostracion
]

DEMO_EVENT = "Concierto Demo - Estadio"
DEMO_GATES = [("Fila cédula digital A", Lane.DIGITAL), ("Fila normal B", Lane.NORMAL)]
DEMO_TICKETS = [
    dict(holder_name="Asistente Uno", rut_body="11111111"),
    dict(holder_name="Asistente Dos", rut_body="22222222"),
    dict(holder_name="Asistente Tres", rut_body="12345678"),
]


def demo_password(data: dict) -> tuple[str, bool]:
    """(contrasena, viene_de_variable). Solo se aplica al crear la cuenta: cambiarla despues es en «Personal»."""
    variable = "DEMO_ADMIN_PASSWORD" if data["role"] == Role.ADMIN else "DEMO_GUARD_PASSWORD"
    value = os.environ.get(variable)
    return (value, True) if value else (data["password"], False)


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
                    password_hash=hash_password(demo_password(data)[0]),
                )
            )

        event = db.query(Event).filter(Event.name == DEMO_EVENT).first()
        if event is None:
            event = Event(name=DEMO_EVENT)
            event.gates = [Gate(name=name, lane=lane) for name, lane in DEMO_GATES]
            event.tickets = [
                Ticket(
                    holder_name=t["holder_name"],
                    document_id=t["rut_body"] + check_digit(t["rut_body"]),
                )
                for t in DEMO_TICKETS
            ]
            db.add(event)
        db.commit()

        print("Personal demo:")
        for data in DEMO_USERS:
            password, from_env = demo_password(data)
            shown = "(la de la variable de entorno)" if from_env else password
            print(f"  - {data['email']} / {shown} ({data['role'].value})")
        # Separado del backend del evento: el padron (con las fotos) es del Registro Civil simulado.
        print("Registro Civil simulado (activar la cedula en /mi-cedula, RUT + clave de activacion):")
        registry = os.environ.get("REGISTRO_CIVIL_DIR")
        for name, rut, code in seed_demo_padron(pathlib.Path(registry) if registry else DEFAULT_DIR):
            print(f"  - {rut} + clave {code} ({name})")
        print(f"RUT con entrada para '{DEMO_EVENT}' (se cotejan en la puerta con la cedula):")
        for t in DEMO_TICKETS:
            print(f"  - {t['rut_body']}-{check_digit(t['rut_body'])} ({t['holder_name']})")
    finally:
        db.close()


if __name__ == "__main__":
    run()
