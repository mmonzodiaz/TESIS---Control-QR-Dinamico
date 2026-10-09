"""Prueba de carga del flujo de validacion de QR (docs/queue-model.md, seccion 2).

Levanta su propio servidor uvicorn contra una base SQLite temporal (no toca la base demo),
siembra un evento con N personas con entrada (cada una con su cedula digital simulada, ligada a la
clave de su telefono) y mide, para varios niveles de concurrencia (= filas/guardias escaneando a la vez):

- throughput de validacion (validaciones/s),
- latencia de extremo a extremo vista por el escaner (p50/p95/p99),
- latencia de procesamiento en el servidor (AccessLog.latency_ms),
- errores HTTP,
- correctitud bajo carga: cada QR se escanea desde DOS filas a la vez y se verifica que
  exactamente uno de los dos escaneos concede acceso (consumo atomico, ADR-8).

Cada QR lo genera el telefono (sin conexion) y lo descifra y verifica el escaner localmente antes de
consultar al servidor (ADR-11); eso ocurre en los dispositivos, fuera de lo que se cronometra aqui.
Lo medido es la consulta en linea: firmas del emisor y del dispositivo, uso unico, admision y
prohibiciones.

Uso (desde backend/):  uv run python scripts/load_test.py [--tickets 400] [--levels 1,2,4,8,16]
Escribe docs/results/load-test.json y docs/results/load-test.md.
"""

import argparse
import asyncio
import json
import os
import pathlib
import platform
import shutil
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
RESULTS_DIR = BACKEND_DIR.parent / "docs" / "results"
DB_PATH = BACKEND_DIR / "loadtest.db"
ISSUER_DIR = BACKEND_DIR / "loadtest-issuer"
PORT = 8765

# Deben fijarse antes de importar app.*: pydantic-settings los lee una sola vez.
os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH}"
# El TTL no es lo que se mide aqui; se alarga para que los QR pre-generados no expiren
# mientras corre la prueba (el TTL real de 45 s se analiza en docs/ttl-justification.md).
os.environ["QR_TTL_SECONDS"] = "3600"
# Registro Civil simulado propio de la prueba (no toca las claves de la demo).
os.environ["ISSUER_PUBLIC_KEY_FILE"] = str(ISSUER_DIR / "issuer_public.key")
os.environ["VERIFIER_PRIVATE_KEY_FILE"] = str(ISSUER_DIR / "verifier_private.key")
# La prueba satura el servidor a proposito: sin limite de validaciones por guardia. Sin Registro
# Civil al que consultar revocaciones (puerto cerrado): se mide el recinto, no al emisor.
os.environ["QR_VALIDATE_RATE_LIMIT_PER_GUARD"] = "0"
os.environ["REGISTRO_CIVIL_URL"] = "http://127.0.0.1:9"
sys.path.insert(0, str(BACKEND_DIR))

import httpx  # noqa: E402

from app.credential import b64d, decode_qr, ed25519_public, new_secret_key  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402
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

BASE_URL = f"http://127.0.0.1:{PORT}"
GUARD_EMAIL, GUARD_PASSWORD = "guardia-carga@test.cl", "carga-123"


