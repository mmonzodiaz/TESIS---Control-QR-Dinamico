"""El experimento de degradacion biometrica (scripts/biometric_degradation.py), en lo que se puede
probar sin el modelo ONNX ni el conjunto de rostros: que la foto degradada sea EXACTAMENTE la que
el emisor pone en el QR, que el tamano de QR calculado cuadre con el vector de prueba, y que las
metricas ROC esten bien. Si cualquiera de estas falla, la curva que mida el experimento no
representa al sistema (ADR-16)."""

import base64
import io
import json
import pathlib

import pytest
from PIL import Image

from scripts.biometric_degradation import (
    BUDGETS,
    PREPROCESSING,
    SIZES,
    check_fidelity,
    fit_photo,
    qr_payload_chars,
    roc_metrics,
    sanity_gate,
)
from scripts.registro_civil_sim import PHOTO_MAX_BYTES, PHOTO_SIZE, compress_photo, demo_avatar

VECTOR = pathlib.Path(__file__).parent / "vectors" / "qr-v2.json"


@pytest.fixture(scope="module")
def portrait():
    return demo_avatar("11111111-1")


def test_degraded_photo_is_byte_identical_to_what_the_issuer_puts_in_the_qr(portrait):
    mine = fit_photo(portrait, PHOTO_SIZE, PHOTO_MAX_BYTES)
    assert mine is not None
    assert mine[0] == compress_photo(portrait)
    check_fidelity(portrait)  # no debe levantar


def test_production_config_is_one_of_the_measured_variants():
    assert tuple(PHOTO_SIZE) in SIZES
    assert PHOTO_MAX_BYTES in BUDGETS


def test_every_variant_either_fits_under_its_budget_or_is_reported_as_not_fitting(portrait):
    for size in SIZES:
        for budget in BUDGETS:
            fitted = fit_photo(portrait, size, budget)
            if fitted is None:
                continue
            photo, quality = fitted
            assert len(photo) <= budget
            assert 0 < quality <= 70
            with Image.open(io.BytesIO(photo)) as decoded:
                assert decoded.size == size


def test_bigger_budget_never_yields_a_smaller_photo_at_the_same_size(portrait):
    for size in SIZES:
        sizes_by_budget = [fit_photo(portrait, size, b) for b in sorted(BUDGETS)]
        got = [len(f[0]) for f in sizes_by_budget if f is not None]
        assert got == sorted(got)


def test_qr_length_matches_the_test_vector_within_the_name_length_difference():
    vector = json.loads(VECTOR.read_text(encoding="utf-8"))
    photo_bytes = len(base64.b64decode(vector["credential"]["photo"]))
    # El vector usa otro RUT/nombre que el largo supuesto en el script, asi que se permite holgura:
    # lo que se verifica es que el modelo del formato no este equivocado por un factor.
    assert abs(qr_payload_chars(photo_bytes) - len(vector["qr"])) < 40


def test_qr_length_grows_by_three_characters_every_two_bytes_of_photo():
    assert qr_payload_chars(400) - qr_payload_chars(200) == 300


def test_roc_metrics_on_perfectly_separable_scores():
    genuine = [0.8 + i * 0.0001 for i in range(500)]
    impostor = [0.1 + i * 0.0001 for i in range(2000)]
    m = roc_metrics(genuine, impostor, (1e-2, 1e-3, 1e-4))
    assert m["auc"] == 1.0
    assert m["eer"]["valor"] == 0.0
    assert m["tar"]["0.001"]["tar"] == 1.0
    assert m["tar"]["0.0001"] is None  # 2000 impostores no resuelven FAR 1e-4
    assert m["far_minimo_resoluble"] == pytest.approx(1 / 2000)


def test_roc_metrics_on_indistinguishable_scores():
    m = roc_metrics([0.5] * 100, [0.5] * 100, (1e-2,))
    assert m["auc"] == pytest.approx(0.5)
    assert m["eer"]["valor"] == pytest.approx(0.5)


def test_sanity_gate_lets_a_good_baseline_through_and_blocks_a_collapsed_one():
    sanity_gate(0.95, 0.80, "externo")  # no debe levantar
    with pytest.raises(SystemExit) as caught:
        sanity_gate(0.51, 0.80, "externo")
    message = str(caught.value)
    # El mensaje tiene que mandar a revisar el preprocesamiento primero: es la causa mas probable
    # y la que produce exactamente este sintoma sin dar ningun error.
    assert "--preproceso" in message
    assert "no es un hallazgo" in message


def test_both_preprocessing_modes_are_documented():
    assert set(PREPROCESSING) == {"externo", "crudo"}
    assert "127,5" in PREPROCESSING["externo"]
    assert "0-255" in PREPROCESSING["crudo"]


def test_roc_metrics_degrade_monotonically_as_distributions_overlap():
    impostor = [i / 1000 for i in range(1000)]
    aucs = [roc_metrics([0.5 + shift] * 200, impostor, (1e-2,))["auc"] for shift in (0.0, 0.2, 0.4)]
    assert aucs == sorted(aucs)
