// Comparacion biometrica en el dispositivo del guardia (ADR-16). MODULO APAGADO POR DEFECTO.
//
// Compara la foto firmada que viene dentro del QR con lo que ve la camara, para apoyar la decision
// del guardia. No la reemplaza: el puntaje es un dato mas en la pantalla y el guardia sigue
// tocando "Dejar pasar" o "No coincide" (ADR-12).
//
// Invariantes que este archivo tiene que cumplir, y por que:
// 1. Corre aqui, en el dispositivo del guardia. Si lo calculara el telefono del titular, uno
//    modificado podria informar "coincide" y el resultado no seria verificable.
// 2. NO se persiste nada: ni el fotograma ni el vector. Un embedding ES dato biometrico, asi que
//    guardarlo seria guardar biometria con otro nombre. El puntaje solo se muestra al guardia; el
//    historial guarda unicamente su decision.
// 3. Se enciende por persona, nunca de forma automatica: el art. 12 inc. 6 de la Ley 19.628 (texto
//    de la Ley 21.719) presume que el consentimiento no fue libre si la recoleccion no era
//    necesaria, asi que la via no biometrica tiene que seguir disponible (docs/ley-21719.md §5).
//
// El modelo (~13,6 MB) no se versiona: licencia de investigacion no comercial y tamano. Hay que
// dejarlo en public/models/ (ver .env.example). Sin el, el modulo informa que falta y el escaner
// sigue funcionando como siempre.
//
// Que se usa: w600k_mbf.onnx, MobileFaceNet del pack buffalo_sc de InsightFace. Entrada
// [N,3,112,112], salida de 512 dimensiones, comparadas por similitud coseno. Los PESOS son solo
// para investigacion no comercial (el codigo de InsightFace es MIT, los pesos no): hay que
// declararlo en la tesis. La alternativa Apache-2.0, arcfaceresnet100-8, pesa 249 MB y se entreno
// con MS-Celeb-1M, retirado por Microsoft por problemas de consentimiento.
//
// Sin detector de rostros a proposito: recorte central en los dos lados, para que la geometria sea
// la misma que midio el experimento (ver toModelInput). Alinear por puntos faciales exigiria
// hacerlo en ambos lados y volver a medir el umbral; queda como mejora pendiente en ADR-16.

const INPUT_SIZE = 112; // entrada nativa de los modelos de la familia ArcFace
const MODEL_URL = "/models/w600k_mbf.onnx";

/** Umbral de decision. Sale de docs/results/biometric-degradation.json para la configuracion de
 * produccion (112x112 en 900 B) al punto de operacion FAR 1e-3, donde el TAR medido es 92,0 %.
 * Un test lo fija contra ese archivo: si alguien lo cambia a ojo, el test falla. */
export const THRESHOLD = 0.245486;
export const THRESHOLD_FAR = "1e-3";

/** El modulo existe solo si se enciende. Sin esto no se descarga el modelo ni se carga el runtime. */
export function biometricsEnabled(): boolean {
  return import.meta.env.VITE_BIOMETRIA === "1";
}

export class BiometricsUnavailable extends Error {}

export type Comparison = {
  score: number;
  threshold: number;
  match: boolean;
};

type Session = {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
  inputNames: string[];
  outputNames: string[];
};

let sessionPromise: Promise<Session> | null = null;

/** Carga el runtime y el modelo una sola vez. Conviene llamarlo al abrir el escaner, junto con las
 * claves de lectores y la copia de contingencia: despues queda en memoria y sirve sin red. */
export function loadModel(): Promise<Session> {
  if (!biometricsEnabled()) {
    return Promise.reject(new BiometricsUnavailable("El modulo biometrico esta apagado"));
  }
  // Un fallo pasajero (red inestable al bajar 13,6 MB) no debe dejar la comparacion apagada hasta
  // recargar la pagina: si la carga falla se olvida la promesa y el siguiente intento reintenta.
  sessionPromise ??= (async () => {
    let ort: typeof import("onnxruntime-web");
    try {
      ort = await import("onnxruntime-web");
    } catch {
      throw new BiometricsUnavailable("Falta onnxruntime-web: instala las dependencias del frontend");
    }
    try {
      const session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: ["wasm"] });
      return session as unknown as Session;
    } catch {
      throw new BiometricsUnavailable(
        `No se pudo cargar el modelo en ${MODEL_URL}. Hay que dejarlo ahi a mano: no se versiona por licencia y tamano.`,
      );
    }
  })();
  const pending = sessionPromise;
  pending.catch(() => {
    if (sessionPromise === pending) sessionPromise = null;
  });
  return pending;
}

