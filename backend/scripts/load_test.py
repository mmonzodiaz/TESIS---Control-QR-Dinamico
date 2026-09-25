"""Prueba de carga del flujo de validacion de QR (docs/queue-model.md, seccion 2).

Levanta su propio servidor uvicorn contra una base SQLite temporal (no toca la base demo),
siembra un evento con N entradas y mide, para varios niveles de concurrencia (= filas/guardias
escaneando a la vez):

- throughput de validacion (validaciones/s),
- latencia de extremo a extremo vista por el escaner (p50/p95/p99),
- latencia de procesamiento en el servidor (AccessLog.latency_ms),
- errores HTTP,
- correctitud bajo carga: cada QR se escanea desde DOS filas a la vez y se verifica que
  exactamente uno de los dos escaneos concede acceso (consumo atomico, ADR-8).

Uso (desde backend/):  uv run python scripts/load_test.py [--tickets 400] [--levels 1,2,4,8,16]
Escribe docs/results/load-test.json y docs/results/load-test.md.
"""

import argparse
import asyncio
import json
import os
import pathlib
import platform
import statistics
import subprocess
import sys
import time
from datetime import datetime, timezone

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
RESULTS_DIR = BACKEND_DIR.parent / "docs" / "results"
DB_PATH = BACKEND_DIR / "loadtest.db"
PORT = 8765

# Deben fijarse antes de importar app.*: pydantic-settings los lee una sola vez.
os.environ["DATABASE_URL"] = f"sqlite:///{DB_PATH}"
# El TTL no es lo que se mide aqui; se alarga para que los QR pre-generados no expiren
# mientras corre la prueba (el TTL real de 45 s se analiza en docs/ttl-justification.md).
os.environ["QR_TTL_SECONDS"] = "3600"
sys.path.insert(0, str(BACKEND_DIR))

import httpx  # noqa: E402

from app.database import Base, SessionLocal, engine  # noqa: E402
from app.models import AccessLog, Event, Gate, Lane, Role, Ticket, User  # noqa: E402
from app.rut import check_digit  # noqa: E402
from app.security import create_access_token, hash_password, hash_ticket_code, new_claim_session  # noqa: E402

BASE_URL = f"http://127.0.0.1:{PORT}"
GUARD_EMAIL, GUARD_PASSWORD = "guardia-carga@test.cl", "carga-123"


def percentile(values: list[float], pct: float) -> float:
    ordered = sorted(values)
    rank = max(1, -(-len(ordered) * pct // 100))  # nearest-rank
    return ordered[int(rank) - 1]


def seed_level(level: int, tickets: int) -> tuple[list[int], list[str]]:
    """Crea un evento con `level` filas y `tickets` entradas ya activadas. Devuelve (gates, jwts)."""
    db = SessionLocal()
    event = Event(name=f"Carga c={level}")
    event.gates = [Gate(name=f"Fila {i + 1}", lane=Lane.FAST) for i in range(max(level, 2))]
    db.add(event)
    db.flush()
    sessions = []
    for i in range(tickets):
        body = str(30_000_000 + level * 100_000 + i)
        ticket = Ticket(
            event_id=event.id,
            holder_name=f"Asistente {i}",
            document_id=body + check_digit(body),
            code_hash=hash_ticket_code(f"L{level}T{i}"),
            claim_session=new_claim_session(),
        )
        db.add(ticket)
        sessions.append(ticket)
    db.commit()
    jwts = [create_access_token(f"ticket:{t.id}", extra={"sid": t.claim_session}) for t in sessions]
    gate_ids = [g.id for g in event.gates]
    db.close()
    return gate_ids, jwts


def server_latencies(gate_ids: list[int]) -> list[float]:
    db = SessionLocal()
    rows = db.query(AccessLog.latency_ms).filter(AccessLog.gate_id.in_(gate_ids)).all()
    db.close()
    return [r[0] for r in rows]


async def run_level(client: httpx.AsyncClient, guard_headers: dict, level: int, tickets: int) -> dict:
    gate_ids, jwts = seed_level(level, tickets)

    # Fase 1: cada asistente genera su QR (no se cronometra como parte de la fila).
    qr_tokens = []
    for jwt in jwts:
        res = await client.post("/qr/generate", headers={"Authorization": f"Bearer {jwt}"})
        res.raise_for_status()
        qr_tokens.append(res.json()["token"])

    # Fase 2: `level` guardias escanean en paralelo. Cada QR se escanea desde dos filas
    # distintas a la vez para ejercitar la carrera que el consumo atomico debe resolver.
    queue: asyncio.Queue[str] = asyncio.Queue()
    for token in qr_tokens:
        queue.put_nowait(token)

    latencies: list[float] = []
    grants_per_token: dict[str, int] = {}
    errors = 0

    async def scan(token: str, gate_id: int) -> None:
        nonlocal errors
        started = time.perf_counter()
        try:
            res = await client.post("/qr/validate", json={"token": token, "gate_id": gate_id}, headers=guard_headers)
            latencies.append((time.perf_counter() - started) * 1000)
            if res.status_code != 200:
                errors += 1
            elif res.json()["granted"]:
                grants_per_token[token] = grants_per_token.get(token, 0) + 1
        except httpx.HTTPError:
            errors += 1

    async def guard_worker(worker: int) -> None:
        while not queue.empty():
            token = queue.get_nowait()
            g1 = gate_ids[worker % len(gate_ids)]
            g2 = gate_ids[(worker + 1) % len(gate_ids)]
            await asyncio.gather(scan(token, g1), scan(token, g2))

    started = time.perf_counter()
    await asyncio.gather(*(guard_worker(w) for w in range(level)))
    elapsed = time.perf_counter() - started

    requests = len(latencies) + errors
    srv = server_latencies(gate_ids)
    double_grants = sum(1 for n in grants_per_token.values() if n > 1)
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
        "| Concurrencia (guardias) | Solicitudes/s | Ingresos/s | Cliente media (ms) | Cliente p50 / p95 / p99 (ms) | Servidor p50 / p95 (ms) | Errores | Dobles concesiones |",
        "|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for r in results:
        lines.append(
            f"| {r['concurrency']} | {r['throughput_rps']} | {r['admissions_per_s']} | {r['client_mean_ms']} | "
            f"{r['client_p50_ms']} / {r['client_p95_ms']} / {r['client_p99_ms']} | "
            f"{r['server_p50_ms']} / {r['server_p95_ms']} | {r['errors']} | {r['double_grants']} |"
        )
    lines.append("")
    (RESULTS_DIR / "load-test.md").write_text("\n".join(lines), encoding="utf-8")


async def main_async(args: argparse.Namespace) -> list[dict]:
    levels = [int(x) for x in args.levels.split(",")]
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30, limits=httpx.Limits(max_connections=200)) as client:
        login = await client.post("/auth/login", data={"username": GUARD_EMAIL, "password": GUARD_PASSWORD})
        login.raise_for_status()
        guard_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        results = []
        for level in levels:
            result = await run_level(client, guard_headers, level, args.tickets)
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

    server = start_server()
    try:
        results = asyncio.run(main_async(args))
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

    print(f"Resultados en {RESULTS_DIR}")


if __name__ == "__main__":
    main()
