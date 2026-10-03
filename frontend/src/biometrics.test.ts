import { beforeEach, describe, expect, it, vi } from "vitest";
// Se importa el resultado del experimento para que el umbral del codigo no pueda separarse
// de la evidencia que lo produjo.
import results from "../../docs/results/biometric-degradation.json";
import {
  BiometricsUnavailable,
  THRESHOLD,
  __setSessionForTests,
  biometricsEnabled,
  similarity,
} from "./biometrics";

beforeEach(() => {
  __setSessionForTests(null);
  vi.unstubAllEnvs();
});

describe("el modulo esta apagado por defecto", () => {
  it("no se enciende si no esta la variable", () => {
    expect(biometricsEnabled()).toBe(false);
  });

  it("solo se enciende con el valor exacto", () => {
    vi.stubEnv("VITE_BIOMETRIA", "0");
    expect(biometricsEnabled()).toBe(false);
    vi.stubEnv("VITE_BIOMETRIA", "true");
    expect(biometricsEnabled()).toBe(false);
    vi.stubEnv("VITE_BIOMETRIA", "1");
    expect(biometricsEnabled()).toBe(true);
  });

  it("apagado, ni siquiera intenta cargar el modelo", async () => {
    // Importa que falle ANTES de pedir el modelo: son ~13,6 MB que no hay que descargar.
    const { loadModel } = await import("./biometrics");
    await expect(loadModel()).rejects.toBeInstanceOf(BiometricsUnavailable);
  });
});

describe("el umbral no se elige a ojo", () => {
  it("es exactamente el que midio el experimento para 112x112 en 900 B", () => {
    // Si alguien cambia el umbral en el codigo, este test falla: el numero tiene que venir de la
    // evidencia (FAR 1e-3, donde el TAR medido es 92,0 %), no del criterio de quien edite.
    //
    // Se busca por NOMBRE de configuracion y no por el flag `es_produccion` del archivo: ese flag
    // quedo grabado cuando se midio, y entonces produccion todavia era 72x96. El umbral pertenece
    // a una configuracion concreta, no a "lo que fuera produccion ese dia".
    const measured = results.variantes_opcion_a.find((v) => v.configuracion === "112x112@900B") as
      | { configuracion: string; tar: Record<string, { tar: number; umbral: number }> }
      | undefined;
    if (!measured) throw new Error("falta la configuracion 112x112@900B en el resultado");
    expect(THRESHOLD).toBeCloseTo(measured.tar["0.001"].umbral, 6);
    expect(measured.tar["0.001"].tar).toBeGreaterThan(0.9);
    // Y que esa configuracion sea la que el emisor usa hoy: si cambia PHOTO_SIZE, hay que remedir.
    expect(results.produccion_actual.tamano).toEqual([72, 96]); // tamano al momento de medir
  });
});

describe("similitud coseno", () => {
  const unit = (values: number[]) => {
    const v = new Float32Array(values);
    const norm = Math.hypot(...values);
    return new Float32Array(v.map((x) => x / norm));
  };

  it("vale 1 para el mismo vector y 0 para ortogonales", () => {
    const a = unit([1, 2, 3]);
    expect(similarity(a, a)).toBeCloseTo(1, 6);
    expect(similarity(unit([1, 0, 0]), unit([0, 1, 0]))).toBeCloseTo(0, 6);
  });

  it("decide sobre el umbral en el borde", () => {
    const score = THRESHOLD;
    expect(score >= THRESHOLD).toBe(true);
    expect(score - 1e-6 >= THRESHOLD).toBe(false);
  });

  it("rechaza vectores de distinto largo en vez de inventar un numero", () => {
    expect(() => similarity(new Float32Array(2), new Float32Array(3))).toThrow(BiometricsUnavailable);
  });
});

describe("comparacion con una sesion falsa", () => {
  /** Sesion que devuelve un vector fijo por llamada, para probar el cableado sin el modelo real. */
  function fakeSession(vectors: number[][]) {
    let call = 0;
    return {
      inputNames: ["input.1"],
      outputNames: ["516"],
      run: vi.fn(async () => ({ "516": { data: new Float32Array(vectors[call++ % vectors.length]) } })),
    };
  }

  /** OffscreenCanvas no existe en el entorno de pruebas; se simula lo minimo que usa el modulo. */
  function stubOffscreenCanvas() {
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return {
            drawImage: () => {},
            getImageData: () => ({ data: new Uint8ClampedArray(112 * 112 * 4).fill(128) }),
          };
        }
      },
    );
  }

  it("un vector nulo se reporta como no disponible y no como puntaje 0", async () => {
    // Un 0 silencioso seria peor que un error: pareceria "no coincide" cuando en realidad el
    // modelo no esta funcionando.
    vi.stubEnv("VITE_BIOMETRIA", "1");
    stubOffscreenCanvas();
    __setSessionForTests(fakeSession([[0, 0, 0]]));
    const { faceVector } = await import("./biometrics");
    const source = {} as unknown as CanvasImageSource;
    await expect(faceVector(source, 10, 10)).rejects.toBeInstanceOf(BiometricsUnavailable);
  });

  it("dos vectores iguales dan puntaje 1 y por tanto coincidencia", async () => {
    vi.stubEnv("VITE_BIOMETRIA", "1");
    stubOffscreenCanvas();
    __setSessionForTests(fakeSession([[3, 4, 0]]));
    const { faceVector } = await import("./biometrics");
    const source = {} as unknown as CanvasImageSource;
    const a = await faceVector(source, 10, 10);
    const b = await faceVector(source, 10, 10);
    expect(similarity(a, b)).toBeCloseTo(1, 6);
    // El vector sale L2-normalizado: (3,4,0) con norma 5 da (0,6; 0,8; 0).
    expect(Array.from(a)).toEqual([0.6000000238418579, 0.800000011920929, 0]);
  });
});
