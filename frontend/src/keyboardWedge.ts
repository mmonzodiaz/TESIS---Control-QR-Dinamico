// Pistola lectora de codigos 2D en modo teclado ("keyboard wedge"): tipea el contenido del QR muy
// rapido y termina con Enter (o Tab). Aqui se reconoce esa rafaga para no confundirla con una
// persona escribiendo, y se corrige el caso tipico de distribucion de teclado distinta.

const QR_PREFIX = "CA2:";
// Entre teclas de la pistola pasan pocos ms; una persona tarda mucho mas.
const MAX_GAP_MS = 150;
const BASE45 = /^[0-9A-Z $%*+\-./:]+$/;

// La pistola suele emular un teclado de EE. UU. Si Windows esta en espanol (Latinoamerica o
// Espana), las mismas teclas producen otros simbolos. Mapa inverso: lo que llega -> lo que era.
// Se aplica solo si el prefijo llego como "CA2Ñ" (el ":" de EE. UU. es la tecla Ñ en espanol).
const US_TO_SPANISH_INVERSE: Record<string, string> = {
  "Ñ": ":",
  "(": "*",
  "¡": "+", // Latinoamerica
  "¿": "+", // Espana
  "'": "-",
  "-": "/",
};

export class LayoutMismatchError extends Error {}

/** Devuelve el texto del QR tal como fue codificado, o lanza si no es un QR de este sistema. */
export function normalizeScannedText(raw: string): string {
  let text = raw.trim();
  if (text.toUpperCase().startsWith("CA2Ñ")) {
    text = [...text].map((ch) => US_TO_SPANISH_INVERSE[ch] ?? ch).join("");
  }
  if (!text.startsWith(QR_PREFIX)) throw new LayoutMismatchError("No es un QR de este sistema");
  if (!BASE45.test(text.slice(QR_PREFIX.length))) {
    throw new LayoutMismatchError(
      "La pistola envió caracteres inesperados. Configura su idioma de teclado igual al de Windows.",
    );
  }
  return text;
}

/** Acumula teclas; devuelve el texto completo cuando la pistola termina con Enter/Tab. */
export class KeyboardWedge {
  private buffer = "";
  private lastAt = 0;

  /** `consume`: la tecla es parte de una lectura y no debe llegar a la pagina (p. ej. un espacio
   * que activaria un boton con foco). */
  handleKey(key: string, at: number): { consume: boolean; scanned?: string } {
    const gap = at - this.lastAt;
    this.lastAt = at;
    if (this.buffer && gap > MAX_GAP_MS) this.buffer = "";

    if (key === "Enter" || key === "Tab") {
      if (this.buffer.length < QR_PREFIX.length) {
        this.buffer = "";
        return { consume: false };
      }
      const scanned = this.buffer;
      this.buffer = "";
      return { consume: true, scanned };
    }
    if (key.length !== 1) return { consume: this.buffer.length > 0 }; // Shift, etc.
    // Una lectura empieza con "C" (de "CA2:"); cualquier otra tecla suelta se ignora.
    if (!this.buffer && key.toUpperCase() !== "C") return { consume: false };
    this.buffer += key;
    return { consume: true };
  }
}
