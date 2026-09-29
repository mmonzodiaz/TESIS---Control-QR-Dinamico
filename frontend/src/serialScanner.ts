// Pistola lectora 2D configurada como PUERTO SERIE (USB-COM virtual o RS-232): no tipea como teclado,
// envia el texto del QR por un puerto COM. Chrome y Edge de escritorio lo leen con la API Web Serial
// (solo en contexto seguro: https o localhost). La persona elige el puerto una vez.

// Muchas pistolas USB-COM ignoran la velocidad; para un RS-232 real debe coincidir con la de la pistola.
export const SERIAL_BAUD_RATE = 9600;
// Si la pistola no manda fin de linea, se considera terminada la lectura tras esta pausa.
const IDLE_FLUSH_MS = 150;

/** Arma lecturas completas a partir de los trozos que llegan por el puerto. */
export class SerialLineAssembler {
  private buffer = "";

  /** Agrega un trozo; devuelve las lecturas que quedaron completas (terminadas en CR o LF). */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const parts = this.buffer.split(/[\r\n]+/);
    this.buffer = parts.pop() ?? "";
    return parts.map((p) => p.trim()).filter(Boolean);
  }

  /** Tras una pausa sin datos: lo que haya quedado sin fin de linea es una lectura completa. */
  flush(): string | null {
    const pending = this.buffer.trim();
    this.buffer = "";
    return pending || null;
  }
}

// Tipos minimos de Web Serial (aun no estan en lib.dom de TypeScript).
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
}

function serialApi(): SerialLike | null {
  return (navigator as unknown as { serial?: SerialLike }).serial ?? null;
}

export function isSerialSupported(): boolean {
  return typeof navigator !== "undefined" && serialApi() !== null;
}

/**
 * Pide al usuario el puerto de la pistola, lo abre y llama `onScan` con cada lectura.
 * Devuelve una funcion para desconectar. `onClosed` se llama si el puerto se cierra solo
 * (p. ej. se desenchufa la pistola).
 */
export async function connectSerialScanner(onScan: (text: string) => void, onClosed: () => void): Promise<() => Promise<void>> {
  const serial = serialApi();
  if (!serial) throw new Error("Este navegador no permite leer puertos serie. Usa Chrome o Edge de escritorio.");
  const port = await serial.requestPort();
  await port.open({ baudRate: SERIAL_BAUD_RATE });
  if (!port.readable) throw new Error("El puerto no se puede leer");

  const reader = port.readable.getReader();
  const decoder = new TextDecoder();
  const assembler = new SerialLineAssembler();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  void (async () => {
    try {
      while (!stopped) {
        const { value, done } = await reader.read();
        if (done) break;
        clearTimeout(idleTimer);
        for (const line of assembler.push(decoder.decode(value, { stream: true }))) onScan(line);
        idleTimer = setTimeout(() => {
          const pending = assembler.flush();
          if (pending) onScan(pending);
        }, IDLE_FLUSH_MS);
      }
    } catch {
      // puerto desconectado
    } finally {
      clearTimeout(idleTimer);
      reader.releaseLock();
      if (!stopped) {
        await port.close().catch(() => {});
        onClosed();
      }
    }
  })();

  return async () => {
    stopped = true;
    await reader.cancel().catch(() => {});
    await port.close().catch(() => {});
  };
}
