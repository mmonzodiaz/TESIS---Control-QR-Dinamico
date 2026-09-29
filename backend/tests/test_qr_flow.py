"""La cedula digital en la puerta (ADR-10, ADR-11, ADR-12): el QR es de la persona, el recinto
coteja su RUT firmado con la lista de entradas, y el guardia confirma la foto antes de registrar el
ingreso. Incluye los ataques contra la cedula (docs/threat-model.md)."""

import dataclasses
import threading
import time

import pytest

from app.credential import CredentialError, b64e, base45_decode, decode_qr, new_secret_key
from app.models import unix_now
from helpers import (
    VERIFIER_PUBLIC,
    auth_header,
    create_event,
    create_ticket,
    guard_scanner,
    new_rut,
    person_with_ticket,
    phone_for,
)
from scripts.qr_clients import Phone, Scanner
from scripts.registro_civil_sim import compress_photo, demo_avatar

MAX_AGE = 2 + 5  # QR_TTL_SECONDS de conftest + qr_clock_skew_seconds


def test_scan_shows_signed_identity_and_admits_once(client):
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    _, scanner = guard_scanner(client, "guard_ok@test.cl", event_id)

    qr = phone.qr()
    first = scanner.scan(qr, gate_id)
    assert first["granted"] is True and first["reason"] == "ok"
    # El guardia ve la foto, el nombre y el RUT que vienen firmados dentro del QR.
    assert first["shown"]["photo"] == phone.credential.photo
    assert first["shown"]["name"] == "Asistente Test"
    assert first["attendee"]["holder_name"] == "Asistente Test"

    again = scanner.scan(qr, gate_id)
    assert again["granted"] is False and again["reason"] == "already_used"


def test_the_same_cedula_works_at_any_event_where_the_person_has_a_ticket(client):
    """La cedula es de la persona, no de un evento: el mismo telefono sirve en otro recinto."""
    event_a, [gate_a] = create_event("Evento A")
    event_b, [gate_b] = create_event("Evento B")
    rut = new_rut()
    create_ticket(event_a, rut)
    create_ticket(event_b, rut)
    phone = phone_for(rut)
    _, scanner_a = guard_scanner(client, "guard_a@test.cl", event_a)
    _, scanner_b = guard_scanner(client, "guard_b@test.cl", event_b)

    assert scanner_a.scan(phone.qr(), gate_a)["granted"] is True
    assert scanner_b.scan(phone.qr(), gate_b)["granted"] is True


def test_valid_cedula_without_ticket_is_rejected(client):
    event_id, [gate_id] = create_event()
    phone = phone_for(new_rut(), "Sin Entrada")
    _, scanner = guard_scanner(client, "guard_noticket@test.cl", event_id)

    result = scanner.scan(phone.qr(), gate_id)
    assert result["granted"] is False and result["reason"] == "no_ticket"
    # La identidad igual se verifico: el guardia ve quien es.
    assert result["shown"]["name"] == "Sin Entrada"


def test_qr_text_does_not_reveal_identity():
    """Quien fotografia el QR en la fila no puede leer nombre, RUT ni foto: va cifrado."""
    rut = new_rut()
    phone = phone_for(rut, "Maria Gonzalez")
    raw = base45_decode(phone.qr(issued_at=1_790_000_000).removeprefix("CA2:"))
    assert b"Maria" not in raw
    assert rut.replace("-", "").encode() not in raw
    assert phone.credential.photo[:32] not in raw


def test_old_qr_is_expired_and_future_dated_qr_is_invalid(client):
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    _, scanner = guard_scanner(client, "guard_exp@test.cl", event_id)

    assert scanner.scan(phone.qr(issued_at=unix_now() - MAX_AGE - 1), gate_id)["reason"] == "expired"
    # Fechar el QR en el futuro seria una forma de alargarle la vigencia.
    assert scanner.scan(phone.qr(issued_at=unix_now() + 60), gate_id)["reason"] == "invalid"
    assert scanner.scan(phone.qr(), gate_id)["granted"] is True


def test_several_qr_can_coexist_but_the_person_enters_once(client):
    """El telefono genera QR sin conexion: el servidor no revoca el anterior (antes ADR-2), pero la
    admision unica por entrada acota el efecto."""
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    _, scanner = guard_scanner(client, "guard_two@test.cl", event_id)

    first, second = phone.qr(), phone.qr()
    assert first != second
    assert scanner.scan(first, gate_id)["granted"] is True
    assert scanner.scan(second, gate_id)["reason"] == "already_admitted"


def test_cedula_from_fake_issuer_is_rejected_locally_and_online(client):
    event_id, [gate_id] = create_event()
    rut = new_rut()
    create_ticket(event_id, rut)
    fake = phone_for(rut, issuer_secret=new_secret_key())  # "cedula" firmada por otro
    _, scanner = guard_scanner(client, "guard_fake@test.cl", event_id)

    result = scanner.scan(fake.qr(), gate_id)
    assert result["granted"] is False and result["reason"] == "invalid"
    assert "emisor" in result["local_error"]

    # Si un lector adulterado igual lo consultara en linea, el servidor tambien lo rechaza.
    raw = decode_qr(fake.qr(), scanner.verifier_secret)
    res = client.post("/qr/validate", json=Scanner.validate_payload(raw, gate_id), headers=scanner.headers)
    assert res.json()["reason"] == "invalid"


def test_swapped_photo_is_detected(client):
    """Cambiar la foto de una cedula real por la del atacante rompe el hash firmado."""
    event_id, _ = create_event()
    _, phone = person_with_ticket(event_id)
    _, scanner = guard_scanner(client, "guard_photo@test.cl", event_id)

    attacker_photo = compress_photo(demo_avatar("atacante"))
    tampered = dataclasses.replace(phone, credential=dataclasses.replace(phone.credential, photo=attacker_photo))
    with pytest.raises(CredentialError, match="foto"):
        scanner.read(tampered.qr())


