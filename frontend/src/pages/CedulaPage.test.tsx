// @vitest-environment jsdom
//
// Render real de la app de la cedula (CedulaPage -> CedulaView): enrolamiento con el Registro Civil
// simulado, PIN creado dos veces y QR a pantalla completa. El Registro Civil se simula con la cedula
// de los vectores compartidos con el backend, ligada a la clave de telefono de esos mismos vectores;
// el QR que muestra la pantalla se descifra con la clave de lectores, como en la puerta.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import vectors from "../../../backend/tests/vectors/qr-v2.json";
import { b64decode, checkQr, decodeQr } from "../credential";
import { CedulaPage } from "./CedulaPage";

const mocks = vi.hoisted(() => ({
  enroll: vi.fn(),
  officialTime: vi.fn(),
  revocations: vi.fn(),
  reportLoss: vi.fn(),
  shownQrs: [] as string[],
}));

vi.mock("../api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api")>();
  const { enroll, officialTime, revocations, reportLoss } = mocks;
  return { ...original, api: { ...original.api, enroll, officialTime, revocations, reportLoss } };
});
vi.mock("../credential", async (importOriginal) => {
  const original = await importOriginal<typeof import("../credential")>();
  return {
    ...original,
    // El telefono de los vectores: el Registro Civil simulado firma la cedula con su clave publica.
    newSecretKey: () => original.b64decode(vectors.device_secret),
    // Se guarda cada QR que la pantalla genera, para verificarlo con la clave de lectores.
    buildQr: (...args: Parameters<typeof original.buildQr>) => {
      const qr = original.buildQr(...args);
      mocks.shownQrs.push(qr);
      return qr;
    },
  };
});
vi.mock("../wallet", async (importOriginal) => {
  const original = await importOriginal<typeof import("../wallet")>();
  // Pocas iteraciones de PBKDF2 para que el test sea rapido; el formato es el mismo.
  return { ...original, sealWallet: (pin: string, wallet: Parameters<typeof original.sealWallet>[1]) => original.sealWallet(pin, wallet, 1000) };
});

function pressPin(pin: string) {
  for (const digit of pin) fireEvent.click(screen.getByRole("button", { name: digit }));
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.shownQrs.length = 0;
  mocks.enroll.mockResolvedValue({
    ...vectors.credential,
    verifier_public_key: vectors.verifier_public,
    server_time: Math.floor(Date.now() / 1000),
  });
  mocks.officialTime.mockResolvedValue({ server_time: Math.floor(Date.now() / 1000) });
  mocks.revocations.mockResolvedValue({ revoked: [], issued_at: Math.floor(Date.now() / 1000), sig: "" });
});

afterEach(() => cleanup());

describe("app de la cedula digital", () => {
  it("activa la cedula, crea el PIN y muestra un QR que el lector autorizado verifica", async () => {
    render(
      <MemoryRouter>
        <CedulaPage />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("RUN"), { target: { value: "11.111.111-1" } });
    fireEvent.change(screen.getByLabelText("Clave de activación"), { target: { value: "RCUNO234" } });
    fireEvent.click(screen.getByRole("button", { name: "Obtener mi cédula digital" }));

    // La cedula que entrega el Registro Civil va ligada a la clave publica de este telefono.
    expect(await screen.findByText("Crea tu PIN de 6 dígitos")).toBeTruthy();
    // (el RUN va como se escribio; el Registro Civil lo normaliza)
    expect(mocks.enroll).toHaveBeenCalledWith("11.111.111-1", "RCUNO234", vectors.device_public);
    pressPin("482913");
    expect(await screen.findByText("Repite tu PIN")).toBeTruthy();
    pressPin("482913");

    fireEvent.click(await screen.findByRole("button", { name: /Mostrar mi QR/ }));
    const dialog = await screen.findByRole("dialog", { name: "Tu código QR" });
    expect(dialog.querySelector("svg")).toBeTruthy();

    // Lo que muestra la pantalla es un QR que el lector autorizado descifra y verifica.
    expect(mocks.shownQrs.length).toBeGreaterThan(0);
    const contents = decodeQr(mocks.shownQrs.at(-1)!, b64decode(vectors.verifier_secret));
    const identity = checkQr(contents, b64decode(vectors.issuer_public));
    expect(identity.rut).toBe(vectors.core.rut);
    expect(identity.name).toBe(vectors.core.name);
    // La cedula quedo guardada cifrada con el PIN: sin nombre ni foto en claro.
    const stored = JSON.stringify({ ...localStorage });
    expect(stored).not.toContain(vectors.core.name);
    expect(stored).not.toContain(vectors.credential.photo.slice(0, 40));
  });

  it("PIN repetido distinto: vuelve a pedir crearlo", async () => {
    render(
      <MemoryRouter>
        <CedulaPage />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("RUN"), { target: { value: "11.111.111-1" } });
    fireEvent.change(screen.getByLabelText("Clave de activación"), { target: { value: "RCUNO234" } });
    fireEvent.click(screen.getByRole("button", { name: "Obtener mi cédula digital" }));
    await screen.findByText("Crea tu PIN de 6 dígitos");
    pressPin("482913");
    await screen.findByText("Repite tu PIN");
    pressPin("111111");

    expect(await screen.findByText("Los PIN no coinciden. Créalo de nuevo.")).toBeTruthy();
    expect(screen.getByText("Crea tu PIN de 6 dígitos")).toBeTruthy();
  });
});
