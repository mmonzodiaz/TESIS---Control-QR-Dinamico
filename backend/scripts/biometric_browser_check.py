"""Insumos para contrastar el comparador del navegador contra Python con fotos reales (ADR-16).

El umbral de frontend/src/biometrics.ts se calibro en Python (scripts/biometric_degradation.py): la
sonda es el recorte del rostro (128x128 en LFW) escalado a 112 con bicubico de PIL, que suaviza al
reducir. En el escaner, la sonda es el fotograma de la camara (p. ej. 1080 px de lado) reducido a 112
por drawImage del canvas, con el remuestreo del navegador. Si ese remuestreo no suaviza, los puntajes
se mueven respecto del umbral sin que ningun test unitario lo note (auditoria del 2026-10-09).

Este script genera, para una muestra equilibrada de pares de LFW:
  - la referencia: la foto del QR, con el MISMO compresor del emisor (WebP 112x112 en 900 B);
  - la sonda en varios tamanos: el recorte del rostro (128 px) y versiones ampliadas con Lanczos
    (512 y 1080 px), que simulan un fotograma de camara encuadrado en el rostro;
  - el puntaje de Python para cada tamano de sonda.
La pagina frontend/dev-check/biometria.html calcula lo mismo en el navegador con biometrics.ts y
compara.

Uso (desde backend/, con el grupo de biometria):
    uv run --group biometria python scripts/biometric_browser_check.py \
        --rostros biometric-data/lfw_funneled --pares biometric-data/pairs.txt \
        --modelo ../frontend/public/models/w600k_mbf.onnx --pares-muestra 200
Escribe en frontend/dev-check/data/ (ignorado por git: son fotos de LFW).
"""

import argparse
import io
import json
import pathlib
import sys

from PIL import Image

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from biometric_degradation import Embedder, balanced_sample, crop_face, load_pairs  # noqa: E402
from registro_civil_sim import PHOTO_MAX_BYTES, PHOTO_SIZE, compress_photo  # noqa: E402

OUT_DIR = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "dev-check" / "data"
PROBE_SIZES = (128, 512, 1080)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--rostros", required=True)
    parser.add_argument("--pares", required=True)
    parser.add_argument("--modelo", required=True)
    parser.add_argument("--pares-muestra", type=int, default=200)
    args = parser.parse_args()

    pairs = balanced_sample(load_pairs(pathlib.Path(args.pares), pathlib.Path(args.rostros)), args.pares_muestra)
    embedder = Embedder(pathlib.Path(args.modelo), "externo")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    entries = []
    for i, (path_a, path_b, same, _fold) in enumerate(pairs):
        if not (path_a.exists() and path_b.exists()):
            continue
        with Image.open(path_a) as img_a, Image.open(path_b) as img_b:
            photo = compress_photo(crop_face(img_a))  # exactamente lo que el emisor pone en el QR
            probe = crop_face(img_b).convert("RGB")
        ref_name = f"ref_{i:04d}.webp"
        (OUT_DIR / ref_name).write_bytes(photo)
        with Image.open(io.BytesIO(photo)) as decoded:
            ref_vec = embedder.embed(decoded)
        probes, scores = {}, {}
        for size in PROBE_SIZES:
            image = probe if probe.size == (size, size) else probe.resize((size, size), Image.LANCZOS)
            name = f"probe_{i:04d}_{size}.png"
            image.save(OUT_DIR / name)
            probes[str(size)] = name
            scores[str(size)] = float(ref_vec @ embedder.embed(image))
        entries.append({"id": i, "same": same, "ref": ref_name, "probes": probes, "python": scores})

    manifest = {
        "photo": {"size": list(PHOTO_SIZE), "max_bytes": PHOTO_MAX_BYTES},
        "probe_sizes": list(PROBE_SIZES),
        "calibrated_probe_size": 128,
        "entries": entries,
    }
    (OUT_DIR / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")
    print(f"{len(entries)} pares escritos en {OUT_DIR}")


if __name__ == "__main__":
    main()
