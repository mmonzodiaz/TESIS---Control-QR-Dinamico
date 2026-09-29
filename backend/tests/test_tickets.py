"""Entradas nominativas: la lista de RUT que tienen entrada para un evento (sin codigos ni activacion
en el telefono; en la puerta se coteja el RUT firmado de la cedula)."""

from app.models import Role
from app.rut import is_valid_rut, mask_rut
from helpers import auth_header, create_event, create_user, login, new_rut


def test_rut_validation():
    assert is_valid_rut("11.111.111-1")
    assert is_valid_rut("12345678-5")
    assert is_valid_rut("12345678-5".lower())
    assert not is_valid_rut("12345678-9")
    assert not is_valid_rut("abc")
    assert mask_rut("123456785") == "12.***.***-5"


def test_admin_manages_events_gates_and_ticket_list(client):
    create_user("admin_evt@test.cl", Role.ADMIN)
    admin = login(client, "admin_evt@test.cl")

    event = client.post("/events", json={"name": "Partido"}, headers=auth_header(admin))
    assert event.status_code == 201
    event_id = event.json()["id"]
    gate = client.post(f"/events/{event_id}/gates", json={"name": "Norte", "lane": "digital"}, headers=auth_header(admin))
    assert gate.status_code == 201

    rut = new_rut()
    ticket = client.post(f"/events/{event_id}/tickets", json={"holder_name": "Luis", "rut": rut}, headers=auth_header(admin))
    assert ticket.status_code == 201
    assert ticket.json()["document_id"] == rut.replace("-", "")
    assert "code" not in ticket.json()

    duplicate = client.post(f"/events/{event_id}/tickets", json={"holder_name": "Luis", "rut": rut}, headers=auth_header(admin))
    assert duplicate.status_code == 400
    bad_rut = client.post(f"/events/{event_id}/tickets", json={"holder_name": "X", "rut": "12345678-9"}, headers=auth_header(admin))
    assert bad_rut.status_code == 400

    listing = client.get(f"/events/{event_id}/tickets", headers=auth_header(admin)).json()
    assert [t["document_id"] for t in listing] == [rut.replace("-", "")]

    assert client.delete(f"/tickets/{ticket.json()['id']}", headers=auth_header(admin)).status_code == 204
    assert client.get(f"/events/{event_id}/tickets", headers=auth_header(admin)).json() == []


def test_guard_cannot_manage_events_or_tickets(client):
    create_user("guard_evt@test.cl", Role.GUARD)
    guard = login(client, "guard_evt@test.cl")
    event_id, _ = create_event()

    assert client.get("/events", headers=auth_header(guard)).status_code == 200
    assert client.post("/events", json={"name": "X"}, headers=auth_header(guard)).status_code == 403
    assert client.get(f"/events/{event_id}/tickets", headers=auth_header(guard)).status_code == 403
    assert (
        client.post(f"/events/{event_id}/tickets", json={"holder_name": "X", "rut": new_rut()}, headers=auth_header(guard)).status_code
        == 403
    )
