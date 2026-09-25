"""Experimento de ataque: QR estatico del carnet fisico vs. QR dinamico (docs/attack-experiment.md).

Ejecuta los mismos ataques contra ambos modos, sobre el backend real (en proceso, base temporal):

- estatico: /baseline/static-validate (emula el QR fijo del carnet; routers/static_baseline.py)
- dinamico: /qr/validate (la propuesta)

Ambos modos comparten la admision unica por entrada, asi que la unica variable es que la credencial
sea estatica o dinamica. El reloj del backend se controla desde el script para simular esperas
(60 s, 1 h, 30 dias) sin tener que esperar de verdad.

Fuera de alcance de la automatizacion: la verificacion visual del guardia. En el modo estatico, un
carnet falsificado lleva la foto del atacante, asi que esa verificacion no lo detiene (ver
docs/threat-model.md §6).

Uso (desde backend/):  uv run python scripts/attack_experiment.py
Escribe docs/results/attack-experiment.json y docs/results/attack-experiment.md.
"""

import itertools
import json
import os
import pathlib
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
RESULTS_DIR = BACKEND_DIR.parent / "docs" / "results"
DB_PATH = BACKEND_DIR / "attack-experiment.db"

T0 = datetime(2026, 10, 1, 20, 0, 0)  # apertura de puertas simulada (UTC naive, como el backend)
_rut_bodies = itertools.count(40_000_000)


@dataclass(frozen=True)
class Scenario:
    key: str
    title: str
    description: str


def relay_delay_s(ttl: int) -> float:
    return ttl * 0.1  # el complice escanea dentro de la ventana de validez


def scenarios(ttl: int) -> list[Scenario]:
    return [
        Scenario("control", "Control: el titular legitimo ingresa", "Sin ataque. Verifica que ningun modo rechace al titular."),
        Scenario("photo_60s", "Foto del QR usada 60 s despues", "El atacante fotografia el QR del titular y lo presenta 60 s despues, antes de que el titular llegue a la puerta."),
        Scenario("photo_1h", "Foto del QR usada 1 hora despues", "Idem, 1 hora despues (misma jornada)."),
        Scenario("other_event", "Copia usada en otro evento, 30 dias despues", "La copia capturada se presenta en otro evento al que el titular tambien tiene entrada."),
        Scenario("relay", f"Reenvio en tiempo real ({relay_delay_s(ttl):g} s)", "El QR se reenvia a un complice que escanea en la puerta antes que el titular, dentro de la ventana de validez."),
        Scenario("after_holder", "Copia usada despues de que el titular ingreso", "El titular entra primero; luego el atacante presenta la copia."),
    ]


BAN_COPY_DELAY_S = 600  # la copia del QR del tercero se capturo 10 min antes (p. ej. en la fila)


def ban_scenarios(ttl: int) -> list[Scenario]:
    """Filtro de personas con prohibicion de ingreso (p. ej. hinchas sancionados)."""
    return [
        Scenario(
            "ban_own",
            "Control: persona con prohibicion usa su propia credencial",
            "La persona sancionada tiene entrada y presenta su propio carnet / QR. Verifica que el filtro funcione.",
        ),
        Scenario(
            "ban_copy",
            "Persona con prohibicion usa la copia del QR de un tercero",
            "Presenta la copia del QR de alguien sin prohibicion (capturada 10 min antes, sin que el tercero coopere).",
        ),
        Scenario(
            "ban_lent",
            "Persona con prohibicion usa la credencial prestada por un tercero",
            f"Un tercero sin prohibicion coopera: presta su carnet (estatico) o le reenvia su QR en tiempo real, {relay_delay_s(ttl):g} s (dinamico).",
        ),
    ]


class Clock:
    def __init__(self) -> None:
        self.now = T0

    def __call__(self) -> datetime:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


@contextmanager
def patched_clock(clock: Clock):
    from app.routers import qr, static_baseline

    originals = (qr.utcnow, static_baseline.utcnow)
    qr.utcnow = static_baseline.utcnow = clock
    try:
        yield
    finally:
        qr.utcnow, static_baseline.utcnow = originals


