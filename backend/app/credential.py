"""Credencial de identidad firmada y QR dinamico generado por el telefono (ADR-10, ADR-11).

Tres piezas, tres claves:

1. **Credencial de identidad** (la emite el Registro Civil; aqui, scripts/registro_civil_sim.py).
   `core` = version | fecha de emision | RUT | nombre | SHA-256 de la foto, firmado con Ed25519 por
   el emisor. La foto viaja aparte y se valida contra su hash: asi el backend del evento puede
   verificar la firma del emisor **sin recibir nunca la foto**.
2. **Clave del dispositivo** (Ed25519, la crea el telefono al activar la entrada). Firma cada QR:
   hash del core | evento | entrada | nonce | hora. El backend guarda solo la clave publica.
3. **Clave del evento** (X25519). El telefono cifra el QR con la clave publica del evento; solo el
   escaner del personal (que tiene la privada) puede leer foto, nombre y RUT. Quien fotografie el
   QR en la fila no ve nada.

Formato del QR (texto, modo alfanumerico): "CA1:" + base45(clave efimera | cifrado + tag).
Texto plano: evento u32 | entrada u32 | nonce 16 | hora u32 | firma dispositivo 64 |
largo core u16 | core | firma emisor 64 | foto (resto).

En produccion el telefono y el escaner implementan esto en el cliente (frontend/src/credential.ts,
mismo formato, fijado por tests/vectors/qr-v1.json). Aqui esta en Python para el backend, los tests
y los scripts de experimentos, que emulan al telefono y al escaner.
"""

import base64
import hashlib
import os
import secrets
import struct
from dataclasses import dataclass

from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

CORE_VERSION = 1
ISSUER_DOMAIN = b"CA-ID-v1"  # separacion de dominio: una firma de credencial no sirve como firma de QR
DEVICE_DOMAIN = b"CA-QR-v1"
ENCRYPTION_INFO = b"CA-QR-v1 enc"
ENCRYPTION_AAD = b"CA1"
QR_PREFIX = "CA1:"
NONCE_BYTES = 16
SIGNATURE_BYTES = 64
KEY_BYTES = 32
_ZERO_NONCE = bytes(12)  # seguro: la clave de cifrado es nueva en cada QR (clave efimera)

BASE45_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:"


class CredentialError(ValueError):
    """Credencial o QR mal formado, con firma invalida o que no se puede descifrar."""


# --- Codificacion ------------------------------------------------------------------


def b64e(data: bytes) -> str:
    return base64.b64encode(data).decode()


def b64d(text: str, expected_len: int | None = None) -> bytes:
    try:
        data = base64.b64decode(text, validate=True)
    except ValueError as exc:
        raise CredentialError("base64 invalido") from exc
    if expected_len is not None and len(data) != expected_len:
        raise CredentialError(f"se esperaban {expected_len} bytes")
    return data


def base45_encode(data: bytes) -> str:
    """RFC 9285. Aprovecha el modo alfanumerico del QR (5,5 bits por caracter)."""
    out = []
    for i in range(0, len(data) - 1, 2):
        n = data[i] * 256 + data[i + 1]
        c, n = n % 45, n // 45
        d, e = n % 45, n // 45
        out += [BASE45_ALPHABET[c], BASE45_ALPHABET[d], BASE45_ALPHABET[e]]
    if len(data) % 2:
        c, d = data[-1] % 45, data[-1] // 45
        out += [BASE45_ALPHABET[c], BASE45_ALPHABET[d]]
    return "".join(out)


