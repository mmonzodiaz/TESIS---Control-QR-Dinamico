"""Flujo del QR dinamico generado por el telefono (ADR-11): lectura local con foto firmada, uso
unico, expiracion, anti pass-back, consumo atomico, y los ataques contra la credencial
(docs/threat-model.md)."""

import dataclasses
import threading

import pytest

from app.credential import CredentialError, b64e, base45_decode, decode_qr, new_secret_key
from app.models import unix_now
from helpers import (
    attendee_phone,
    attendee_session,
    auth_header,
    create_event,
    create_ticket,
    guard_scanner,
    issue_identity,
    phone_for,
)
from scripts.qr_clients import Phone, Scanner
from scripts.registro_civil_sim import compress_photo, demo_avatar

MAX_AGE = 2 + 5  # QR_TTL_SECONDS de conftest + qr_clock_skew_seconds


def test_scan_shows_signed_identity_and_grants_access_once(client):
    event_id, [gate_id] = create_event()
    _, phone = attendee_phone(client, event_id)
    _, scanner = guard_scanner(client, "guard_ok@test.cl", event_id)

    qr = phone.qr()
    first = scanner.scan(qr, gate_id)
    assert first["granted"] is True
    assert first["reason"] == "ok"
    # El guardia ve la foto, el nombre y el RUT que vienen firmados dentro del QR.
    assert first["shown"]["photo"] == phone.credential.photo
    assert first["shown"]["name"] == "Asistente Test"
    assert first["attendee"]["holder_name"] == "Asistente Test"
    assert first["latency_ms"] >= 0

    again = scanner.scan(qr, gate_id)
    assert again["granted"] is False
    assert again["reason"] == "already_used"


def test_qr_text_does_not_reveal_identity(client):
    """Quien fotografia el QR en la fila no puede leer nombre, RUT ni foto: va cifrado."""
    event_id, _ = create_event()
    ticket_id, rut, code = create_ticket(event_id, "Maria Gonzalez")
    phone = phone_for(rut, "Maria Gonzalez")
    phone.claim(client, rut, code)

    raw = base45_decode(phone.qr().removeprefix("CA1:"))
    assert b"Maria" not in raw
    assert rut.replace("-", "").encode() not in raw
    assert phone.credential.photo[:32] not in raw


def test_old_qr_is_expired_and_future_dated_qr_is_invalid(client):
    event_id, [gate_id] = create_event()
    _, phone = attendee_phone(client, event_id)
    _, scanner = guard_scanner(client, "guard_exp@test.cl", event_id)

    assert scanner.scan(phone.qr(issued_at=unix_now() - MAX_AGE - 1), gate_id)["reason"] == "expired"
    # Fechar el QR en el futuro seria una forma de alargarle la vigencia.
    assert scanner.scan(phone.qr(issued_at=unix_now() + 60), gate_id)["reason"] == "invalid"
    assert scanner.scan(phone.qr(), gate_id)["granted"] is True


def test_several_qr_can_coexist_but_the_ticket_enters_once(client):
    """El telefono genera QR sin conexion, asi que el servidor no puede revocar el anterior (antes
    ADR-2). La admision unica por entrada acota el efecto: solo uno de ellos puede servir."""
    event_id, [gate_id] = create_event()
    _, phone = attendee_phone(client, event_id)
    _, scanner = guard_scanner(client, "guard_two@test.cl", event_id)

    first, second = phone.qr(), phone.qr()
    assert first != second
    assert scanner.scan(first, gate_id)["granted"] is True
    assert scanner.scan(second, gate_id)["reason"] == "already_admitted"


def test_credential_from_fake_issuer_is_rejected_locally_and_online(client):
    event_id, [gate_id] = create_event()
    ticket_id, rut, code = create_ticket(event_id)
    _, scanner = guard_scanner(client, "guard_fake@test.cl", event_id)

    fake = issue_identity(rut, issuer_secret=new_secret_key())  # "cedula" firmada por otro
    assert Phone(fake).claim(client, rut, code).status_code == 400

    # Aunque lograra un QR (p. ej. activando con la cedula real y mostrando otra), el escaner lo rechaza.
    real_phone = phone_for(rut)
    real_phone.claim(client, rut, code)
    forged = Phone(fake, device_secret=real_phone.device_secret, params=real_phone.params)
    result = scanner.scan(forged.qr(), gate_id)
    assert result["granted"] is False
    assert result["reason"] == "invalid"
    assert "emisor" in result["local_error"]

    # Y si un escaner adulterado igual lo consultara en linea, el servidor tambien lo rechaza.
    raw = decode_qr(forged.qr(), scanner.event_secret)
    res = client.post("/qr/validate", json=Scanner.validate_payload(raw, gate_id), headers=scanner.headers)
    assert res.json()["reason"] == "invalid"