def run_experiment(client) -> dict:
    """Corre todos los escenarios en ambos modos. `client` es un TestClient de app.main."""
    from app.config import settings
    from app.database import SessionLocal
    from app.models import BannedPerson, Event, Gate, Lane, Role, Ticket, User
    from app.routers.static_baseline import static_qr_for
    from app.rut import check_digit
    from app.security import create_access_token, hash_password, hash_ticket_code, new_claim_session

    ttl = settings.qr_ttl_seconds
    guard_email = f"guardia-ataque-{next(_rut_bodies)}@test.cl"
    db = SessionLocal()
    db.add(User(email=guard_email, full_name="Guardia", role=Role.GUARD, password_hash=hash_password("x-123456")))
    db.commit()
    db.close()
    guard = client.post("/auth/login", data={"username": guard_email, "password": "x-123456"}).json()["access_token"]
    guard_h = {"Authorization": f"Bearer {guard}"}

    def new_event() -> int:
        db = SessionLocal()
        event = Event(name="Evento experimento")
        event.gates = [Gate(name="Puerta", lane=Lane.FAST)]
        db.add(event)
        db.commit()
        gate_id = event.gates[0].id
        db.close()
        return gate_id

    def new_ticket(gate_id: int, document_id: str) -> str:
        """Entrada ya activada en un dispositivo; devuelve el JWT del titular."""
        db = SessionLocal()
        gate = db.get(Gate, gate_id)
        ticket = Ticket(
            event_id=gate.event_id,
            holder_name="Titular",
            document_id=document_id,
            code_hash=hash_ticket_code(f"X{document_id}{gate_id}"),
            claim_session=new_claim_session(),
        )
        db.add(ticket)
        db.commit()
        jwt = create_access_token(f"ticket:{ticket.id}", extra={"sid": ticket.claim_session})
        db.close()
        return jwt

    def credential(mode: str, jwt: str, document_id: str) -> str:
        if mode == "estatico":
            return static_qr_for(document_id)  # el QR del carnet: siempre el mismo
        res = client.post("/qr/generate", headers={"Authorization": f"Bearer {jwt}"})
        return res.json()["token"] if res.status_code == 200 else ""

    def present(mode: str, qr: str, gate_id: int) -> dict:
        if mode == "estatico":
            res = client.post("/baseline/static-validate", json={"qr": qr, "gate_id": gate_id}, headers=guard_h)
        else:
            res = client.post("/qr/validate", json={"token": qr, "gate_id": gate_id}, headers=guard_h)
        body = res.json()
        return {"granted": body["granted"], "reason": body["reason"]}

    def holder_attempt(mode: str, jwt: str, document_id: str, gate_id: int) -> dict:
        if mode == "dinamico":
            res = client.post("/qr/generate", headers={"Authorization": f"Bearer {jwt}"})
            if res.status_code != 200:
                # Si otro ya entro con su entrada, el telefono del titular ni siquiera genera QR.
                return {"granted": False, "reason": res.json()["detail"]}
            return present(mode, res.json()["token"], gate_id)
        return present(mode, credential(mode, jwt, document_id), gate_id)

    rows = []
    for scenario in scenarios(ttl):
        row = {"key": scenario.key, "title": scenario.title, "description": scenario.description}
        for mode in ("estatico", "dinamico"):
            clock = Clock()
            with patched_clock(clock):
                body = str(next(_rut_bodies))
                document_id = body + check_digit(body)
                gate_id = new_event()
                jwt = new_ticket(gate_id, document_id)
                captured = credential(mode, jwt, document_id)  # lo que muestra el titular (y el atacante copia)

                holder_after = None
                if scenario.key == "control":
                    attempt = present(mode, captured, gate_id)
                elif scenario.key == "after_holder":
                    present(mode, captured, gate_id)  # entra el titular
                    attempt = present(mode, captured, gate_id)  # luego el atacante con la copia
                else:
                    target_gate, target_jwt = gate_id, jwt
                    if scenario.key == "other_event":
                        target_gate = new_event()
                        target_jwt = new_ticket(target_gate, document_id)
                    clock.advance(
                        {"photo_60s": 60, "photo_1h": 3600, "other_event": 30 * 86400, "relay": relay_delay_s(ttl)}[
                            scenario.key
                        ]
                    )
                    attempt = present(mode, captured, target_gate)
                    # Luego llega el titular con su credencial vigente: ¿puede entrar?
                    holder_after = holder_attempt(mode, target_jwt, document_id, target_gate)

            row[mode] = {"attempt": attempt, "holder_after": holder_after}
        rows.append(row)
    def ban(document_id: str) -> None:
        db = SessionLocal()
        db.add(BannedPerson(document_id=document_id, reason="Experimento"))
        db.commit()
        db.close()

    def new_person() -> str:
        body = str(next(_rut_bodies))
        return body + check_digit(body)

    ban_rows = []
    for scenario in ban_scenarios(ttl):
        row = {"key": scenario.key, "title": scenario.title, "description": scenario.description}
        for mode in ("estatico", "dinamico"):
            clock = Clock()
            with patched_clock(clock):
                gate_id = new_event()
                banned = new_person()
                ban(banned)
                if scenario.key == "ban_own":
                    banned_jwt = new_ticket(gate_id, banned)
                    attempt = present(mode, credential(mode, banned_jwt, banned), gate_id)
                else:
                    # El filtro revisa el RUT de la credencial presentada: el del tercero, que no tiene prohibicion.
                    third = new_person()
                    third_jwt = new_ticket(gate_id, third)
                    captured = credential(mode, third_jwt, third)
                    clock.advance(BAN_COPY_DELAY_S if scenario.key == "ban_copy" else relay_delay_s(ttl))
                    attempt = present(mode, captured, gate_id)
            row[mode] = {"attempt": attempt, "holder_after": None}
        ban_rows.append(row)

    return {"ttl_seconds": ttl, "rows": rows, "ban_rows": ban_rows}


