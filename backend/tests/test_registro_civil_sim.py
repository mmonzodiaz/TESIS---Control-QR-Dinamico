"""El padron y las claves del Registro Civil simulado bajo concurrencia (auditoria del 2026-10-09).

El servicio atiende en paralelo: sin candado, dos enrolamientos a la vez leian la misma version del
padron y uno borraba la cedula que el otro acababa de emitir, que despues nunca se podia revocar. Y
las claves publicas se reescribian en cada solicitud, asi que el backend del recinto podia leerlas
vacias a mitad de la escritura."""

import json
import threading

from app.credential import ed25519_public, new_secret_key
from app.rut import check_digit
from scripts.registro_civil_sim import (
    PADRON_FILE,
    PUBLIC_KEY_FILE,
    VERIFIER_PUBLIC_KEY_FILE,
    add_person,
    compress_photo,
    demo_avatar,
    enroll,
    ensure_issuer_keys,
    load_padron,
    report_loss,
    save_padron,
)


def run_together(workers: list) -> list[BaseException]:
    """Arranca todos los hilos a la vez (barrera) y devuelve las excepciones que hayan levantado."""
    barrier = threading.Barrier(len(workers))
    errors: list[BaseException] = []

    def wrap(work):
        def run():
            barrier.wait()
            try:
                work()
            except BaseException as exc:  # noqa: BLE001 - se reportan en el assert
                errors.append(exc)

        return run

    threads = [threading.Thread(target=wrap(w)) for w in workers]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return errors


def test_concurrent_enrollments_never_lose_an_issued_credential(tmp_path):
    ensure_issuer_keys(tmp_path)
    photo = compress_photo(demo_avatar("padron"))
    people = [(f"{10_000_000 + i}", f"CLAVE{i:03d}") for i in range(12)]
    ruts = []
    for body, code in people:
        rut = f"{body}-{check_digit(body)}"
        add_person(f"Persona {body}", rut, photo, code, tmp_path)
        ruts.append((rut, code))
    rounds = 4

    def enroll_many(rut: str, code: str):
        def work():
            for _ in range(rounds):
                assert enroll(rut, code, ed25519_public(new_secret_key()), tmp_path) is not None

        return work

    assert run_together([enroll_many(rut, code) for rut, code in ruts]) == []
    padron = load_padron(tmp_path)
    for rut, _ in ruts:
        credentials = padron[rut.replace("-", "")]["credentials"]
        # Cada emision queda registrada: una sola activa y las anteriores revocadas como reemplazadas.
        assert len(credentials) == rounds, rut
        assert sum(1 for c in credentials if c["revoked_at"] is None) == 1, rut


def test_a_loss_report_racing_an_enrollment_leaves_every_credential_in_the_padron(tmp_path):
    """El caso de la auditoria: un ladron enrola mientras el dueno reporta la perdida. La emision del
    ladron no puede desaparecer del padron, porque entonces nunca entraria en la lista de revocadas."""
    ensure_issuer_keys(tmp_path)
    add_person("Duena", "11111111-1", compress_photo(demo_avatar("d")), "DUENA234", tmp_path)
    workers = [lambda: enroll("11111111-1", "DUENA234", ed25519_public(new_secret_key()), tmp_path) for _ in range(6)]
    workers += [lambda: report_loss("11111111-1", "DUENA234", tmp_path) for _ in range(6)]
    assert run_together(workers) == []
    assert len(load_padron(tmp_path)["111111111"]["credentials"]) == 6


def test_readers_never_see_a_half_written_padron(tmp_path):
    save_padron({"x": {"credentials": list(range(2000))}}, tmp_path)
    path = tmp_path / PADRON_FILE
    stop = threading.Event()
    bad: list[str] = []

    def writer():
        for i in range(150):
            save_padron({"x": {"credentials": list(range(2000 + i))}}, tmp_path)
        stop.set()

    def reader():
        while not stop.is_set():
            try:
                json.loads(path.read_text(encoding="utf-8"))
            except PermissionError:
                pass  # Windows: el archivo se estaba reemplazando justo en ese instante
            except (json.JSONDecodeError, FileNotFoundError) as exc:
                bad.append(repr(exc))

    assert run_together([writer, reader, reader]) == []
    assert bad == []
    assert not list(tmp_path.glob("*.tmp")), "no deben quedar temporales"


def test_public_keys_are_written_once_not_on_every_request(tmp_path):
    secret = ensure_issuer_keys(tmp_path)
    public = tmp_path / PUBLIC_KEY_FILE
    verifier = tmp_path / VERIFIER_PUBLIC_KEY_FILE
    stamps = (public.stat().st_mtime_ns, verifier.stat().st_mtime_ns)
    for _ in range(5):
        assert ensure_issuer_keys(tmp_path) == secret
    assert (public.stat().st_mtime_ns, verifier.stat().st_mtime_ns) == stamps

    # Si falta o no corresponde a la privada, se repone.
    public.unlink()
    verifier.write_text("otra clave")
    ensure_issuer_keys(tmp_path)
    assert public.exists() and verifier.read_text() != "otra clave"


def test_first_concurrent_requests_agree_on_a_single_issuer_key(tmp_path):
    secrets_seen: list[bytes] = []
    errors = run_together([lambda: secrets_seen.append(ensure_issuer_keys(tmp_path)) for _ in range(8)])
    assert errors == []
    assert len(set(secrets_seen)) == 1
