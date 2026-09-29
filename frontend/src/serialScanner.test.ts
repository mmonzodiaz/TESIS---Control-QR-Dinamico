import { describe, expect, it } from "vitest";
import vectors from "../../backend/tests/vectors/qr-v2.json";
import { SerialLineAssembler } from "./serialScanner";
import { normalizeScannedText } from "./keyboardWedge";

describe("pistola lectora por puerto serie", () => {
  it("arma la lectura aunque llegue en muchos trozos y termine en CR+LF", () => {
    const assembler = new SerialLineAssembler();
    const chunks = vectors.qr.match(/.{1,64}/g)!;
    const lines = [...chunks.flatMap((c) => assembler.push(c)), ...assembler.push("\r\n")];
    expect(lines).toEqual([vectors.qr]);
    expect(normalizeScannedText(lines[0])).toBe(vectors.qr);
  });

  it("separa dos lecturas seguidas", () => {
    const assembler = new SerialLineAssembler();
    expect(assembler.push("CA2:AAA\rCA2:BB")).toEqual(["CA2:AAA"]);
    expect(assembler.push("B\n")).toEqual(["CA2:BBB"]);
  });

  it("si la pistola no manda fin de linea, la pausa cierra la lectura", () => {
    const assembler = new SerialLineAssembler();
    expect(assembler.push(vectors.qr)).toEqual([]);
    expect(assembler.flush()).toBe(vectors.qr);
    expect(assembler.flush()).toBeNull();
  });
});