def summarize(result: dict) -> dict:
    attacks = [r for r in result["rows"] if r["key"] != "control"]
    evasions = [r for r in result["ban_rows"] if r["key"] != "ban_own"]
    ban_own = next(r for r in result["ban_rows"] if r["key"] == "ban_own")
    return {
        mode: {
            "attacks_succeeded": sum(r[mode]["attempt"]["granted"] for r in attacks),
            "attacks_total": len(attacks),
            "ban_evasions_succeeded": sum(r[mode]["attempt"]["granted"] for r in evasions),
            "ban_evasions_total": len(evasions),
            "ban_filter_blocks_own_credential": not ban_own[mode]["attempt"]["granted"],
            "legit_holder_accepted": next(r for r in result["rows"] if r["key"] == "control")[mode]["attempt"]["granted"],
        }
        for mode in ("estatico", "dinamico")
    }


def cell(outcome: dict | None, attack: bool) -> str:
    if outcome is None:
        return "—"
    if not attack:
        return f"{'Acepta' if outcome['granted'] else 'RECHAZA'} (`{outcome['reason']}`)"
    return f"{'**ATAQUE PASA**' if outcome['granted'] else 'Bloqueado'} (`{outcome['reason']}`)"


def write_results(result: dict) -> None:
    summary = summarize(result)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / "attack-experiment.json").write_text(json.dumps({**result, "summary": summary}, indent=2), encoding="utf-8")

    lines = [
        "# Resultados del experimento de ataque (generado)",
        "",
        "Generado por `backend/scripts/attack_experiment.py`. No editar a mano. Metodo en `docs/attack-experiment.md`.",
        "",
        f"TTL del QR dinamico: {result['ttl_seconds']} s. Ambos modos tienen admision unica por entrada.",
        "",
        "| Escenario | QR estatico (carnet) | QR dinamico | Titular despues: estatico | Titular despues: dinamico |",
        "|---|---|---|---|---|",
    ]
    for r in result["rows"]:
        attack = r["key"] != "control"
        lines.append(
            f"| {r['title']} | {cell(r['estatico']['attempt'], attack)} | {cell(r['dinamico']['attempt'], attack)} | "
            f"{cell(r['estatico']['holder_after'], False)} | {cell(r['dinamico']['holder_after'], False)} |"
        )
    s, d = summary["estatico"], summary["dinamico"]
    lines += [
        "",
        f"**Ataques exitosos:** QR estatico {s['attacks_succeeded']} de {s['attacks_total']}; "
        f"QR dinamico {d['attacks_succeeded']} de {d['attacks_total']}. "
        f"Titular legitimo aceptado: estatico {'si' if s['legit_holder_accepted'] else 'NO'}, dinamico {'si' if d['legit_holder_accepted'] else 'NO'}.",
        "",
        "## Filtro de personas con prohibicion de ingreso",
        "",
        "| Escenario | QR estatico (carnet) | QR dinamico |",
        "|---|---|---|",
        *[
            f"| {r['title']} | {cell(r['estatico']['attempt'], r['key'] != 'ban_own')} | "
            f"{cell(r['dinamico']['attempt'], r['key'] != 'ban_own')} |"
            for r in result["ban_rows"]
        ],
        "",
        f"**Evasiones del filtro:** QR estatico {s['ban_evasions_succeeded']} de {s['ban_evasions_total']}; "
        f"QR dinamico {d['ban_evasions_succeeded']} de {d['ban_evasions_total']}. "
        f"Con su propia credencial, la persona sancionada es bloqueada en ambos modos: "
        f"{'si' if s['ban_filter_blocks_own_credential'] and d['ban_filter_blocks_own_credential'] else 'NO'}.",
        "",
        "Escenarios:",
        "",
        *[f"- **{r['title']}**: {r['description']}" for r in result["rows"] + result["ban_rows"]],
        "",
    ]
    (RESULTS_DIR / "attack-experiment.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


def main() -> None:
    os.chdir(BACKEND_DIR)  # pydantic-settings lee JWT_SECRET desde backend/.env
    os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH}"
    os.environ["QR_TTL_SECONDS"] = "45"
    os.environ["ENABLE_STATIC_BASELINE"] = "1"
    sys.path.insert(0, str(BACKEND_DIR))
    DB_PATH.unlink(missing_ok=True)

    from fastapi.testclient import TestClient

    from app.database import engine
    from app.main import app

    try:
        result = run_experiment(TestClient(app))
        write_results(result)
    finally:
        engine.dispose()
        DB_PATH.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
