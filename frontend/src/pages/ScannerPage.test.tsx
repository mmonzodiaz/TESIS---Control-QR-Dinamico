// @vitest-environment jsdom
//
// Render real del escaner del guardia (ScannerPage), con la API, la camara y la sesion simuladas.
// Los QR son de verdad: se arman con las claves de los vectores compartidos con el backend
// (backend/tests/vectors/qr-v2.json) y el escaner los descifra y verifica como en la puerta.
// Fija flujos que la auditoria del 2026-10-09 encontro rotos y que ningun test de logica cubria
// porque viven en el componente: el autocierre, la cola sin red por guardia, el aviso de revocadas
// y la sincronizacion de un solo vuelo.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import vectors from "../../../backend/tests/vectors/qr-v2.json";
import type { Contingency, OfflineSyncResult, QRValidateRequest, QRValidateResponse } from "../api";
import { b64decode, buildQr, parseCredentialFile } from "../credential";
import { queueKey, type QueuedDecision } from "../offline";
import { REASON_LABEL } from "../reasons";
import { GATES_RETRY_MS } from "../useEventSelection";
import { ScannerPage } from "./ScannerPage";

const GUARD_ID = 7;
const OTHER_GUARD_ID = 99;
const EVENT_ID = 1;
const GATE_ID = 11;

const apiMock = vi.hoisted(() => ({
  listEvents: vi.fn(),
  listGates: vi.fn(),
  verifierKeys: vi.fn(),
  contingency: vi.fn(),
  validateQr: vi.fn(),
  syncOffline: vi.fn(),
}));

// Lectura desde imagen: por defecto no encuentra QR; un test la hace devolver uno.
const scanFileMock = vi.hoisted(() => vi.fn());

vi.mock("../api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../api")>()), api: apiMock }));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ token: "token-guardia", user: { id: 7, email: "guardia@test.cl", full_name: "Guardia", role: "guard" } }),
}));
// Sin camara ni WebAssembly: el lector de la camara no hace nada y las lecturas llegan por la pistola.
vi.mock("html5-qrcode", () => ({
  Html5QrcodeSupportedFormats: { QR_CODE: 0 },
  Html5Qrcode: class {
    start() {
      return Promise.resolve();
    }
    stop() {
      return Promise.resolve();
    }
    clear() {}
    pause() {}
    resume() {}
    scanFile() {
      return scanFileMock();
    }
  },
}));
vi.mock("../barcodeDetector", () => ({ installBarcodeDetector: () => {} }));

const { credential, identity } = parseCredentialFile(vectors.credential);
let nonceCounter = 0;

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

/** QR vigente de la cedula de los vectores, con un nonce distinto cada vez (como el telefono). */
function freshQr(): string {
  const nonce = new Uint8Array(16);
  nonce[15] = ++nonceCounter;
  return buildQr({
    credential,
    deviceSecret: b64decode(vectors.device_secret),
    verifierPublic: b64decode(vectors.verifier_public),
    issuedAt: nowUnix(),
    nonce,
  });
}

function contingency(overrides: Partial<Contingency> = {}): Contingency {
  return {
    event_id: EVENT_ID,
    generated_at: nowUnix(),
    seal: "ab".repeat(32),
    max_age_seconds: 600,
    ticket_ruts: [identity.rut],
    admitted_ruts: [],
    banned_ruts: [],
    revoked_ids: [],
    revocation_list_issued_at: nowUnix(),
    ...overrides,
  };
}

function queued(nonceHex: string): QueuedDecision {
  return {
    rut: identity.rut,
    decision: {
      decision: "admit",
      scanned_at: nowUnix(),
      gate_id: GATE_ID,
      nonce: nonceHex,
      issued_at: nowUnix(),
      device_sig: "c2ln",
      credential_core: "Y29yZQ==",
      issuer_sig: "c2ln",
    },
  };
}

