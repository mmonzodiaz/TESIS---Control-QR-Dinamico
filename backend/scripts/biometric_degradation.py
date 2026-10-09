"""Cuanta precision biometrica cuesta meter la foto dentro de un QR (ADR-16).

Pregunta: la cedula lleva la foto DENTRO del QR, comprimida por registro_civil_sim.compress_photo
a PHOTO_SIZE y hasta PHOTO_MAX_BYTES, porque el QR tiene techo de tamano. Cuando se midio, la
configuracion de produccion era 72x96 en 900 B; el resultado llevo a dejarla en 112x112 (ADR-16). Los modelos de
reconocimiento facial de la familia ArcFace entran a 112x112 y pierden precision con esa
compresion. ADR-16 necesita decidir entre dos caminos y la decision se toma con un numero:

  (A) comparar contra la foto del QR tal como esta  -> no cambia el formato de la credencial
  (B) plantilla firmada en el core, calculada por el emisor desde el retrato original

Este experimento mide (A) para varios presupuestos de bytes y tamanos de imagen, y usa (B) como
linea base: el emisor tiene el retrato original, asi que el techo de (B) es la precision sin
degradar. La diferencia entre la curva y la linea base ES el costo de meter la foto en el QR.

Protocolo
---------
Para cada par de fotos del conjunto (una misma persona, o dos distintas):
  - referencia: la primera imagen, degradada con el MISMO compresor del emisor (se verifica por
    igualdad de bytes contra compress_photo en la configuracion de produccion).
  - sonda: la segunda imagen sin degradar (hace de fotograma de camara).
  - puntaje: similitud coseno entre los dos vectores del modelo.
Con los puntajes de pares genuinos e impostores se calcula TAR a FAR fijo, EER y AUC.

Limites declarados (NO omitirlos al citar esto en la tesis)
-----------------------------------------------------------
1. Sin alineado por puntos faciales. Se usa un recorte central fijo, documentado en CROP. Por eso
   el TAR ABSOLUTO queda por debajo de las cifras publicadas para estos modelos; lo que este
   experimento mide es la DEGRADACION RELATIVA respecto de su propia linea base, que es lo que
   decide entre (A) y (B).
2. La resolucion de FAR la limita la cantidad de pares impostores: con N impostores el FAR mas
   fino medible es 1/N. El reporte lo declara y omite los puntos no resolubles.
3. Las sondas son fotos de archivo, no fotogramas de camara en una fila (desenfoque, contraluz,
   angulo). El resultado es un techo, no lo que se obtendria en la puerta.
4. Un conjunto publico de rostros no representa la poblacion chilena; el sesgo demografico de
   estos modelos esta documentado en la literatura (ver NIST FRVT Part 3) y no se mide aqui.

Insumos: modelo y preprocesamiento
----------------------------------
El preprocesamiento NO es el mismo para todos los modelos y equivocarlo produce vectores basura
con AUC ~0,5 (no un error, solo numeros sin sentido). Por eso --preproceso es obligatorio:

  --preproceso externo  ->  (pixel - 127,5) / 127,5, RGB, NCHW.
      Para los modelos de InsightFace (w600k_mbf de buffalo_sc, 13,6 MB; w600k_r50 de buffalo_l,
      174 MB). Entrada [N,3,112,112], salida [1,512]. Sus PESOS son solo para investigacion no
      comercial (el codigo es MIT, los pesos no): declararlo en la tesis.

  --preproceso crudo    ->  pixeles 0-255 sin normalizar, RGB, NCHW.
      Para arcfaceresnet100-8 del ONNX Model Zoo (249 MB, Apache-2.0, permite uso comercial), que
      lleva la normalizacion DENTRO del grafo (nodos Sub 127,5 y Mul 1/128 antes de la primera
      convolucion). Normalizar por fuera seria normalizar dos veces. Contrapartida etica a
      declarar: sus pesos se entrenaron con MS-Celeb-1M, retirado por Microsoft por problemas de
      consentimiento.

Ninguno de los dos sale L2-normalizado del grafo; este script normaliza el vector al calcularlo.

Insumos: conjunto de rostros
----------------------------
La fuente oficial de LFW (vis-www.cs.umass.edu) esta CAIDA desde ~enero de 2025 y no hay
reubicacion anunciada: las URLs que aparecen en los papers estan muertas. Hay espejos vivos (el
que usa scikit-learn sirve pairs.txt y las variantes lfw y lfw-funneled, pero NO deepfunneled).
Declara en la tesis la variante exacta y el espejo usado, porque cambian el resultado. Todas las
variantes son imagenes de 250x250, que es lo que supone CROP. LFW tiene 6 pares mal etiquetados
conocidos en View 2 que por convencion NO se corrigen, para mantener comparabilidad.

Uso (desde backend/, con el grupo de dependencias de biometria):
    uv sync --group biometria
    uv run python scripts/biometric_degradation.py --verificar
    uv run python scripts/biometric_degradation.py --rostros <dir> --pares <archivo> \
        --modelo <m.onnx> --preproceso externo
Escribe docs/results/biometric-degradation.json y docs/results/biometric-degradation.md.
"""