def base45_decode(text: str) -> bytes:
    try:
        values = [BASE45_ALPHABET.index(ch) for ch in text]
    except ValueError as exc:
        raise CredentialError("base45 invalido") from exc
    out = bytearray()
    for i in range(0, len(values), 3):
        chunk = values[i : i + 3]
        if len(chunk) == 3:
            n = chunk[0] + chunk[1] * 45 + chunk[2] * 45 * 45
            if n > 0xFFFF:
                raise CredentialError("base45 invalido")
            out += bytes((n // 256, n % 256))
        elif len(chunk) == 2:
            n = chunk[0] + chunk[1] * 45
            if n > 0xFF:
                raise CredentialError("base45 invalido")
            out.append(n)
        else:
            raise CredentialError("base45 invalido")
    return bytes(out)


# --- Claves ------------------------------------------------------------------------


def new_secret_key() -> bytes:
    """32 bytes aleatorios: sirven como clave privada Ed25519 o X25519."""
    return secrets.token_bytes(KEY_BYTES)


def ed25519_public(secret: bytes) -> bytes:
    return Ed25519PrivateKey.from_private_bytes(secret).public_key().public_bytes_raw()


def x25519_public(secret: bytes) -> bytes:
    return X25519PrivateKey.from_private_bytes(secret).public_key().public_bytes_raw()


def sign(secret: bytes, message: bytes) -> bytes:
    return Ed25519PrivateKey.from_private_bytes(secret).sign(message)


def verify(public: bytes, message: bytes, signature: bytes) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(public).verify(signature, message)
        return True
    except (InvalidSignature, ValueError):
        return False


# --- Credencial de identidad ----------------------------------------------------------


@dataclass(frozen=True)
class IdentityCore:
    rut: str  # normalizado, ej. 12345678K
    name: str
    photo_sha256: bytes
    issued_at: int  # unix, segundos


def encode_core(core: IdentityCore) -> bytes:
    rut, name = core.rut.encode("ascii"), core.name.encode("utf-8")
    if len(rut) > 255 or len(name) > 255 or len(core.photo_sha256) != 32:
        raise CredentialError("campos de la credencial fuera de rango")
    return (
        struct.pack(">BI", CORE_VERSION, core.issued_at)
        + bytes([len(rut)])
        + rut
        + bytes([len(name)])
        + name
        + core.photo_sha256
    )


def parse_core(data: bytes) -> IdentityCore:
    try:
        version, issued_at = struct.unpack_from(">BI", data, 0)
        pos = 5
        rut_len = data[pos]
        rut = data[pos + 1 : pos + 1 + rut_len].decode("ascii")
        pos += 1 + rut_len
        name_len = data[pos]
        name = data[pos + 1 : pos + 1 + name_len].decode("utf-8")
        pos += 1 + name_len
        photo_sha256 = data[pos : pos + 32]
    except (struct.error, IndexError, UnicodeDecodeError) as exc:
        raise CredentialError("credencial mal formada") from exc
    if version != CORE_VERSION or len(photo_sha256) != 32 or pos + 32 != len(data):
        raise CredentialError("credencial mal formada")
    return IdentityCore(rut=rut, name=name, photo_sha256=photo_sha256, issued_at=issued_at)


def issuer_sign(issuer_secret: bytes, core: bytes) -> bytes:
    return sign(issuer_secret, ISSUER_DOMAIN + core)


def verify_issuer(issuer_public: bytes, core: bytes, signature: bytes) -> bool:
    return verify(issuer_public, ISSUER_DOMAIN + core, signature)


@dataclass(frozen=True)
class IdentityCredential:
    """Lo que el Registro Civil deja en el telefono. La foto nunca se envia al backend del evento."""

    core: bytes
    issuer_sig: bytes
    photo: bytes

    def to_json(self) -> dict:
        return {"format": "cedula-sim-v1", "core": b64e(self.core), "issuer_sig": b64e(self.issuer_sig), "photo": b64e(self.photo)}

    @classmethod
    def from_json(cls, data: dict) -> "IdentityCredential":
        if data.get("format") != "cedula-sim-v1":
            raise CredentialError("formato de credencial desconocido")
        return cls(b64d(data["core"]), b64d(data["issuer_sig"], SIGNATURE_BYTES), b64d(data["photo"]))


# --- QR ------------------------------------------------------------------------------


def device_message(core: bytes, event_id: int, ticket_id: int, nonce: bytes, issued_at: int) -> bytes:
    return DEVICE_DOMAIN + hashlib.sha256(core).digest() + struct.pack(">II", event_id, ticket_id) + nonce + struct.pack(">I", issued_at)


@dataclass(frozen=True)
class QRContents:
    event_id: int
    ticket_id: int
    nonce: bytes
    issued_at: int
    device_sig: bytes
    core: bytes
    issuer_sig: bytes
    photo: bytes


def _encryption_key(shared: bytes, ephemeral_public: bytes, event_public: bytes) -> bytes:
    return HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=ENCRYPTION_INFO + ephemeral_public + event_public
    ).derive(shared)


def build_qr(
    credential: IdentityCredential,
    device_secret: bytes,
    event_id: int,
    ticket_id: int,
    event_public: bytes,
    issued_at: int,
    nonce: bytes | None = None,
    ephemeral_secret: bytes | None = None,
) -> str:
    """Lo que hace el telefono cada 45 s, sin conexion. `nonce`/`ephemeral_secret` solo se fijan en tests."""
    nonce = nonce if nonce is not None else os.urandom(NONCE_BYTES)
    device_sig = sign(device_secret, device_message(credential.core, event_id, ticket_id, nonce, issued_at))
    plaintext = (
        struct.pack(">II", event_id, ticket_id)
        + nonce
        + struct.pack(">I", issued_at)
        + device_sig
        + struct.pack(">H", len(credential.core))
        + credential.core
        + credential.issuer_sig
        + credential.photo
    )
    ephemeral_secret = ephemeral_secret if ephemeral_secret is not None else new_secret_key()
    ephemeral = X25519PrivateKey.from_private_bytes(ephemeral_secret)
    ephemeral_public = ephemeral.public_key().public_bytes_raw()
    shared = ephemeral.exchange(X25519PublicKey.from_public_bytes(event_public))
    key = _encryption_key(shared, ephemeral_public, event_public)
    ciphertext = ChaCha20Poly1305(key).encrypt(_ZERO_NONCE, plaintext, ENCRYPTION_AAD)
    return QR_PREFIX + base45_encode(ephemeral_public + ciphertext)


def decode_qr(qr_text: str, event_secret: bytes) -> QRContents:
    """Lo que hace el escaner del personal: descifra con la clave privada del evento."""
    if not qr_text.startswith(QR_PREFIX):
        raise CredentialError("no es un QR de este sistema")
    raw = base45_decode(qr_text[len(QR_PREFIX) :])
    if len(raw) < KEY_BYTES + 16:
        raise CredentialError("QR truncado")
    ephemeral_public, ciphertext = raw[:KEY_BYTES], raw[KEY_BYTES:]
    event_private = X25519PrivateKey.from_private_bytes(event_secret)
    try:
        shared = event_private.exchange(X25519PublicKey.from_public_bytes(ephemeral_public))
        key = _encryption_key(shared, ephemeral_public, event_private.public_key().public_bytes_raw())
        plaintext = ChaCha20Poly1305(key).decrypt(_ZERO_NONCE, ciphertext, ENCRYPTION_AAD)
    except (InvalidTag, ValueError) as exc:
        # Tambien cae aqui un QR cifrado para otro evento.
        raise CredentialError("no se pudo descifrar (QR alterado o de otro evento)") from exc
    try:
        event_id, ticket_id = struct.unpack_from(">II", plaintext, 0)
        pos = 8
        nonce = plaintext[pos : pos + NONCE_BYTES]
        pos += NONCE_BYTES
        (issued_at,) = struct.unpack_from(">I", plaintext, pos)
        pos += 4
        device_sig = plaintext[pos : pos + SIGNATURE_BYTES]
        pos += SIGNATURE_BYTES
        (core_len,) = struct.unpack_from(">H", plaintext, pos)
        pos += 2
        core = plaintext[pos : pos + core_len]
        pos += core_len
        issuer_sig = plaintext[pos : pos + SIGNATURE_BYTES]
        pos += SIGNATURE_BYTES
        photo = plaintext[pos:]
    except struct.error as exc:
        raise CredentialError("QR mal formado") from exc
    if len(core) != core_len or len(issuer_sig) != SIGNATURE_BYTES or not photo:
        raise CredentialError("QR mal formado")
    return QRContents(event_id, ticket_id, nonce, issued_at, device_sig, core, issuer_sig, photo)


def check_identity(contents: QRContents, issuer_public: bytes) -> IdentityCore:
    """Verificacion local del escaner: firma del emisor y foto integra. Devuelve los datos a mostrar."""
    if not verify_issuer(issuer_public, contents.core, contents.issuer_sig):
        raise CredentialError("firma del emisor invalida")
    core = parse_core(contents.core)
    if hashlib.sha256(contents.photo).digest() != core.photo_sha256:
        raise CredentialError("la foto no corresponde a la credencial")
    return core