def test_swapped_photo_is_detected(client):
    """Cambiar la foto de una cedula real por la del atacante rompe el hash firmado."""
    event_id, [gate_id] = create_event()
    _, phone = attendee_phone(client, event_id)
    _, scanner = guard_scanner(client, "guard_photo@test.cl", event_id)

    attacker_photo = compress_photo(demo_avatar("atacante"))
    tampered = Phone(
        dataclasses.replace(phone.credential, photo=attacker_photo),
        device_secret=phone.device_secret,
        params=phone.params,
    )
    with pytest.raises(CredentialError, match="foto"):
        scanner.read(tampered.qr())


def test_copied_credential_without_the_device_key_is_invalid(client):
    """Clonar el archivo de la cedula a otro telefono no basta: falta la clave del dispositivo (A8)."""
    event_id, [gate_id] = create_event()
    _, phone = attendee_phone(client, event_id)
    _, scanner = guard_scanner(client, "guard_clone@test.cl", event_id)

    clone = Phone(phone.credential, device_secret=new_secret_key(), params=phone.params)
    result = scanner.scan(clone.qr(), gate_id)
    assert result["granted"] is False
    assert result["reason"] == "invalid"


def test_qr_from_other_event_cannot_be_read_there(client):
    event_id, [gate_id] = create_event()
    other_event, [other_gate] = create_event("Otro evento")
    _, phone = attendee_phone(client, event_id)
    _, scanner_here = guard_scanner(client, "guard_here@test.cl", event_id)
    _, scanner_other = guard_scanner(client, "guard_wrong@test.cl", other_event)

    qr = phone.qr()
    # Cifrado para el evento de la entrada: el escaner de otro evento no lo puede leer.
    result = scanner_other.scan(qr, other_gate)
    assert result["reason"] == "invalid"
    assert "otro evento" in result["local_error"]
    # Y si se consulta en linea desde una puerta de otro evento, el servidor lo rechaza.
    contents, _ = scanner_here.read(qr)
    res = client.post("/qr/validate", json=Scanner.validate_payload(contents, other_gate), headers=scanner_here.headers)
    assert res.json()["reason"] == "wrong_event"


def test_admitted_ticket_cannot_enter_again(client):
    """Anti pass-back (A9): tras ingresar, ningun QR nuevo de esa entrada sirve."""
    event_id, [gate_id] = create_event()
    _, phone = attendee_phone(client, event_id)
    _, scanner = guard_scanner(client, "guard_passback@test.cl", event_id)

    assert scanner.scan(phone.qr(), gate_id)["granted"]
    assert scanner.scan(phone.qr(), gate_id)["reason"] == "already_admitted"
    me = client.get("/tickets/me", headers=auth_header(phone.session)).json()
    assert me["attendee"]["admitted_at"] is not None


def test_concurrent_scans_grant_access_only_once(client):
    """Dos puertas escanean el mismo QR a la vez: el INSERT del nonce concede solo una."""
    event_id, gate_ids = create_event(gates=2)
    _, phone = attendee_phone(client, event_id)
    _, scanner = guard_scanner(client, "guard_race@test.cl", event_id)
    contents, _ = scanner.read(phone.qr())

    results: list[bool] = []
    barrier = threading.Barrier(len(gate_ids) * 3)

    def scan(gate_id: int) -> None:
        barrier.wait()
        res = client.post("/qr/validate", json=Scanner.validate_payload(contents, gate_id), headers=scanner.headers)
        results.append(res.json()["granted"])

    threads = [threading.Thread(target=scan, args=(g,)) for g in gate_ids * 3]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert results.count(True) == 1


def test_only_staff_gets_verifier_keys_and_attendee_cannot_validate(client):
    event_id, _ = create_event()
    _, attendee = attendee_session(client, event_id)

    assert client.get(f"/events/{event_id}/verifier", headers=auth_header(attendee)).status_code == 401
    payload = {
        "ticket_id": 1,
        "nonce": "0" * 32,
        "issued_at": unix_now(),
        "device_sig": b64e(bytes(64)),
        "credential_core": b64e(b"x"),
        "issuer_sig": b64e(bytes(64)),
    }
    assert client.post("/qr/validate", json=payload, headers=auth_header(attendee)).status_code == 401
