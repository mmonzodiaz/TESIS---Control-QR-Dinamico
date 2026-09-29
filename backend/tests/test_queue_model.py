"""Chequeos del modelo de colas (scripts/queue_model.py) contra resultados conocidos."""

import math
import random

from scripts.queue_model import LaneGroup, simulate_lane


def test_pollaczek_khinchine_reduces_to_mm1_when_cv_is_one():
    # M/M/1: Wq = rho / (mu - lambda). Con lambda = 0.1/s y E[S] = 8 s: rho = 0.8, Wq = 32 s.
    lane = LaneGroup("manual", lanes=1, arrivals_per_s=0.1, service_s=8, cv=1)
    assert math.isclose(lane.wq_s(), 0.8 / (1 / 8 - 0.1))


def test_deterministic_service_halves_mm1_wait():
    # M/D/1 (cv = 0) espera exactamente la mitad que M/M/1 con la misma carga.
    exp = LaneGroup("x", 1, 0.1, 8, cv=1).wq_s()
    det = LaneGroup("x", 1, 0.1, 8, cv=0).wq_s()
    assert math.isclose(det, exp / 2)


def test_overloaded_lane_is_unstable():
    assert math.isinf(LaneGroup("x", 1, 0.2, 8, cv=0.5).wq_s())


def test_little_law_people_waiting():
    lane = LaneGroup("x", lanes=3, arrivals_per_s=0.3, service_s=8, cv=0.5)
    assert math.isclose(lane.lq_per_lane(), 0.1 * lane.wq_s())


def test_simulation_matches_formula():
    rng = random.Random(1)
    analytic = LaneGroup("x", 1, 0.1, 8, cv=0.5).wq_s()
    simulated = simulate_lane(0.1, 8, 0.5, 100_000, rng)
    assert abs(simulated - analytic) / analytic < 0.08


def test_preferential_lane_meets_target_and_reports_cost_for_majority():
    from scripts.queue_model import PREFERENTIAL_TARGET_WQ_S, TOTAL_LANES, preferential_lane

    result = preferential_lane(adoption=0.05, overhead_s=0.024)
    assert result["digital_wq_s"] <= PREFERENTIAL_TARGET_WQ_S
    assert 0 < result["digital_lanes"] < TOTAL_LANES
    # Dar mas filas por persona a la minoria digital empeora la fila normal si no se agregan guardias.
    assert result["normal_wq_s"] > result["base_wq_s"]
    assert result["extra_lanes_to_protect_normal"] > 0
    # Mismo tramite humano en ambas filas: la ventaja no viene de una verificacion mas rapida.
    assert result["digital_service_s"] >= 8
