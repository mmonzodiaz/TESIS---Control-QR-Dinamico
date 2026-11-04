"""Apoyo al piloto en terreno (docs/piloto.md). No forma parte del sistema: se corre a mano en el PC.

  uv run python scripts/piloto.py reabrir  --evento 1   # entre demostraciones: la persona demo puede volver a entrar
  uv run python scripts/piloto.py exportar --evento 1   # al terminar: intentos anonimizados, en piloto-datos/

"reabrir" existe porque una entrada admite un solo ingreso (ADR-8): sin esto, la misma persona demo
quedaria como "ya ingreso" desde la segunda demostracion. Solo borra la marca de ingreso de ese evento;
el historial se conserva y un QR ya usado sigue sin servir. Es un comando local, sin API a proposito: en
un evento real, reabrir una entrada anularia el anti pass-back.

"exportar" no incluye RUT, nombres, nonces, cuentas del personal ni horas absolutas: las personas y los
guardias quedan como persona-1, guardia-1, numerados en orden de aparicion, y el tiempo como segundos
desde el primer intento. Escribe en backend/piloto-datos/, fuera de git.
"""

import argparse
import csv
import pathlib
import sys

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy.orm import Session  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.models import AccessLog, BiometricConsent, Event, Gate, QRCheck, QRUse, Ticket  # noqa: E402

OUTPUT_DIR = BACKEND_DIR / "piloto-datos"
COLUMNS = [
    "intento",
    "segundos_desde_inicio",
    "persona",
    "guardia",
    "fila",
    "tipo_fila",
    "dejo_pasar",
    "motivo",
    "sin_conexion",
    "alerta",
    "latencia_ms",
    "segundos_decision",
    "comparacion_facial",
]
# Motivos con los que el guardia alcanzo a decidir: los demas se rechazan antes de mirar la foto.
DECIDED = {"ok", "photo_mismatch"}


def reopen_event(db: Session, event_id: int) -> int:
    """Borra la marca de ingreso de las entradas del evento. Devuelve cuantas reabrio."""
    reopened = (
        db.query(Ticket)
        .filter(Ticket.event_id == event_id, Ticket.admitted_at.is_not(None))
        .update({Ticket.admitted_at: None}, synchronize_session=False)
    )
    db.commit()
    return reopened


def _pseudonym(table: dict, key: object, prefix: str) -> str | None:
    if key is None:
        return None
    return table.setdefault(key, f"{prefix}-{len(table) + 1}")


def export_rows(db: Session, event_id: int) -> list[dict]:
    """Intentos del evento, en orden y anonimizados."""
    gate_ids = [gate_id for (gate_id,) in db.query(Gate.id).filter(Gate.event_id == event_id)]
    entries = (
        db.query(AccessLog).filter(AccessLog.gate_id.in_(gate_ids)).order_by(AccessLog.created_at, AccessLog.id).all()
    )
    nonces = [entry.token_id for entry in entries if entry.token_id]
    checks = dict(db.query(QRCheck.nonce, QRCheck.checked_at).filter(QRCheck.nonce.in_(nonces)).all())
    uses = dict(db.query(QRUse.nonce, QRUse.used_at).filter(QRUse.nonce.in_(nonces)).all())
    consents = {nonce for (nonce,) in db.query(BiometricConsent.nonce).filter(BiometricConsent.nonce.in_(nonces))}

    people: dict = {}
    guards: dict = {}
    rows = []
    for number, entry in enumerate(entries, start=1):
        decision_seconds = None
        if not entry.offline and entry.reason in DECIDED and entry.token_id in checks and entry.token_id in uses:
            decision_seconds = round((uses[entry.token_id] - checks[entry.token_id]).total_seconds(), 1)
        rows.append(
            {
                "intento": number,
                "segundos_desde_inicio": round((entry.created_at - entries[0].created_at).total_seconds(), 1),
                "persona": _pseudonym(people, entry.document_id, "persona"),
                "guardia": _pseudonym(guards, entry.scanned_by_id, "guardia"),
                "fila": entry.gate.name if entry.gate else None,
                "tipo_fila": entry.gate.lane.value if entry.gate else None,
                "dejo_pasar": entry.granted,
                "motivo": entry.reason,
                "sin_conexion": entry.offline,
                "alerta": entry.offline and entry.granted and entry.reason != "ok",
                "latencia_ms": entry.latency_ms,
                "segundos_decision": decision_seconds,
                "comparacion_facial": entry.token_id in consents,
            }
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Apoyo al piloto en terreno.")
    parser.add_argument("accion", choices=["reabrir", "exportar"])
    parser.add_argument("--evento", type=int, required=True, help="id del evento (el evento demo suele ser 1)")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        event = db.get(Event, args.evento)
        if event is None:
            available = ", ".join(f"{e.id}: {e.name}" for e in db.query(Event).all()) or "ninguno"
            raise SystemExit(f"No existe el evento {args.evento}. Disponibles: {available}")
        if args.accion == "reabrir":
            print(f"Reabiertas {reopen_event(db, event.id)} entradas de '{event.name}'.")
            return
        rows = export_rows(db, event.id)
    finally:
        db.close()

    OUTPUT_DIR.mkdir(exist_ok=True)
    path = OUTPUT_DIR / f"intentos-evento-{args.evento}.csv"
    with open(path, "w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"{len(rows)} intentos en {path}")


if __name__ == "__main__":
    main()
