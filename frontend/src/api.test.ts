import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

function mockFetchOnce(response: { ok: boolean; status?: number; statusText?: string; json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    statusText: response.statusText ?? "",
    json: response.json ?? (async () => ({})),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("api.login", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("envia username/password como form-urlencoded, no como JSON", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({ access_token: "t", token_type: "bearer", user: {} }),
    });

    await api.login("guardia@demo.cl", "guardia123");

    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toBeInstanceOf(URLSearchParams);
    expect((options.body as URLSearchParams).get("username")).toBe("guardia@demo.cl");
    expect((options.body as URLSearchParams).get("password")).toBe("guardia123");
    // Content-Type NO debe forzarse a JSON: el backend espera OAuth2PasswordRequestForm.
    expect((options.headers as Headers).get("Content-Type")).toBeNull();
  });
});

describe("api.myTicket / verifierKeys / validateQr", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("adjunta el header Authorization con el token de sesion del asistente", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: async () => ({ attendee: {}, qr: {} }) });

    await api.myTicket("jwt-del-asistente");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/tickets/me");
    expect((options.headers as Headers).get("Authorization")).toBe("Bearer jwt-del-asistente");
  });

  it("pide las claves del escaner para el evento elegido", async () => {
    const fetchMock = mockFetchOnce({ ok: true, json: async () => ({}) });

    await api.verifierKeys("jwt-del-guardia", 5);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/events/5/verifier");
    expect((options.headers as Headers).get("Authorization")).toBe("Bearer jwt-del-guardia");
  });

  it("envia los datos verificados del QR como JSON en el body de /qr/validate", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({ granted: true, reason: "ok", attendee: null, latency_ms: 1 }),
    });
    const payload = {
      gate_id: 7,
      ticket_id: 1,
      nonce: "00".repeat(16),
      issued_at: 1,
      device_sig: "sig",
      credential_core: "core",
      issuer_sig: "isig",
    };

    await api.validateQr("jwt-del-guardia", payload);

    const [, options] = fetchMock.mock.calls[0];
    expect((options.headers as Headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(options.body as string)).toEqual(payload);
  });
});

describe("api.claimTicket", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("envia RUT + codigo + cedula como JSON y sin header Authorization (endpoint publico)", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({ access_token: "t", token_type: "bearer", attendee: {}, qr: {} }),
    });
    const payload = {
      rut: "11.111.111-1",
      code: "DEMO2345",
      device_public_key: "pk",
      credential_core: "core",
      issuer_sig: "isig",
    };

    await api.claimTicket(payload);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/tickets/claim");
    expect(JSON.parse(options.body as string)).toEqual(payload);
    expect((options.headers as Headers).get("Authorization")).toBeNull();
  });
});

describe("manejo de errores", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("lanza ApiError con el detalle del backend cuando la respuesta no es ok", async () => {
    mockFetchOnce({
      ok: false,
      status: 403,
      json: async () => ({ detail: "No tienes permisos para esta accion" }),
    });

    await expect(api.listUsers("jwt")).rejects.toMatchObject({
      status: 403,
      message: "No tienes permisos para esta accion",
    });
    await expect(api.listUsers("jwt")).rejects.toBeInstanceOf(ApiError);
  });

  it("cae al statusText si el cuerpo de error no es JSON valido", async () => {
    mockFetchOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: async () => {
        throw new Error("no es JSON");
      },
    });

    await expect(api.listUsers("jwt")).rejects.toMatchObject({
      status: 500,
      message: "Internal Server Error",
    });
  });
});
