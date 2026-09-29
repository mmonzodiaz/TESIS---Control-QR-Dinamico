"""Crea datos demo: personal (admin + 2 guardias), un evento con dos filas y la lista de RUT con
entrada, e inscribe a esas tres personas en el padron del Registro Civil simulado
(scripts/registro_civil_sim.py) para que activen su cedula digital en el telefono con RUT + clave
de activacion (claves fijas para poder repetir la demostracion).

Uso: uv run python -m app.seed
"""

from scripts.registro_civil_sim import seed_demo_padron

from .database import Base, SessionLocal, engine
from .models import Event, Gate, Lane, Role, Ticket, User
from .rut import check_digit
from .security import hash_password

DEMO_USERS = [
    dict(email="admin@demo.cl", full_name="Admin Demo", role=Role.ADMIN, password="admin123"),
    dict(email="guardia@demo.cl", full_name="Guardia Fila Cédula Digital", role=Role.GUARD, password="guardia123"),
    dict(email="guardia2@demo.cl", full_name="Guardia Fila Normal", role=Role.GUARD, password="guardia123"),
]

DEMO_EVENT = "Concierto Demo - Estadio"
DEMO_GATES = [("Fila cédula digital A", Lane.DIGITAL), ("Fila normal B", Lane.NORMAL)]
DEMO_TICKETS = [
    dict(holder_name="Asistente Uno", rut_body="11111111"),
    dict(holder_name="Asistente Dos", rut_body="22222222"),
    dict(holder_name="Asistente Tres", rut_body="12345678"),
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
            print(f"  - {data['email']} / {data['password']} ({data['role'].value})")
        # Separado del backend del evento: el padron (con las fotos) es del Registro Civil simulado.
        print("Registro Civil simulado (activar la cedula en /mi-cedula, RUT + clave de activacion):")
        for name, rut, code in seed_demo_padron():
            print(f"  - {rut} + clave {code} ({name})")
        print(f"RUT con entrada para '{DEMO_EVENT}' (se cotejan en la puerta con la cedula):")
        for t in DEMO_TICKETS:
            print(f"  - {t['rut_body']}-{check_digit(t['rut_body'])} ({t['holder_name']})")
    finally:
        db.close()


if __name__ == "__main__":
    run()
