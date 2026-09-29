"""Formato de la credencial y del QR (app/credential.py), sin servidor."""

import dataclasses
import json

import pytest

from app.credential import (
    CredentialError,
    IdentityCredential,
    b64d,
    base45_decode,
    base45_encode,
    check_identity,
    decode_qr,
    parse_core,
)
from scripts.qr_test_vectors import VECTORS_PATH, make_vectors


def test_base45_matches_rfc_9285():
    for text, encoded in make_vectors()["base45"]:
        assert base45_encode(text.encode()) == encoded
        assert base45_decode(encoded) == text.encode()
    with pytest.raises(CredentialError):
        base45_decode("GGW")  # 65535 < valor: invalido segun el RFC


def test_shared_vectors_are_up_to_date():
    """Si falla, el formato cambio: regenerar con scripts/qr_test_vectors.py y actualizar el frontend."""
    assert json.loads(VECTORS_PATH.read_text(encoding="utf-8")) == make_vectors()


def test_vector_qr_decodes_to_the_signed_identity():
    v = make_vectors()
    contents = decode_qr(v["qr"], b64d(v["event_secret"]))
    identity = check_identity(contents, b64d(v["issuer_public"]))
    assert (identity.rut, identity.name, identity.issued_at) == ("12345678K", "José Muñoz", 1_790_000_000)
    assert (contents.event_id, contents.ticket_id, contents.issued_at) == (7, 42, 1_790_000_123)
    assert contents.nonce.hex() == v["nonce_hex"]
    assert contents.photo == IdentityCredential.from_json(v["credential"]).photo


def test_any_altered_byte_breaks_the_qr():
    v = make_vectors()
    qr = v["qr"]
    for i in (4, len(qr) // 2, len(qr) - 1):
        swapped = "0" if qr[i] != "0" else "1"
        with pytest.raises(CredentialError):
            decode_qr(qr[:i] + swapped + qr[i + 1 :], b64d(v["event_secret"]))


def test_tampered_core_or_photo_fails_identity_check():
    v = make_vectors()
    contents = decode_qr(v["qr"], b64d(v["event_secret"]))
    issuer = b64d(v["issuer_public"])
    with pytest.raises(CredentialError, match="emisor"):
        check_identity(dataclasses.replace(contents, core=contents.core.replace(b"12345678K", b"11111111K")), issuer)
    with pytest.raises(CredentialError, match="foto"):
        check_identity(dataclasses.replace(contents, photo=contents.photo[:-1] + b"\x00"), issuer)


def test_malformed_core_is_rejected():
    with pytest.raises(CredentialError):
        parse_core(b"\x01\x00")
    core = IdentityCredential.from_json(make_vectors()["credential"]).core
    with pytest.raises(CredentialError):
        parse_core(core + b"extra")
