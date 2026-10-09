"""Registro Civil simulado (registro_civil/app.py): enrolamiento del telefono con RUT + clave de
activacion, que entrega la cedula firmada. Es un servicio aparte del backend del evento."""

import hashlib

import pytest
from fastapi.testclient import TestClient

from app.config import settings
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


@pytest.mark.parametrize("rut", ["1²-K", "١١١١١١١١-١"])
def test_unicode_digits_in_the_rut_get_the_same_answer_not_a_crash(rc, rut):
    """str.isdigit() aceptaba '²' (y despues int() fallaba: 500 sin autenticacion) y digitos de otros
    alfabetos. Ahora es un RUT invalido mas, con la misma respuesta uniforme."""
    device = b64e(ed25519_public(new_secret_key()))
    for path, body in (
        ("/enrolar", {"rut": rut, "clave": "CLAVE234", "device_public_key": device}),
        ("/reportar-perdida", {"rut": rut, "clave": "CLAVE234"}),
    ):
        res = rc.post(path, json=body)
        assert res.status_code < 500, (path, res.text)


def test_enrollment_is_rate_limited(rc):
    device = b64e(ed25519_public(new_secret_key()))
    statuses = [
        rc.post("/enrolar", json={"rut": new_rut(), "clave": "XXXXXXXX", "device_public_key": device}).status_code
        for _ in range(11)
    ]
    assert statuses[:10] == [401] * 10
    assert statuses[10] == 429


# --- Arquitectura alternativa: la foto resuelta por el emisor (ADR-17, modulo secundario) --------
# NO es el flujo principal: ahi la foto va dentro del QR (ADR-10) y el escaner no necesita red.
# Estos tests fijan las propiedades que hacen aceptable el endpoint, porque entrega biometria. Va
# apagado por defecto (ENABLE_FOTO_RESUELTA); cada test lo enciende con la fixture foto_resuelta.


@pytest.fixture
def foto_resuelta(monkeypatch):
    monkeypatch.setattr(settings, "enable_foto_resuelta", True)


def test_photo_endpoint_does_not_exist_unless_enabled(rc):
    """Apagado por defecto: el recinto recibe el core firmado en cada validacion, y con el endpoint
    encendido podria pedir la foto de cada asistente (contra ADR-10/11). Apagado responde igual que
    una ruta inexistente, aun con un core legitimo."""
    credential, _ = _enrolled(rc)
    res = rc.post("/foto", json={"core": b64e(credential.core), "issuer_sig": b64e(credential.issuer_sig)})
    assert res.status_code == 404
    assert res.json() == rc.post("/no-existe").json() == {"detail": "Not Found"}


def _enrolled(rc, name: str = "Nora Vega"):
    """Inscribe a una persona y enrola un telefono. Devuelve (credencial, foto)."""
    rut = new_rut()
    photo = compress_photo(demo_avatar(rut))
    code = add_person(name, rut, photo, key_dir=TEST_ISSUER_DIR)
    device_secret = new_secret_key()
    res = rc.post(
        "/enrolar",
        json={"rut": rut, "clave": code, "device_public_key": b64e(ed25519_public(device_secret))},
    )
    assert res.status_code == 200, res.text
    return IdentityCredential.from_json(res.json()), photo


def test_issuer_resolves_the_photo_for_a_validly_signed_core(rc, foto_resuelta):
    credential, photo = _enrolled(rc)
    res = rc.post("/foto", json={"core": b64e(credential.core), "issuer_sig": b64e(credential.issuer_sig)})
    assert res.status_code == 200, res.text
    # La foto entregada es exactamente la que el hash firmado promete.
    returned = b64d(res.json()["photo"])
    assert returned == photo
    assert hashlib.sha256(returned).digest() == parse_core(credential.core).photo_sha256


def test_a_core_without_a_valid_issuer_signature_gets_no_photo(rc, foto_resuelta):
    credential, _ = _enrolled(rc)
    forged = bytes(credential.issuer_sig[:-1]) + bytes([credential.issuer_sig[-1] ^ 0x01])
    res = rc.post("/foto", json={"core": b64e(credential.core), "issuer_sig": b64e(forged)})
    assert res.status_code == 404


def test_the_endpoint_cannot_be_used_to_enumerate_faces_by_rut(rc, foto_resuelta):
    """La autorizacion es el core firmado, no el RUT: conocer el RUT de alguien no alcanza.

    Es la propiedad que hace tolerable exponer fotos, y la razon de no aceptar el RUT como entrada.
    """
    credential, _ = _enrolled(rc)
    rut = parse_core(credential.core).rut
    # Un atacante que conoce el RUT pero no tiene un core firmado no tiene nada que enviar.
    assert rc.post("/foto", json={"core": b64e(rut.encode()), "issuer_sig": b64e(b"\x00" * 64)}).status_code == 404
    assert rc.post("/foto", json={"rut": rut}).status_code == 422  # el RUT no es ni un campo valido


def test_the_signed_hash_wins_over_the_padron_photo(rc, foto_resuelta):
    """Si el padron cambia la foto, el emisor no entrega nada: la respuesta nunca contradice a la
    credencial que el verificador ya valido."""
    credential, _ = _enrolled(rc)
    rut = parse_core(credential.core).rut
    add_person("Nora Vega", rut, compress_photo(demo_avatar(rut + "otra")), key_dir=TEST_ISSUER_DIR)
    res = rc.post("/foto", json={"core": b64e(credential.core), "issuer_sig": b64e(credential.issuer_sig)})
    assert res.status_code == 404


def test_the_same_photo_travels_in_the_qr_so_the_lookup_is_never_needed(rc, foto_resuelta):
    """Comprueba que el modulo es redundante en el flujo principal: la foto que entregaria el emisor
    es la misma que el escaner ya saca del QR sin red (ADR-10). Ese es el costo de la arquitectura
    alternativa: una consulta por escaneo para obtener lo que ya se tenia."""
    credential, photo = _enrolled(rc)
    res = rc.post("/foto", json={"core": b64e(credential.core), "issuer_sig": b64e(credential.issuer_sig)})
    assert b64d(res.json()["photo"]) == photo == credential.photo