def percentile(values: list[float], pct: float) -> float:
    ordered = sorted(values)
    rank = max(1, -(-len(ordered) * pct // 100))  # nearest-rank
    return ordered[int(rank) - 1]


def seed_level(level: int, tickets: int, issuer_secret: bytes, photo: bytes) -> tuple[int, list[int], list[Phone]]:
    """Crea un evento con `level` filas y `tickets` personas con entrada y cedula digital. Devuelve
    (evento, filas, telefonos)."""
    verifier_public = verifier_public_key(ISSUER_DIR)
    db = SessionLocal()
    event = Event(name=f"Carga c={level}")
    event.gates = [Gate(name=f"Fila {i + 1}", lane=Lane.DIGITAL) for i in range(max(level, 2))]
    db.add(event)
    db.flush()
    phones = []
    for i in range(tickets):
        body = str(30_000_000 + level * 100_000 + i)
        rut = body + check_digit(body)
        device_secret = new_secret_key()
        credential = issue_credential(issuer_secret, f"Asistente {i}", rut, photo, ed25519_public(device_secret))
        phones.append(Phone(credential, device_secret, verifier_public))
        db.add(Ticket(event_id=event.id, holder_name=f"Asistente {i}", document_id=rut))
    db.commit()
    result = event.id, [g.id for g in event.gates], phones
    db.close()
    return result


def server_latencies(gate_ids: list[int]) -> list[float]:
    db = SessionLocal()
    rows = db.query(AccessLog.latency_ms).filter(AccessLog.gate_id.in_(gate_ids)).all()
    db.close()
    return [r[0] for r in rows]


async def run_level(
    client: httpx.AsyncClient, guard_headers: dict, level: int, tickets: int, issuer_secret: bytes, photo: bytes
) -> dict:
    event_id, gate_ids, phones = seed_level(level, tickets, issuer_secret, photo)
    keys = (await client.get(f"/events/{event_id}/verifier", headers=guard_headers)).json()
    verifier_secret = b64d(keys["verifier_private_key"])

    # Fase 1 (fuera del cronometro, ocurre en los dispositivos): cada telefono genera su QR y el
    # escaner lo descifra localmente. Lo que viaja al servidor es la consulta sin la foto.
    now = int(time.time())
    payloads = [decode_qr(phone.qr(issued_at=now), verifier_secret) for phone in phones]
    qr_tokens = [p.nonce.hex() for p in payloads]

    # Fase 2: `level` guardias escanean en paralelo. Cada QR se escanea desde dos filas
    # distintas a la vez para ejercitar la carrera que el consumo atomico debe resolver.
    queue: asyncio.Queue = asyncio.Queue()
    for contents in payloads:
        queue.put_nowait(contents)

    latencies: list[float] = []  # solo respuestas recibidas (cualquier codigo)
    grants_per_token: dict[str, int] = {}
    errors = 0  # respuestas no-200 mas solicitudes sin respuesta
    sent = 0

    async def scan(contents, gate_id: int) -> None:
        nonlocal errors, sent
        token = contents.nonce.hex()
        sent += 1
        started = time.perf_counter()
        try:
            res = await client.post(
                "/qr/validate", json=Scanner.validate_payload(contents, gate_id), headers=guard_headers
            )
            latencies.append((time.perf_counter() - started) * 1000)
            if res.status_code != 200:
                errors += 1
            elif res.json()["granted"]:
                grants_per_token[token] = grants_per_token.get(token, 0) + 1
        except httpx.HTTPError:
            errors += 1

    async def guard_worker(worker: int) -> None:
        while not queue.empty():
            contents = queue.get_nowait()
            g1 = gate_ids[worker % len(gate_ids)]
            g2 = gate_ids[(worker + 1) % len(gate_ids)]
            await asyncio.gather(scan(contents, g1), scan(contents, g2))

    started = time.perf_counter()
    await asyncio.gather(*(guard_worker(w) for w in range(level)))
    elapsed = time.perf_counter() - started

    # Antes: len(latencies) + errors, que contaba dos veces cada respuesta no-200 (va en las dos).
    requests = sent
    srv = server_latencies(gate_ids)
    # Cada QR es de un titular valido con entrada: lo correcto es EXACTAMENTE una concesion. Mas de
    # una es un fallo de seguridad (uso unico, ADR-8); ninguna es un fallo de disponibilidad (bajo
    # carga, SQLite agota su espera de 5 s y responde error a los dos escaneos del mismo QR).
    double_grants = sum(1 for n in grants_per_token.values() if n > 1)
    not_admitted = sum(1 for token in qr_tokens if token not in grants_per_token)
    return {
        "concurrency": level,
        "qr_tokens": len(qr_tokens),
        "requests": requests,
        "elapsed_s": round(elapsed, 3),
        "throughput_rps": round(requests / elapsed, 1),
        "admissions_per_s": round(sum(grants_per_token.values()) / elapsed, 1),
        "client_mean_ms": round(statistics.fmean(latencies), 2),
        "client_p50_ms": round(percentile(latencies, 50), 2),
        "client_p95_ms": round(percentile(latencies, 95), 2),
        "client_p99_ms": round(percentile(latencies, 99), 2),
        "server_p50_ms": round(percentile(srv, 50), 2),
        "server_p95_ms": round(percentile(srv, 95), 2),
        "server_mean_ms": round(statistics.fmean(srv), 2),
        "errors": errors,
        "granted_tokens": len(grants_per_token),
        "double_grants": double_grants,
        "valid_holders_not_admitted": not_admitted,
    }


def start_server() -> subprocess.Popen:
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(PORT), "--log-level", "warning"],
        cwd=BACKEND_DIR,
        env=os.environ.copy(),
    )
    for _ in range(100):
        try:
            if httpx.get(f"{BASE_URL}/health", timeout=0.5).status_code == 200:
                return proc
        except httpx.HTTPError:
            time.sleep(0.1)
    proc.kill()
    raise RuntimeError("El servidor de prueba no levanto")


