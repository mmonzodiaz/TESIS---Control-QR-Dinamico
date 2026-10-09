import { describe, expect, it } from "vitest";
import { ApiError, type Contingency, type OfflineDecision } from "./api";
import {
  adoptOtherQueues,
  buildLedger,
  emptyLedger,
  evaluateOffline,
  isConnectivityError,
  loadAllQueues,
  loadOtherQueues,
  loadQueue,
  queueKey,
  recordInLedger,
  REVOCATION_STALE_SECONDS,
  revocationWarning,
  saveQueue,
  syncProblemText,
  syncQueue,
  type QueuedDecision,
} from "./offline";

const NOW = 1_790_000_000;
const RUT = "12345678K";

function contingency(overrides: Partial<Contingency> = {}): Contingency {
  return {
    event_id: 1,
    generated_at: NOW - 30,
    seal: "0".repeat(64),
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

const base = { eventId: 1, now: NOW, freshness: "ok", rut: RUT, credentialId: "c1", nonce: "n1", ledger: emptyLedger() };

describe("evaluateOffline", () => {
  it("deja pasar (a confirmar por el guardia) si la copia es reciente y todo calza", () => {
    expect(evaluateOffline({ ...base, contingency: contingency() })).toBe("ok");
  });

  it("no deja pasar sin copia o con copia vencida: se deriva a la fila normal", () => {
    expect(evaluateOffline({ ...base, contingency: null })).toBe("stale");
    expect(evaluateOffline({ ...base, contingency: contingency({ generated_at: NOW - 601 }) })).toBe("stale");
  });

  it("una copia de otro evento no sirve: es como no tener copia", () => {
    // Al cambiar de evento, la copia del anterior no dice nada de las entradas del nuevo.
    expect(evaluateOffline({ ...base, eventId: 2, contingency: contingency({ event_id: 1 }) })).toBe("stale");
    expect(evaluateOffline({ ...base, eventId: null, contingency: contingency() })).toBe("stale");
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

describe("revocationWarning", () => {
  it("no avisa si la lista de revocadas estaba al dia al armar la copia, ni antes de tener copia", () => {
    expect(revocationWarning(contingency())).toBeNull();
    expect(revocationWarning(contingency({ revocation_list_issued_at: NOW - 30 - REVOCATION_STALE_SECONDS }))).toBeNull();
    expect(revocationWarning(null)).toBeNull();
  });

  it("avisa si el servidor nunca obtuvo la lista: una cedula reportada como perdida pasaria", () => {
    const copy = contingency({ revocation_list_issued_at: null, revoked_ids: [] });
    expect(revocationWarning(copy)).toEqual({ kind: "missing" });
    // Solo avisa: la decision sin red no cambia (no se bloquea a todos si cae el Registro Civil).
    expect(evaluateOffline({ ...base, contingency: copy })).toBe("ok");
  });

  it("avisa con la antiguedad si la lista quedo atrasada (el Registro Civil no responde)", () => {
    const copy = contingency({ revocation_list_issued_at: NOW - 30 - 15 * 60 });
    expect(revocationWarning(copy)).toEqual({ kind: "stale", minutes: 15 });
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

/** localStorage en memoria (los tests corren en Node, sin navegador). */
function memoryStorage() {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const queued = (nonce: string, rut = RUT, kind: "admit" | "reject" = "admit"): QueuedDecision => ({ rut, decision: decision(nonce, kind) });

describe("cola sin red por guardia", () => {
  it("cada guardia ve y envia solo su cola; lo de otra cuenta (o de antes de separarlas) aparece aparte", () => {
    const storage = memoryStorage();
    saveQueue(1, [queued("a1")], storage);
    saveQueue(2, [queued("b1"), queued("b2")], storage);
    storage.setItem("control-acceso-escaner-pendientes", JSON.stringify([queued("legado")]));

    expect(loadQueue(2, storage).map((q) => q.decision.nonce)).toEqual(["b1", "b2"]);
    expect(loadOtherQueues(2, storage).map((q) => q.decision.nonce).sort()).toEqual(["a1", "legado"]);
    // La memoria de uso unico es del lector: incluye lo de todas las cuentas.
    expect(loadAllQueues(storage)).toHaveLength(4);
  });

  it("enviar a mi nombre suma lo de otras cuentas sin duplicar y las vacia", () => {
    const storage = memoryStorage();
    saveQueue(1, [queued("a1"), queued("x")], storage);
    saveQueue(2, [queued("x")], storage);

    expect(adoptOtherQueues(2, storage).map((q) => q.decision.nonce)).toEqual(["x", "a1"]);
    expect(storage.getItem(queueKey(1))).toBeNull();
    expect(loadOtherQueues(2, storage)).toEqual([]);
  });

  it("vaciar la cola borra la clave", () => {
    const storage = memoryStorage();
    saveQueue(3, [queued("c1")], storage);
    saveQueue(3, [], storage);
    expect(storage.length).toBe(0);
  });
});

describe("buildLedger", () => {
  it("arma de una vez lo mismo que registrar decision por decision", () => {
    const items = [queued("n1"), queued("n2", "99999999K", "reject"), queued("n3", "11111111K")];
    const oneByOne = items.reduce(recordInLedger, emptyLedger());
    const built = buildLedger(items);
    expect([...built.usedNonces]).toEqual([...oneByOne.usedNonces]);
    expect([...built.admittedRuts].sort()).toEqual([RUT, "11111111K"].sort());
  });
});

describe("syncQueue", () => {
  const ok = (decisions: OfflineDecision[]) => decisions.map((d) => ({ nonce: d.nonce, reason: "ok", alert: false }));

  it("envia en lotes del tamano maximo que acepta el servidor", async () => {
    const sizes: number[] = [];
    const items = Array.from({ length: 7 }, (_, i) => queued(`n${i}`));
    const out = await syncQueue(items, async (d) => (sizes.push(d.length), ok(d)), 3);
    expect(sizes).toEqual([3, 3, 1]);
    expect(out.results).toHaveLength(7);
    expect(out.stopped).toBeNull();
  });

  it("si el servidor rechaza el lote, aisla la decision mala y envia el resto", async () => {
    const send = async (d: OfflineDecision[]) => {
      if (d.some((x) => x.nonce === "malo")) throw new ApiError(422, "Formato invalido");
      return ok(d);
    };
    const out = await syncQueue([queued("a"), queued("malo"), queued("b")], send);
    expect(out.results.map((r) => r.nonce)).toEqual(["a", "b"]);
    expect(out.rejected).toEqual(["malo"]);
    expect(out.stopped).toBeNull();
  });

  it("sin red se detiene sin marcar nada como rechazado", async () => {
    const out = await syncQueue([queued("a")], async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(out).toEqual({ results: [], rejected: [], stopped: "offline" });
  });

  it("un 429 o 401 no es un rechazo definitivo: se reintenta despues", async () => {
    const out = await syncQueue([queued("a"), queued("b")], async () => {
      throw new ApiError(429, "Demasiadas validaciones");
    });
    expect(out).toEqual({ results: [], rejected: [], stopped: "error" });
  });
});

describe("syncProblemText", () => {
  it("avisa al guardia en vez de descartar el error en silencio", () => {
    expect(syncProblemText(0, false)).toBeNull();
    expect(syncProblemText(0, true)).toMatch(/se reintentará/);
    expect(syncProblemText(2, false)).toMatch(/no aceptó 2 decisiones/);
    expect(syncProblemText(1, true)).toMatch(/no aceptó 1 decisión/);
  });
});
