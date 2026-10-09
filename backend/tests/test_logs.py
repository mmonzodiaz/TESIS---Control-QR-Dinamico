"""Cobertura de /logs y /metrics: acceso restringido al personal y contenido del registro."""

from app.models import Role
from helpers import auth_header, create_event, create_user, guard_scanner, login, new_rut, person_with_ticket, phone_for


def test_anonymous_cannot_read_logs_or_metrics(client):
    event_id, _ = create_event()
    assert client.get("/logs").status_code == 401
    assert client.get(f"/metrics?event_id={event_id}").status_code == 401


def test_admin_and_guard_can_read_logs(client):
    create_user("admin_logs@test.cl", Role.ADMIN)
    create_user("guard_logs@test.cl", Role.GUARD)
    admin_token = login(client, "admin_logs@test.cl")
    guard_token = login(client, "guard_logs@test.cl")

    assert client.get("/logs", headers=auth_header(admin_token)).status_code == 200
    assert client.get("/logs", headers=auth_header(guard_token)).status_code == 200


def test_validate_attempt_is_recorded_in_logs(client):
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
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
    assert matching[0]["scanned_by"]["full_name"] == "guard_reg@test.cl"  # helpers usa el email como nombre


def test_logs_do_not_expose_staff_email_or_rut(client):
    """El historial lo leen los guardias; /users es solo del admin. Quien escaneo aparece con su
    nombre y rol, sin email ni RUT (minimizacion de datos personales)."""
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    _, scanner = guard_scanner(client, "guard_pii_a@test.cl", event_id)
    scanner.scan(phone.qr(), gate_id)
    create_user("guard_pii_b@test.cl", Role.GUARD)
    other_guard = login(client, "guard_pii_b@test.cl")
    assert client.get("/users", headers=auth_header(other_guard)).status_code == 403

    logs = client.get("/logs?limit=500", headers=auth_header(other_guard)).json()
    staff = [entry["scanned_by"] for entry in logs if entry["scanned_by"]]
    assert staff
    assert all(set(s) == {"id", "full_name", "role"} for s in staff)


def test_metrics_aggregate_scans_per_gate(client):
    event_id, [gate_a, gate_b] = create_event("Evento metricas", gates=2)
    guard, scanner = guard_scanner(client, "guard_metrics@test.cl", event_id)

    for _ in range(3):
        _, phone = person_with_ticket(event_id)
        qr = phone.qr()
        scanner.scan(qr, gate_a)
        # Re-escaneo del mismo QR: debe contarse como rechazo "already_used".
        scanner.scan(qr, gate_a)

    res = client.get(f"/metrics?event_id={event_id}", headers=auth_header(guard))
    assert res.status_code == 200
    data = res.json()
    assert data["tickets_total"] == 3
    assert data["tickets_admitted"] == 3

    by_gate = {g["gate_id"]: g for g in data["gates"]}
    assert by_gate[gate_a]["scans"] == 6
    assert by_gate[gate_a]["granted"] == 3
    assert by_gate[gate_a]["rejected_by_reason"] == {"already_used": 3}
    assert by_gate[gate_a]["latency_p95_ms"] >= by_gate[gate_a]["latency_p50_ms"]
    assert by_gate[gate_b]["scans"] == 0
    assert by_gate[gate_b]["latency_p50_ms"] is None


def test_rejection_without_ticket_is_logged_with_the_signed_rut(client):
    """Una cedula valida sin entrada queda en el historial con su RUT (enmascarado)."""
    event_id, [gate_id] = create_event()
    guard_token, scanner = guard_scanner(client, "guard_log_noticket@test.cl", event_id)
    rut = new_rut()
    scanner.scan(phone_for(rut).qr(), gate_id)

    entry = client.get("/logs", headers=auth_header(guard_token)).json()[0]
    assert entry["reason"] == "no_ticket"
    assert entry["rut_masked"].endswith(rut[-1])
