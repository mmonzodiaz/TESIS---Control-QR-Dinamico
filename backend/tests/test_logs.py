"""Cobertura de /logs y /metrics: acceso restringido al personal y contenido del registro."""

from app.models import Role
from helpers import attendee_phone, attendee_session, auth_header, create_event, create_user, guard_scanner, login


def test_attendee_cannot_read_logs_or_metrics(client):
    event_id, _ = create_event()
    _, attendee = attendee_session(client, event_id)

    assert client.get("/logs", headers=auth_header(attendee)).status_code == 401
    assert client.get(f"/metrics?event_id={event_id}", headers=auth_header(attendee)).status_code == 401


def test_admin_and_guard_can_read_logs(client):
    create_user("admin_logs@test.cl", Role.ADMIN)
    create_user("guard_logs@test.cl", Role.GUARD)
    admin_token = login(client, "admin_logs@test.cl")
    guard_token = login(client, "guard_logs@test.cl")

    assert client.get("/logs", headers=auth_header(admin_token)).status_code == 200
    assert client.get("/logs", headers=auth_header(guard_token)).status_code == 200


def test_validate_attempt_is_recorded_in_logs(client):
    event_id, [gate_id] = create_event()
    _, phone = attendee_phone(client, event_id)
    guard_token, scanner = guard_scanner(client, "guard_reg@test.cl", event_id)

    qr = phone.qr()
    contents, _ = scanner.read(qr)
    scanner.scan(qr, gate_id)

    logs = client.get("/logs", headers=auth_header(guard_token)).json()
    matching = [entry for entry in logs if entry["token_id"] == contents.nonce.hex()]
    assert len(matching) == 1
    assert matching[0]["granted"] is True
    assert matching[0]["reason"] == "ok"
    assert matching[0]["holder_name"] == "Asistente Test"
    assert matching[0]["gate"]["id"] == gate_id
    assert matching[0]["scanned_by"]["email"] == "guard_reg@test.cl"


def test_metrics_aggregate_scans_per_gate(client):
    event_id, [gate_a, gate_b] = create_event("Evento metricas", gates=2)
    guard, scanner = guard_scanner(client, "guard_metrics@test.cl", event_id)

    for _ in range(3):
        _, phone = attendee_phone(client, event_id)
        qr = phone.qr()
        scanner.scan(qr, gate_a)
        # Re-escaneo del mismo QR: debe contarse como rechazo "already_used".
        scanner.scan(qr, gate_a)

    res = client.get(f"/metrics?event_id={event_id}", headers=auth_header(guard))
    assert res.status_code == 200
    data = res.json()
    assert data["tickets_total"] == 3
    assert data["tickets_claimed"] == 3
    assert data["tickets_admitted"] == 3

    by_gate = {g["gate_id"]: g for g in data["gates"]}
    assert by_gate[gate_a]["scans"] == 6
    assert by_gate[gate_a]["granted"] == 3
    assert by_gate[gate_a]["rejected_by_reason"] == {"already_used": 3}
    assert by_gate[gate_a]["latency_p95_ms"] >= by_gate[gate_a]["latency_p50_ms"]
    assert by_gate[gate_b]["scans"] == 0
    assert by_gate[gate_b]["latency_p50_ms"] is None
