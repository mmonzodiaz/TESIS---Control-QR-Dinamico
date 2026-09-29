"""Limites de intentos (A5, A7): login del personal y validaciones por guardia."""

from app.models import Role
from app.routers.qr import validate_rate_limiter
from helpers import create_event, create_user, guard_scanner, person_with_ticket


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
