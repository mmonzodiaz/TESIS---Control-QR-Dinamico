"""Experimento de ataque: QR estatico del carnet fisico vs. QR dinamico (docs/attack-experiment.md).

Ejecuta los mismos ataques contra ambos modos, sobre el backend real (en proceso, base temporal):

- estatico: /baseline/static-validate (emula el QR fijo del carnet; routers/static_baseline.py)
- dinamico: QR generado por el telefono, leido por el escaner (scripts/qr_clients.py) y validado
  en /qr/validate (la propuesta, ADR-11)

Ambos modos comparten la admision unica por entrada, asi que la unica variable es que la credencial
sea estatica o dinamica. El reloj del backend se controla desde el script para simular esperas
(60 s, 1 h, 30 dias) sin tener que esperar de verdad.

Ademas de la decision automatica, cada intento registra si **la foto que ve el guardia corresponde
a quien esta en la puerta**. En el carnet, la foto va impresa en el mismo objeto que se falsifica:
un carnet falso lleva la foto del atacante. En el QR dinamico, la foto viene firmada por el Registro
Civil dentro del QR: siempre es la del titular. La comparacion de rostros la hace una persona; el
experimento no la automatiza, solo registra si una comparacion correcta detectaria el ataque.

Uso (desde backend/):  uv run python scripts/attack_experiment.py
Escribe docs/results/attack-experiment.json y docs/results/attack-experiment.md.
"""

import calendar
import itertools
import json
import os
import pathlib
import shutil
import sys
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
RESULTS_DIR = BACKEND_DIR.parent / "docs" / "results"
DB_PATH = BACKEND_DIR / "attack-experiment.db"
ISSUER_DIR = BACKEND_DIR / "attack-experiment-issuer"

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

    def unix(self) -> int:
        return calendar.timegm(self.now.timetuple())

    def advance(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)


@contextmanager
def patched_clock(clock: Clock):
    from app import models
    from app.routers import qr, static_baseline

    originals = (qr.utcnow, static_baseline.utcnow, models.utcnow)
    qr.utcnow = static_baseline.utcnow = models.utcnow = clock
    try:
        yield
    finally:
        qr.utcnow, static_baseline.utcnow, models.utcnow = originals


