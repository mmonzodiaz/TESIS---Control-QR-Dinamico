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

    await api.login("residente1@demo.cl", "residente123");

    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toBeInstanceOf(URLSearchParams);
    expect((options.body as URLSearchParams).get("username")).toBe("residente1@demo.cl");
    expect((options.body as URLSearchParams).get("password")).toBe("residente123");
    // Content-Type NO debe forzarse a JSON: el backend espera OAuth2PasswordRequestForm.
    expect((options.headers as Headers).get("Content-Type")).toBeNull();
  });
});

describe("api.generateQr / validateQr", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());

  it("adjunta el header Authorization con el token del residente", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({ token: "abc", expires_at: "2026-01-01T00:00:00", ttl_seconds: 45 }),
    });

    await api.generateQr("jwt-del-residente");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain("/qr/generate");
    expect(options.method).toBe("POST");
    expect((options.headers as Headers).get("Authorization")).toBe("Bearer jwt-del-residente");
  });

  it("envia el token escaneado como JSON en el body de /qr/validate", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      json: async () => ({ granted: true, reason: "ok", user: null }),
    });

    await api.validateQr("jwt-del-guardia", "qr-token-123");

    const [, options] = fetchMock.mock.calls[0];
    expect((options.headers as Headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(options.body as string)).toEqual({ token: "qr-token-123" });
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
