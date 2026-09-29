import { describe, expect, it } from "vitest";
import vectors from "../../backend/tests/vectors/qr-v2.json";
import { KeyboardWedge, LayoutMismatchError, normalizeScannedText } from "./keyboardWedge";

// Lo que tipea una pistola que emula teclado de EE. UU. en un Windows con teclado en espanol.
const US_TO_SPANISH: Record<string, string> = { ":": "Ñ", "*": "(", "+": "¡", "-": "'", "/": "-" };

function typeFast(wedge: KeyboardWedge, text: string, start = 1000) {
  let result;
  let t = start;
  for (const ch of text) result = wedge.handleKey(ch, (t += 5));
  return wedge.handleKey("Enter", t + 5).scanned ?? result?.scanned;
}

describe("pistola lectora (modo teclado)", () => {
  it("reconstruye el QR completo cuando la pistola termina con Enter", () => {
    const wedge = new KeyboardWedge();
    expect(typeFast(wedge, vectors.qr)).toBe(vectors.qr);
  });

  it("ignora a una persona tecleando lento", () => {
    const wedge = new KeyboardWedge();
    let t = 0;
    for (const ch of "CA2:ABC") wedge.handleKey(ch, (t += 400));
    expect(wedge.handleKey("Enter", t + 400).scanned).toBeUndefined();
  });

  it("no captura teclas sueltas que no empiezan una lectura", () => {
    const wedge = new KeyboardWedge();
    expect(wedge.handleKey(" ", 10).consume).toBe(false);
    expect(wedge.handleKey("Enter", 20).consume).toBe(false);
  });

  it("corrige la distribucion de teclado EE. UU. -> espanol", () => {
    const garbled = [...vectors.qr].map((ch) => US_TO_SPANISH[ch] ?? ch).join("");
    expect(garbled.startsWith("CA2Ñ")).toBe(true);
    expect(normalizeScannedText(garbled)).toBe(vectors.qr);
  });

  it("acepta el texto correcto tal cual y rechaza lo que no es de este sistema", () => {
    expect(normalizeScannedText(vectors.qr)).toBe(vectors.qr);
    expect(() => normalizeScannedText("https://ejemplo.cl")).toThrow(LayoutMismatchError);
    expect(() => normalizeScannedText("CA2:abc")).toThrow(/idioma de teclado/);
  });
});
