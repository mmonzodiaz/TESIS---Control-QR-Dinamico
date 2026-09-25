"""El experimento de ataque (scripts/attack_experiment.py) como test: fija la matriz de resultados
que respalda la afirmacion central de la tesis (docs/attack-experiment.md)."""

from scripts.attack_experiment import run_experiment, summarize


def test_static_card_qr_falls_to_copies_while_dynamic_qr_only_falls_to_relay(client):
    result = run_experiment(client)
    by_key = {r["key"]: r for r in result["rows"]}

    def granted(key: str, mode: str) -> bool:
        return by_key[key][mode]["attempt"]["granted"]

    # Ninguno de los dos modos rechaza al titular legitimo.
    assert granted("control", "estatico") and granted("control", "dinamico")

    # Copias reutilizadas despues: pasan con el QR estatico, se bloquean con el dinamico.
    for key in ("photo_60s", "photo_1h", "other_event"):
        assert granted(key, "estatico"), key
        assert not granted(key, "dinamico"), key
        # Y con el dinamico el titular legitimo sigue pudiendo entrar.
        assert by_key[key]["dinamico"]["holder_after"]["granted"], key

    # Riesgo residual declarado (A1): el reenvio en tiempo real pasa en ambos modos.
    assert granted("relay", "estatico") and granted("relay", "dinamico")

    # Copia usada despues de que el titular entro: ambos la bloquean (admision unica).
    assert not granted("after_holder", "estatico") and not granted("after_holder", "dinamico")

    summary = summarize(result)
    assert summary["estatico"]["attacks_succeeded"] == 4
    assert summary["dinamico"]["attacks_succeeded"] == 1


def test_ban_filter_is_evaded_with_copies_only_in_static_mode(client):
    result = run_experiment(client)
    by_key = {r["key"]: r for r in result["ban_rows"]}

    def granted(key: str, mode: str) -> bool:
        return by_key[key][mode]["attempt"]["granted"]

    # Con su propia credencial, la persona sancionada queda afuera en ambos modos.
    for mode in ("estatico", "dinamico"):
        assert not granted("ban_own", mode)
        assert by_key["ban_own"][mode]["attempt"]["reason"] == "banned"

    # Con la copia del QR de un tercero: el carnet deja pasar, el QR dinamico no.
    assert granted("ban_copy", "estatico")
    assert not granted("ban_copy", "dinamico")

    # Con la cooperacion en tiempo real de un tercero: pasa en ambos (riesgo residual, ADR-10).
    assert granted("ban_lent", "estatico") and granted("ban_lent", "dinamico")
