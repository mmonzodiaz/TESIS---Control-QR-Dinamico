"""Modelo de colas: ¿cuanto cuesta en la fila la seguridad del QR dinamico? (docs/queue-model.md)

Pregunta principal: hoy en eventos masivos se lee el QR (estatico) del carnet fisico y se hace
verificacion visual. El QR dinamico mantiene ese mismo tramite humano y agrega una validacion en
linea contra el servidor. ¿Cuanto alarga eso las filas?

Cada fila fisica es una cola M/G/1 independiente (llegadas Poisson, servicio general, un guardia).
Para M/G/1 la espera media en cola es exacta (Pollaczek-Khinchine):

    Wq = rho * E[S] * (1 + Cs^2) / (2 * (1 - rho)),   rho = lambda_fila * E[S]

y por la ley de Little  Lq = lambda_fila * Wq  (personas esperando en esa fila).
Las formulas se contrastan con una simulacion de eventos discretos (recursion de Lindley).

El tiempo humano de servicio es un SUPUESTO ilustrativo (debe cronometrarse en terreno); por eso
se entrega sensibilidad. Lo que si es medido es la latencia del servidor
(docs/results/load-test.json), que se suma al servicio en la modalidad QR dinamico.

Uso (desde backend/):  uv run python scripts/queue_model.py
Escribe docs/results/queue-model.json y docs/results/queue-model.md.
"""

import json
import math
import pathlib
import random
import statistics
import sys
from dataclasses import dataclass

# En Windows, la consola por defecto usa cp1252 y no puede imprimir rho/flecha/grado del
# reporte final; los archivos ya se escriben en UTF-8 (write_text), esto solo evita que el
# print de abajo truene con UnicodeEncodeError.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

RESULTS_DIR = pathlib.Path(__file__).resolve().parents[2] / "docs" / "results"

# --- Escenario (SUPUESTOS ilustrativos; ver docs/queue-model.md §2.2) ----------------------
ARRIVALS_PER_S = 5.0  # 18.000 personas en la hora punta de ingreso
TOTAL_LANES = 45  # filas con guardia
HUMAN_SERVICE_S = 8.0  # leer QR + verificacion visual; igual en ambas modalidades
SERVICE_CV = 0.5  # coeficiente de variacion del tiempo de servicio
HUMAN_SERVICE_SWEEP = (6.0, 7.0, 8.0, 8.5)

# --- Fila de cedula digital (preferente, incentivo a la adopcion) --------------------------
# Mismo tiempo humano que la fila normal: la tesis no sostiene que la verificacion sea mas
# rapida, sino mas dificil de falsear. La ventaja en la fila viene solo de que pocos tienen la
# cedula digital y se les asignan mas filas por persona (como una fila preferente).
DIGITAL_ADOPTION_SWEEP = (0.02, 0.05, 0.10, 0.20, 0.30)
PREFERENTIAL_TARGET_WQ_S = 5.0  # espera maxima objetivo en la fila digital

SIM_CUSTOMERS = 200_000
SIM_SEED = 20260925


@dataclass
class LaneGroup:
    kind: str
    lanes: int
    arrivals_per_s: float  # total del grupo
    service_s: float
    cv: float

    @property
    def rho(self) -> float:
        return self.arrivals_per_s / self.lanes * self.service_s

    def wq_s(self) -> float:
        if self.lanes == 0 or self.arrivals_per_s == 0:
            return 0.0
        rho = self.rho
        if rho >= 1:
            return math.inf
        return rho * self.service_s * (1 + self.cv**2) / (2 * (1 - rho))

    def lq_per_lane(self) -> float:
        return self.arrivals_per_s / self.lanes * self.wq_s() if self.lanes else 0.0