/** Solo para los tests: inyecta una sesion falsa y evita descargar el modelo. */
export function __setSessionForTests(session: Session | null): void {
  sessionPromise = session ? Promise.resolve(session) : null;
}

/** Recorte central cuadrado y escalado a 112x112.
 *
 * Replica la geometria del experimento, que recorta al centro **los dos lados** sin alinear por
 * puntos faciales. Eso importa: si la referencia se recortara al centro y la sonda se alineara por
 * puntos, los vectores dejarian de ser comparables y el puntaje seria ruido con cara de numero. El
 * costo es que el guardia tiene que encuadrar el rostro al centro, y de ahi la guia en pantalla.
 */
function toModelInput(source: CanvasImageSource, width: number, height: number): ImageData {
  const side = Math.min(width, height);
  const canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new BiometricsUnavailable("El navegador no entrego un contexto 2D");
  ctx.drawImage(source, (width - side) / 2, (height - side) / 2, side, side, 0, 0, INPUT_SIZE, INPUT_SIZE);
  return ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
}

/** (pixel - 127,5) / 127,5, RGB, NCHW: el preprocesamiento de los modelos de InsightFace.
 * Equivocarlo no da error, da vectores sin sentido (ver el encabezado del script del experimento). */
function toTensorData(image: ImageData): Float32Array {
  const { data } = image;
  const pixels = INPUT_SIZE * INPUT_SIZE;
  const out = new Float32Array(3 * pixels);
  for (let i = 0; i < pixels; i++) {
    out[i] = (data[i * 4] - 127.5) / 127.5;
    out[pixels + i] = (data[i * 4 + 1] - 127.5) / 127.5;
    out[2 * pixels + i] = (data[i * 4 + 2] - 127.5) / 127.5;
  }
  return out;
}

function l2Normalize(vector: Float32Array): Float32Array {
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) throw new BiometricsUnavailable("El modelo devolvio un vector nulo");
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm;
  return out;
}

/** Vector facial de una imagen. El vector NO se guarda en ninguna parte: lo devuelve y quien lo
 * use lo descarta al terminar la comparacion. */
export async function faceVector(source: CanvasImageSource, width: number, height: number): Promise<Float32Array> {
  const session = await loadModel();
  const ort = await import("onnxruntime-web");
  const tensor = new ort.Tensor("float32", toTensorData(toModelInput(source, width, height)), [1, 3, INPUT_SIZE, INPUT_SIZE]);
  const output = await session.run({ [session.inputNames[0]]: tensor });
  return l2Normalize(output[session.outputNames[0]].data);
}

/** Similitud coseno. Ambos vectores vienen L2-normalizados, asi que es el producto punto. */
export function similarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new BiometricsUnavailable("Vectores de distinto largo");
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Compara la foto firmada del QR con un fotograma de la camara.
 *
 * `photo` son los bytes WebP que venian dentro del QR (ya verificados contra el hash firmado) y
 * `frame` es el elemento de video en vivo. Ni el fotograma ni los vectores sobreviven a esta
 * funcion: lo unico que sale es el puntaje.
 */
export async function compareFaceToCamera(photo: Uint8Array, frame: HTMLVideoElement): Promise<Comparison> {
  if (!frame.videoWidth || !frame.videoHeight) {
    throw new BiometricsUnavailable("La camara todavia no entrega imagen");
  }
  const bitmap = await createImageBitmap(new Blob([photo as unknown as BlobPart], { type: "image/webp" }));
  try {
    const reference = await faceVector(bitmap, bitmap.width, bitmap.height);
    const probe = await faceVector(frame, frame.videoWidth, frame.videoHeight);
    const score = similarity(reference, probe);
    return { score, threshold: THRESHOLD, match: score >= THRESHOLD };
  } finally {
    bitmap.close(); // el fotograma de referencia no queda en memoria mas de lo necesario
  }
}
