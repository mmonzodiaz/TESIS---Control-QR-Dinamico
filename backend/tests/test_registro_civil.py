"""Registro Civil simulado (registro_civil/app.py): enrolamiento del telefono con RUT + clave de
activacion, que entrega la cedula firmada. Es un servicio aparte del backend del evento."""

import hashlib

import pytest
from fastapi.testclient import TestClient

from app.credential import (
    IdentityCredential,
    b64e,
    check_identity,
    decode_qr,
    ed25519_public,
    new_secret_key,
    parse_core,
    x25519_public,
)
from helpers import ISSUER_SECRET, TEST_ISSUER_DIR, new_rut
from registro_civil.app import app as registro_civil_app
from scripts.qr_clients import Phone
from scripts.registro_civil_sim import add_person, compress_photo, demo_avatar


@pytest.fixture
def rc():
    return TestClient(registro_civil_app)


def test_enrollment_delivers_the_signed_credential_with_photo(rc):
    rut = new_rut()
    photo = compress_photo(demo_avatar(rut))
    code = add_person("Carla Rojas", rut, photo, key_dir=TEST_ISSUER_DIR)

    res = rc.post("/enrolar", json={"rut": rut, "clave": code.lower()})
    assert res.status_code == 200, res.text
    credential = IdentityCredential.from_json(res.json())
    core = parse_core(credential.core)
    assert (core.name, core.rut) == ("Carla Rojas", rut.replace("-", ""))
    assert credential.photo == photo
    assert core.photo_sha256 == hashlib.sha256(photo).digest()

    # La cedula enrolada sirve para generar un QR que el escaner verifica con la clave del emisor.
    event_secret = new_secret_key()
    phone = Phone(credential, params={"event_id": 1, "ticket_id": 1, "event_public_key": b64e(x25519_public(event_secret))})
    contents = decode_qr(phone.qr(issued_at=1_790_000_000), event_secret)
    assert check_identity(contents, ed25519_public(ISSUER_SECRET)).name == "Carla Rojas"


def test_wrong_key_or_unknown_rut_get_the_same_answer(rc):
    rut = new_rut()
    add_person("Diego Soto", rut, compress_photo(demo_avatar(rut)), "CLAVE234", key_dir=TEST_ISSUER_DIR)

    wrong_key = rc.post("/enrolar", json={"rut": rut, "clave": "OTRA2345"})
    unknown = rc.post("/enrolar", json={"rut": new_rut(), "clave": "CLAVE234"})
    for res in (wrong_key, unknown):
        assert res.status_code == 401
        assert res.json()["detail"] == "RUT o clave de activacion invalidos"


def test_enrollment_is_rate_limited(rc):
    statuses = [rc.post("/enrolar", json={"rut": new_rut(), "clave": "XXXXXXXX"}).status_code for _ in range(11)]
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429