def run_experiment(client, issuer_secret: bytes) -> dict:
    """Corre todos los escenarios en ambos modos. `client` es un TestClient de app.main;
    `issuer_secret` es la clave del Registro Civil simulado cuya publica usa el backend."""
    from app.config import settings
    from app.credential import b64e, ed25519_public, parse_core
    from app.database import SessionLocal
    from app.models import BannedPerson, Event, Gate, Lane, Role, Ticket, User
    from app.routers.static_baseline import static_qr_for
    from app.rut import check_digit
    from app.security import hash_password, hash_ticket_code, new_claim_session
    from scripts.qr_clients import Phone, Scanner
    from scripts.registro_civil_sim import compress_photo, demo_avatar, issue_credential

    ttl = settings.qr_ttl_seconds
    guard_email = f"guardia-ataque-{next(_rut_bodies)}@test.cl"
    db = SessionLocal()
    db.add(User(email=guard_email, full_name="Guardia", role=Role.GUARD, password_hash=hash_password("x-123456")))
    db.commit()
    db.close()
    guard = client.post("/auth/login", data={"username": guard_email, "password": "x-123456"}).json()["access_token"]
    guard_h = {"Authorization": f"Bearer {guard}"}

    gate_event: dict[int, int] = {}
    scanners: dict[int, Scanner] = {}
    cedulas: dict = {}

    def new_event() -> int:
        db = SessionLocal()
        event = Event(name="Evento experimento")
        event.gates = [Gate(name="Puerta", lane=Lane.FAST)]
        db.add(event)
        db.commit()
        gate_event[event.gates[0].id] = event.id
        gate_id = event.gates[0].id
        db.close()
        return gate_id

    def new_person() -> str:
        body = str(next(_rut_bodies))
        return body + check_digit(body)

    def cedula(document_id: str):
        """Cada persona tiene una cedula digital (con su foto) emitida por el Registro Civil."""
        if document_id not in cedulas:
            cedulas[document_id] = issue_credential(
                issuer_secret, f"Persona {document_id}", document_id, compress_photo(demo_avatar(document_id))
            )
        return cedulas[document_id]

    def new_ticket(gate_id: int, document_id: str) -> Phone:
        """Entrada ya activada en el telefono del titular; devuelve ese telefono."""
        phone = Phone(cedula(document_id))
        db = SessionLocal()
        event = db.get(Event, gate_event[gate_id])
        ticket = Ticket(
            event_id=event.id,
            holder_name="Titular",
            document_id=document_id,
            code_hash=hash_ticket_code(f"X{document_id}{gate_id}"),
            claim_session=new_claim_session(),
            device_public_key=b64e(ed25519_public(phone.device_secret)),
        )
        db.add(ticket)
        db.commit()
        phone.params = {"event_id": event.id, "ticket_id": ticket.id, "event_public_key": event.qr_public_key}
        db.close()
        return phone

    def credential(mode: str, phone: Phone, clock: Clock) -> str:
        if mode == "estatico":
            return static_qr_for(parse_core(phone.credential.core).rut)  # el QR del carnet: siempre el mismo
        return phone.qr(issued_at=clock.unix())  # lo que muestra la pantalla en ese momento

    def present(mode: str, qr: str, gate_id: int, presenter: str, card_photo: str) -> dict:
        """`presenter`: RUT de quien esta en la puerta. `card_photo`: de quien es la foto impresa en el
        carnet presentado (modo estatico). En el modo dinamico la foto la trae el QR, firmada."""
        if mode == "estatico":
            body = client.post("/baseline/static-validate", json={"qr": qr, "gate_id": gate_id}, headers=guard_h).json()
            shown = card_photo
        else:
            event_id = gate_event[gate_id]
            if event_id not in scanners:
                scanners[event_id] = Scanner(client, guard, event_id)
            body = scanners[event_id].scan(qr, gate_id)
            shown = body["shown"]["rut"] if body.get("shown") else None
        return {
            "granted": body["granted"],
            "reason": body["reason"],
            "photo_matches": None if shown is None else shown == presenter,
        }

    rows = []
    for scenario in scenarios(ttl):
        row = {"key": scenario.key, "title": scenario.title, "description": scenario.description}
        for mode in ("estatico", "dinamico"):
            clock = Clock()
            with patched_clock(clock):
                holder, attacker = new_person(), new_person()
                gate_id = new_event()
                phone = new_ticket(gate_id, holder)
                captured = credential(mode, phone, clock)  # lo que muestra el titular (y el atacante copia)

                holder_after = None
                if scenario.key == "control":
                    attempt = present(mode, captured, gate_id, holder, holder)
                elif scenario.key == "after_holder":
                    present(mode, captured, gate_id, holder, holder)  # entra el titular
                    # luego el atacante con la copia (en el carnet, un carnet falso con su propia foto)
                    attempt = present(mode, captured, gate_id, attacker, attacker)
                else:
                    target_gate, target_phone = gate_id, phone
                    if scenario.key == "other_event":
                        target_gate = new_event()
                        target_phone = new_ticket(target_gate, holder)
                    clock.advance(
                        {"photo_60s": 60, "photo_1h": 3600, "other_event": 30 * 86400, "relay": relay_delay_s(ttl)}[
                            scenario.key
                        ]
                    )
                    # En el carnet, el atacante lleva un carnet falso con el QR clonado y su propia foto.
                    attempt = present(mode, captured, target_gate, attacker, attacker)
                    # Luego llega el titular con su credencial vigente: ¿puede entrar?
                    holder_after = present(mode, credential(mode, target_phone, clock), target_gate, holder, holder)

            row[mode] = {"attempt": attempt, "holder_after": holder_after}
        rows.append(row)

    def ban(document_id: str) -> None:
        db = SessionLocal()
        db.add(BannedPerson(document_id=document_id, reason="Experimento"))
        db.commit()
        db.close()

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
                    attempt = present(mode, credential(mode, new_ticket(gate_id, banned), clock), gate_id, banned, banned)
                else:
                    # El filtro revisa el RUT de la credencial presentada: el del tercero, que no tiene prohibicion.
                    third = new_person()
                    captured = credential(mode, new_ticket(gate_id, third), clock)
                    clock.advance(BAN_COPY_DELAY_S if scenario.key == "ban_copy" else relay_delay_s(ttl))
                    # Copia: carnet falso con la foto del sancionado. Prestamo: el carnet real del tercero.
                    card_photo = banned if scenario.key == "ban_copy" else third
                    attempt = present(mode, captured, gate_id, banned, card_photo)
            row[mode] = {"attempt": attempt, "holder_after": None}
        ban_rows.append(row)

    return {"ttl_seconds": ttl, "rows": rows, "ban_rows": ban_rows}


