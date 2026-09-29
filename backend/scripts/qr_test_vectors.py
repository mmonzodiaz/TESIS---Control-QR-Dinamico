"""Vectores de prueba del formato del QR (compartidos por backend y frontend).

Con claves, nonce y clave efimera fijas, el QR es determinista (Ed25519 firma de forma
determinista). tests/test_credential.py verifica que este archivo coincide con app/credential.py y
frontend/src/credential.test.ts que el telefono y el lector en TypeScript producen y leen lo mismo.

Uso (desde backend/), solo si se cambia el formato a proposito:
  uv run python scripts/qr_test_vectors.py
"""

import hashlib
import json
import pathlib
import sys

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.credential import (  # noqa: E402
    IdentityCore,
    IdentityCredential,
    b64e,
    build_qr,
    ed25519_public,
    encode_core,
    issuer_sign,
    x25519_public,
)

VECTORS_PATH = BACKEND_DIR / "tests" / "vectors" / "qr-v2.json"


def _key(fill: int) -> bytes:
    return bytes([fill]) * 32


def make_vectors() -> dict:
    issuer, device, verifier, ephemeral = _key(1), _key(2), _key(3), _key(4)
    photo = bytes(range(200))  # no es una imagen: el formato trata la foto como bytes opacos
    core = encode_core(
        IdentityCore(
            rut="12345678K",
            name="José Muñoz",
            photo_sha256=hashlib.sha256(photo).digest(),
            device_public=ed25519_public(device),
            issued_at=1_790_000_000,
        )
    )
    credential = IdentityCredential(core=core, issuer_sig=issuer_sign(issuer, core), photo=photo)
    nonce = bytes(range(16))
    qr = build_qr(credential, device, x25519_public(verifier), 1_790_000_123, nonce=nonce, ephemeral_secret=ephemeral)
    return {
        "issuer_secret": b64e(issuer),
        "issuer_public": b64e(ed25519_public(issuer)),
        "device_secret": b64e(device),
        "device_public": b64e(ed25519_public(device)),
        "verifier_secret": b64e(verifier),
        "verifier_public": b64e(x25519_public(verifier)),
        "ephemeral_secret": b64e(ephemeral),
        "credential": credential.to_json(),
        "core": {"rut": "12345678K", "name": "José Muñoz", "issued_at": 1_790_000_000},
        "issued_at": 1_790_000_123,
        "nonce_hex": nonce.hex(),
        "qr": qr,
        "base45": [["AB", "BB8"], ["Hello!!", "%69 VD92EX0"], ["base-45", "UJCLQE7W581"]],
    }


def main() -> None:
    VECTORS_PATH.parent.mkdir(parents=True, exist_ok=True)
    VECTORS_PATH.write_text(json.dumps(make_vectors(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Escrito {VECTORS_PATH}")


if __name__ == "__main__":
    main()
