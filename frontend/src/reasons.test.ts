import { describe, expect, it } from "vitest";
import { REASON_LABEL, REASON_TONE } from "./reasons";

// Los valores que backend/app/routers/qr.py puede devolver en QRValidateOut.reason (y en
// OfflineSyncResult.reason de /qr/sync, que agrega unknown_gate).
// Si el backend agrega un motivo nuevo y este test falla, es la senal de actualizar
// tambien ScannerPage.tsx y LogsPage.tsx (que dependen de estos mapas).
const BACKEND_REASONS = ["ok", "expired", "already_used", "invalid", "already_admitted", "no_ticket", "banned", "photo_mismatch", "revoked", "unknown_gate"];

describe("reasons", () => {
  it.each(BACKEND_REASONS)("tiene etiqueta y estilo para el motivo '%s'", (reason) => {
    expect(REASON_LABEL[reason]).toBeTruthy();
    expect(REASON_TONE[reason]).toBeTruthy();
  });

  it("no tiene motivos huerfanos que ya no use el backend", () => {
    expect(Object.keys(REASON_LABEL).sort()).toEqual([...BACKEND_REASONS].sort());
    expect(Object.keys(REASON_TONE).sort()).toEqual([...BACKEND_REASONS].sort());
  });
});