def _passes(outcome: dict, photo_check: bool) -> bool:
    return outcome["granted"] and (not photo_check or outcome["photo_matches"] is not False)


def summarize(result: dict) -> dict:
    attacks = [r for r in result["rows"] if r["key"] != "control"]
    evasions = [r for r in result["ban_rows"] if r["key"] != "ban_own"]
    ban_own = next(r for r in result["ban_rows"] if r["key"] == "ban_own")
    return {
        mode: {
            "attacks_succeeded": sum(_passes(r[mode]["attempt"], False) for r in attacks),
            "attacks_succeeded_with_photo_check": sum(_passes(r[mode]["attempt"], True) for r in attacks),
            "attacks_total": len(attacks),
            "ban_evasions_succeeded": sum(_passes(r[mode]["attempt"], False) for r in evasions),
            "ban_evasions_succeeded_with_photo_check": sum(_passes(r[mode]["attempt"], True) for r in evasions),
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
    if not outcome["granted"]:
        return f"Bloqueado (`{outcome['reason']}`)"
    if outcome["photo_matches"] is False:
        return f"Pasa el sistema (`{outcome['reason']}`); **foto no coincide**"
    return f"**ATAQUE PASA** (`{outcome['reason']}`)"


def write_results(result: dict) -> None:
    summary = summarize(result)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / "attack-experiment.json").write_text(json.dumps({**result, "summary": summary}, indent=2), encoding="utf-8")

    s, d = summary["estatico"], summary["dinamico"]
    lines = [
        "# Resultados del experimento de ataque (generado)",
        "",
        "Generado por `backend/scripts/attack_experiment.py`. No editar a mano. Metodo en `docs/attack-experiment.md`.",
        "",
        f"TTL del QR dinamico: {result['ttl_seconds']} s. Ambos modos tienen admision unica por entrada.",
        '"Foto no coincide": el sistema acepta, pero la foto que ve el guardia no es la de quien esta en la puerta;',
        "una comparacion visual correcta detiene el ataque.",
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
    lines += [
        "",
        f"**Ataques que pasan la validacion automatica:** QR estatico {s['attacks_succeeded']} de {s['attacks_total']}; "
        f"QR dinamico {d['attacks_succeeded']} de {d['attacks_total']}.",
        "",
        f"**Ataques que pasan ademas una comparacion correcta de la foto:** QR estatico "
        f"{s['attacks_succeeded_with_photo_check']} de {s['attacks_total']}; QR dinamico "
        f"{d['attacks_succeeded_with_photo_check']} de {d['attacks_total']}.",
        "",
        f"Titular legitimo aceptado: estatico {'si' if s['legit_holder_accepted'] else 'NO'}, "
        f"dinamico {'si' if d['legit_holder_accepted'] else 'NO'}.",
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
        f"**Evasiones del filtro (validacion automatica):** QR estatico {s['ban_evasions_succeeded']} de "
        f"{s['ban_evasions_total']}; QR dinamico {d['ban_evasions_succeeded']} de {d['ban_evasions_total']}.",
        "",
        f"**Evasiones con comparacion correcta de la foto:** QR estatico {s['ban_evasions_succeeded_with_photo_check']} de "
        f"{s['ban_evasions_total']}; QR dinamico {d['ban_evasions_succeeded_with_photo_check']} de {d['ban_evasions_total']}.",
        "",
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
    # Registro Civil simulado propio del experimento (no toca las claves de la demo).
    os.environ["ISSUER_PUBLIC_KEY_FILE"] = str(ISSUER_DIR / "issuer_public.key")
    sys.path.insert(0, str(BACKEND_DIR))
    DB_PATH.unlink(missing_ok=True)

    from fastapi.testclient import TestClient

    from app.database import engine
    from app.main import app
    from scripts.registro_civil_sim import ensure_issuer_keys

    try:
        result = run_experiment(TestClient(app), ensure_issuer_keys(ISSUER_DIR))
        write_results(result)
    finally:
        engine.dispose()
        DB_PATH.unlink(missing_ok=True)
        shutil.rmtree(ISSUER_DIR, ignore_errors=True)


if __name__ == "__main__":
    main()
