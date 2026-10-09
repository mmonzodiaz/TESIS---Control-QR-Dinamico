// Contrasta el preprocesamiento del navegador contra la referencia de Python, con el MODELO REAL.
//
// Es el test que atrapa la clase de bug que ya nos mordio una vez: equivocar el orden de canales,
// el layout NCHW o la normalizacion no da error, da vectores sin sentido. Aqui los dos lados
// calculan los mismos pixeles con la misma formula, asi que cualquier diferencia en el vector es
// culpa del preprocesamiento.
//
// Lo que NO cubre (auditoria del 2026-10-09): OffscreenCanvas se reemplaza por uno que entrega
// pixeles fijos, asi que el recorte central y el reescalado del canvas no se contrastan. Valida
// orden de canales, NCHW, normalizacion e inferencia. Un fotograma real (p. ej. 1920x1080 recortado
// a 1080 y reducido a 112 por el canvas) se remuestrea distinto que en Python, y eso puede mover el
// puntaje respecto del umbral sin que este test falle: falta probarlo en un navegador real.
//
// Se salta solo si el modelo no esta: no se versiona (13,6 MB, licencia de investigacion no
// comercial). Para correrlo hay que dejarlo en frontend/public/models/w600k_mbf.onnx.
import { beforeAll, describe, expect, it, vi } from "vitest";
import reference from "./__fixtures__/face-vector-reference.json";

const MODEL_PATH = "public/models/w600k_mbf.onnx";
const SIZE = 112;

/** Mismo patron deterministico que uso Python para generar la referencia. */
function patternPixels(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      data[i] = (x * 2 + y) % 256;
      data[i + 1] = (y * 3 + x * 5) % 256;
      data[i + 2] = (x * 7 + y * 11) % 256;
      data[i + 3] = 255;
    }
  }
  return data;
}

describe("preprocesamiento contrastado contra Python, con el modelo real", () => {
  beforeAll(() => {
    vi.stubEnv("VITE_BIOMETRIA", "1");
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage: () => {}, getImageData: () => ({ data: patternPixels() }) };
        }
      },
    );
  });

  it("produce el mismo vector que la implementacion de Python", async (ctx) => {
    const ort = await import("onnxruntime-web");
    let session: Awaited<ReturnType<typeof ort.InferenceSession.create>>;
    try {
      session = await ort.InferenceSession.create(MODEL_PATH, { executionProviders: ["wasm"] });
    } catch {
      // Sin el modelo no hay nada que contrastar; se salta en vez de fallar.
      ctx.skip();
      return;
    }
    const { __setSessionForTests, faceVector } = await import("./biometrics");
    __setSessionForTests(session as never);

    const vector = await faceVector({} as unknown as CanvasImageSource, SIZE, SIZE);

    expect(vector.length).toBe(reference.vector.length);
    // Tolerancia por la diferencia de precision entre los dos runtimes, no por holgura: si el
    // preprocesamiento estuviera mal, el coseno se iria muy por debajo de 1 y no a la cuarta cifra.
    let dot = 0;
    for (let i = 0; i < vector.length; i++) dot += vector[i] * reference.vector[i];
    expect(dot).toBeGreaterThan(0.9999);
    for (let i = 0; i < vector.length; i++) {
      expect(vector[i]).toBeCloseTo(reference.vector[i], 3);
    }
  }, 120_000);
});
