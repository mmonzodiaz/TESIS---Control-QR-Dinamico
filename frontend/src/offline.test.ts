import { describe, expect, it } from "vitest";
import { ApiError, type Contingency, type OfflineDecision } from "./api";
import { emptyLedger, evaluateOffline, isConnectivityError, recordInLedger } from "./offline";

const NOW = 1_790_000_000;
const RUT = "12345678K";

function contingency(overrides: Partial<Contingency> = {}): Contingency {
  return {
    event_id: 1,
    generated_at: NOW - 30,
    max_age_seconds: 600,
    ticket_ruts: [RUT],
    admitted_ruts: [],
    banned_ruts: [],
    revoked_ids: [],
    revocation_list_issued_at: NOW - 30,
    ...overrides,
  };
}

function decision(nonce: string, kind: "admit" | "reject" = "admit"): OfflineDecision {
  return { decision: kind, scanned_at: NOW, gate_id: 1, nonce, issued_at: NOW, device_sig: "", credential_core: "", issuer_sig: "" };
}

const base = { now: NOW, freshness: "ok", rut: RUT, credentialId: "c1", nonce: "n1", ledger: emptyLedger() };

describe("evaluateOffline", () => {
  it("deja pasar (a confirmar por el guardia) si la copia es reciente y todo calza", () => {
    expect(evaluateOffline({ ...base, contingency: contingency() })).toBe("ok");
  });

  it("no deja pasar sin copia o con copia vencida: se deriva a la fila normal", () => {
    expect(evaluateOffline({ ...base, contingency: null })).toBe("stale");
    expect(evaluateOffline({ ...base, contingency: contingency({ generated_at: NOW - 601 }) })).toBe("stale");
  });

  it("aplica revocaciones, prohibiciones y la lista de entradas de la copia", () => {
    expect(evaluateOffline({ ...base, contingency: contingency({ revoked_ids: ["c1"] }) })).toBe("revoked");
    expect(evaluateOffline({ ...base, contingency: contingency({ banned_ruts: [RUT] }) })).toBe("banned");
    expect(evaluateOffline({ ...base, contingency: contingency({ ticket_ruts: [] }) })).toBe("no_ticket");
    expect(evaluateOffline({ ...base, contingency: contingency({ admitted_ruts: [RUT] }) })).toBe("already_admitted");
  });

  it("el QR vencido o fechado en el futuro se rechaza antes de mirar la copia", () => {
    expect(evaluateOffline({ ...base, freshness: "expired", contingency: null })).toBe("expired");
    expect(evaluateOffline({ ...base, freshness: "invalid", contingency: contingency() })).toBe("invalid");
  });

  it("recuerda a quien ya dejo pasar este lector sin red, y los QR que ya uso", () => {
    const afterAdmit = recordInLedger(emptyLedger(), { rut: RUT, decision: decision("n0") });
    expect(evaluateOffline({ ...base, ledger: afterAdmit, contingency: contingency() })).toBe("already_admitted");

    // "No coincide" quema ese QR, pero el titular puede entrar con otro.
    const afterReject = recordInLedger(emptyLedger(), { rut: RUT, decision: decision("n1", "reject") });
    expect(evaluateOffline({ ...base, ledger: afterReject, contingency: contingency() })).toBe("already_used");
    expect(evaluateOffline({ ...base, nonce: "n2", ledger: afterReject, contingency: contingency() })).toBe("ok");
  });
});

describe("isConnectivityError", () => {
  it("distingue una caida de red de un rechazo del servidor", () => {
    expect(isConnectivityError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isConnectivityError(new ApiError(502, "Bad Gateway"))).toBe(true);
    expect(isConnectivityError(new ApiError(429, "Demasiadas validaciones"))).toBe(false);
    expect(isConnectivityError(new ApiError(401, "No autenticado"))).toBe(false);
  });
});
