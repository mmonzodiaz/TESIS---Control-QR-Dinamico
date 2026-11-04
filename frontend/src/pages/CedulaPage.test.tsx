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
import { ApiError } from "../api";
import { b64decode, checkQr, decodeQr } from "../credential";
import { CedulaPage } from "./CedulaPage";

const mocks = vi.hoisted(() => ({
  enroll: vi.fn(),
  publicEvents: vi.fn(),
  officialTime: vi.fn(),
  revocations: vi.fn(),
  reportLoss: vi.fn(),
  shownQrs: [] as string[],
}));

vi.mock("../api", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api")>();
  const { enroll, officialTime, revocations, reportLoss, publicEvents } = mocks;
  return { ...original, api: { ...original.api, enroll, officialTime, revocations, reportLoss, publicEvents } };
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

function renderPage() {
  render(
    <MemoryRouter>
      <CedulaPage />
    </MemoryRouter>,
  );
}

function fillEnroll(rut = "11.111.111-1", clave = "RCUNO234") {
  fireEvent.change(screen.getByLabelText("RUN"), { target: { value: rut } });
  fireEvent.change(screen.getByLabelText("Clave de activación"), { target: { value: clave } });
  fireEvent.click(screen.getByRole("button", { name: "Obtener mi cédula digital" }));
}

const QUE_ES_ESTO = /genera tu teléfono y dura unos segundos/;

describe("recomendaciones del Anexo A.2 en la interfaz", () => {
  it("el RUN invalido se marca junto a su campo, sin llamar al Registro Civil", async () => {
    renderPage();
    fillEnroll("11.111.111-2");

    const message = await screen.findByText(/El RUN no es válido/);
    const field = screen.getByLabelText("RUN");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(message.id);
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it("la clave rechazada se marca junto a su campo y lo ingresado se conserva para reintentar", async () => {
    mocks.enroll.mockRejectedValueOnce(new ApiError(401, "RUT o clave de activación inválidos"));
    renderPage();
    fillEnroll("11.111.111-1", "RCMALA23");

    const message = await screen.findByText("RUT o clave de activación inválidos");
    const clave = screen.getByLabelText("Clave de activación") as HTMLInputElement;
    expect(clave.getAttribute("aria-describedby")).toBe(message.id);
    expect(clave.value).toBe("RCMALA23");
    expect((screen.getByLabelText("RUN") as HTMLInputElement).value).toBe("11.111.111-1");

    // Corregir y reintentar, sin reiniciar: el mensaje se va al editar y el enrolamiento sigue.
    fireEvent.change(clave, { target: { value: "RCUNO234" } });
    expect(screen.queryByText("RUT o clave de activación inválidos")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Obtener mi cédula digital" }));
    expect(await screen.findByText("Crea tu PIN de 6 dígitos")).toBeTruthy();
  });

  it("sin red explica el problema en español y no con el error del navegador", async () => {
    mocks.enroll.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderPage();
    fillEnroll();

    expect(await screen.findByText(/No se pudo contactar al Registro Civil/)).toBeTruthy();
    expect(screen.queryByText("Failed to fetch")).toBeNull();
    expect((screen.getByLabelText("Clave de activación") as HTMLInputElement).value).toBe("RCUNO234");
  });

  it("el reporte de perdida tambien marca el error junto al campo y conserva lo ingresado", async () => {
    mocks.reportLoss.mockRejectedValueOnce(new ApiError(401, "RUT o clave de activación inválidos"));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /Perdiste tu teléfono/ }));
    fireEvent.change(screen.getByLabelText("RUN"), { target: { value: "11.111.111-1" } });
    fireEvent.change(screen.getByLabelText("Clave de activación"), { target: { value: "RCMALA23" } });
    fireEvent.click(screen.getByRole("button", { name: "Desactivar mi cédula" }));

    const message = await screen.findByText("RUT o clave de activación inválidos");
    const clave = screen.getByLabelText("Clave de activación") as HTMLInputElement;
    expect(clave.getAttribute("aria-describedby")).toBe(message.id);
    expect(clave.value).toBe("RCMALA23");
  });

  it("el panel informativo se ve antes de activar, expandido solo la primera vez", () => {
    renderPage();
    expect(screen.getByText(QUE_ES_ESTO)).toBeTruthy();
    cleanup();

    // Vuelve sin haberlo cerrado: ya lo vio, queda plegado y se puede abrir.
    renderPage();
    expect(screen.queryByText(QUE_ES_ESTO)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Qué es esto y para qué sirve" }));
    expect(screen.getByText(QUE_ES_ESTO)).toBeTruthy();
  });

  it("explica en qué se diferencia de una clave o contraseña", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "¿En qué se diferencia de una clave o contraseña?" }));
    expect(screen.getByText(/acredita tu identidad en persona/)).toBeTruthy();
  });

  it("muestra dónde se acepta solo si la persona lo pide", async () => {
    mocks.publicEvents.mockResolvedValue([
      { name: "Concierto Demo", starts_at: "2026-12-20T20:00:00" },
      { name: "Partido sin fecha", starts_at: null },
    ]);
    renderPage();
    expect(mocks.publicEvents).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Dónde puedes usarla" }));

    expect(await screen.findByText("Concierto Demo")).toBeTruthy();
    expect(screen.getByText("Partido sin fecha")).toBeTruthy();
    expect(screen.getByText(/2026/)).toBeTruthy();
  });

  it("si la lista falla, ofrece reintentar y la cédula sigue disponible", async () => {
    mocks.publicEvents.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    mocks.publicEvents.mockResolvedValueOnce([]);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Dónde puedes usarla" }));

    expect(await screen.findByText(/No se pudo cargar la lista/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Obtener mi cédula digital" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText(/Por ahora no hay eventos/)).toBeTruthy();
  });
});