/** La pistola en modo teclado: una rafaga de teclas y Enter, escuchada en toda la pagina. */
function pistolScan(qr: string) {
  for (const key of qr) fireEvent.keyDown(document.body, { key });
  fireEvent.keyDown(document.body, { key: "Enter" });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const offline = () => Promise.reject(new TypeError("Failed to fetch"));

async function renderScanner() {
  render(
    <MemoryRouter>
      <ScannerPage />
    </MemoryRouter>,
  );
  // Listo para leer: claves del evento cargadas y fila elegida.
  await screen.findByText("Apunta al QR o escanéalo con la pistola lectora");
  await waitFor(() => expect((screen.getByLabelText("Fila") as HTMLSelectElement).value).toBe(String(GATE_ID)));
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  apiMock.listEvents.mockResolvedValue([{ id: EVENT_ID, name: "Concierto", created_at: "2026-10-01T00:00:00" }]);
  apiMock.listGates.mockResolvedValue([{ id: GATE_ID, event_id: EVENT_ID, name: "Fila A", lane: "digital" }]);
  apiMock.verifierKeys.mockResolvedValue({
    verifier_private_key: vectors.verifier_secret,
    issuer_public_key: vectors.issuer_public,
    ttl_seconds: 45,
    clock_skew_seconds: 5,
    server_time: nowUnix(),
  });
  apiMock.contingency.mockResolvedValue(contingency());
  apiMock.validateQr.mockImplementation(async (_token: string, payload: QRValidateRequest): Promise<QRValidateResponse> => {
    const base = { pending: false, attendee: null, latency_ms: 1 };
    if (payload.action === "check") return { ...base, granted: false, reason: "ok", pending: true };
    if (payload.action === "admit") return { ...base, granted: true, reason: "ok" };
    return { ...base, granted: false, reason: "photo_mismatch" };
  });
  apiMock.syncOffline.mockImplementation(offline);
  scanFileMock.mockRejectedValue(new Error("sin imagen"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("escaner en dos pasos (ADR-12)", () => {
  it("lectura con pistola: verifica sin registrar, el guardia deja pasar y queda el ingreso", async () => {
    await renderScanner();
    pistolScan(freshQr());

    expect(await screen.findByText("¿Es la persona que tienes al frente?")).toBeTruthy();
    expect(screen.getByAltText(`Foto de ${identity.name}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Dejar pasar/ }));

    expect(await screen.findByText("Ingreso registrado")).toBeTruthy();
    const actions = apiMock.validateQr.mock.calls.map(([, payload]) => (payload as QRValidateRequest).action);
    expect(actions).toEqual(["check", "admit"]);
    const nonces = apiMock.validateQr.mock.calls.map(([, payload]) => (payload as QRValidateRequest).nonce);
    expect(nonces[0]).toBe(nonces[1]);
  });

  it("'No coincide' rechaza esa lectura sin registrar ingreso", async () => {
    await renderScanner();
    pistolScan(freshQr());
    fireEvent.click(await screen.findByRole("button", { name: /No coincide/ }));

    expect(await screen.findByText(REASON_LABEL.photo_mismatch)).toBeTruthy();
    expect(apiMock.validateQr.mock.calls.at(-1)?.[1]).toMatchObject({ action: "reject" });
  });

  it("el autocierre de un ingreso no borra la lectura siguiente hecha antes de 1,8 s", async () => {
    // Regresion (auditoria 2026-10-09): el temporizador del ingreso anterior cerraba la hoja de
    // decision de la persona siguiente si la pistola leia dentro de la ventana de autocierre.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderScanner();
    pistolScan(freshQr());
    fireEvent.click(await screen.findByRole("button", { name: /Dejar pasar/ }));
    await screen.findByText("Ingreso registrado");

    pistolScan(freshQr()); // la persona siguiente, de inmediato
    await screen.findByText("¿Es la persona que tienes al frente?");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500); // pasa de largo el autocierre del ingreso anterior
    });

    expect(screen.getByText("¿Es la persona que tienes al frente?")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Dejar pasar/ })).toBeTruthy();
  });

  it("leer un QR desde imagen no pisa la decision en curso", async () => {
    // Regresion (revision del 2026-10-09): con una persona en "¿Es la persona…?", elegir una imagen
    // reemplazaba su hoja de decision sin aviso. Ahora rige la misma regla que la pistola.
    await renderScanner();
    pistolScan(freshQr());
    await screen.findByText("¿Es la persona que tienes al frente?");
    const input = screen.getByTestId("leer-imagen") as HTMLInputElement;
    expect(input.disabled).toBe(true);

    scanFileMock.mockResolvedValue(freshQr());
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["x"], "qr.png", { type: "image/png" })] } });
    });

    expect(scanFileMock).not.toHaveBeenCalled();
    expect(apiMock.validateQr).toHaveBeenCalledTimes(1); // solo el "check" de la persona en curso
    expect(screen.getByRole("button", { name: /Dejar pasar/ })).toBeTruthy();
  });
});

describe("filas del evento", () => {
  it("si la lista de filas no carga, avisa con 'Reintentar' y se recupera sin recargar", async () => {
    // Regresion (revision del 2026-10-09): una falla pasajera dejaba el escaner sin fila hasta
    // cambiar de evento o recargar la pagina.
    apiMock.listGates.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(
      <MemoryRouter>
        <ScannerPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("No se pudieron cargar las filas del evento.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => expect((screen.getByLabelText("Fila") as HTMLSelectElement).value).toBe(String(GATE_ID)));
    expect(screen.queryByText("No se pudieron cargar las filas del evento.")).toBeNull();
  });

  it("tambien se reintenta solo, cada pocos segundos, mientras dure la falla", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiMock.listGates.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(
      <MemoryRouter>
        <ScannerPage />
      </MemoryRouter>,
    );
    await screen.findByText("No se pudieron cargar las filas del evento.");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GATES_RETRY_MS); // segundo intento: vuelve a fallar
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GATES_RETRY_MS); // tercero: carga
    });

    await waitFor(() => expect((screen.getByLabelText("Fila") as HTMLSelectElement).value).toBe(String(GATE_ID)));
    expect(apiMock.listGates).toHaveBeenCalledTimes(3);
  });
});

describe("sin conexion (ADR-15)", () => {
  it("decide con la copia de contingencia y guarda la decision en la cola de ESTE guardia, con el sello", async () => {
    apiMock.validateQr.mockImplementation(offline);
    const copy = contingency();
    apiMock.contingency.mockResolvedValue(copy);
    await renderScanner();
    pistolScan(freshQr());

    expect(await screen.findByText("Sin conexión: cédula válida y con entrada")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Dejar pasar/ }));
    expect(await screen.findByText("Ingreso registrado sin conexión")).toBeTruthy();

    const own = JSON.parse(localStorage.getItem(queueKey(GUARD_ID)) ?? "[]") as QueuedDecision[];
    expect(own).toHaveLength(1);
    expect(own[0].rut).toBe(identity.rut);
    expect(own[0].decision).toMatchObject({
      decision: "admit",
      gate_id: GATE_ID,
      contingency_generated_at: copy.generated_at,
      contingency_seal: copy.seal,
    });
    expect(localStorage.getItem(queueKey(OTHER_GUARD_ID))).toBeNull();
    expect(await screen.findByText(/1 por sincronizar/)).toBeTruthy();
  });

  it("el sello va con la decision aunque la copia venza mientras el guardia mira la foto", async () => {
    // Regresion (revision del 2026-10-09): con una copia de 9:55 min y 20 s mirando la foto, la
    // decision iba sin sello y el servidor la tomaba como alerta "expired".
    vi.useFakeTimers({ shouldAdvanceTime: true });
    apiMock.validateQr.mockImplementation(offline);
    const copy = contingency({ generated_at: nowUnix() - 595 });
    apiMock.contingency.mockResolvedValue(copy);
    await renderScanner();
    pistolScan(freshQr());
    await screen.findByText("Sin conexión: cédula válida y con entrada");

    vi.setSystemTime(Date.now() + 20_000); // la copia ya tiene mas de 10 minutos
    fireEvent.click(screen.getByRole("button", { name: /Dejar pasar/ }));
    await screen.findByText("Ingreso registrado sin conexión");

    const own = JSON.parse(localStorage.getItem(queueKey(GUARD_ID)) ?? "[]") as QueuedDecision[];
    expect(own[0].decision).toMatchObject({ contingency_generated_at: copy.generated_at, contingency_seal: copy.seal });
  });

  it("lo pendiente de otra cuenta no se envia a nombre de este guardia hasta que lo decida", async () => {
    const theirs = queued("0".repeat(31) + "1");
    localStorage.setItem(queueKey(OTHER_GUARD_ID), JSON.stringify([theirs]));
    await renderScanner();

    expect(screen.getByText(/Hay 1 decisión sin conexión de otra cuenta/)).toBeTruthy();
    expect(apiMock.syncOffline).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Enviar a mi nombre" }));
    await waitFor(() => expect(apiMock.syncOffline).toHaveBeenCalledWith("token-guardia", [theirs.decision]));
    expect(screen.queryByText(/de otra cuenta/)).toBeNull();
  });

  it("una sola sincronizacion en vuelo aunque cambie la cola mientras tanto", async () => {
    const mine = queued("0".repeat(31) + "a");
    const theirs = queued("0".repeat(31) + "b");
    localStorage.setItem(queueKey(GUARD_ID), JSON.stringify([mine]));
    localStorage.setItem(queueKey(OTHER_GUARD_ID), JSON.stringify([theirs]));
    const first = deferred<OfflineSyncResult[]>();
    apiMock.syncOffline.mockReturnValueOnce(first.promise).mockResolvedValue([{ nonce: theirs.decision.nonce, reason: "ok", alert: false }]);
    await renderScanner();
    await waitFor(() => expect(apiMock.syncOffline).toHaveBeenCalledTimes(1));

    // La cola cambia (2 decisiones) con el primer envio aun en vuelo: no debe salir un segundo envio.
    fireEvent.click(screen.getByRole("button", { name: "Enviar a mi nombre" }));
    await screen.findByText(/2 por sincronizar/);
    expect(apiMock.syncOffline).toHaveBeenCalledTimes(1);

    // Termina el primero: se envia solo lo que faltaba, sin repetir lo ya enviado.
    await act(async () => first.resolve([{ nonce: mine.decision.nonce, reason: "ok", alert: false }]));
    await waitFor(() => expect(apiMock.syncOffline).toHaveBeenCalledTimes(2));
    expect(apiMock.syncOffline.mock.calls[0][1]).toEqual([mine.decision]);
    expect(apiMock.syncOffline.mock.calls[1][1]).toEqual([theirs.decision]);
    await waitFor(() => expect(localStorage.getItem(queueKey(GUARD_ID))).toBeNull());
  });
});

describe("lista de cedulas revocadas (ADR-14)", () => {
  it("avisa al guardia si el servidor nunca obtuvo la lista", async () => {
    apiMock.contingency.mockResolvedValue(contingency({ revocation_list_issued_at: null }));
    await renderScanner();
    expect(await screen.findByText(/Sin lista de cédulas revocadas/)).toBeTruthy();
  });

  it("no avisa si la lista esta al dia", async () => {
    await renderScanner();
    await waitFor(() => expect(apiMock.contingency).toHaveBeenCalled());
    expect(screen.queryByText(/cédulas revocadas/)).toBeNull();
  });
});
