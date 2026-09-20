"""Cobertura de /logs: acceso restringido a admin/guard y contenido del registro."""

from app.models import Role
from helpers import auth_header, create_user, login


def test_resident_cannot_read_logs(client):
    create_user("resident_logs@test.cl", Role.RESIDENT)
    resident_token = login(client, "resident_logs@test.cl")

    res = client.get("/logs", headers=auth_header(resident_token))
    assert res.status_code == 403


def test_admin_and_guard_can_read_logs(client):
    create_user("admin_logs@test.cl", Role.ADMIN)
    create_user("guard_logs@test.cl", Role.GUARD)
    admin_token = login(client, "admin_logs@test.cl")
    guard_token = login(client, "guard_logs@test.cl")

    assert client.get("/logs", headers=auth_header(admin_token)).status_code == 200
    assert client.get("/logs", headers=auth_header(guard_token)).status_code == 200


def test_validate_attempt_is_recorded_in_logs(client):
    create_user("resident_reg@test.cl", Role.RESIDENT)
    create_user("guard_reg@test.cl", Role.GUARD)
    resident_token = login(client, "resident_reg@test.cl")
    guard_token = login(client, "guard_reg@test.cl")

    generated = client.post("/qr/generate", headers=auth_header(resident_token))
    qr_token = generated.json()["token"]
    client.post("/qr/validate", json={"token": qr_token}, headers=auth_header(guard_token))

    logs = client.get("/logs", headers=auth_header(guard_token)).json()
    matching = [entry for entry in logs if entry["token_id"] == qr_token]
    assert len(matching) == 1
    assert matching[0]["granted"] is True
    assert matching[0]["reason"] == "ok"
    assert matching[0]["user"]["email"] == "resident_reg@test.cl"
    assert matching[0]["scanned_by"]["email"] == "guard_reg@test.cl"
