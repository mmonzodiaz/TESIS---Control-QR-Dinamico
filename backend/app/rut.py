"""Normalizacion y validacion de RUT chileno (digito verificador modulo 11)."""


def normalize_rut(raw: str) -> str:
    """'12.345.678-k' -> '12345678K'. No valida."""
    return raw.replace(".", "").replace("-", "").replace(" ", "").strip().upper()


def check_digit(body: str) -> str:
    total, factor = 0, 2
    for digit in reversed(body):
        total += int(digit) * factor
        factor = 2 if factor == 7 else factor + 1
    rest = 11 - total % 11
    return {11: "0", 10: "K"}.get(rest, str(rest))


def is_valid_rut(raw: str) -> bool:
    rut = normalize_rut(raw)
    if len(rut) < 2:
        return False
    body, dv = rut[:-1], rut[-1]
    return body.isdigit() and 1 <= len(body) <= 8 and check_digit(body) == dv


def mask_rut(normalized: str) -> str:
    """Muestra solo el primer grupo y el DV al guardia: '12345678K' -> '12.***.***-K'."""
    body, dv = normalized[:-1], normalized[-1]
    return f"{body[:-6] or body[:1]}.***.***-{dv}"