def write_results(results: list[dict], args: argparse.Namespace) -> None:
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    meta = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "platform": f"{platform.system()} {platform.release()} / Python {platform.python_version()} / {platform.processor()}",
        "setup": "1 proceso uvicorn, SQLite en disco, cliente httpx asincrono en la misma maquina",
        "tickets_per_level": args.tickets,
    }
    (RESULTS_DIR / "load-test.json").write_text(json.dumps({"meta": meta, "levels": results}, indent=2), encoding="utf-8")

    lines = [
        "# Resultados de la prueba de carga (generado)",
        "",
        f"Generado por `backend/scripts/load_test.py` el {meta['generated_at']}. No editar a mano.",
        "",
        f"- Plataforma: {meta['platform']}",
        f"- Montaje: {meta['setup']}",
        f"- Entradas por nivel: {args.tickets}; cada QR se escanea desde 2 filas a la vez ({2 * args.tickets} solicitudes por nivel)",
        "",
        "| Concurrencia (guardias) | Solicitudes/s | Ingresos/s | Cliente media (ms) | Cliente p50 / p95 / p99 (ms) | Servidor p50 / p95 (ms) | Errores | Dobles concesiones | Titulares validos no admitidos |",
        "|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for r in results:
        lines.append(
            f"| {r['concurrency']} | {r['throughput_rps']} | {r['admissions_per_s']} | {r['client_mean_ms']} | "
            f"{r['client_p50_ms']} / {r['client_p95_ms']} / {r['client_p99_ms']} | "
            f"{r['server_p50_ms']} / {r['server_p95_ms']} | {r['errors']} de {r['requests']} | {r['double_grants']} | "
            f"{r['valid_holders_not_admitted']} de {r['qr_tokens']} |"
        )
    lines += [
        "",
        "Cada QR es de un titular valido: lo correcto es exactamente una concesion. *Dobles concesiones*",
        "mide la seguridad (uso unico, ADR-8); *titulares validos no admitidos* mide la disponibilidad",
        "(ninguno de los dos escaneos del QR concedio acceso, tipicamente por errores de SQLite bajo",
        "saturacion; en la puerta, el guardia volveria a escanear).",
        "",
    ]
    (RESULTS_DIR / "load-test.md").write_text("\n".join(lines), encoding="utf-8")


async def main_async(args: argparse.Namespace, issuer_secret: bytes) -> list[dict]:
    levels = [int(x) for x in args.levels.split(",")]
    photo = compress_photo(demo_avatar("carga"))  # misma foto para todos: la foto no viaja al servidor
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30, limits=httpx.Limits(max_connections=200)) as client:
        login = await client.post("/auth/login", data={"username": GUARD_EMAIL, "password": GUARD_PASSWORD})
        login.raise_for_status()
        guard_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        results = []
        for level in levels:
            result = await run_level(client, guard_headers, level, args.tickets, issuer_secret, photo)
            print(json.dumps(result))
            results.append(result)
        return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tickets", type=int, default=400, help="entradas (QR) por nivel de concurrencia")
    parser.add_argument("--levels", default="1,2,4,8,16", help="niveles de concurrencia separados por coma")
    args = parser.parse_args()

    if DB_PATH.exists():
        DB_PATH.unlink()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    db.add(User(email=GUARD_EMAIL, full_name="Guardia carga", role=Role.GUARD, password_hash=hash_password(GUARD_PASSWORD)))
    db.commit()
    db.close()
    issuer_secret = ensure_issuer_keys(ISSUER_DIR)

    server = start_server()
    try:
        results = asyncio.run(main_async(args, issuer_secret))
        write_results(results, args)
    finally:
        server.terminate()
        server.wait(timeout=10)
        engine.dispose()
        # En Windows el archivo puede seguir tomado unos instantes tras cerrar el servidor.
        for _ in range(50):
            try:
                DB_PATH.unlink(missing_ok=True)
                break
            except PermissionError:
                time.sleep(0.2)
        shutil.rmtree(ISSUER_DIR, ignore_errors=True)

    print(f"Resultados en {RESULTS_DIR}")


if __name__ == "__main__":
    main()
