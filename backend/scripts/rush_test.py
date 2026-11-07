"""Prueba de punta: muchas personas entrando a la vez por muchas filas.

`load_test.py` mide la consulta en linea con un paso por QR y hasta 16 filas. Esta prueba simula la
entrada a un estadio con el flujo real de dos pasos (ADR-12: verificar y despues dejar pasar), muchas
filas atendidas en paralelo y dos intentos de fraude que ocurren al mismo tiempo:

- *mismo QR en dos filas*: la captura del QR se reenvia a un complice y ambos la presentan a la vez;
- *dos QR en dos filas*: el telefono genera dos QR distintos de la misma persona y se presentan a la vez.

En los tres casos la persona es titular de una entrada valida, asi que lo correcto es que entre
exactamente una vez. La prueba comprueba ese invariante persona por persona, cuenta los errores del
servidor y mide cuanto tarda cada solicitud y cada persona.

Corre contra SQLite (por defecto) o PostgreSQL, con uno o varios procesos del servidor, para comprobar
que el uso unico sigue siendo atomico cuando varios procesos escriben en la misma base:

    uv run python scripts/rush_test.py                                   # SQLite, 1 proceso
    uv run python scripts/rush_test.py --database-url postgresql://... --workers 4 --label pg-4

La base de PostgreSQL se BORRA entera al empezar: usar una base solo para esto.
Escribe docs/results/rush-test.json y docs/results/rush-test.md (una fila por --label).
"""

import argparse
import asyncio
import json
import os
import pathlib
import platform
import random
import secrets
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
RESULTS_DIR = BACKEND_DIR.parent / "docs" / "results"
PORT = 8766
BASE_URL = f"http://127.0.0.1:{PORT}"
GUARD_EMAIL, GUARD_PASSWORD = "guardia-punta@test.cl", "punta-123456"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--people", type=int, default=2000, help="personas con entrada")
    parser.add_argument("--gates", type=int, default=32, help="filas atendidas en paralelo")
    parser.add_argument("--workers", type=int, default=1, help="procesos uvicorn")
    parser.add_argument("--fraud", type=float, default=0.2, help="fraccion de personas con un intento de fraude")
    parser.add_argument("--database-url", default=None, help="por defecto, una base SQLite temporal")
    parser.add_argument("--label", default=None, help="nombre de la fila en los resultados")
    parser.add_argument("--seed", type=int, default=7)
    return parser.parse_args()


ARGS = parse_args()
WORK_DIR = pathlib.Path(tempfile.mkdtemp(prefix="punta-"))
ISSUER_DIR = WORK_DIR / "issuer"
DATABASE_URL = ARGS.database_url or f"sqlite:///{(WORK_DIR / 'punta.db').as_posix()}"

# Deben fijarse antes de importar app.*: pydantic-settings los lee una sola vez.
os.environ["DATABASE_URL"] = DATABASE_URL
os.environ.setdefault("JWT_SECRET", secrets.token_urlsafe(48))
# El TTL no es lo que se mide: los QR se generan antes de cronometrar y no deben vencer mientras tanto.
os.environ["QR_TTL_SECONDS"] = "3600"
os.environ["ISSUER_PUBLIC_KEY_FILE"] = str(ISSUER_DIR / "issuer_public.key")
os.environ["VERIFIER_PRIVATE_KEY_FILE"] = str(ISSUER_DIR / "verifier_private.key")
# Todas las filas usan la misma cuenta de guardia: sin limite de validaciones por guardia. Sin Registro
# Civil al que consultar revocaciones (puerto cerrado): se mide el recinto, no al emisor.
os.environ["QR_VALIDATE_RATE_LIMIT_PER_GUARD"] = "0"
os.environ["REGISTRO_CIVIL_URL"] = "http://127.0.0.1:9"
sys.path.insert(0, str(BACKEND_DIR))

import httpx  # noqa: E402

