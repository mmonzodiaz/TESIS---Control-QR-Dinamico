"""El experimento de ataque (scripts/attack_experiment.py) como test: fija la matriz de resultados
que respalda la afirmacion central de la tesis (docs/attack-experiment.md)."""

import pytest

from helpers import ISSUER_SECRET
from scripts.attack_experiment import run_experiment, summarize


@pytest.fixture(scope="module")
def result():
    from fastapi.testclient import TestClient

    from app.main import app

    return run_experiment(TestClient(app), ISSUER_SECRET)


def test_static_card_qr_falls_to_copies_while_dynamic_qr_only_falls_to_relay(result):
    by_key = {r["key"]: r for r in result["rows"]}

    def attempt(key: str, mode: str) -> dict:
        return by_key[key][mode]["attempt"]

    # Ninguno de los dos modos rechaza al titular legitimo, y su foto coincide.
    for mode in ("estatico", "dinamico"):
        assert attempt("control", mode)["granted"] and attempt("control", mode)["photo_matches"]

    # Copias reutilizadas despues: pasan con el QR estatico, se bloquean con el dinamico.
    for key in ("photo_60s", "photo_1h", "other_event"):
        assert attempt(key, "estatico")["granted"], key
        assert not attempt(key, "dinamico")["granted"], key
        # Y con el dinamico el titular legitimo sigue pudiendo entrar.
        assert by_key[key]["dinamico"]["holder_after"]["granted"], key

    # Reenvio en tiempo real: pasa la validacion automatica en ambos modos...
    assert attempt("relay", "estatico")["passes_system"] and attempt("relay", "dinamico")["passes_system"]
    # ...pero con el QR dinamico el guardia ve la foto firmada del titular y lo rechaza (dos pasos,
    # ADR-12), sin consumir la entrada: el titular entra despues. Con el carnet falso, la foto es la
    # del propio atacante y el titular queda afuera.
    assert attempt("relay", "dinamico")["reason"] == "photo_mismatch"
    assert by_key["relay"]["dinamico"]["holder_after"]["granted"]
    assert attempt("relay", "estatico")["granted"] and attempt("relay", "estatico")["photo_matches"] is True
    assert not by_key["relay"]["estatico"]["holder_after"]["granted"]

    # Copia usada despues de que el titular entro: ambos la bloquean (admision unica).
    assert not attempt("after_holder", "estatico")["granted"] and not attempt("after_holder", "dinamico")["granted"]

    summary = summarize(result)
    assert summary["estatico"]["attacks_succeeded"] == 4
    assert summary["dinamico"]["attacks_succeeded"] == 1
    assert summary["estatico"]["attacks_succeeded_with_photo_check"] == 4
    assert summary["dinamico"]["attacks_succeeded_with_photo_check"] == 0


def test_ban_filter_is_evaded_with_copies_only_in_static_mode(result):
    by_key = {r["key"]: r for r in result["ban_rows"]}

    def attempt(key: str, mode: str) -> dict:
        return by_key[key][mode]["attempt"]

    # Con su propia credencial, la persona sancionada queda afuera en ambos modos.
    for mode in ("estatico", "dinamico"):
        assert not attempt("ban_own", mode)["granted"]
        assert attempt("ban_own", mode)["reason"] == "banned"

    # Con la copia del QR de un tercero: el carnet deja pasar (carnet falso con la foto del
    # sancionado), el QR dinamico no.
    assert attempt("ban_copy", "estatico")["granted"] and attempt("ban_copy", "estatico")["photo_matches"]
    assert not attempt("ban_copy", "dinamico")["granted"]

    # Con la cooperacion de un tercero pasa la validacion automatica en ambos modos, pero la foto
    # que ve el guardia es la del tercero: ADR-10 cierra este caso si el guardia compara bien.
    for mode in ("estatico", "dinamico"):
        assert attempt("ban_lent", mode)["passes_system"]
        assert attempt("ban_lent", mode)["photo_matches"] is False
    assert attempt("ban_lent", "dinamico")["reason"] == "photo_mismatch"

    summary = summarize(result)
    assert summary["estatico"]["ban_evasions_succeeded_with_photo_check"] == 1
    assert summary["dinamico"]["ban_evasions_succeeded_with_photo_check"] == 0
