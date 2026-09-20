"""Smoke test del flujo de QR dinamico: no es cobertura exhaustiva, verifica
que generar -> validar -> reusar -> expirar se comporte como documentan
docs/architecture.md y docs/ttl-justification.md."""

import time

from app.models import Role
from helpers import auth_header, create_user, login


def test_generate_then_validate_grants_access_once(client):
    create_user("resident_ok@test.cl", Role.RESIDENT)
    create_user("guard_ok@test.cl", Role.GUARD)
    resident_token = login(client, "resident_ok@test.cl")
    guard_token = login(client, "guard_ok@test.cl")

    generated = client.post("/qr/generate", headers=auth_header(resident_token))
    assert generated.status_code == 200
    qr_token = generated.json()["token"]

    first_scan = client.post("/qr/validate", json={"token": qr_token}, headers=auth_header(guard_token))
    assert first_scan.status_code == 200
    assert first_scan.json()["granted"] is True
    assert first_scan.json()["reason"] == "ok"

    second_scan = client.post("/qr/validate", json={"token": qr_token}, headers=auth_header(guard_token))
    assert second_scan.json()["granted"] is False
    assert second_scan.json()["reason"] == "already_used"


def test_expired_token_is_rejected(client):
    create_user("resident_exp@test.cl", Role.RESIDENT)
    create_user("guard_exp@test.cl", Role.GUARD)
    resident_token = login(client, "resident_exp@test.cl")
    guard_token = login(client, "guard_exp@test.cl")

    generated = client.post("/qr/generate", headers=auth_header(resident_token))
    qr_token = generated.json()["token"]
    ttl_seconds = generated.json()["ttl_seconds"]

    time.sleep(ttl_seconds + 1)

    scan = client.post("/qr/validate", json={"token": qr_token}, headers=auth_header(guard_token))
    assert scan.json()["granted"] is False
    assert scan.json()["reason"] == "expired"


def test_unknown_token_is_invalid(client):
    create_user("guard_inv@test.cl", Role.GUARD)
    guard_token = login(client, "guard_inv@test.cl")

    scan = client.post(
        "/qr/validate",
        json={"token": "00000000-0000-0000-0000-000000000000"},
        headers=auth_header(guard_token),
    )
    assert scan.json() == {"granted": False, "reason": "invalid", "user": None}


def test_generating_new_qr_invalidates_previous_one(client):
    """Cubre ADR-2 (docs/architecture.md): un QR nuevo revoca cualquier QR anterior sin usar."""
    create_user("resident_regen@test.cl", Role.RESIDENT)
    create_user("guard_regen@test.cl", Role.GUARD)
    resident_token = login(client, "resident_regen@test.cl")
    guard_token = login(client, "guard_regen@test.cl")

    first = client.post("/qr/generate", headers=auth_header(resident_token))
    first_token = first.json()["token"]

    second = client.post("/qr/generate", headers=auth_header(resident_token))
    assert second.json()["token"] != first_token

    scan_old = client.post("/qr/validate", json={"token": first_token}, headers=auth_header(guard_token))
    assert scan_old.json()["granted"] is False
    assert scan_old.json()["reason"] == "already_used"


def test_resident_cannot_validate_qr(client):
    create_user("resident_forbidden@test.cl", Role.RESIDENT)
    resident_token = login(client, "resident_forbidden@test.cl")

    res = client.post(
        "/qr/validate",
        json={"token": "00000000-0000-0000-0000-000000000000"},
        headers=auth_header(resident_token),
    )
    assert res.status_code == 403
