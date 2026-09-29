"""Registro Civil simulado (registro_civil/app.py): enrolamiento del telefono con RUT + clave de
activacion, que entrega la cedula firmada. Es un servicio aparte del backend del evento."""

import hashlib

import pytest
from fastapi.testclient import TestClient

from app.credential import (
    IdentityCredential,
    b64d,
    b64e,
    check_qr,
    decode_qr,
    ed25519_public,
    new_secret_key,
    parse_core,
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

    device_secret = new_secret_key()
    res = rc.post(
        "/enrolar",
        json={"rut": rut, "clave": code.lower(), "device_public_key": b64e(ed25519_public(device_secret))},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    credential = IdentityCredential.from_json(data)
    core = parse_core(credential.core)
    assert (core.name, core.rut) == ("Carla Rojas", rut.replace("-", ""))
    assert credential.photo == photo
    assert core.photo_sha256 == hashlib.sha256(photo).digest()
    # La clave del telefono queda firmada dentro de la cedula.
    assert core.device_public == ed25519_public(device_secret)
    assert data["server_time"] > 0

    # La cedula enrolada genera QR que un lector autorizado verifica con la clave del emisor.
    phone = Phone(credential, device_secret, b64d(data["verifier_public_key"]))
    verifier_secret = b64d((TEST_ISSUER_DIR / "verifier_private.key").read_text())
    contents = decode_qr(phone.qr(issued_at=1_790_000_000), verifier_secret)
    assert check_qr(contents, ed25519_public(ISSUER_SECRET)).name == "Carla Rojas"


def test_wrong_key_or_unknown_rut_get_the_same_answer(rc):
    rut = new_rut()
    add_person("Diego Soto", rut, compress_photo(demo_avatar(rut)), "CLAVE234", key_dir=TEST_ISSUER_DIR)

    device = b64e(ed25519_public(new_secret_key()))
    wrong_key = rc.post("/enrolar", json={"rut": rut, "clave": "OTRA2345", "device_public_key": device})
    unknown = rc.post("/enrolar", json={"rut": new_rut(), "clave": "CLAVE234", "device_public_key": device})
    for res in (wrong_key, unknown):
        assert res.status_code == 401
        assert res.json()["detail"] == "RUT o clave de activación inválidos"


def test_enrollment_is_rate_limited(rc):
    device = b64e(ed25519_public(new_secret_key()))
    statuses = [
        rc.post("/enrolar", json={"rut": new_rut(), "clave": "XXXXXXXX", "device_public_key": device}).status_code
        for _ in range(11)
    ]
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429