from app.credential import b64d, decode_qr, ed25519_public, new_secret_key  # noqa: E402
from app.database import IS_SQLITE, Base, SessionLocal, engine  # noqa: E402
from app.models import AccessLog, Event, Gate, Lane, Role, Ticket, User  # noqa: E402
from app.rut import check_digit  # noqa: E402
from app.security import hash_password  # noqa: E402
from scripts.qr_clients import Phone, Scanner  # noqa: E402
from scripts.registro_civil_sim import (  # noqa: E402
    compress_photo,
    demo_avatar,
    ensure_issuer_keys,
    issue_credential,
    verifier_public_key,
)

NORMAL, SAME_QR, TWO_QRS = "normal", "mismo QR en dos filas", "dos QR en dos filas"


def percentile(values: list[float], pct: float) -> float:
    ordered = sorted(values)
    rank = max(1, -(-len(ordered) * pct // 100))  # nearest-rank
    return ordered[int(rank) - 1]


def seed(issuer_secret: bytes) -> tuple[int, list[int], list[Phone]]:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)  # antes de levantar el servidor: los procesos no compiten por crearla
    verifier_public = verifier_public_key(ISSUER_DIR)
    photo = compress_photo(demo_avatar("punta"))  # misma foto para todos: la foto no viaja al servidor
    db = SessionLocal()
    db.add(User(email=GUARD_EMAIL, full_name="Guardia punta", role=Role.GUARD, password_hash=hash_password(GUARD_PASSWORD)))
    event = Event(name="Prueba de punta")
    event.gates = [Gate(name=f"Fila {i + 1}", lane=Lane.DIGITAL) for i in range(max(ARGS.gates, 2))]
    db.add(event)
    db.flush()
    phones = []
    for i in range(ARGS.people):
        body = str(40_000_000 + i)
        rut = body + check_digit(body)
        device_secret = new_secret_key()
        credential = issue_credential(issuer_secret, f"Asistente {i}", rut, photo, ed25519_public(device_secret))
        phones.append(Phone(credential, device_secret, verifier_public))
        db.add(Ticket(event_id=event.id, holder_name=f"Asistente {i}", document_id=rut))
    db.commit()
    result = event.id, [g.id for g in event.gates], phones
    db.close()
    return result


def stop_server(proc: subprocess.Popen) -> None:
    """Con --workers, uvicorn lanza procesos hijos. En Windows, terminar al padre los deja vivos y con el
    puerto tomado: la corrida siguiente le hablaria a un servidor viejo. Se cierra el arbol completo."""
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    else:
        proc.terminate()
    proc.wait(timeout=20)


def start_server() -> subprocess.Popen:
    try:
        httpx.get(f"{BASE_URL}/health", timeout=0.5)
        raise RuntimeError(f"El puerto {PORT} ya responde: hay un servidor de una corrida anterior. Ciérralo primero.")
    except httpx.HTTPError:
        pass  # libre, como debe ser
    cmd = [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(PORT), "--log-level", "warning"]
    if ARGS.workers > 1:
        cmd += ["--workers", str(ARGS.workers)]
    proc = subprocess.Popen(cmd, cwd=BACKEND_DIR, env=os.environ.copy())
    for _ in range(300):
        try:
            if httpx.get(f"{BASE_URL}/health", timeout=0.5).status_code == 200:
                return proc
        except httpx.HTTPError:
            time.sleep(0.1)
    proc.kill()
    raise RuntimeError("El servidor de prueba no levanto")


async def run(event_id: int, gate_ids: list[int], phones: list[Phone]) -> dict:
    rng = random.Random(ARGS.seed)
    limits = httpx.Limits(max_connections=4 * ARGS.gates, max_keepalive_connections=4 * ARGS.gates)
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=60, limits=limits) as client:
        login = await client.post("/auth/login", data={"username": GUARD_EMAIL, "password": GUARD_PASSWORD})
        login.raise_for_status()
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        keys = (await client.get(f"/events/{event_id}/verifier", headers=headers)).json()
        verifier_secret = b64d(keys["verifier_private_key"])

        # Fuera del cronometro (ocurre en los dispositivos): cada telefono genera su QR y el escaner lo
        # descifra localmente. Lo que viaja al servidor es la consulta, sin la foto.
        now = int(time.time())
        people = []
        for index, phone in enumerate(phones):
            roll = rng.random()
            kind = NORMAL if roll >= ARGS.fraud else (SAME_QR if roll < ARGS.fraud / 2 else TWO_QRS)
            first = decode_qr(phone.qr(issued_at=now), verifier_secret)
            if kind == NORMAL:
                presented = [first]
            elif kind == SAME_QR:
                presented = [first, first]
            else:
                presented = [first, decode_qr(phone.qr(issued_at=now), verifier_secret)]
            people.append((index, kind, presented))
        rng.shuffle(people)

        request_ms: list[float] = []
        person_ms: list[float] = []
        grants = [0] * len(phones)
        server_errors = 0  # 5xx o sin respuesta
        client_errors = 0  # 4xx
        unexpected: dict[str, int] = {}

        async def post(payload: dict) -> dict | None:
            nonlocal server_errors, client_errors
            started = time.perf_counter()
            try:
                res = await client.post("/qr/validate", json=payload, headers=headers)
            except httpx.HTTPError:
                server_errors += 1
                return None
            request_ms.append((time.perf_counter() - started) * 1000)
            if res.status_code >= 500:
                server_errors += 1
                return None
            if res.status_code != 200:
                client_errors += 1
                return None
            return res.json()

        async def two_steps(index: int, contents, gate_id: int) -> None:
            """Lo que hace un guardia: verificar, mirar la foto (coincide) y dejar pasar."""
            payload = Scanner.validate_payload(contents, gate_id)
            checked = await post({**payload, "action": "check"})
            if checked is None or not checked.get("pending"):
                reason = checked["reason"] if checked else "error"
                unexpected[f"check:{reason}"] = unexpected.get(f"check:{reason}", 0) + 1
                return
            admitted = await post({**payload, "action": "admit"})
            if admitted is not None and admitted["granted"]:
                grants[index] += 1
            else:
                reason = admitted["reason"] if admitted else "error"
                unexpected[f"admit:{reason}"] = unexpected.get(f"admit:{reason}", 0) + 1

        queue: asyncio.Queue = asyncio.Queue()
        for person in people:
            queue.put_nowait(person)

        async def gate_worker(worker: int) -> None:
            while not queue.empty():
                index, kind, presented = queue.get_nowait()
                started = time.perf_counter()
                gates = [gate_ids[(worker + k) % len(gate_ids)] for k in range(len(presented))]
                await asyncio.gather(*(two_steps(index, c, g) for c, g in zip(presented, gates)))
                person_ms.append((time.perf_counter() - started) * 1000)

        started = time.perf_counter()
        await asyncio.gather(*(gate_worker(w) for w in range(ARGS.gates)))
        elapsed = time.perf_counter() - started

    kinds = {kind: sum(1 for _, k, _ in people if k == kind) for kind in (NORMAL, SAME_QR, TWO_QRS)}
    by_kind = {
        kind: {
            "personas": kinds[kind],
            "entraron_una_vez": sum(1 for i, k, _ in people if k == kind and grants[i] == 1),
            "entraron_dos_veces": sum(1 for i, k, _ in people if k == kind and grants[i] > 1),
            "no_entraron": sum(1 for i, k, _ in people if k == kind and grants[i] == 0),
        }
        for kind in kinds
    }

    # La base tiene que contar lo mismo que vio el cliente.
    db = SessionLocal()
    admitted_in_db = db.query(Ticket).filter(Ticket.event_id == event_id, Ticket.admitted_at.isnot(None)).count()
    granted_logs = db.query(AccessLog).filter(AccessLog.gate_id.in_(gate_ids), AccessLog.granted.is_(True)).count()
    server_ms = [r[0] for r in db.query(AccessLog.latency_ms).filter(AccessLog.gate_id.in_(gate_ids)).all()]
    db.close()

    return {
        "label": ARGS.label or ("sqlite" if IS_SQLITE else "postgresql") + f"-{ARGS.workers}",
        "database": "SQLite" if IS_SQLITE else "PostgreSQL",
        "workers": ARGS.workers,
        "people": ARGS.people,
        "gates": ARGS.gates,
        "requests": len(request_ms) + server_errors,
        "elapsed_s": round(elapsed, 2),
        "people_per_minute": round(ARGS.people / elapsed * 60),
        "request_p50_ms": round(percentile(request_ms, 50), 1),
        "request_p95_ms": round(percentile(request_ms, 95), 1),
        "request_p99_ms": round(percentile(request_ms, 99), 1),
        "person_p50_ms": round(percentile(person_ms, 50), 1),
        "person_p95_ms": round(percentile(person_ms, 95), 1),
        "server_mean_ms": round(statistics.fmean(server_ms), 2) if server_ms else None,
        "server_errors": server_errors,
        "client_errors": client_errors,
        "by_kind": by_kind,
        "double_entries": sum(1 for g in grants if g > 1),
        "not_admitted": sum(1 for g in grants if g == 0),
        "admitted_in_db": admitted_in_db,
        "granted_logs": granted_logs,
        "rejections_seen": unexpected,
    }


