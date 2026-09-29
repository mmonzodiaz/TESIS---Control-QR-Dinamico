"""Registro Civil SIMULADO: padron de personas y emision de cedulas digitales firmadas.

Es un actor distinto del sistema del evento. En un despliegue real, la cedula la entrega el
Registro Civil a la app del telefono; el sistema del evento solo conoce su clave publica. Por eso
la clave privada del emisor y el padron (con las fotos) viven aqui (registro_civil_sim/) y el
backend del evento lee solo la clave publica (settings.issuer_public_key_file).

El telefono se enrola en el servicio registro_civil/app.py con RUT + clave de activacion (que
simula la ClaveUnica) y recibe su cedula firmada; la guarda cifrada con un PIN.

La foto se comprime a WebP de baja resolucion para que quepa en el QR (ver PHOTO_MAX_BYTES).

Uso (desde backend/):
  uv run python scripts/registro_civil_sim.py init
  uv run python scripts/registro_civil_sim.py agregar --nombre "Ana Perez" --rut 12.345.678-5 --foto ana.jpg
  uv run python scripts/registro_civil_sim.py demo      # personas demo del padron (lo llama el seed)
"""

import argparse
import hashlib
import hmac
import io
import json
import pathlib
import random
import secrets
import sys
import time

from PIL import Image, ImageDraw, ImageOps

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.credential import (  # noqa: E402
    IdentityCore,
    IdentityCredential,
    b64d,
    b64e,
    ed25519_public,
    encode_core,
    issuer_sign,
    new_secret_key,
)
from app.rut import is_valid_rut, normalize_rut  # noqa: E402

DEFAULT_DIR = BACKEND_DIR / "registro_civil_sim"
PRIVATE_KEY_FILE = "issuer_private.key"
PUBLIC_KEY_FILE = "issuer_public.key"

# Tamano de la foto en el QR. Un QR admite ~2,9 KB; con 900 B de foto el QR queda cerca de la
# version 25 (117x117 modulos), legible desde la pantalla de un telefono.
PHOTO_SIZE = (72, 96)
PHOTO_MAX_BYTES = 900

PADRON_FILE = "padron.json"
# Sin 0/O/1/I para que no se confundan al tipearla.
ACTIVATION_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

# Mismas personas que las entradas demo de app/seed.py, con claves de activacion fijas para poder
# repetir la demostracion. En un despliegue real esto seria la ClaveUnica de cada persona.
DEMO_PEOPLE = [
    ("Asistente Uno", "11111111-1", "RCUNO234"),
    ("Asistente Dos", "22222222-2", "RCDOS234"),
    ("Asistente Tres", "12345678-5", "RCTRES23"),
]


def ensure_issuer_keys(key_dir: pathlib.Path = DEFAULT_DIR) -> bytes:
    """Crea el par de claves del emisor si no existe. Devuelve la clave privada."""
    key_dir.mkdir(parents=True, exist_ok=True)
    private_path = key_dir / PRIVATE_KEY_FILE
    if private_path.exists():
        secret = b64d(private_path.read_text().strip(), 32)
    else:
        secret = new_secret_key()
        private_path.write_text(b64e(secret))
    (key_dir / PUBLIC_KEY_FILE).write_text(b64e(ed25519_public(secret)))
    return secret


def compress_photo(image: Image.Image, max_bytes: int = PHOTO_MAX_BYTES) -> bytes:
    image = ImageOps.fit(ImageOps.exif_transpose(image).convert("RGB"), PHOTO_SIZE)
    for quality in range(70, 0, -5):
        buf = io.BytesIO()
        image.save(buf, "WEBP", quality=quality, method=6)
        if buf.tell() <= max_bytes:
            return buf.getvalue()
    raise ValueError(f"No se pudo comprimir la foto bajo {max_bytes} bytes")


def issue_credential(issuer_secret: bytes, name: str, rut: str, photo: bytes, issued_at: int | None = None) -> IdentityCredential:
    if not is_valid_rut(rut):
        raise ValueError(f"RUT invalido: {rut}")
    core = encode_core(
        IdentityCore(
            rut=normalize_rut(rut),
            name=name,
            photo_sha256=hashlib.sha256(photo).digest(),
            issued_at=issued_at if issued_at is not None else int(time.time()),
        )
    )
    return IdentityCredential(core=core, issuer_sig=issuer_sign(issuer_secret, core), photo=photo)


