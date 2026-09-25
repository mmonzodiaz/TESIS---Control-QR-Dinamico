import { describe, expect, it } from "vitest";
import { formatRut, isValidRut, normalizeRut } from "./rut";

describe("rut", () => {
  it("valida el digito verificador (mismos casos que backend/tests/test_tickets.py)", () => {
    expect(isValidRut("11.111.111-1")).toBe(true);
    expect(isValidRut("12345678-5")).toBe(true);
    expect(isValidRut("12345678-9")).toBe(false);
    expect(isValidRut("abc")).toBe(false);
  });

  it("acepta K minuscula", () => {
    // 10000013-K: cuerpo cuyo DV es K
    expect(isValidRut("10000013-k")).toBe(true);
  });

  it("normaliza y formatea", () => {
    expect(normalizeRut("12.345.678-k")).toBe("12345678K");
    expect(formatRut("123456785")).toBe("12.345.678-5");
    expect(formatRut("1")).toBe("1");
  });
});
