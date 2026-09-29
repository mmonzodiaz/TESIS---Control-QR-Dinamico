import { describe, expect, it } from "vitest";
import vectors from "../../backend/tests/vectors/qr-v1.json";
import {
  isValidPin,
  MAX_PIN_ATTEMPTS,
  newWallet,
  openWallet,
  PIN_LOCKOUT_MS,
  registerPinFailure,
  sealWallet,
  WrongPinError,
} from "./wallet";

// Pocas iteraciones de PBKDF2 para que el test sea rapido; el formato es el mismo.
const FAST = 1000;

describe("billetera protegida con PIN", () => {
  it("guarda la cedula y la clave del dispositivo cifradas, y las recupera con el PIN correcto", async () => {
    const wallet = newWallet(vectors.credential);
    expect(wallet.deviceSecret).toHaveLength(32);

    const sealed = await sealWallet("482913", wallet, FAST);
    // Lo guardado no deja ver nombre, RUT ni foto.
    const stored = JSON.stringify(sealed);
    expect(stored).not.toContain(vectors.credential.photo.slice(0, 40));
    expect(stored).not.toContain(vectors.credential.core);

    const opened = await openWallet("482913", sealed);
    expect(opened.identity.name).toBe(vectors.core.name);
    expect(opened.credential.photo).toEqual(wallet.credential.photo);
    expect(opened.deviceSecret).toEqual(wallet.deviceSecret);
  });

  it("rechaza un PIN incorrecto", async () => {
    const sealed = await sealWallet("111111", newWallet(vectors.credential), FAST);
    await expect(openWallet("111112", sealed)).rejects.toBeInstanceOf(WrongPinError);
  });

  it("cada telefono enrolado tiene su propia clave de dispositivo", () => {
    expect(newWallet(vectors.credential).deviceSecret).not.toEqual(newWallet(vectors.credential).deviceSecret);
  });

  it("acepta solo PIN de 6 digitos", () => {
    expect(isValidPin("123456")).toBe(true);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("12345a")).toBe(false);
  });

  it("bloquea el ingreso de PIN tras varios fallos seguidos", () => {
    let attempts = { failures: 0, lockedUntil: 0 };
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) {
      attempts = registerPinFailure(attempts, 1000);
      expect(attempts.lockedUntil).toBe(0);
    }
    attempts = registerPinFailure(attempts, 1000);
    expect(attempts.lockedUntil).toBe(1000 + PIN_LOCKOUT_MS);
  });
});