def write_results(result: dict) -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    path = RESULTS_DIR / "rush-test.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"runs": {}}
    result["generated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    result["platform"] = f"{platform.system()} {platform.release()} / Python {platform.python_version()} / {platform.processor()}"
    data["runs"][result["label"]] = result
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    lines = [
        "# Resultados de la prueba de punta (generado)",
        "",
        "Generado por `backend/scripts/rush_test.py`. No editar a mano. Servidor, base y cliente en la misma",
        "máquina, así que los tiempos son una cota inferior de lo que se vería con red.",
        "",
        "Cada persona tiene una entrada válida y pasa por el flujo de dos pasos. Una fracción intenta además",
        "un fraude a la vez: *mismo QR en dos filas* o *dos QR en dos filas*. Lo correcto es que cada",
        "persona entre exactamente una vez.",
        "",
        "| Corrida | Base | Procesos | Personas | Filas | Personas/min | Solicitud p50 / p95 / p99 (ms) | Persona p50 / p95 (ms) | Errores 5xx | Entraron dos veces | No entraron |",
        "|---|---|---:|---:|---:|---:|---|---|---:|---:|---:|",
    ]
    for r in data["runs"].values():
        lines.append(
            f"| {r['label']} | {r['database']} | {r['workers']} | {r['people']} | {r['gates']} | {r['people_per_minute']} | "
            f"{r['request_p50_ms']} / {r['request_p95_ms']} / {r['request_p99_ms']} | {r['person_p50_ms']} / {r['person_p95_ms']} | "
            f"{r['server_errors']} de {r['requests']} | {r['double_entries']} | {r['not_admitted']} |"
        )
    lines += ["", "Detalle por tipo de persona:", ""]
    for r in data["runs"].values():
        detail = "; ".join(
            f"{kind}: {v['entraron_una_vez']} de {v['personas']} una vez, {v['entraron_dos_veces']} dos veces"
            for kind, v in r["by_kind"].items()
        )
        lines.append(f"- **{r['label']}** ({r['generated_at']}): {detail}. En la base: {r['admitted_in_db']} ingresos.")
    lines.append("")
    (RESULTS_DIR / "rush-test.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    issuer_secret = ensure_issuer_keys(ISSUER_DIR)
    event_id, gate_ids, phones = seed(issuer_secret)
    server = start_server()
    try:
        result = asyncio.run(run(event_id, gate_ids, phones))
    finally:
        stop_server(server)
        engine.dispose()
        shutil.rmtree(WORK_DIR, ignore_errors=True)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    write_results(result)
    ok = result["double_entries"] == 0 and result["not_admitted"] == 0 and result["server_errors"] == 0
    print("OK: cada persona entró exactamente una vez" if ok else "FALLA: revisar los resultados")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
