"""Cedula digital firmada y QR dinamico generado por el telefono (ADR-10, ADR-11).

La cedula es de la PERSONA, no de un evento: sirve ante cualquier lector autorizado, como la app
de Identificacion Digital. Tres claves:

1. **Emisor** (Ed25519, Registro Civil; aqui scripts/registro_civil_sim.py). Firma el `core`:
   version | fecha de emision | RUT | nombre | SHA-256 de la foto | clave publica del dispositivo.
   La foto viaja aparte y se valida contra su hash: el sistema del recinto verifica la firma del
   emisor sin recibir nunca la foto.
2. **Dispositivo** (Ed25519, la crea el telefono al enrolarse). Su clave publica va DENTRO del core
   firmado (como la clave de dispositivo del mDL, ISO/IEC 18013-5), asi que cualquier lector puede
   verificar, incluso sin red, que el QR lo genero el telefono dueno de esa cedula. Firma cada QR:
   hash del core | nonce | hora.
3. **Lectores autorizados** (X25519). El telefono cifra el QR con la clave publica de lectores que
   entrega el Registro Civil; solo los lectores autorizados (que tienen la privada) pueden leer
   foto, nombre y RUT. Quien fotografie el QR en la fila no ve nada.

Formato del QR (texto, modo alfanumerico): "CA2:" + base45(clave efimera | cifrado + tag).
Texto plano: nonce 16 | hora u32 | firma dispositivo 64 | largo core u16 | core | firma emisor 64 |
foto (resto).

En produccion el telefono y el escaner implementan esto en el cliente (frontend/src/credential.ts,
mismo formato, fijado por tests/vectors/qr-v2.json). Aqui esta en Python para el backend, los tests
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

CORE_VERSION = 2
ISSUER_DOMAIN = b"CA-ID-v2"  # separacion de dominio: una firma de cedula no sirve como firma de QR
DEVICE_DOMAIN = b"CA-QR-v2"
ENCRYPTION_INFO = b"CA-QR-v2 enc"
ENCRYPTION_AAD = b"CA2"
QR_PREFIX = "CA2:"
NONCE_BYTES = 16
SIGNATURE_BYTES = 64
KEY_BYTES = 32
_ZERO_NONCE = bytes(12)  # seguro: la clave de cifrado es nueva en cada QR (clave efimera)

BASE45_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:"


class CredentialError(ValueError):
    """Cedula o QR mal formado, con firma invalida o que no se puede descifrar."""


# --- Codificacion ------------------------------------------------------------------


def b64e(data: bytes) -> str:
    return base64.b64encode(data).decode()


def b64d(text: str, expected_len: int | None = None) -> bytes:
    try:
        data = base64.b64decode(text, validate=True)
    except ValueError as exc:
        raise CredentialError("base64 inválido") from exc
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
        raise CredentialError("base45 inválido") from exc
    out = bytearray()
    for i in range(0, len(values), 3):
        chunk = values[i : i + 3]
        if len(chunk) == 3:
            n = chunk[0] + chunk[1] * 45 + chunk[2] * 45 * 45
            if n > 0xFFFF:
                raise CredentialError("base45 inválido")
            out += bytes((n // 256, n % 256))
        elif len(chunk) == 2:
            n = chunk[0] + chunk[1] * 45
            if n > 0xFF:
                raise CredentialError("base45 inválido")
            out.append(n)
        else:
            raise CredentialError("base45 inválido")
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


# --- Cedula ---------------------------------------------------------------------------


@dataclass(frozen=True)
class IdentityCore:
    rut: str  # normalizado, ej. 12345678K
    name: str
    photo_sha256: bytes
    device_public: bytes  # Ed25519 del telefono donde se enrolo la cedula
    issued_at: int  # unix, segundos


def encode_core(core: IdentityCore) -> bytes:
    rut, name = core.rut.encode("ascii"), core.name.encode("utf-8")
    if len(rut) > 255 or len(name) > 255 or len(core.photo_sha256) != 32 or len(core.device_public) != KEY_BYTES:
        raise CredentialError("campos de la cédula fuera de rango")
    return (
        struct.pack(">BI", CORE_VERSION, core.issued_at)
        + bytes([len(rut)])
        + rut
        + bytes([len(name)])
        + name
        + core.photo_sha256
        + core.device_public
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
        device_public = data[pos + 32 : pos + 64]
    except (struct.error, IndexError, UnicodeDecodeError) as exc:
        raise CredentialError("cédula mal formada") from exc
    if version != CORE_VERSION or len(device_public) != KEY_BYTES or pos + 64 != len(data):
        raise CredentialError("cédula mal formada")
    return IdentityCore(rut=rut, name=name, photo_sha256=photo_sha256, device_public=device_public, issued_at=issued_at)


def issuer_sign(issuer_secret: bytes, core: bytes) -> bytes:
    return sign(issuer_secret, ISSUER_DOMAIN + core)


def verify_issuer(issuer_public: bytes, core: bytes, signature: bytes) -> bool:
    return verify(issuer_public, ISSUER_DOMAIN + core, signature)


@dataclass(frozen=True)
class IdentityCredential:
    """Lo que el Registro Civil deja en el telefono. La foto nunca se envia al sistema del recinto."""

    core: bytes
    issuer_sig: bytes
    photo: bytes

    def to_json(self) -> dict:
        return {"format": "cedula-sim-v2", "core": b64e(self.core), "issuer_sig": b64e(self.issuer_sig), "photo": b64e(self.photo)}

    @classmethod
    def from_json(cls, data: dict) -> "IdentityCredential":
        if data.get("format") != "cedula-sim-v2":
            raise CredentialError("formato de cédula desconocido")
        return cls(b64d(data["core"]), b64d(data["issuer_sig"], SIGNATURE_BYTES), b64d(data["photo"]))


# --- QR ------------------------------------------------------------------------------


def device_message(core: bytes, nonce: bytes, issued_at: int) -> bytes:
    return DEVICE_DOMAIN + hashlib.sha256(core).digest() + nonce + struct.pack(">I", issued_at)


@dataclass(frozen=True)
class QRContents:
    nonce: bytes
    issued_at: int
    device_sig: bytes
    core: bytes
    issuer_sig: bytes
    photo: bytes


def _encryption_key(shared: bytes, ephemeral_public: bytes, verifier_public: bytes) -> bytes:
    return HKDF(
        algorithm=hashes.SHA256(), length=32, salt=None, info=ENCRYPTION_INFO + ephemeral_public + verifier_public
    ).derive(shared)


def build_qr(
    credential: IdentityCredential,
    device_secret: bytes,
    verifier_public: bytes,
    issued_at: int,
    nonce: bytes | None = None,
    ephemeral_secret: bytes | None = None,
) -> str:
    """Lo que hace el telefono cada 45 s, sin conexion. `nonce`/`ephemeral_secret` solo se fijan en tests."""
    nonce = nonce if nonce is not None else os.urandom(NONCE_BYTES)
    device_sig = sign(device_secret, device_message(credential.core, nonce, issued_at))
    plaintext = (
        nonce
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
    shared = ephemeral.exchange(X25519PublicKey.from_public_bytes(verifier_public))
    key = _encryption_key(shared, ephemeral_public, verifier_public)
    ciphertext = ChaCha20Poly1305(key).encrypt(_ZERO_NONCE, plaintext, ENCRYPTION_AAD)
    return QR_PREFIX + base45_encode(ephemeral_public + ciphertext)


def decode_qr(qr_text: str, verifier_secret: bytes) -> QRContents:
    """Lo que hace el lector autorizado: descifra con la clave privada de lectores."""
    if not qr_text.startswith(QR_PREFIX):
        raise CredentialError("no es un QR de cédula digital")
    raw = base45_decode(qr_text[len(QR_PREFIX) :])
    if len(raw) < KEY_BYTES + 16:
        raise CredentialError("QR truncado")
    ephemeral_public, ciphertext = raw[:KEY_BYTES], raw[KEY_BYTES:]
    verifier_private = X25519PrivateKey.from_private_bytes(verifier_secret)
    try:
        shared = verifier_private.exchange(X25519PublicKey.from_public_bytes(ephemeral_public))
        key = _encryption_key(shared, ephemeral_public, verifier_private.public_key().public_bytes_raw())
        plaintext = ChaCha20Poly1305(key).decrypt(_ZERO_NONCE, ciphertext, ENCRYPTION_AAD)
    except (InvalidTag, ValueError) as exc:
        raise CredentialError("no se pudo descifrar (QR alterado o lector no autorizado)") from exc
    try:
        pos = 0
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
    if len(nonce) != NONCE_BYTES or len(core) != core_len or len(issuer_sig) != SIGNATURE_BYTES or not photo:
        raise CredentialError("QR mal formado")
    return QRContents(nonce, issued_at, device_sig, core, issuer_sig, photo)


def check_signatures(core: bytes, issuer_sig: bytes, nonce: bytes, issued_at: int, device_sig: bytes, issuer_public: bytes) -> IdentityCore:
    """Cedula emitida por el Registro Civil y QR firmado por el telefono dueno de esa cedula."""
    if not verify_issuer(issuer_public, core, issuer_sig):
        raise CredentialError("firma del emisor inválida: la cédula no la emitió el Registro Civil")
    identity = parse_core(core)
    if not verify(identity.device_public, device_message(core, nonce, issued_at), device_sig):
        raise CredentialError("el QR no lo generó el teléfono dueño de esta cédula")
    return identity


def check_qr(contents: QRContents, issuer_public: bytes) -> IdentityCore:
    """Verificacion local del lector (funciona sin red): firmas y foto integra. Devuelve lo que se muestra."""
    identity = check_signatures(
        contents.core, contents.issuer_sig, contents.nonce, contents.issued_at, contents.device_sig, issuer_public
    )
    if hashlib.sha256(contents.photo).digest() != identity.photo_sha256:
        raise CredentialError("la foto no corresponde a la cédula (fue cambiada)")
    return identity


# --- Revocacion (ADR-14) -------------------------------------------------------------

REVOCATION_DOMAIN = b"CA-REV-v1"


def credential_id(core: bytes) -> str:
    """Identificador de UNA emision de la cedula (cambia al enrolar otro telefono). Es un hash: la lista
    de revocadas no dice de quien son sin tener la cedula."""
    return hashlib.sha256(core).hexdigest()


def _revocation_message(issued_at: int, ids: list[str]) -> bytes:
    return REVOCATION_DOMAIN + struct.pack(">QI", issued_at, len(ids)) + b"".join(bytes.fromhex(i) for i in ids)


def sign_revocation_list(issuer_secret: bytes, issued_at: int, ids: list[str]) -> dict:
    """Lista de cedulas revocadas firmada por el emisor, como una CRL: cualquiera puede distribuirla
    (el backend del recinto, el escaner) sin poder alterarla."""
    ordered = sorted(set(ids))
    return {
        "issued_at": issued_at,
        "revoked": ordered,
        "sig": b64e(sign(issuer_secret, _revocation_message(issued_at, ordered))),
    }


def verify_revocation_list(data: dict, issuer_public: bytes) -> tuple[int, frozenset[str]]:
    """Devuelve (fecha de la lista, ids revocados) o lanza CredentialError si la firma no calza."""
    try:
        issued_at = int(data["issued_at"])
        ids = [str(i) for i in data["revoked"]]
        # Fuera de 64 bits, struct.pack lanza struct.error (no ValueError) y el error escapaba como un
        # 500 en cada validacion, en vez de conservar la ultima lista valida.
        if not 0 <= issued_at < 2**64 or any(len(i) != 64 for i in ids) or ids != sorted(set(ids)):
            raise CredentialError("lista de revocación mal formada")
        message = _revocation_message(issued_at, ids)
        signature = b64d(data["sig"], SIGNATURE_BYTES)
    except (KeyError, TypeError, ValueError, struct.error) as exc:
        raise CredentialError("lista de revocación mal formada") from exc
    if not verify(issuer_public, message, signature):
        raise CredentialError("la lista de revocación no la firmó el Registro Civil")
    return issued_at, frozenset(ids)
