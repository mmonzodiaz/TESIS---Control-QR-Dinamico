"""Chequeos del modelo de colas (scripts/queue_model.py) contra resultados conocidos."""

import math
import random

from scripts.queue_model import LaneGroup, plan, simulate_lane


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


def test_plan_with_zero_adoption_uses_all_lanes_manually():
    result = plan(arrivals=5, lanes=45, manual_s=8, qr_s=3, cv=0.5, adoption=0)
    assert [g["kind"] for g in result["groups"]] == ["manual"]
    assert result["groups"][0]["lanes"] == 45


def test_plan_splits_lanes_and_keeps_both_groups_stable():
    result = plan(arrivals=5, lanes=45, manual_s=8, qr_s=3, cv=0.5, adoption=0.6)
    assert sum(g["lanes"] for g in result["groups"]) == 45
    assert all(g["rho"] < 1 for g in result["groups"])