def load_test_overheads() -> dict:
    """Latencia de validacion por persona, en segundos, segun la prueba de carga.

    - realista: media del cliente con 1 escaner concurrente. En la punta del escenario llegan
      5 validaciones/s a un servidor que atiende ~30/s, asi que casi nunca coinciden.
    - estres: peor media observada (servidor saturado, sin pausas entre escaneos).
    - cota: peor p95 observado, usado como si fuera el tiempo de TODAS las validaciones.
    """
    path = RESULTS_DIR / "load-test.json"
    if not path.exists():
        raise SystemExit("Falta docs/results/load-test.json: correr primero scripts/load_test.py")
    levels = json.loads(path.read_text(encoding="utf-8"))["levels"]
    lowest = min(levels, key=lambda level: level["concurrency"])
    return {
        "realista": lowest["client_mean_ms"] / 1000,
        "estres": max(level["client_mean_ms"] for level in levels) / 1000,
        "cota": max(level["client_p95_ms"] for level in levels) / 1000,
        "capacity_admissions_per_s": min(level["admissions_per_s"] for level in levels),
    }


def single_group(arrivals: float, lanes: int, service_s: float, cv: float, kind: str = "fila") -> LaneGroup:
    return LaneGroup(kind, lanes, arrivals, service_s, cv)


def lanes_to_match(arrivals: float, service_s: float, cv: float, target_wq: float, start: int) -> int:
    """Menor numero de filas cuya espera no supera `target_wq`."""
    lanes = start
    while single_group(arrivals, lanes, service_s, cv).wq_s() > target_wq:
        lanes += 1
    return lanes


def preferential_lane(adoption: float, overhead_s: float) -> dict:
    """Fila de cedula digital (preferente) para la minoria que la tiene.

    Asigna a la fila digital el minimo de filas que deja su espera bajo el objetivo; el resto
    atiende al publico general. Informa cuanto empeora la fila normal y cuantas filas (guardias)
    extra harian falta para que la fila normal no empeore respecto de la linea base.
    """
    base = single_group(ARRIVALS_PER_S, TOTAL_LANES, HUMAN_SERVICE_S, SERVICE_CV)
    digital_arrivals = ARRIVALS_PER_S * adoption
    normal_arrivals = ARRIVALS_PER_S - digital_arrivals
    digital_s = HUMAN_SERVICE_S + overhead_s

    digital_lanes = 1
    while single_group(digital_arrivals, digital_lanes, digital_s, SERVICE_CV).wq_s() > PREFERENTIAL_TARGET_WQ_S:
        digital_lanes += 1
    digital = single_group(digital_arrivals, digital_lanes, digital_s, SERVICE_CV)
    normal = single_group(normal_arrivals, TOTAL_LANES - digital_lanes, HUMAN_SERVICE_S, SERVICE_CV)
    extra = lanes_to_match(normal_arrivals, HUMAN_SERVICE_S, SERVICE_CV, base.wq_s(), TOTAL_LANES - digital_lanes) - (
        TOTAL_LANES - digital_lanes
    )
    # Reparto proporcional (sin incentivo): misma utilizacion en ambos grupos.
    proportional_lanes = max(1, round(TOTAL_LANES * adoption))
    return {
        "adoption": adoption,
        "digital_arrivals_per_s": digital_arrivals,
        "digital_service_s": digital_s,
        "digital_lanes": digital_lanes,
        "proportional_lanes": proportional_lanes,
        "digital_rho": digital.rho,
        "digital_wq_s": digital.wq_s(),
        "digital_lq": digital.lq_per_lane(),
        "normal_rho": normal.rho,
        "normal_wq_s": normal.wq_s(),
        "normal_lq": normal.lq_per_lane(),
        "base_wq_s": base.wq_s(),
        "extra_lanes_to_protect_normal": extra,
    }


