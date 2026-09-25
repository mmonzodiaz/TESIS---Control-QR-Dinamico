// Mismo algoritmo que backend/app/rut.py (digito verificador modulo 11). Se valida en el
// cliente solo para dar feedback inmediato; la validacion que cuenta es la del servidor.

export function normalizeRut(raw: string): string {
  return raw.replace(/[.\-\s]/g, "").toUpperCase();
}

export function checkDigit(body: string): string {
  let total = 0;
  let factor = 2;
  for (const digit of [...body].reverse()) {
    total += Number(digit) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (total % 11);
  return rest === 11 ? "0" : rest === 10 ? "K" : String(rest);
}

export function isValidRut(raw: string): boolean {
  const rut = normalizeRut(raw);
  const body = rut.slice(0, -1);
  return /^\d{1,8}$/.test(body) && checkDigit(body) === rut.slice(-1);
}

/** "123456785" -> "12.345.678-5" (formatea mientras se escribe). */
export function formatRut(raw: string): string {
  const rut = normalizeRut(raw).replace(/[^0-9K]/g, "");
  if (rut.length < 2) return rut;
  const body = rut.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${body}-${rut.slice(-1)}`;
}