def test_copied_cedula_without_the_device_key_is_invalid(client):
    """Copiar la cedula a otro telefono no basta: su clave va firmada dentro de la cedula (A8)."""
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    _, scanner = guard_scanner(client, "guard_clone@test.cl", event_id)

    clone = Phone(phone.credential, new_secret_key(), VERIFIER_PUBLIC)
    result = scanner.scan(clone.qr(), gate_id)
    assert result["granted"] is False and result["reason"] == "invalid"
    assert "teléfono" in result["local_error"]


def test_unauthorized_reader_cannot_read_the_qr():
    """Solo los lectores con la clave que entrega el Registro Civil pueden descifrar el QR."""
    phone = phone_for(new_rut())
    with pytest.raises(CredentialError, match="no autorizado"):
        decode_qr(phone.qr(issued_at=1_790_000_000), new_secret_key())


def test_admitted_person_cannot_enter_again(client):
    """Anti pass-back (A9): tras ingresar, ningun QR nuevo de esa persona sirve en ese evento."""
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    _, scanner = guard_scanner(client, "guard_passback@test.cl", event_id)

    assert scanner.scan(phone.qr(), gate_id)["granted"]
    assert scanner.scan(phone.qr(), gate_id)["reason"] == "already_admitted"


def test_concurrent_scans_admit_only_once(client):
    """Dos puertas escanean el mismo QR a la vez: el INSERT del nonce concede solo una."""
    event_id, gate_ids = create_event(gates=2)
    _, phone = person_with_ticket(event_id)
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


def test_only_staff_gets_verifier_keys_and_validates(client):
    event_id, [gate_id] = create_event()
    assert client.get(f"/events/{event_id}/verifier").status_code == 401
    payload = {
        "gate_id": gate_id,
        "nonce": "0" * 32,
        "issued_at": unix_now(),
        "device_sig": b64e(bytes(64)),
        "credential_core": b64e(b"x"),
        "issuer_sig": b64e(bytes(64)),
    }
    assert client.post("/qr/validate", json=payload).status_code == 401


# --- Dos pasos: el guardia confirma la foto antes de registrar el ingreso (ADR-12) ---------------


def test_check_does_not_consume_and_admit_registers_entry(client):
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    guard_token, scanner = guard_scanner(client, "guard_2step@test.cl", event_id)
    contents, _ = scanner.read(phone.qr())
    payload = Scanner.validate_payload(contents, gate_id)

    checked = scanner._post({**payload, "action": "check"})
    assert checked["pending"] is True and checked["granted"] is False
    assert checked["attendee"]["admitted_at"] is None
    # El "check" no deja rastro en el historial: solo cuenta la decision del guardia.
    logs = client.get("/logs", headers=auth_header(guard_token)).json()
    assert not [entry for entry in logs if entry["token_id"] == contents.nonce.hex()]

    admitted = scanner._post({**payload, "action": "admit"})
    assert admitted["granted"] is True and admitted["reason"] == "ok"


def test_photo_mismatch_rejects_without_burning_the_holders_ticket(client):
    """Reenvio a un complice: el guardia ve la foto del titular y rechaza. El titular entra despues."""
    event_id, gate_ids = create_event(gates=2)
    _, phone = person_with_ticket(event_id)
    _, scanner = guard_scanner(client, "guard_mismatch@test.cl", event_id)

    relayed = phone.qr()
    rejected = scanner.scan(relayed, gate_ids[0], decide=lambda shown: False)
    assert rejected["granted"] is False and rejected["reason"] == "photo_mismatch"
    assert rejected["attendee"]["admitted_at"] is None

    # El mismo QR ya no sirve en otra fila...
    assert scanner.scan(relayed, gate_ids[1], decide=lambda shown: True)["reason"] == "already_used"
    # ...pero el titular, con un QR nuevo, entra.
    assert scanner.scan(phone.qr(), gate_ids[1], decide=lambda shown: True)["granted"] is True


def test_guard_can_confirm_after_the_qr_expires_only_if_checked_in_time(client):
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    _, scanner = guard_scanner(client, "guard_window@test.cl", event_id)

    checked, _ = scanner.read(phone.qr(issued_at=unix_now() - MAX_AGE + 1))
    payload = Scanner.validate_payload(checked, gate_id)
    assert scanner._post({**payload, "action": "check"})["pending"] is True
    time.sleep(2.5)
    # Vencio mientras el guardia miraba la foto, pero se verifico a tiempo: se puede confirmar.
    assert scanner._post({**payload, "action": "admit"})["reason"] == "ok"

    # Un QR vencido que nunca paso el "check" no se puede admitir directamente.
    _, other = person_with_ticket(event_id)
    stale, _ = scanner.read(other.qr(issued_at=unix_now() - MAX_AGE - 2))
    assert scanner._post({**Scanner.validate_payload(stale, gate_id), "action": "admit"})["reason"] == "expired"


def test_check_previews_used_and_admitted(client):
    event_id, [gate_id] = create_event()
    _, phone = person_with_ticket(event_id)
    _, scanner = guard_scanner(client, "guard_preview@test.cl", event_id)

    qr = phone.qr()
    assert scanner.scan(qr, gate_id)["granted"] is True
    contents, _ = scanner.read(qr)
    assert scanner._post({**Scanner.validate_payload(contents, gate_id), "action": "check"})["reason"] == "already_used"
    contents, _ = scanner.read(phone.qr())
    assert scanner._post({**Scanner.validate_payload(contents, gate_id), "action": "check"})["reason"] == "already_admitted"