import argparse
import io
import json
import math
import pathlib
import statistics
import sys
from dataclasses import dataclass, field

from PIL import Image, ImageOps

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from registro_civil_sim import PHOTO_MAX_BYTES, PHOTO_SIZE, compress_photo  # noqa: E402

RESULTS_DIR = pathlib.Path(__file__).resolve().parents[2] / "docs" / "results"

# Recorte central fijo sobre imagenes de 250x250 (formato de LFW deepfunneled), en fraccion del
# lado: aproxima el encuadre de rostro que esperan estos modelos sin detector de puntos faciales.
# Cambiar esto cambia el TAR absoluto de TODAS las filas por igual; la comparacion relativa aguanta.
CROP = (0.244, 0.244, 0.756, 0.756)
MODEL_INPUT = (112, 112)  # ArcFace / MobileFaceNet

# Configuraciones a medir. El tamano manda sobre el presupuesto: a tamanos chicos la calidad topa en 70,
# asi que mas bytes no compran precision; para gastar mas bytes hay que poner mas pixeles.
SIZES = [(72, 96), (96, 128), (112, 112), (128, 160), (160, 160)]
BUDGETS = [600, 900, 1500, 2500]  # 2500 B ~ techo de un QR version 40

# Formato del QR (backend/app/credential.py::build_qr), para traducir bytes de foto a tamano de QR:
# clave efimera 32 | nonce 16 | hora 4 | firma dispositivo 64 | largo core 2 | core | firma emisor 64
# | foto | tag 16.  El core es version 1 + hora 4 + (1+len rut) + (1+len nombre) + hash foto 32 +
# clave dispositivo 32.  base45 codifica 2 bytes en 3 caracteres.
QR_FIXED_BYTES = 32 + 16 + 4 + 64 + 2 + 64 + 16
CORE_BYTES = 1 + 4 + (1 + 10) + (1 + 13) + 32 + 32  # RUT de 10 y nombre de 13 caracteres


@dataclass
class Variant:
    size: tuple[int, int]
    budget: int
    # Por par medido: la calidad y el tamano dependen de cada foto, asi que se reportan como
    # distribucion (mediana y maximo), no como el valor de la ultima foto procesada.
    qualities: list[int] = field(default_factory=list)
    photo_sizes: list[int] = field(default_factory=list)
    genuine: list[float] = field(default_factory=list)
    impostor: list[float] = field(default_factory=list)
    # Fold de LFW de cada puntaje, para elegir el umbral fuera del fold que se evalua.
    genuine_folds: list[int | None] = field(default_factory=list)
    impostor_folds: list[int | None] = field(default_factory=list)

    def add(self, score: float, same: bool, fold: int | None) -> None:
        (self.genuine if same else self.impostor).append(score)
        (self.genuine_folds if same else self.impostor_folds).append(fold)

    @property
    def key(self) -> str:
        return f"{self.size[0]}x{self.size[1]}@{self.budget}B"


def fit_photo(image: Image.Image, size: tuple[int, int], max_bytes: int) -> tuple[bytes, int] | None:
    """Mismo algoritmo que registro_civil_sim.compress_photo, con el tamano como parametro.

    Devuelve (bytes, calidad) o None si no cabe ni en la calidad minima.
    """
    image = ImageOps.fit(ImageOps.exif_transpose(image).convert("RGB"), size)
    for quality in range(70, 0, -5):
        buf = io.BytesIO()
        image.save(buf, "WEBP", quality=quality, method=6)
        if buf.tell() <= max_bytes:
            return buf.getvalue(), quality
    return None


def check_fidelity(sample: Image.Image) -> None:
    """Verifica que fit_photo reproduce exactamente al compresor de produccion.

    Si esto falla, la curva medida no corresponde a lo que el emisor realmente pone en el QR.
    """
    mine = fit_photo(sample, PHOTO_SIZE, PHOTO_MAX_BYTES)
    theirs = compress_photo(sample)
    if mine is None or mine[0] != theirs:
        raise SystemExit(
            "fit_photo no reproduce compress_photo en la configuracion de produccion "
            f"({PHOTO_SIZE[0]}x{PHOTO_SIZE[1]}, {PHOTO_MAX_BYTES} B). El experimento no seria valido."
        )


