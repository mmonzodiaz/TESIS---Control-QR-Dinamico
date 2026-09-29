"""Emuladores del telefono (cedula digital) y del lector del guardia, para tests y experimentos.

Hacen lo mismo que frontend/src/credential.ts (mismo formato, fijado por tests/vectors/qr-v2.json):
el telefono genera el QR sin conexion con su cedula y su clave; el lector lo descifra, verifica las
firmas y la foto localmente, y luego consulta /qr/validate SIN la foto.
"""

from dataclasses import dataclass, field

from app.credential import (
    CredentialError,
    IdentityCredential,
    b64d,
    b64e,
    build_qr,
    check_qr,
    decode_qr,
    ed25519_public,
    new_secret_key,
)


@dataclass
class Phone:
    """La app de cedula digital: solo conoce la cedula, su clave y la clave de lectores."""

    credential: IdentityCredential
    device_secret: bytes
    verifier_public: bytes

    @classmethod
    def enroll(cls, rc_client, rut: str, clave: str) -> "Phone":
        """Enrolamiento contra el servicio del Registro Civil simulado (registro_civil/app.py)."""
        device_secret = new_secret_key()
        res = rc_client.post(
            "/enrolar", json={"rut": rut, "clave": clave, "device_public_key": b64e(ed25519_public(device_secret))}
        )
        res.raise_for_status()
        data = res.json()
        return cls(IdentityCredential.from_json(data), device_secret, b64d(data["verifier_public_key"]))

    def qr(self, issued_at: int | None = None, nonce: bytes | None = None) -> str:
        """QR que muestra la pantalla. `issued_at` por defecto: reloj del servidor (en los
        experimentos, el reloj simulado)."""
        from app.models import unix_now

        return build_qr(
            self.credential,
            self.device_secret,
            self.verifier_public,
            issued_at if issued_at is not None else unix_now(),
            nonce=nonce,
        )


@dataclass
class Scanner:
    client: object
    guard_token: str
    event_id: int
    headers: dict = field(init=False)
    verifier_secret: bytes = field(init=False)
    issuer_public: bytes = field(init=False)

    def __post_init__(self):
        self.headers = {"Authorization": f"Bearer {self.guard_token}"}
        res = self.client.get(f"/events/{self.event_id}/verifier", headers=self.headers)
        res.raise_for_status()
        keys = res.json()
        self.verifier_secret = b64d(keys["verifier_private_key"])
        self.issuer_public = b64d(keys["issuer_public_key"])

    def read(self, qr: str):
        """Solo la parte local. Lanza CredentialError si el QR no es legible o no es autentico."""
        contents = decode_qr(qr, self.verifier_secret)
        return contents, check_qr(contents, self.issuer_public)

    @staticmethod
    def validate_payload(contents, gate_id: int) -> dict:
        return {
            "gate_id": gate_id,
            "nonce": contents.nonce.hex(),
            "issued_at": contents.issued_at,
            "device_sig": b64e(contents.device_sig),
            "credential_core": b64e(contents.core),
            "issuer_sig": b64e(contents.issuer_sig),
        }

    def scan(self, qr: str, gate_id: int, decide=None) -> dict:
        """Lectura local + consulta en linea. Devuelve la respuesta del servidor mas lo que el
        guardia ve en pantalla (`shown`: nombre, RUT y foto que vienen firmados en el QR).

        Sin `decide`, un solo paso ("admit" directo). Con `decide(shown) -> bool` (el guardia compara
        la foto), dos pasos como el escaner real (ADR-12): "check" y luego "admit" o "reject"."""
        try:
            contents, identity = self.read(qr)
        except CredentialError as exc:
            return {"granted": False, "reason": "invalid", "local_error": str(exc), "shown": None}
        shown = {"name": identity.name, "rut": identity.rut, "photo": contents.photo}
        payload = self.validate_payload(contents, gate_id)
        if decide is not None:
            checked = self._post({**payload, "action": "check"})
            if not checked["pending"]:
                return {**checked, "shown": shown}
            payload["action"] = "admit" if decide(shown) else "reject"
        return {**self._post(payload), "shown": shown}

    def _post(self, payload: dict) -> dict:
        res = self.client.post("/qr/validate", json=payload, headers=self.headers)
        res.raise_for_status()
        return res.json()

