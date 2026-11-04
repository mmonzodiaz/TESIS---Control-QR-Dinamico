"""La especificacion para verificadores (docs/especificacion-verificador.md) alcanza para verificar.

Este archivo hace de tercero: NO importa app.credential a proposito. Implementa el verificador solo
con lo que dice el documento (biblioteca estandar y `cryptography`) y lo prueba contra los vectores
compartidos y contra lo que publica el Registro Civil simulado. Si el formato cambia sin actualizar
el documento, este test falla.
"""

import base64
import hashlib
import json
import pathlib
import struct

import pytest
from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from fastapi.testclient import TestClient

from helpers import TEST_ISSUER_DIR, new_rut
from registro_civil.app import app as registro_civil_app
from scripts.qr_clients import Phone
from scripts.registro_civil_sim import add_person, compress_photo, demo_avatar

VECTORS = json.loads((pathlib.Path(__file__).parent / "vectors" / "qr-v2.json").read_text(encoding="utf-8"))
BASE45 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:"


class Rejected(Exception):
    pass


def base45_decode(text: str) -> bytes:
    values = [BASE45.index(ch) for ch in text]
    out = bytearray()
    for i in range(0, len(values), 3):
        chunk = values[i : i + 3]
        if len(chunk) == 3:
            out += (chunk[0] + chunk[1] * 45 + chunk[2] * 2025).to_bytes(2, "big")
        else:
            out.append(chunk[0] + chunk[1] * 45)
    return bytes(out)


def ed25519_ok(public: bytes, message: bytes, signature: bytes) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(public).verify(signature, message)
        return True
    except InvalidSignature:
        return False


def third_party_verify(qr: str, reader_secret: bytes, issuer_public: bytes) -> dict:
    """Pasos 1 a 5 de la seccion 5 del documento."""
    if not qr.startswith("CA2:"):
        raise Rejected("prefijo")
    raw = base45_decode(qr[4:])
    ephemeral_public, ciphertext = raw[:32], raw[32:]

    reader = X25519PrivateKey.from_private_bytes(reader_secret)
    shared = reader.exchange(X25519PublicKey.from_public_bytes(ephemeral_public))
    reader_public = reader.public_key().public_bytes_raw()
    key = HKDF(hashes.SHA256(), 32, salt=None, info=b"CA-QR-v2 enc" + ephemeral_public + reader_public).derive(shared)
    try:
        plain = ChaCha20Poly1305(key).decrypt(bytes(12), ciphertext, b"CA2")
    except InvalidTag as exc:
        raise Rejected("descifrado") from exc

    nonce, plain = plain[:16], plain[16:]
    (qr_issued_at,), plain = struct.unpack(">I", plain[:4]), plain[4:]
    device_sig, plain = plain[:64], plain[64:]
    (core_len,), plain = struct.unpack(">H", plain[:2]), plain[2:]
    core, plain = plain[:core_len], plain[core_len:]
    issuer_sig, photo = plain[:64], plain[64:]

    if not ed25519_ok(issuer_public, b"CA-ID-v2" + core, issuer_sig):
        raise Rejected("firma del emisor")

    version, cedula_issued_at = struct.unpack(">BI", core[:5])
    assert version == 2
    pos = 5
    rut = core[pos + 1 : pos + 1 + core[pos]].decode("ascii")
    pos += 1 + core[pos]
    name = core[pos + 1 : pos + 1 + core[pos]].decode("utf-8")
    pos += 1 + core[pos]
    photo_hash, device_public = core[pos : pos + 32], core[pos + 32 : pos + 64]

    device_message = b"CA-QR-v2" + hashlib.sha256(core).digest() + nonce + struct.pack(">I", qr_issued_at)
    if not ed25519_ok(device_public, device_message, device_sig):
        raise Rejected("firma del dispositivo")
    if hashlib.sha256(photo).digest() != photo_hash:
        raise Rejected("foto")
    return {
        "rut": rut,
        "name": name,
        "photo": photo,
        "nonce": nonce,
        "issued_at": qr_issued_at,
        "cedula_issued_at": cedula_issued_at,
        "credential_id": hashlib.sha256(core).hexdigest(),
    }


