"""Flujo de QR dinamico sobre entradas: generar -> validar -> reusar -> expirar, mas
anti pass-back y consumo atomico (docs/architecture.md, docs/threat-model.md A9)."""

import threading
import time

from app.models import Role
from helpers import attendee_session, auth_header, create_event, create_user, login


def _guard(client, email: str) -> str:
    create_user(email, Role.GUARD)
    return login(client, email)


def test_generate_then_validate_grants_access_once(client):
    event_id, [gate_id] = create_event()
    _, attendee = attendee_session(client, event_id)
    guard = _guard(client, "guard_ok@test.cl")

    generated = client.post("/qr/generate", headers=auth_header(attendee))
    assert generated.status_code == 200
    qr_token = generated.json()["token"]

    first_scan = client.post("/qr/validate", json={"token": qr_token, "gate_id": gate_id}, headers=auth_header(guard))
    assert first_scan.status_code == 200
    body = first_scan.json()
    assert body["granted"] is True
    assert body["reason"] == "ok"
    assert body["attendee"]["holder_name"] == "Asistente Test"
    assert "***" in body["attendee"]["rut_masked"]
    assert body["latency_ms"] >= 0

    second_scan = client.post("/qr/validate", json={"token": qr_token, "gate_id": gate_id}, headers=auth_header(guard))
    assert second_scan.json()["granted"] is False
    assert second_scan.json()["reason"] == "already_used"


def test_expired_token_is_rejected(client):
    _, attendee = attendee_session(client)
    guard = _guard(client, "guard_exp@test.cl")

    generated = client.post("/qr/generate", headers=auth_header(attendee))
    qr_token = generated.json()["token"]
    ttl_seconds = generated.json()["ttl_seconds"]

    time.sleep(ttl_seconds + 1)

    scan = client.post("/qr/validate", json={"token": qr_token}, headers=auth_header(guard))
    assert scan.json()["granted"] is False
    assert scan.json()["reason"] == "expired"


def test_unknown_token_is_invalid(client):
    guard = _guard(client, "guard_inv@test.cl")

    scan = client.post(
        "/qr/validate",
        json={"token": "00000000-0000-0000-0000-000000000000"},
        headers=auth_header(guard),
    )
    body = scan.json()
    assert body["granted"] is False
    assert body["reason"] == "invalid"
    assert body["attendee"] is None


def test_generating_new_qr_invalidates_previous_one(client):
    """Cubre ADR-2 (docs/architecture.md): un QR nuevo revoca cualquier QR anterior sin usar."""
    _, attendee = attendee_session(client)
    guard = _guard(client, "guard_regen@test.cl")

    first_token = client.post("/qr/generate", headers=auth_header(attendee)).json()["token"]
    second_token = client.post("/qr/generate", headers=auth_header(attendee)).json()["token"]
    assert second_token != first_token

    scan_old = client.post("/qr/validate", json={"token": first_token}, headers=auth_header(guard))
    assert scan_old.json()["granted"] is False
    assert scan_old.json()["reason"] == "already_used"


def test_admitted_attendee_cannot_generate_new_qr(client):
    """Anti pass-back (A9): tras ingresar no se puede sacar otro QR para pasarselo a alguien."""
    _, attendee = attendee_session(client)
    guard = _guard(client, "guard_passback@test.cl")

    qr_token = client.post("/qr/generate", headers=auth_header(attendee)).json()["token"]
    assert client.post("/qr/validate", json={"token": qr_token}, headers=auth_header(guard)).json()["granted"]

    again = client.post("/qr/generate", headers=auth_header(attendee))
    assert again.status_code == 409
    assert again.json()["detail"] == "already_admitted"


def test_qr_from_other_event_is_rejected_at_gate(client):
    _, [gate_other_event] = create_event("Otro evento")
    _, attendee = attendee_session(client)
    guard = _guard(client, "guard_wrong@test.cl")

    qr_token = client.post("/qr/generate", headers=auth_header(attendee)).json()["token"]
    scan = client.post(
        "/qr/validate", json={"token": qr_token, "gate_id": gate_other_event}, headers=auth_header(guard)
    )
    assert scan.json()["granted"] is False
    assert scan.json()["reason"] == "wrong_event"


def test_concurrent_scans_grant_access_only_once(client):
    """Dos puertas escanean el mismo QR a la vez: el consumo atomico concede solo una."""
    event_id, gate_ids = create_event(gates=2)
    _, attendee = attendee_session(client, event_id)
    guard = _guard(client, "guard_race@test.cl")
    qr_token = client.post("/qr/generate", headers=auth_header(attendee)).json()["token"]

    results: list[bool] = []
    barrier = threading.Barrier(len(gate_ids) * 3)

    def scan(gate_id: int) -> None:
        barrier.wait()
        res = client.post("/qr/validate", json={"token": qr_token, "gate_id": gate_id}, headers=auth_header(guard))
        results.append(res.json()["granted"])

    threads = [threading.Thread(target=scan, args=(g,)) for g in gate_ids * 3]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert results.count(True) == 1


def test_staff_token_cannot_generate_qr_and_attendee_cannot_validate(client):
    guard = _guard(client, "guard_gen@test.cl")
    _, attendee = attendee_session(client)

    assert client.post("/qr/generate", headers=auth_header(guard)).status_code == 401
    res = client.post(
        "/qr/validate",
        json={"token": "00000000-0000-0000-0000-000000000000"},
        headers=auth_header(attendee),
    )
    assert res.status_code == 401