def qr_payload_chars(photo_bytes: int) -> int:
    """Caracteres del QR para una foto de ese tamano, segun el formato de credential.py.

    Contrastado con backend/tests/vectors/qr-v2.json (foto de 200 B -> 739 caracteres; aqui da unos
    pocos mas porque el RUT y el nombre del vector son de otro largo).
    """
    raw = QR_FIXED_BYTES + CORE_BYTES + photo_bytes
    return len("CA2:") + (raw // 2) * 3 + (raw % 2) * 2


#: Como alimentar cada familia de modelos. Ver la seccion "Insumos" del encabezado: equivocarse
#: aqui no da error, da vectores sin sentido, y de ahi la comprobacion de cordura de abajo.
PREPROCESSING = {
    "externo": "(pixel - 127,5) / 127,5  [InsightFace: w600k_mbf, w600k_r50]",
    "crudo": "pixeles 0-255 sin normalizar  [ONNX Model Zoo: arcfaceresnet100-8, normaliza en el grafo]",
}


class Embedder:
    """Modelo ONNX de reconocimiento facial (entrada Nx3x112x112, salida un vector)."""

    def __init__(self, model_path: pathlib.Path, preprocessing: str):
        import numpy as np
        import onnxruntime

        self.np = np
        self.preprocessing = preprocessing
        self.session = onnxruntime.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        shape = self.session.get_inputs()[0].shape
        if len(shape) != 4:
            raise SystemExit(f"El modelo espera una entrada de {len(shape)} dimensiones, no una imagen (4).")
        self.dims = tuple(shape[2:])
        self.output_dim = self.session.get_outputs()[0].shape[-1]

    def embed(self, image: Image.Image):
        np = self.np
        size = MODEL_INPUT if not all(isinstance(d, int) for d in self.dims) else tuple(self.dims)[::-1]
        arr = np.asarray(image.convert("RGB").resize(size, Image.BICUBIC), dtype=np.float32)
        if self.preprocessing == "externo":
            arr = (arr - 127.5) / 127.5
        # "crudo": el grafo ya trae los nodos de normalizacion; normalizar aqui seria hacerlo dos veces.
        arr = np.transpose(arr, (2, 0, 1))[None, ...]
        vec = self.session.run(None, {self.input_name: arr})[0][0].astype(np.float64)
        norm = float(np.linalg.norm(vec))
        if norm == 0.0:
            raise SystemExit("El modelo devolvio un vector nulo: revisa que sea un modelo de reconocimiento facial.")
        return vec / norm


def crop_face(image: Image.Image) -> Image.Image:
    w, h = image.size
    box = (int(CROP[0] * w), int(CROP[1] * h), int(CROP[2] * w), int(CROP[3] * h))
    return image.crop(box)


Pair = tuple[pathlib.Path, pathlib.Path, bool, int | None]


def load_pairs(pairs_file: pathlib.Path, faces_dir: pathlib.Path) -> list[Pair]:
    """Lee el archivo de pares en formato LFW.

    Lineas de 3 campos = misma persona (genuino); de 4 campos = personas distintas (impostor). La
    cabecera de pairs.txt ("10 300") dice cuantos folds hay y cuantos pares de cada tipo trae cada
    uno; con ella se anota el fold de cada par (None si el archivo no la trae).
    """

    def image_path(name: str, index: str) -> pathlib.Path:
        return faces_dir / name / f"{name}_{int(index):04d}.jpg"

    pairs: list[Pair] = []
    per_fold = None
    for line in pairs_file.read_text(encoding="utf-8").splitlines():
        parts = line.split()
        fold = len(pairs) // (2 * per_fold) if per_fold else None
        if len(parts) == 2 and not pairs and all(p.isdigit() for p in parts):
            per_fold = int(parts[1])
        elif len(parts) == 3:
            pairs.append((image_path(parts[0], parts[1]), image_path(parts[0], parts[2]), True, fold))
        elif len(parts) == 4:
            pairs.append((image_path(parts[0], parts[1]), image_path(parts[2], parts[3]), False, fold))
    if not pairs:
        raise SystemExit(f"No se leyeron pares de {pairs_file}. Se espera el formato de pairs.txt de LFW.")
    return pairs


def balanced_sample(pairs: list[Pair], total: int) -> list:
    """Muestra con la mitad de pares genuinos y la mitad impostores, repartida por el archivo.

    Hace falta porque cada fold de LFW lista primero sus 300 genuinos y despues sus 300 impostores:
    quedarse con los primeros N del archivo da un solo tipo y el ROC no se puede calcular.
    """
    genuine = [p for p in pairs if p[2]]
    impostor = [p for p in pairs if not p[2]]
    half = max(1, total // 2)
    # Paso uniforme en vez de los primeros N: asi la muestra cubre todos los folds, no solo el primero.
    def spread(items: list, n: int) -> list:
        if n >= len(items):
            return items
        step = len(items) / n
        return [items[int(i * step)] for i in range(n)]

    return spread(genuine, half) + spread(impostor, half)


def threshold_at_far(impostor_sorted: list[float], far: float) -> float | None:
    """Umbral mas bajo que acepta (puntaje >= umbral) como maximo far*N impostores. None si con N
    impostores ese FAR no se resuelve (far < 1/N).

    Queda apenas por encima del impostor numero allowed+1 contando desde el mas alto, asi que
    acepta exactamente los allowed de arriba (o menos, si hay empates). Hasta el 2026-10-09 se
    usaba ese mismo impostor como umbral y, con >=, se aceptaba uno de mas: con 3000 impostores y
    FAR 1e-3, 4 en vez de 3 (FAR real 1,33e-3).
    """
    n = len(impostor_sorted)
    if far < 1.0 / n:
        return None
    allowed = int(far * n)
    if allowed >= n:
        return impostor_sorted[0]
    return math.nextafter(impostor_sorted[n - 1 - allowed], math.inf)


def cross_validated(
    genuine: list[float],
    genuine_folds: list[int | None],
    impostor: list[float],
    impostor_folds: list[int | None],
    far_targets: tuple[float, ...],
) -> dict | None:
    """TAR y FAR con el umbral elegido FUERA del fold que se mide (protocolo de LFW View 2: se ajusta
    en 9 folds y se evalua en el decimo; los resultados de los 10 se suman).

    El umbral de roc_metrics se elige y se mide sobre los mismos impostores, lo que lo hace
    optimista: con FAR 1e-3 y 3000 impostores lo fijan 3 o 4 puntajes de la cola. Esto mide cuanto
    se aleja en caras que el umbral no vio. None si los pares no traen fold.
    """
    folds = sorted({f for f in genuine_folds + impostor_folds if f is not None})
    if len(folds) < 2 or None in genuine_folds or None in impostor_folds:
        return None
    out: dict = {"folds": len(folds), "tar": {}}
    for far in far_targets:
        accepted_g = accepted_i = 0
        resolvable = True
        for k in folds:
            train = sorted(s for s, f in zip(impostor, impostor_folds) if f != k)
            threshold = threshold_at_far(train, far)
            if threshold is None:
                resolvable = False
                break
            accepted_g += sum(1 for s, f in zip(genuine, genuine_folds) if f == k and s >= threshold)
            accepted_i += sum(1 for s, f in zip(impostor, impostor_folds) if f == k and s >= threshold)
        out["tar"][f"{far:g}"] = (
            {"tar": accepted_g / len(genuine), "far_observado": accepted_i / len(impostor)} if resolvable else None
        )
    return out


def roc_metrics(genuine: list[float], impostor: list[float], far_targets: tuple[float, ...]) -> dict:
    """TAR a FAR fijo, EER y AUC a partir de los puntajes. Sin dependencias de sklearn.

    El FAR mas fino resoluble es 1/len(impostor): los objetivos por debajo se omiten.
    """
    if not genuine or not impostor:
        raise SystemExit(
            f"Se necesitan pares de los dos tipos y hay {len(genuine)} genuinos y {len(impostor)} impostores.\n"
            "En el formato de LFW cada fold lista primero todos sus pares genuinos y despues los"
            " impostores, asi que recortar el archivo de corrido deja un solo tipo: usa --limite-pares,"
            " que toma una muestra equilibrada, en vez de truncar el archivo a mano."
        )
    g = sorted(genuine)
    im = sorted(impostor)
    n_g, n_i = len(g), len(im)

    def tar_at(threshold: float) -> float:
        lo, hi = 0, n_g
        while lo < hi:  # primer genuino >= umbral
            mid = (lo + hi) // 2
            if g[mid] < threshold:
                lo = mid + 1
            else:
                hi = mid
        return (n_g - lo) / n_g

    out: dict = {"n_genuinos": n_g, "n_impostores": n_i, "far_minimo_resoluble": 1.0 / n_i, "tar": {}}
    for far in far_targets:
        threshold = threshold_at_far(im, far)
        if threshold is None:
            out["tar"][f"{far:g}"] = None  # no resoluble con este tamano de muestra
            continue
        out["tar"][f"{far:g}"] = {
            "tar": tar_at(threshold),
            "umbral": threshold,
            # FAR que de verdad tiene ese umbral sobre estos impostores (<= el objetivo).
            "far_real": sum(1 for s in im if s >= threshold) / n_i,
        }

    # EER: donde FAR y FRR se cruzan, barriendo los puntajes como umbrales candidatos.
    best = None
    for threshold in sorted(set(g + im)):
        far_t = sum(1 for s in im if s >= threshold) / n_i
        frr_t = sum(1 for s in g if s < threshold) / n_g
        gap = abs(far_t - frr_t)
        if best is None or gap < best[0]:
            best = (gap, (far_t + frr_t) / 2, threshold)
    out["eer"] = {"valor": best[1], "umbral": best[2]}

    # AUC = probabilidad de que un genuino puntue mas alto que un impostor (Mann-Whitney).
    wins = ties = 0
    j = 0
    for s in g:
        while j < n_i and im[j] < s:
            j += 1
        wins += j
        ties += sum(1 for t in im[j:] if t == s)
    out["auc"] = (wins + 0.5 * ties) / (n_g * n_i)
    out["media_genuinos"] = sum(g) / n_g
    out["media_impostores"] = sum(im) / n_i
    return out


def sanity_gate(auc: float, floor: float, preprocessing: str) -> None:
    """Aborta si la linea base no separa genuinos de impostores.

    La linea base usa el retrato SIN degradar: si ahi el AUC es malo, el problema esta en el
    montaje (preprocesamiento equivocado, orden de canales, recorte fuera del rostro, pares mal
    leidos), no en la compresion. Sin esta puerta el experimento entregaria numeros con cara de
    resultado: un modelo mal alimentado produce AUC ~0,5 sin levantar ningun error.
    """
    if auc >= floor:
        return
    raise SystemExit(
        f"\nLinea base con AUC {auc:.3f}, por debajo del minimo {floor:.2f}: el montaje esta mal, "
        "no es un hallazgo.\nRevisa, en este orden:\n"
        f"  1. --preproceso (usaste '{preprocessing}': {PREPROCESSING[preprocessing]}).\n"
        "     Es el error mas probable: con el preprocesamiento cruzado los vectores no significan nada.\n"
        "  2. Que CROP caiga sobre el rostro (asume imagenes de 250x250 tipo LFW).\n"
        "  3. Que el archivo de pares corresponda al directorio de rostros.\n"
        "Para saltarte esta puerta a proposito, baja --auc-minima."
    )


def describe_environment(args) -> None:
    say = print
    say("Entorno del experimento de degradacion biometrica\n")
    try:
        import numpy  # noqa: F401
        import onnxruntime

        say(f"  [ok]    onnxruntime {onnxruntime.__version__}")
    except ImportError as exc:
        say(f"  [falta] {exc.name}: instala el grupo con  uv sync --group biometria")
    for label, path, hint in (
        ("modelo ONNX", args.modelo, "un modelo de reconocimiento facial (entrada 112x112, salida un vector)"),
        ("directorio de rostros", args.rostros, "un conjunto publico de rostros, una carpeta por persona"),
        ("archivo de pares", args.pares, "lista de pares en formato pairs.txt de LFW"),
    ):
        if path is None:
            say(f"  [falta] {label}: pasalo por linea de comandos ({hint})")
        elif not pathlib.Path(path).exists():
            say(f"  [falta] {label}: no existe {path}")
        else:
            say(f"  [ok]    {label}: {path}")
    if args.preproceso:
        say(f"  [ok]    preprocesamiento: {PREPROCESSING[args.preproceso]}")
    else:
        say("  [falta] --preproceso: elige " + " o ".join(sorted(PREPROCESSING)) + " segun el modelo")
    say("\nPreprocesamiento por modelo (equivocarlo no da error, da vectores sin sentido):")
    for key, detail in sorted(PREPROCESSING.items()):
        say(f"  {key:>8}: {detail}")
    say(
        "\nEl conjunto de rostros y el modelo no se versionan en este repositorio (licencia y tamano)."
        "\nAl citar el resultado en la tesis hay que declarar la variante exacta del conjunto, el espejo"
        "\nde donde salio, el modelo con su version y la LICENCIA de sus pesos, mas los limites que"
        "\nquedan listados en el informe generado."
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Mide cuanta precision biometrica cuesta comprimir la foto para el QR.")
    parser.add_argument("--rostros", help="directorio del conjunto de rostros (una carpeta por persona)")
    parser.add_argument("--pares", help="archivo de pares en formato LFW")
    parser.add_argument("--modelo", help="modelo ONNX de reconocimiento facial")
    parser.add_argument(
        "--preproceso",
        choices=sorted(PREPROCESSING),
        help="como alimentar el modelo; ver la seccion Insumos del encabezado. Equivocarlo da vectores sin sentido",
    )
    parser.add_argument("--limite-pares", type=int, default=0, help="usar solo los primeros N pares (prueba rapida)")
    parser.add_argument(
        "--auc-minima",
        type=float,
        default=0.80,
        help="AUC minima exigida a la linea base sin degradar; por debajo se aborta (default 0.80)",
    )
    parser.add_argument("--verificar", action="store_true", help="revisa el entorno y los insumos, sin medir")
    parser.add_argument(
        "--rehacer-informe",
        action="store_true",
        help="reescribe el .md desde el .json ya medido, sin volver a medir (el json es la fuente de verdad)",
    )
    args = parser.parse_args()

    if args.verificar:
        describe_environment(args)
        return
    if args.rehacer_informe:
        path = RESULTS_DIR / "biometric-degradation.json"
        if not path.exists():
            raise SystemExit(f"No existe {path}: hay que medir primero.")
        write_report(json.loads(path.read_text(encoding="utf-8")))
        print(f"Informe reescrito desde {path.name}")
        return
    if not (args.rostros and args.pares and args.modelo and args.preproceso):
        describe_environment(args)
        raise SystemExit("\nFaltan insumos: --rostros, --pares, --modelo y --preproceso son obligatorios para medir.")

    faces_dir, pairs_file, model_path = (pathlib.Path(p) for p in (args.rostros, args.pares, args.modelo))
    pairs = load_pairs(pairs_file, faces_dir)
    if args.limite_pares:
        pairs = balanced_sample(pairs, args.limite_pares)

    print(f"Pares a medir: {len(pairs)}")
    embedder = Embedder(model_path, args.preproceso)
    print(f"Modelo: {model_path.name} (vector de {embedder.output_dim} dimensiones)")
    print(f"Preprocesamiento: {PREPROCESSING[args.preproceso]}")

    variants = [Variant(size, budget) for size in SIZES for budget in BUDGETS]
    baseline = Variant((0, 0), 0)  # (B): el emisor calcula el vector desde el retrato original
    checked = False
    skipped = 0

    for i, (path_a, path_b, same, fold) in enumerate(pairs, 1):
        if not (path_a.exists() and path_b.exists()):
            skipped += 1
            continue
        with Image.open(path_a) as img_a, Image.open(path_b) as img_b:
            reference_full = crop_face(img_a)
            probe = crop_face(img_b)
            if not checked:
                check_fidelity(reference_full)
                checked = True
            probe_vec = embedder.embed(probe)
            baseline.add(float(embedder.embed(reference_full) @ probe_vec), same, fold)
            for variant in variants:
                fitted = fit_photo(reference_full, variant.size, variant.budget)
                if fitted is None:
                    continue
                photo, quality = fitted
                variant.qualities.append(quality)
                variant.photo_sizes.append(len(photo))
                with Image.open(io.BytesIO(photo)) as degraded:
                    variant.add(float(embedder.embed(degraded) @ probe_vec), same, fold)
        if i % 200 == 0:
            print(f"  {i}/{len(pairs)} pares")

    if skipped:
        print(f"Pares omitidos por imagen faltante: {skipped}")
    if not baseline.genuine:
        raise SystemExit("Ningun par se pudo medir: revisa --rostros y --pares.")

    far_targets = (1e-2, 1e-3, 1e-4)
    baseline_metrics = {**roc_metrics(baseline.genuine, baseline.impostor, far_targets), **_cv(baseline, far_targets)}
    sanity_gate(baseline_metrics["auc"], args.auc_minima, args.preproceso)
    rows = []
    for variant in variants:
        if not variant.photo_sizes:
            rows.append({**_variant_id(variant), "cabe": False})
            continue
        rows.append(
            {
                **_variant_id(variant),
                "cabe": True,
                "calidad_webp": statistics.median_low(variant.qualities),
                "bytes_foto": statistics.median_low(variant.photo_sizes),
                "bytes_foto_max": max(variant.photo_sizes),
                "caracteres_qr": qr_payload_chars(statistics.median_low(variant.photo_sizes)),
                "caracteres_qr_max": qr_payload_chars(max(variant.photo_sizes)),
                **roc_metrics(variant.genuine, variant.impostor, far_targets),
                **_cv(variant, far_targets),
            }
        )

    payload = {
        "pregunta": "Cuanta precision biometrica cuesta meter la foto de la cedula dentro del QR (ADR-16)",
        "modelo": {
            "archivo": model_path.name,
            "dimensiones_vector": embedder.output_dim,
            "preprocesamiento": args.preproceso,
            "preprocesamiento_detalle": PREPROCESSING[args.preproceso],
        },
        "conjunto": {"directorio": str(faces_dir), "pares": str(pairs_file), "pares_usados": len(baseline.genuine) + len(baseline.impostor)},
        "recorte": {"fraccion": CROP, "entrada_modelo": MODEL_INPUT, "sin_alineado_por_puntos": True},
        "produccion_actual": {"tamano": list(PHOTO_SIZE), "max_bytes": PHOTO_MAX_BYTES},
        "linea_base_opcion_b": baseline_metrics,
        "variantes_opcion_a": rows,
        "limites": [
            "Sin alineado por puntos faciales: el TAR absoluto es una cota inferior; lo valido es la comparacion relativa.",
            "El FAR minimo resoluble lo fija la cantidad de pares impostores.",
            "Las sondas son fotos de archivo, no fotogramas de camara en una fila: el resultado es un techo.",
            "El conjunto de rostros no representa la poblacion chilena. LFW lo advierte en su propia pagina:"
            " muy pocos ninos, nadie sobre 80 anos, proporcion baja de mujeres y etnias con representacion"
            " minima o nula, y no tiene datos suficientes para conclusiones estadisticas por subgrupo.",
            "LFW declara que ningun resultado sobre el permite concluir que un algoritmo sirva para un"
            " proposito comercial; aqui se usa para comparar configuraciones entre si, no para certificar nada.",
            "Declarar en la tesis la variante exacta de LFW y el espejo usado: la fuente oficial"
            " (vis-www.cs.umass.edu) esta caida desde ~enero de 2025 y las variantes dan resultados distintos.",
            "Declarar la licencia de los pesos del modelo: los de InsightFace son solo para investigacion"
            " no comercial; arcfaceresnet100-8 es Apache-2.0 pero se entreno con MS-Celeb-1M, retirado por"
            " Microsoft por problemas de consentimiento.",
        ],
    }
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / "biometric-degradation.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    write_report(payload)
    print(f"\nEscrito en {RESULTS_DIR / 'biometric-degradation.json'} y .md")


def _cv(variant: Variant, far_targets: tuple[float, ...]) -> dict:
    cv = cross_validated(variant.genuine, variant.genuine_folds, variant.impostor, variant.impostor_folds, far_targets)
    return {"validacion_cruzada": cv} if cv else {}


def _variant_id(variant: Variant) -> dict:
    # Sin "es_produccion": cual es produccion lo decide el informe con la configuracion ACTUAL del
    # emisor. Grabarlo aqui lo congelaba al dia de la medicion (asi quedo marcada 72x96 tras pasar
    # a 112x112).
    return {
        "configuracion": variant.key,
        "ancho": variant.size[0],
        "alto": variant.size[1],
        "presupuesto_bytes": variant.budget,
    }


def is_production(row: dict) -> bool:
    return [row["ancho"], row["alto"]] == list(PHOTO_SIZE) and row["presupuesto_bytes"] == PHOTO_MAX_BYTES


def pct(x: float | None) -> str:
    return "—" if x is None else f"{100 * x:.1f} %"


def _cv_tar(metrics: dict, far: str) -> str:
    cv = (metrics.get("validacion_cruzada") or {}).get("tar", {}).get(far)
    return f"{pct(cv['tar'])} (FAR {cv['far_observado']:.1e})" if cv else "—"


def write_report(payload: dict) -> None:
    base = payload["linea_base_opcion_b"]
    far = "0.001"
    base_tar = base["tar"].get(far)
    # Mediciones anteriores a la correccion del umbral (2026-10-09) no traen far_real ni la
    # validacion cruzada: sus umbrales aceptan un impostor de mas y sus calidades son de una sola foto.
    legacy = base_tar is not None and "far_real" not in base_tar
    measured_size = payload.get("produccion_actual", {}).get("tamano")
    lines = [
        "# Costo biometrico de meter la foto en el QR (ADR-16)",
        "",
        "**Generado por** `backend/scripts/biometric_degradation.py`. No editar a mano.",
        "",
        f"Modelo: `{payload['modelo']['archivo']}` ({payload['modelo']['dimensiones_vector']} dimensiones). "
        f"Pares medidos: {payload['conjunto']['pares_usados']}.",
        "",
    ]
    if legacy:
        lines += [
            "> **⚠ Medicion anterior a la correccion del 2026-10-09; hay que volver a medir.** Sus umbrales",
            "> a FAR fijo aceptan un impostor de mas (a FAR 1e-3 con 3000 impostores, el FAR real es",
            "> 1,33e-3), asi que los TAR de abajo son algo optimistas; el umbral se eligio sobre los mismos",
            "> impostores con que se mide (sin validacion cruzada), y la calidad, los bytes y los caracteres",
            "> de QR son los de la ultima foto procesada, no una mediana. EER y AUC no cambian.",
            "",
        ]
    if measured_size and measured_size != list(PHOTO_SIZE):
        lines += [
            f"Se midio cuando produccion era {measured_size[0]}x{measured_size[1]}; la marca de produccion"
            f" de la tabla sigue la configuracion actual del emisor ({PHOTO_SIZE[0]}x{PHOTO_SIZE[1]},"
            f" {PHOTO_MAX_BYTES} B).",
            "",
        ]
    lines += [
        "## Linea base: opcion (B), plantilla firmada por el emisor",
        "",
        "El emisor calcula el vector desde el retrato original sin degradar, asi que esta fila es el",
        "techo alcanzable y el valor de referencia contra el que se mide todo lo demas.",
        "",
        f"- TAR a FAR 1e-3: **{pct(base_tar['tar']) if base_tar else '—'}**"
        + (f" (FAR real {base_tar['far_real']:.1e})" if base_tar and "far_real" in base_tar else ""),
        f"- TAR a FAR 1e-3 con el umbral elegido fuera de cada fold: {_cv_tar(base, far)}",
        f"- EER: {pct(base['eer']['valor'])} (umbral {base['eer']['umbral']:.3f})",
        f"- AUC: {base['auc']:.4f}",
        f"- Similitud media: genuinos {base['media_genuinos']:.3f}, impostores {base['media_impostores']:.3f}",
        "",
        "## Opcion (A): comparar contra la foto del QR",
        "",
    ]
    if not legacy:
        lines += [
            "Calidad y bytes son la mediana por foto; los caracteres de QR, los de la foto mas grande (el QR",
            "tiene que caber en el peor caso). La columna validada elige el umbral en 9 folds de LFW y lo",
            "mide en el decimo, y muestra el FAR que resulto en caras no vistas.",
            "",
        ]
    lines += [
        "| Configuracion | Calidad WebP | Bytes de foto (mediana / max) | Caracteres de QR (max) | Fotos que caben"
        " | TAR @ FAR 1e-3 | TAR @ FAR 1e-3 validado | EER | AUC |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    total = base["n_genuinos"] + base["n_impostores"]
    partial = []
    for row in payload["variantes_opcion_a"]:
        label = row["configuracion"] + (" **(produccion actual)**" if is_production(row) else "")
        if not row["cabe"]:
            lines.append(f"| {label} | no cabe para ninguna | — | — | 0 % | — | — | — | — |")
            continue
        used = row["n_genuinos"] + row["n_impostores"]
        share = used / total
        tar = row["tar"].get(far)
        note = ""
        if share < 0.95:
            note = " ⚠"
            partial.append((row["configuracion"], share, used))
        lines.append(
            f"| {label}{note} | {row['calidad_webp']} | {row['bytes_foto']} / {row.get('bytes_foto_max', '—')} | "
            f"{row.get('caracteres_qr_max', '—')} | {100 * share:.0f} %{note} | {pct(tar['tar']) if tar else '—'} | "
            f"{_cv_tar(row, far)} | {pct(row['eer']['valor'])} | {row['auc']:.4f} |"
        )
    lines += [
        "",
        f"FAR minimo resoluble con la muestra completa: {base['far_minimo_resoluble']:.1e} "
        f"({base['n_impostores']} pares impostores). Un TAR en blanco significa que esa fila tiene"
        " muy pocos impostores para resolver ese FAR.",
        "",
    ]
    if partial:
        lines += [
            "> **⚠ Filas no comparables.** El compresor del emisor no logra meter toda foto en todo",
            "> presupuesto: cuando no cabe, ese par se descarta **solo para esa configuracion**, asi que",
            "> la fila queda medida sobre un subconjunto distinto y sesgado (justamente las fotos que",
            "> mas se comprimen). Su TAR, EER y AUC **no** se pueden comparar con el resto ni con la",
            "> linea base. Mas importante: una configuracion que no admite la mayoria de las fotos no es",
            "> una opcion de produccion, aunque su AUC se vea bien. Afectadas:",
            "",
        ]
        for key, share, used in partial:
            lines.append(f"> - `{key}`: solo {100 * share:.0f} % de las fotos caben ({used} de {total} pares)")
        lines.append("")
    lines += [
        "## Como leer esto",
        "",
        "La fila marcada como produccion actual es lo que hoy entrega el emisor. La distancia entre",
        "esa fila y la linea base es el costo de la restriccion de tamano del QR: si es chica, ADR-16",
        "se implementa con la opcion (A) y no se toca el formato de la credencial; si es grande, el",
        "numero justifica la opcion (B), con su costo de ataduras de modelo y cambio de formato.",
        "",
        "## Limites",
        "",
    ]
    lines += [f"{i}. {limit}" for i, limit in enumerate(payload["limites"], 1)]
    lines.append("")
    (RESULTS_DIR / "biometric-degradation.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