def third_party_revoked_ids(data: dict, issuer_public: bytes) -> set[str]:
    """Seccion 4 del documento: la lista solo vale con la firma del emisor."""
    ids = data["revoked"]
    message = b"CA-REV-v1" + struct.pack(">QI", data["issued_at"], len(ids)) + b"".join(bytes.fromhex(i) for i in ids)
    if not ed25519_ok(issuer_public, message, base64.b64decode(data["sig"])):
        raise Rejected("lista de revocadas")
    return set(ids)


@pytest.fixture
def rc():
    return TestClient(registro_civil_app)


def test_the_document_verifies_the_shared_vectors():
    shown = third_party_verify(
        VECTORS["qr"], base64.b64decode(VECTORS["verifier_secret"]), base64.b64decode(VECTORS["issuer_public"])
    )
    assert (shown["rut"], shown["name"]) == (VECTORS["core"]["rut"], VECTORS["core"]["name"])
    assert shown["nonce"].hex() == VECTORS["nonce_hex"]
    assert shown["issued_at"] == VECTORS["issued_at"]
    assert shown["cedula_issued_at"] == VECTORS["core"]["issued_at"]
    assert shown["photo"] == base64.b64decode(VECTORS["credential"]["photo"])


def test_the_document_rejects_another_issuer():
    other_issuer = base64.b64decode(VECTORS["device_public"])  # una clave valida, pero no la del emisor
    with pytest.raises(Rejected, match="emisor"):
        third_party_verify(VECTORS["qr"], base64.b64decode(VECTORS["verifier_secret"]), other_issuer)


def test_the_qr_cannot_be_read_without_the_authorized_reader_key():
    # La clave publica del emisor y el formato no bastan: hace falta que el emisor autorice al lector.
    not_authorized = bytes(range(32))
    with pytest.raises(Rejected, match="descifrado"):
        third_party_verify(VECTORS["qr"], not_authorized, base64.b64decode(VECTORS["issuer_public"]))


def test_a_third_party_verifies_with_what_the_issuer_publishes(rc):
    published = rc.get("/clave-publica")
    assert published.status_code == 200, published.text
    keys = published.json()
    issuer_public = base64.b64decode(keys["issuer_public_key"])

    rut = new_rut()
    code = add_person("Tercera Persona", rut, compress_photo(demo_avatar(rut)), key_dir=TEST_ISSUER_DIR)
    phone = Phone.enroll(rc, rut, code)
    assert phone.verifier_public == base64.b64decode(keys["verifier_public_key"])

    # El emisor autoriza al lector entregandole esta clave; no se publica.
    reader_secret = base64.b64decode((TEST_ISSUER_DIR / "verifier_private.key").read_text())
    shown = third_party_verify(phone.qr(), reader_secret, issuer_public)
    assert shown["name"] == "Tercera Persona"
    assert shown["credential_id"] not in third_party_revoked_ids(rc.get("/revocaciones").json(), issuer_public)

    assert rc.post("/reportar-perdida", json={"rut": rut, "clave": code}).status_code == 200
    assert shown["credential_id"] in third_party_revoked_ids(rc.get("/revocaciones").json(), issuer_public)


def test_what_the_issuer_publishes_has_no_secrets_or_personal_data(rc):
    keys = rc.get("/clave-publica").json()
    assert set(keys) == {
        "issuer_public_key",
        "verifier_public_key",
        "qr_ttl_seconds",
        "qr_clock_skew_seconds",
        "specification",
    }
    reader_secret = (TEST_ISSUER_DIR / "verifier_private.key").read_text().strip()
    assert reader_secret not in json.dumps(keys)
