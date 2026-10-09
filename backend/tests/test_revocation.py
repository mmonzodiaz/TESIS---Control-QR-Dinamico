"""Revocacion de cedulas (ADR-14): activar la cedula en otro telefono o reportar la perdida deja sin
efecto la cedula anterior, y el recinto lo sabe por la lista firmada del Registro Civil."""

import pytest
from fastapi.testclient import TestClient

from app.credential import CredentialError, credential_id, ed25519_public, sign_revocation_list, verify_revocation_list
from app.revocation import RevocationList
from helpers import ISSUER_SECRET, TEST_ISSUER_DIR, create_event, create_ticket, guard_scanner, new_rut
from registro_civil.app import app as registro_civil_app
from scripts.qr_clients import Phone
from scripts.registro_civil_sim import add_person, compress_photo, demo_avatar

ISSUER_PUBLIC = ed25519_public(ISSUER_SECRET)


@pytest.fixture
def rc():
    return TestClient(registro_civil_app)


def enrolled_person(rc, event_id: int) -> tuple[str, str, Phone]:
    rut = new_rut()
    code = add_person("Paula Vera", rut, compress_photo(demo_avatar(rut)), "CLAVE234", key_dir=TEST_ISSUER_DIR)
    create_ticket(event_id, rut, "Paula Vera")
    return rut, code, Phone.enroll(rc, rut, code)


def revoked_ids(rc) -> frozenset[str]:
    return verify_revocation_list(rc.get("/revocaciones").json(), ISSUER_PUBLIC)[1]


def test_activating_on_a_new_phone_revokes_the_old_one(client, rc):
    event_id, [gate_id] = create_event()
    rut, code, old_phone = enrolled_person(rc, event_id)
    new_phone = Phone.enroll(rc, rut, code)

    assert credential_id(old_phone.credential.core) in revoked_ids(rc)
    assert credential_id(new_phone.credential.core) not in revoked_ids(rc)

    _, scanner = guard_scanner(client, "guard_rev1@test.cl", event_id)
    # El telefono viejo (vendido, robado) ya no sirve, aunque sus firmas sigan siendo validas.
    assert scanner.scan(old_phone.qr(), gate_id)["reason"] == "revoked"
    assert scanner.scan(new_phone.qr(), gate_id)["granted"] is True


def test_reporting_a_lost_phone_revokes_the_cedula(client, rc):
    event_id, [gate_id] = create_event()
    rut, code, phone = enrolled_person(rc, event_id)

    res = rc.post("/reportar-perdida", json={"rut": rut, "clave": code})
    assert res.status_code == 200 and res.json() == {"revoked": 1}

    _, scanner = guard_scanner(client, "guard_rev2@test.cl", event_id)
    result = scanner.scan(phone.qr(), gate_id)
    assert result["granted"] is False and result["reason"] == "revoked"
    # El guardia igual ve la identidad (la cedula es autentica), pero no la deja pasar.
    assert result["shown"]["rut"] == rut.replace("-", "")


def test_loss_report_needs_the_activation_code(rc):
    rut = new_rut()
    add_person("Tomas Ruiz", rut, compress_photo(demo_avatar(rut)), "CLAVE234", key_dir=TEST_ISSUER_DIR)
    res = rc.post("/reportar-perdida", json={"rut": rut, "clave": "OTRA2345"})
    assert res.status_code == 401
    assert res.json()["detail"] == "RUT o clave de activación inválidos"


def test_revocation_list_is_signed_and_tamper_evident():
    signed = sign_revocation_list(ISSUER_SECRET, 1_790_000_000, ["ab" * 32])
    assert verify_revocation_list(signed, ISSUER_PUBLIC) == (1_790_000_000, frozenset(["ab" * 32]))
    # Quitar una cedula de la lista (para "desrevocarla") rompe la firma.
    with pytest.raises(CredentialError):
        verify_revocation_list({**signed, "revoked": []}, ISSUER_PUBLIC)
    # Una lista firmada por otro no vale.
    other = sign_revocation_list(bytes(32), 1_790_000_000, [])
    with pytest.raises(CredentialError):
        verify_revocation_list(other, ISSUER_PUBLIC)


@pytest.mark.parametrize("issued_at", [-1, 2**64])
def test_out_of_range_date_in_the_list_is_rejected_not_a_crash(issued_at):
    """struct.pack lanzaba struct.error, que escapaba del manejo de errores: cada validacion daba 500
    en vez de seguir con la ultima lista valida."""
    signed = sign_revocation_list(ISSUER_SECRET, 1_790_000_000, [])
    with pytest.raises(CredentialError):
        verify_revocation_list({**signed, "issued_at": issued_at}, ISSUER_PUBLIC)


def test_backend_keeps_the_last_valid_list_if_the_registro_civil_is_down():
    lists = [sign_revocation_list(ISSUER_SECRET, 100, ["cd" * 32])]

    def fetch():
        if not lists:
            raise ValueError("Registro Civil caido")
        return lists.pop()

    revocations = RevocationList(fetch)
    assert revocations.is_revoked("cd" * 32)
    # Caido: se sigue usando la ultima lista valida (no se "desrevoca" nada).
    assert revocations.is_revoked("cd" * 32)
    # Una lista mas antigua que la vigente (repeticion de una respuesta vieja) no la reemplaza.
    lists.append(sign_revocation_list(ISSUER_SECRET, 50, []))
    assert revocations.is_revoked("cd" * 32)