def simulate_lane(arrivals_per_s: float, service_s: float, cv: float, n: int, rng: random.Random) -> float:
    """Espera media en cola de una M/G/1 (servicio Gamma) via recursion de Lindley."""
    shape = 1 / cv**2
    scale = service_s / shape
    wait = 0.0
    waits = []
    prev_service = 0.0
    for i in range(n):
        interarrival = rng.expovariate(arrivals_per_s)
        wait = max(0.0, wait + prev_service - interarrival) if i else 0.0
        waits.append(wait)
        prev_service = rng.gammavariate(shape, scale)
    return statistics.fmean(waits[n // 10 :])  # descarta 10% inicial (calentamiento)


def fmt(x: float, digits: int = 1) -> str:
    return "inestable" if math.isinf(x) else f"{x:.{digits}f}"


def security_cost(overheads: dict) -> list[dict]:
    rows = []
    for human_s in HUMAN_SERVICE_SWEEP:
        base = single_group(ARRIVALS_PER_S, TOTAL_LANES, human_s, SERVICE_CV)
        row = {"human_s": human_s, "base_rho": base.rho, "base_wq_s": base.wq_s(), "base_lq": base.lq_per_lane()}
        for name in ("realista", "estres", "cota"):
            dyn = single_group(ARRIVALS_PER_S, TOTAL_LANES, human_s + overheads[name], SERVICE_CV)
            row[f"{name}_wq_s"] = dyn.wq_s()
            row[f"{name}_lq"] = dyn.lq_per_lane()
        row["extra_lanes_cota"] = (
            lanes_to_match(ARRIVALS_PER_S, human_s + overheads["cota"], SERVICE_CV, base.wq_s(), TOTAL_LANES) - TOTAL_LANES
            if not math.isinf(base.wq_s())
            else None
        )
        rows.append(row)
    return rows


def main() -> None:
    overheads = load_test_overheads()
    capacity = overheads["capacity_admissions_per_s"]
    rng = random.Random(SIM_SEED)

    cost = security_cost(overheads)
    preferential = [preferential_lane(a, overheads["realista"]) for a in DIGITAL_ADOPTION_SWEEP]

    # Validacion de la formula contra simulacion, en las filas usadas arriba.
    validation = []
    checks = [
        ("Carnet fisico (8 s)", ARRIVALS_PER_S / TOTAL_LANES, HUMAN_SERVICE_S),
        ("QR dinamico, cota (8 s + p95)", ARRIVALS_PER_S / TOTAL_LANES, HUMAN_SERVICE_S + overheads["cota"]),
    ] + [
        (
            f"Fila cedula digital ({r['adoption']:.0%} de adopcion)",
            r["digital_arrivals_per_s"] / r["digital_lanes"],
            r["digital_service_s"],
        )
        for r in preferential
        if r["adoption"] in (0.05, 0.30)
    ]
    for label, lane_rate, service_s in checks:
        analytic = LaneGroup("x", 1, lane_rate, service_s, SERVICE_CV).wq_s()
        simulated = simulate_lane(lane_rate, service_s, SERVICE_CV, SIM_CUSTOMERS, rng)
        validation.append({"case": label, "analytic_wq_s": analytic, "simulated_wq_s": simulated})

    payload = {
        "assumptions": {
            "arrivals_per_s": ARRIVALS_PER_S,
            "total_lanes": TOTAL_LANES,
            "human_service_s": HUMAN_SERVICE_S,
            "service_cv": SERVICE_CV,
            "preferential_target_wq_s": PREFERENTIAL_TARGET_WQ_S,
        },
        "server_overheads_s": overheads,
        "server_utilization_at_peak": ARRIVALS_PER_S / capacity,
        "security_cost": cost,
        "validation": validation,
        "preferential_lane": preferential,
    }
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / "queue-model.json").write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")

    o = overheads
    lines = [
        "# Resultados del modelo de colas (generado)",
        "",
        "Generado por `backend/scripts/queue_model.py`. No editar a mano. Metodo y supuestos en `docs/queue-model.md`.",
        "",
        "## Supuestos",
        "",
        f"- Llegadas en hora punta: {ARRIVALS_PER_S} personas/s ({ARRIVALS_PER_S * 3600:,.0f}/h), Poisson; {TOTAL_LANES} filas con guardia",
        f"- Tiempo humano de servicio (leer QR + verificacion visual), **igual en ambas modalidades**: {HUMAN_SERVICE_S} s, CV {SERVICE_CV} — **supuesto**",
        "- Latencia del servidor sumada al QR dinamico (medida, `load-test.json`):",
        f"  - realista {o['realista'] * 1000:.0f} ms (media con 1 escaner concurrente),",
        f"  - estres {o['estres'] * 1000:.0f} ms (peor media, servidor saturado),",
        f"  - cota {o['cota'] * 1000:.0f} ms (peor p95 aplicado a todas las validaciones)",
        "",
        "## 1. Costo en la fila de la validacion en linea",
        "",
        "Espera media en cola Wq (s) y personas esperando por fila Lq, por tiempo humano de servicio.",
        "",
        "| Servicio humano (s) | ρ carnet | Carnet fisico Wq / Lq | QR dinamico realista Wq / Lq | QR dinamico estres Wq / Lq | QR dinamico cota Wq / Lq | Filas extra para igualar (cota) |",
        "|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for r in cost:
        lines.append(
            f"| {r['human_s']:.1f} | {r['base_rho']:.2f} | {fmt(r['base_wq_s'])} / {fmt(r['base_lq'])} | "
            f"{fmt(r['realista_wq_s'])} / {fmt(r['realista_lq'])} | {fmt(r['estres_wq_s'])} / {fmt(r['estres_lq'])} | "
            f"{fmt(r['cota_wq_s'])} / {fmt(r['cota_lq'])} | {r['extra_lanes_cota'] if r['extra_lanes_cota'] is not None else '—'} |"
        )
    lines += [
        "",
        "## 2. Capacidad del servidor",
        "",
        f"Demanda en punta: {ARRIVALS_PER_S:.1f} validaciones/s. Capacidad medida (peor nivel): {capacity:.1f} ingresos/s → "
        f"utilizacion **{ARRIVALS_PER_S / capacity:.0%}**.",
        "",
        "## 3. Validacion: Pollaczek-Khinchine vs. simulacion",
        "",
        f"Recursion de Lindley, servicio Gamma, {SIM_CUSTOMERS:,} personas por fila, semilla {SIM_SEED}.",
        "",
        "| Caso | Wq analitico (s) | Wq simulado (s) | Diferencia |",
        "|---|---:|---:|---:|",
    ]
    for v in validation:
        diff = (v["simulated_wq_s"] - v["analytic_wq_s"]) / v["analytic_wq_s"] if v["analytic_wq_s"] else 0
        lines.append(f"| {v['case']} | {fmt(v['analytic_wq_s'], 2)} | {v['simulated_wq_s']:.2f} | {diff:+.1%} |")

    lines += [
        "",
        "## 4. Fila de cedula digital (preferente, incentivo a la adopcion)",
        "",
        f"Mismo tiempo humano en ambas filas ({HUMAN_SERVICE_S:.0f} s; la digital suma la latencia realista): la verificacion "
        "no es mas rapida, es mas dificil de falsear. A la fila digital se le asigna el minimo de filas que deja su espera "
        f"bajo {PREFERENTIAL_TARGET_WQ_S:.0f} s; el resto atiende al publico general. "
        f"Linea base (todas normales): {fmt(preferential[0]['base_wq_s'])} s de espera.",
        "",
        "| Adopcion digital | Filas digitales (proporcional) | Espera fila digital (s) / personas | Espera fila normal (s) / personas | Filas extra para que la normal no empeore |",
        "|---:|---:|---:|---:|---:|",
        *[
            f"| {r['adoption']:.0%} | {r['digital_lanes']} ({r['proportional_lanes']}) | "
            f"{fmt(r['digital_wq_s'])} / {fmt(r['digital_lq'])} | {fmt(r['normal_wq_s'])} / {fmt(r['normal_lq'])} | "
            f"{r['extra_lanes_to_protect_normal']} |"
            for r in preferential
        ],
        "",
    ]
    (RESULTS_DIR / "queue-model.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
