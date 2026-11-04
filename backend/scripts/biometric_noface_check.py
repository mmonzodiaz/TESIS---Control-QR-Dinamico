"""Cuanto puntua el comparador de ADR-16 contra imagenes SIN rostro.

El modulo no tiene detector de rostros (frontend/src/biometrics.ts), asi que una camara que no enfoca
a nadie tambien produce un puntaje. Este script mide con que frecuencia ese puntaje supera el umbral,
con el modelo y la foto del QR de produccion. Compara dos tipos de referencia: fotos de LFW y los
avatares sinteticos de la demo.

Alcance: las imagenes sin rostro son pocas y sinteticas (colores, ruido, formas e imitacion de la camara
falsa de Chromium), no fotogramas reales de una puerta. Es una comprobacion, no una tasa de error.

Uso (desde backend/, con LFW y el modelo en su lugar; ver docs/results/biometric-degradation.md):
  uv run --group biometria python scripts/biometric_noface_check.py
Escribe docs/results/biometric-noface-check.md.
"""

import io
import pathlib
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

BACKEND_DIR = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from scripts.biometric_degradation import Embedder, crop_face, fit_photo  # noqa: E402
from scripts.registro_civil_sim import PHOTO_MAX_BYTES, PHOTO_SIZE, demo_avatar  # noqa: E402

REPO = BACKEND_DIR.parent
MODEL = REPO / "frontend/public/models/w600k_mbf.onnx"
FACES_DIR = BACKEND_DIR / "biometric-data/lfw_funneled"
REPORT = REPO / "docs/results/biometric-noface-check.md"
THRESHOLD = 0.245486  # frontend/src/biometrics.ts, a FAR 10^-3
SEED = 7
LFW_REFERENCES = 300
AVATAR_REFERENCES = 50


def no_face_images(rng: np.random.Generator, rand: random.Random) -> dict[str, Image.Image]:
    images: dict[str, Image.Image] = {}
    solid_colors = {"negro": (0, 0, 0), "blanco": (255, 255, 255), "gris": (128, 128, 128), "verde": (40, 200, 20), "piel": (205, 160, 130)}
    for name, color in solid_colors.items():
        images[f"solido-{name}"] = Image.new("RGB", (640, 480), color)
    images["gradiente"] = Image.fromarray(np.tile(np.linspace(0, 255, 640, dtype=np.uint8)[None, :, None], (480, 1, 3)))
    for i in range(10):
        noise = Image.fromarray(rng.integers(0, 256, (480, 640, 3), dtype=np.uint8))
        images[f"ruido-{i}"] = noise
        images[f"ruido-suave-{i}"] = noise.filter(ImageFilter.GaussianBlur(12))
    for i in range(10):
        shapes = Image.new("RGB", (640, 480), tuple(rand.randrange(256) for _ in range(3)))
        draw = ImageDraw.Draw(shapes)
        for _ in range(12):
            xs, ys = sorted(rand.sample(range(640), 2)), sorted(rand.sample(range(480), 2))
            draw.rectangle((xs[0], ys[0], xs[1], ys[1]), fill=tuple(rand.randrange(256) for _ in range(3)))
        images[f"formas-{i}"] = shapes
    fake_camera = Image.new("RGB", (640, 480), (0, 110, 0))
    ImageDraw.Draw(fake_camera).pieslice((170, 90, 470, 390), 30, 330, fill=(70, 230, 10))
    images["camara-falsa"] = fake_camera
    return images


def qr_photo(image: Image.Image) -> Image.Image:
    fitted = fit_photo(image, PHOTO_SIZE, PHOTO_MAX_BYTES)
    if fitted is None:
        raise SystemExit("Una foto no cupo en el presupuesto del QR")
    return Image.open(io.BytesIO(fitted[0]))


def lfw_references(rand: random.Random) -> list[Image.Image]:
    files = sorted(FACES_DIR.glob("*/*.jpg"))
    if not files:
        raise SystemExit(f"No esta LFW en {FACES_DIR}")
    rand.shuffle(files)
    people: set[str] = set()
    references = []
    for file in files:  # una foto por persona
        if file.parent.name not in people:
            people.add(file.parent.name)
            references.append(qr_photo(crop_face(Image.open(file))))
        if len(references) == LFW_REFERENCES:
            break
    return references


def summarize(label: str, references: np.ndarray, frames: dict[str, np.ndarray]) -> list[str]:
    names = list(frames)
    scores = references @ np.stack([frames[name] for name in names]).T
    above = scores >= THRESHOLD
    worst = max(range(len(names)), key=lambda i: above[:, i].mean())
    return [
        f"| {label} | {above.sum()} de {above.size} ({above.mean():.2%}) | {np.median(scores):.3f} | "
        f"{np.percentile(scores, 99):.3f} | {scores.max():.3f} | {names[worst]} ({above[:, worst].mean():.1%}) |"
    ]


def main() -> None:
    rng = np.random.default_rng(SEED)
    rand = random.Random(SEED)
    embedder = Embedder(MODEL, "externo")
    frames = {name: embedder.embed(ImageOps.fit(image, (112, 112))) for name, image in no_face_images(rng, rand).items()}
    lfw = np.stack([embedder.embed(image) for image in lfw_references(rand)])
    avatars = np.stack([embedder.embed(qr_photo(demo_avatar(f"persona-{i}"))) for i in range(AVATAR_REFERENCES)])

    lines = [
        "# Comparador biométrico frente a imágenes sin rostro",
        "",
        "Generado por `backend/scripts/biometric_noface_check.py`. No editar a mano.",
        "",
        f"Umbral {THRESHOLD} (FAR 10⁻³ con rostros de LFW). {len(frames)} imágenes sin rostro, sintéticas: "
        "colores, ruido, formas e imitación de la cámara falsa de Chromium. Es una comprobación, no una "
        "tasa de error: faltan fotogramas reales de una puerta.",
        "",
        "| Referencia | Pares sobre el umbral | Mediana | p99 | Máximo | Imagen con más pares sobre el umbral |",
        "|---|---|---|---|---|---|",
        *summarize(f"{len(lfw)} fotos de LFW, una por persona", lfw, frames),
        *summarize(f"{len(avatars)} avatares de la demo", avatars, frames),
        "",
        "Con fotos de rostros reales, las imágenes sin rostro superan el umbral con una frecuencia del mismo "
        "orden que el FAR medido. Con los avatares sintéticos de la demo el puntaje no significa nada: por "
        "eso el escáner no afirma que el rostro coincida, y una demostración con ellos no sirve para evaluar "
        "el comparador.",
        "",
    ]
    REPORT.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    print(f"Escrito: {REPORT}")


if __name__ == "__main__":
    main()
