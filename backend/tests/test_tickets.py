"""Flujo "RUT + codigo de entrada": autenticacion con dos factores, respuesta uniforme
ante errores (anti enumeracion, A7), vinculo a dispositivo (A8), rate limit, y la cedula
digital importada en el telefono (ADR-11)."""

from app.models import Role
from app.rut import is_valid_rut, mask_rut
from app.credential import new_secret_key
from helpers import auth_header, claim, create_event, create_ticket, create_user, issue_identity, login, new_rut, phone_for
from scripts.qr_clients import Phone


def test_rut_validation():
    assert is_valid_rut("11.111.111-1")
    assert is_valid_rut("12345678-5")
    assert is_valid_rut("12345678-5".lower())
    assert not is_valid_rut("12345678-9")
    assert not is_valid_rut("abc")
    assert mask_rut("123456785") == "12.***.***-5"


def test_claim_with_rut_and_code_returns_attendee_session(client):
    event_id, _ = create_event("Festival")
    _, rut, code = create_ticket(event_id, "Ana Perez")

    # Acepta el RUT con puntos y el codigo en minusculas/con guion, como lo tipearia alguien.
    body_part, dv = rut.split("-")
    formatted = f"{body_part[:2]}.{body_part[2:5]}.{body_part[5:]}-{dv}"
    res = phone_for(rut, "Ana Perez").claim(client, formatted, f"{code[:4]}-{code[4:]}".lower())
    assert res.status_code == 200, res.text
    attendee = res.json()["attendee"]
    assert attendee["holder_name"] == "Ana Perez"
    assert attendee["event"]["name"] == "Festival"
    # Lo que el telefono necesita para generar QR sin conexion.
    qr = res.json()["qr"]
    assert qr["ticket_id"] == attendee["ticket_id"]
    assert qr["event_public_key"] and qr["server_time"] > 0

    me = client.get("/tickets/me", headers=auth_header(res.json()["access_token"]))
    assert me.status_code == 200
    assert me.json()["attendee"]["ticket_id"] == attendee["ticket_id"]


def test_rut_alone_is_not_enough_and_errors_are_uniform(client):
    event_id, _ = create_event()
    _, rut, code = create_ticket(event_id)
    _, other_rut, other_code = create_ticket(event_id)

    phone = phone_for(rut)
    wrong_code = phone.claim(client, rut, "ZZZZZZZZ")
    unknown_rut = phone.claim(client, new_rut(), code)
    swapped = phone.claim(client, rut, other_code)
    bad_format = phone.claim(client, "12345678-9", code)

    for res in (wrong_code, unknown_rut, swapped, bad_format):
        assert res.status_code == 401
        assert res.json()["detail"] == "RUT o codigo de entrada invalido"


def test_second_device_is_rejected_until_admin_resets(client):
    event_id, _ = create_event()
    ticket_id, rut, code = create_ticket(event_id)
    first_session = claim(client, rut, code)

    second = phone_for(rut).claim(client, rut, code)
    assert second.status_code == 409

    create_user("admin_reset@test.cl", Role.ADMIN)
    admin = login(client, "admin_reset@test.cl")
    assert client.post(f"/tickets/{ticket_id}/reset", headers=auth_header(admin)).status_code == 200

    # La sesion del primer dispositivo queda revocada y el nuevo puede reclamar.
    assert client.get("/tickets/me", headers=auth_header(first_session)).status_code == 401
    assert phone_for(rut).claim(client, rut, code).status_code == 200


def test_claim_is_rate_limited(client):
    phone = phone_for(new_rut())
    statuses = [phone.claim(client, new_rut(), "XXXXXXXX").status_code for _ in range(11)]
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429


def test_admin_creates_event_gate_and_ticket(client):
    create_user("admin_evt@test.cl", Role.ADMIN)
    admin = login(client, "admin_evt@test.cl")

    event = client.post("/events", json={"name": "Partido"}, headers=auth_header(admin))
    assert event.status_code == 201
    event_id = event.json()["id"]

    gate = client.post(f"/events/{event_id}/gates", json={"name": "Norte", "lane": "rapida"}, headers=auth_header(admin))
    assert gate.status_code == 201

    rut = new_rut()
    ticket = client.post(f"/events/{event_id}/tickets", json={"holder_name": "Luis", "rut": rut}, headers=auth_header(admin))
    assert ticket.status_code == 201
    code = ticket.json()["code"]
    assert len(code) == 8

    duplicate = client.post(f"/events/{event_id}/tickets", json={"holder_name": "Luis", "rut": rut}, headers=auth_header(admin))
    assert duplicate.status_code == 400

    listing = client.get(f"/events/{event_id}/tickets", headers=auth_header(admin)).json()
    assert "code" not in listing[0] and "code_hash" not in listing[0]

    assert phone_for(rut).claim(client, rut, code).status_code == 200


def test_claim_requires_the_holders_own_signed_credential(client):
    event_id, _ = create_event()
    ticket_id, rut, code = create_ticket(event_id)

    # Cedula de otra persona (aunque este bien firmada): la entrada es nominativa.
    other_person = Phone(issue_identity(new_rut()))
    res = other_person.claim(client, rut, code)
    assert res.status_code == 400
    assert "otra persona" in res.json()["detail"]

    # Cedula "emitida" por alguien que no es el Registro Civil.
    forged = Phone(issue_identity(rut, issuer_secret=new_secret_key()))
    res = forged.claim(client, rut, code)
    assert res.status_code == 400
    assert "Registro Civil" in res.json()["detail"]

    # Ninguno de los intentos fallidos dejo la entrada ligada a un dispositivo.
    assert phone_for(rut).claim(client, rut, code).status_code == 200


def test_claim_never_receives_the_photo(client):
    """La foto se queda en el telefono: el claim manda el core (con el hash de la foto) y la firma."""
    event_id, _ = create_event()
    _, rut, code = create_ticket(event_id)
    phone = phone_for(rut)
    payload = phone.claim_payload(rut, code)
    assert set(payload) == {"rut", "code", "device_public_key", "credential_core", "issuer_sig"}
    assert phone.credential.photo not in phone.credential.core


def test_guard_cannot_manage_events_or_tickets(client):
    create_user("guard_evt@test.cl", Role.GUARD)
    guard = login(client, "guard_evt@test.cl")
    event_id, _ = create_event()

    assert client.get("/events", headers=auth_header(guard)).status_code == 200
    assert client.post("/events", json={"name": "X"}, headers=auth_header(guard)).status_code == 403
    assert client.get(f"/events/{event_id}/tickets", headers=auth_header(guard)).status_code == 403