def demo_avatar(seed: str) -> Image.Image:
    """Retrato sintetico (no es una persona real), distinto por persona para que el guardia note el cambio."""
    rng = random.Random(seed)
    skin = rng.choice([(241, 204, 170), (224, 172, 125), (198, 134, 90), (141, 85, 54), (255, 219, 190)])
    hair = rng.choice([(40, 30, 25), (95, 60, 35), (180, 140, 80), (120, 120, 120), (20, 20, 20)])
    shirt = rng.choice([(18, 63, 74), (14, 128, 108), (160, 60, 70), (70, 90, 160), (200, 150, 40)])
    bg = rng.choice([(220, 232, 236), (236, 228, 214), (224, 236, 222), (232, 222, 236)])
    img = Image.new("RGB", (240, 320), bg)
    d = ImageDraw.Draw(img)
    d.ellipse((30, 250, 210, 420), fill=shirt)  # hombros
    d.rectangle((100, 200, 140, 260), fill=skin)  # cuello
    face_w = rng.randint(78, 92)
    d.ellipse((120 - face_w, 60, 120 + face_w, 250), fill=skin)
    hair_style = rng.randint(0, 2)
    if hair_style == 0:
        d.pieslice((120 - face_w - 6, 40, 120 + face_w + 6, 200), 180, 360, fill=hair)
    elif hair_style == 1:
        d.ellipse((120 - face_w - 12, 35, 120 + face_w + 12, 150), fill=hair)
        d.rectangle((120 - face_w - 12, 90, 120 - face_w + 10, 250), fill=hair)
        d.rectangle((120 + face_w - 10, 90, 120 + face_w + 12, 250), fill=hair)
    else:
        d.chord((120 - face_w, 50, 120 + face_w, 160), 180, 360, fill=hair)
    eye_y = rng.randint(140, 152)
    for x in (120 - face_w // 2 + 4, 120 + face_w // 2 - 4):
        d.ellipse((x - 9, eye_y - 7, x + 9, eye_y + 7), fill=(255, 255, 255))
        d.ellipse((x - 5, eye_y - 5, x + 5, eye_y + 5), fill=(40, 40, 40))
    d.polygon([(120, eye_y + 10), (112, eye_y + 42), (128, eye_y + 42)], fill=tuple(int(c * 0.85) for c in skin))
    mouth_y = eye_y + 62
    d.arc((95, mouth_y - 14, 145, mouth_y + 10), 20, 160, fill=(150, 60, 60), width=5)
    if rng.random() < 0.4:
        d.rectangle((120 - face_w + 20, eye_y - 12, 120 + face_w - 20, eye_y - 9), fill=hair)  # cejas marcadas
    return img


def _normalize_code(code: str) -> str:
    return code.replace("-", "").replace(" ", "").strip().upper()


def _hash_code(code: str) -> str:
    return hashlib.sha256(_normalize_code(code).encode()).hexdigest()


def load_padron(key_dir: pathlib.Path = DEFAULT_DIR) -> dict:
    path = key_dir / PADRON_FILE
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def add_person(
    name: str, rut: str, photo: bytes, activation_code: str | None = None, key_dir: pathlib.Path = DEFAULT_DIR
) -> str:
    """Inscribe (o reemplaza) a una persona en el padron. Devuelve su clave de activacion."""
    if not is_valid_rut(rut):
        raise ValueError(f"RUT invalido: {rut}")
    code = activation_code or "".join(secrets.choice(ACTIVATION_ALPHABET) for _ in range(8))
    padron = load_padron(key_dir)
    padron[normalize_rut(rut)] = {"name": name, "photo": b64e(photo), "activation_hash": _hash_code(code)}
    key_dir.mkdir(parents=True, exist_ok=True)
    (key_dir / PADRON_FILE).write_text(json.dumps(padron, indent=2), encoding="utf-8")
    return code


def enroll(rut: str, activation_code: str, key_dir: pathlib.Path = DEFAULT_DIR) -> IdentityCredential | None:
    """Emite la cedula firmada si RUT y clave calzan; None si no (sin distinguir por que)."""
    person = load_padron(key_dir).get(normalize_rut(rut))
    if person is None or not hmac.compare_digest(person["activation_hash"], _hash_code(activation_code)):
        return None
    return issue_credential(ensure_issuer_keys(key_dir), person["name"], rut, b64d(person["photo"]))


def seed_demo_padron(key_dir: pathlib.Path = DEFAULT_DIR) -> list[tuple[str, str, str]]:
    ensure_issuer_keys(key_dir)
    for name, rut, code in DEMO_PEOPLE:
        add_person(name, rut, compress_photo(demo_avatar(rut)), code, key_dir)
    return DEMO_PEOPLE


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init", help="crea el par de claves del emisor")
    add = sub.add_parser("agregar", help="inscribe a una persona con su foto en el padron")
    add.add_argument("--nombre", required=True)
    add.add_argument("--rut", required=True)
    add.add_argument("--foto", required=True, type=pathlib.Path)
    add.add_argument("--clave", help="clave de activacion (por defecto, aleatoria)")
    sub.add_parser("demo", help="inscribe a las personas de las entradas demo")
    args = parser.parse_args()

    if args.command == "init":
        ensure_issuer_keys()
        print(f"Claves del emisor en {DEFAULT_DIR}")
    elif args.command == "agregar":
        ensure_issuer_keys()
        photo = compress_photo(Image.open(args.foto))
        code = add_person(args.nombre, args.rut, photo, args.clave)
        print(f"Inscrita: {args.nombre} ({args.rut}), foto {len(photo)} bytes. Clave de activacion: {code}")
    else:
        for name, rut, code in seed_demo_padron():
            print(f"  - {rut} + clave {code} ({name})")


if __name__ == "__main__":
    main()
