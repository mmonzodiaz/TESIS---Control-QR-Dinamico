"""Limites de intentos (A5, A7): login del personal y validaciones por guardia."""

from fastapi.testclient import TestClient

from app import ratelimit
from app.main import app
from app.models import Role
from app.ratelimit import RateLimiter
from app.routers.auth import login_account_total_limiter
from app.routers.qr import validate_rate_limiter
from helpers import create_event, create_user, guard_scanner, person_with_ticket


def client_from(ip: str) -> TestClient:
    return TestClient(app, client=(ip, 50000))


def bad_login(client, email: str) -> int:
    return client.post("/auth/login", data={"username": email, "password": "adivinando"}).status_code


def test_one_ip_cannot_lock_a_staff_account_out_for_everyone(client):
    """Antes el limite por cuenta contaba los intentos desde cualquier IP: cinco intentos por minuto
    desde cualquier lado dejaban al guardia real afuera durante todo el evento. Ahora el limite
    estricto es por cuenta y por IP; el de la cuenta desde cualquier IP es mayor que el de una IP."""
    create_user("guard_lock@test.cl", Role.GUARD)
    attacker = client_from("203.0.113.7")
    assert [bad_login(attacker, "guard_lock@test.cl") for _ in range(6)][-1] == 429
    real_guard = client_from("198.51.100.20")
    ok = real_guard.post("/auth/login", data={"username": "guard_lock@test.cl", "password": "test-password-123"})
    assert ok.status_code == 200


def test_distributed_brute_force_is_still_capped_per_account(client):
    create_user("guard_dist@test.cl", Role.GUARD)
    original = login_account_total_limiter.max_calls
    login_account_total_limiter.max_calls = 4
    try:
        statuses = [bad_login(client_from(f"192.0.2.{i}"), "guard_dist@test.cl") for i in range(5)]
    finally:
        login_account_total_limiter.max_calls = original
    assert statuses == [401, 401, 401, 401, 429]


def test_rate_limiter_forgets_idle_keys(monkeypatch):
    """Cada email inventado dejaba una clave en memoria para siempre."""
    now = [1000.0]
    monkeypatch.setattr(ratelimit.time, "monotonic", lambda: now[0])
    limiter = RateLimiter(5, window_seconds=60)
    for i in range(100):
        limiter.hit(f"inventado-{i}@x.cl")
    assert len(limiter._calls) == 100
    now[0] += 61
    limiter.hit("otro@x.cl")
    assert set(limiter._calls) == {"otro@x.cl"}


def test_login_is_limited_per_account(client):
    create_user("guard_rl@test.cl", Role.GUARD)
    statuses = [
        client.post("/auth/login", data={"username": "guard_rl@test.cl", "password": "adivinando"}).status_code
        for _ in range(6)
    ]
    assert statuses[:5] == [401] * 5
    assert statuses[5] == 429
    # Otra cuenta desde el mismo equipo todavia puede entrar (el limite por IP es mas holgado).
    create_user("guard_rl2@test.cl", Role.GUARD)
    ok = client.post("/auth/login", data={"username": "guard_rl2@test.cl", "password": "test-password-123"})
    assert ok.status_code == 200


def test_validation_is_limited_per_guard(client):
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    _, scanner = guard_scanner(client, "guard_rl3@test.cl", event_id)
    original = validate_rate_limiter.max_calls
    validate_rate_limiter.max_calls = 3
    try:
        contents, _ = scanner.read(phone.qr())
        payload = {**scanner.validate_payload(contents, gate_id), "action": "check"}
        statuses = [client.post("/qr/validate", json=payload, headers=scanner.headers).status_code for _ in range(4)]
    finally:
        validate_rate_limiter.max_calls = original
    assert statuses == [200, 200, 200, 429]
