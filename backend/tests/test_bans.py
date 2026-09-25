"""Prohibicion de ingreso: se aplica en la puerta, sin consumir el QR ni registrar el ingreso."""

from app.models import Role
from helpers import attendee_session, auth_header, create_event, create_ticket, claim, create_user, login, new_rut


def _admin_and_guard(client, suffix: str) -> tuple[str, str]:
    create_user(f"admin_ban_{suffix}@test.cl", Role.ADMIN)
    create_user(f"guard_ban_{suffix}@test.cl", Role.GUARD)
    return login(client, f"admin_ban_{suffix}@test.cl"), login(client, f"guard_ban_{suffix}@test.cl")


def test_banned_person_is_rejected_at_gate_and_can_enter_after_ban_is_lifted(client):
    admin, guard = _admin_and_guard(client, "flow")
    event_id, [gate_id] = create_event()
    ticket_id, rut, code = create_ticket(event_id)
    attendee = claim(client, rut, code)

    ban = client.post("/bans", json={"rut": rut, "reason": "Sancion Estadio Seguro"}, headers=auth_header(admin))
    assert ban.status_code == 201

    qr = client.post("/qr/generate", headers=auth_header(attendee)).json()["token"]
    scan = client.post("/qr/validate", json={"token": qr, "gate_id": gate_id}, headers=auth_header(guard)).json()
    assert scan["granted"] is False
    assert scan["reason"] == "banned"
    assert scan["attendee"]["admitted_at"] is None  # no se registra ingreso

    assert client.delete(f"/bans/{ban.json()['id']}", headers=auth_header(admin)).status_code == 204
    # El mismo QR no se consumio: sigue sirviendo si la prohibicion se levanta dentro de su vigencia.
    again = client.post("/qr/validate", json={"token": qr, "gate_id": gate_id}, headers=auth_header(guard)).json()
    assert again["granted"] is True


def test_only_admin_manages_bans_and_rut_is_validated(client):
    admin, guard = _admin_and_guard(client, "perm")
    _, attendee = attendee_session(client)

    assert client.post("/bans", json={"rut": new_rut(), "reason": "x"}, headers=auth_header(guard)).status_code == 403
    assert client.get("/bans", headers=auth_header(attendee)).status_code == 401
    assert client.post("/bans", json={"rut": "12345678-9", "reason": "x"}, headers=auth_header(admin)).status_code == 400

    rut = new_rut()
    assert client.post("/bans", json={"rut": rut, "reason": "x"}, headers=auth_header(admin)).status_code == 201
    assert client.post("/bans", json={"rut": rut, "reason": "x"}, headers=auth_header(admin)).status_code == 400
