import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { CheckCircle2, CloudUpload, ImageUp, Loader2, ShieldAlert, TriangleAlert, Usb, UserCheck, UserX, WifiOff, X, XCircle } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api, type Contingency, type OfflineSyncResult, type QRValidateRequest, type QRValidateResponse, type VerifierKeys } from "../api";
import { installBarcodeDetector } from "../barcodeDetector";
import { type Comparison, biometricsEnabled, compareFaceToCamera, loadModel } from "../biometrics";
import { KeyboardWedge, normalizeScannedText } from "../keyboardWedge";
import {
  adoptOtherQueues,
  buildLedger,
  contingencyAge,
  evaluateOffline,
  isConnectivityError,
  isContingencyUsable,
  loadAllQueues,
  loadOtherQueues,
  loadQueue,
  recordInLedger,
  revocationWarning,
  saveQueue,
  sealFields,
  syncProblemText,
  syncQueue,
  type OfflineVerdict,
  type QueuedDecision,
} from "../offline";
import { connectSerialScanner, isSerialSupported } from "../serialScanner";
import { b64decode, checkQr, credentialId, CredentialError, decodeQr, photoDataUrl, validatePayload, type IdentityCore } from "../credential";
import { REASON_LABEL } from "../reasons";
import { formatRut } from "../rut";
import { useDocumentTitle } from "../useDocumentTitle";
import { useEventSelection } from "../useEventSelection";

// Escaner del guardia: en su celular (camara a pantalla completa) o en un PC con webcam o con una
// pistola lectora 2D (en modo teclado, o por puerto serie con Web Serial). El resultado aparece en un panel inferior con la foto grande. Flujo en dos pasos (ADR-12): el servidor verifica sin
// registrar ("check"), el guardia compara la foto con la persona y recien ahi decide.

const SCANNER_ELEMENT_ID = "qr-scanner-region";
const FILE_SCANNER_ELEMENT_ID = "qr-file-region";
// El QR lleva la foto y es denso: se lee con BarcodeDetector (nativo o polyfill ZXing-C++), no con zxing-js.
const READER_CONFIG = {
  verbose: false,
  formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
  useBarCodeDetectorIfSupported: true,
};
installBarcodeDetector();
// Un ingreso concedido se cierra solo; los rechazos esperan a que el guardia toque "Siguiente".
const GRANTED_DISMISS_MS = 1800;
// Contingencia sin conexion (ADR-15): cada cuanto se renueva la copia y se reintenta sincronizar.
const CONTINGENCY_REFRESH_MS = 60_000;
const SYNC_RETRY_MS = 15_000;

/** Comparación facial (ADR-16): pedir consentimiento, comparar y mostrar; o la persona no quiso. */
type FaceState = Comparison | "consent" | "declined" | "running" | { error: string } | null;

interface Verifier {
  /** Clave de lectores autorizados: descifra cualquier cedula digital (no solo de este evento). */
  verifierSecret: Uint8Array;
  issuerPublic: Uint8Array;
  ttl: number;
  skew: number;
  /** server_time - reloj local, en segundos. */
  clockOffset: number;
}

interface Seen {
  identity: IdentityCore;
  photo: Uint8Array;
  payload: QRValidateRequest;
  /** Emision de la cedula (para revisar la lista de revocadas sin red). */
  credentialId: string;
  /** Sin red: la copia de contingencia con que se evaluo esta lectura (su sello va con la decision). */
  evaluatedWith?: Contingency | null;
}

type Outcome =
  | { kind: "unreadable"; message: string }
  | ({ kind: "checking" } & Seen)
  | ({ kind: "pending" } & Seen)
  | ({ kind: "deciding" } & Seen)
  | ({ kind: "final"; response: QRValidateResponse } & Seen)
  // Sin conexion (ADR-15): veredicto con la copia de contingencia; si es "ok", el guardia decide.
  | ({ kind: "offline"; verdict: OfflineVerdict } & Seen)
  | ({ kind: "offlinePending" } & Seen)
  | ({ kind: "offlineRecorded"; decision: "admit" | "reject" } & Seen);

function toVerifier(keys: VerifierKeys): Verifier {
  return {
    verifierSecret: b64decode(keys.verifier_private_key),
    issuerPublic: b64decode(keys.issuer_public_key),
    ttl: keys.ttl_seconds,
    skew: keys.clock_skew_seconds,
    clockOffset: keys.server_time - Date.now() / 1000,
  };
}

/** Chequeo de vigencia sin red (el servidor repite este chequeo y ademas el de uso unico). */
function localFreshness(v: Verifier, issuedAt: number): string {
  const now = Date.now() / 1000 + v.clockOffset;
  if (issuedAt > now + v.skew) return "invalid";
  if (now - issuedAt > v.ttl + v.skew) return "expired";
  return "ok";
}

/** El guardia esta verificando o decidiendo sobre una persona: ninguna lectura nueva la reemplaza. */
function isDecisionInProgress(outcome: Outcome | null): boolean {
  return outcome !== null && ["checking", "pending", "deciding", "offlinePending"].includes(outcome.kind);
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // no todos los navegadores lo permiten
  }
}

export function ScannerPage() {
  useDocumentTitle("Escanear cédula");
  const { token, user } = useAuth();
  // ProtectedRoute solo monta el escaner con el usuario cargado. La cola sin red es de este guardia.
  const owner = user!.id;
  const navigate = useNavigate();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const busyRef = useRef(false);
  const lastQrRef = useRef<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<FaceState>(null);
  // La persona consintió la comparación de ESTE ingreso: va con la decisión del guardia, como evidencia.
  const [faceConsent, setFaceConsent] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [keysReady, setKeysReady] = useState(false);
  // Pistola por puerto serie: funcion para desconectarla, o null si no esta conectada.
  const [serialDisconnect, setSerialDisconnect] = useState<(() => Promise<void>) | null>(null);
  const [serialError, setSerialError] = useState<string | null>(null);
  // Lo que lleva este guardia en la sesion: da contexto sin ir al historial.
  const [session, setSession] = useState({ admitted: 0, rejected: 0 });
  const { events, gates, eventId, setEventId, gateId, setGateId, gatesError, retryGates } = useEventSelection(token);
  // El callback del lector se registra una sola vez; leer puerta y claves desde refs evita
  // que queden "congeladas" en el valor del primer render.
  const gateIdRef = useRef<number | null>(gateId);
  gateIdRef.current = gateId;
  const eventIdRef = useRef<number | null>(eventId);
  eventIdRef.current = eventId;
  const verifierRef = useRef<Verifier | null>(null);
  const outcomeRef = useRef<Outcome | null>(outcome);
  outcomeRef.current = outcome;
  // Contingencia sin conexion (ADR-15): copia del evento (solo en memoria), decisiones pendientes de
  // enviar (sobreviven a recargar) y memoria de uso unico de este lector.
  const contingencyRef = useRef<Contingency | null>(null);
  const [contingencyGeneratedAt, setContingencyGeneratedAt] = useState<number | null>(null);
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedDecision[]>(() => loadQueue(owner));
  const queueRef = useRef(queue);
  queueRef.current = queue;
  // Pendientes de otra cuenta en este lector: no se envian a nombre de este guardia sin que lo decida.
  const [otherPending, setOtherPending] = useState(() => loadOtherQueues(owner).length);
  // Memoria de uso unico del LECTOR (todas las cuentas), armada una sola vez al montar.
  const [initialLedger] = useState(() => buildLedger(loadAllQueues()));
  const ledgerRef = useRef(initialLedger);
  const [syncReport, setSyncReport] = useState<{ synced: number; alerts: OfflineSyncResult[] } | null>(null);
  // Sincronizacion de un solo vuelo, compartida entre ejecuciones del efecto que la dispara.
  const syncingRef = useRef(false);
  // Decisiones que el servidor no acepto (4xx): siguen guardadas, pero no se reintentan en esta sesion.
  const rejectedRef = useRef(new Set<string>());
  const [syncProblem, setSyncProblem] = useState<string | null>(null);
  // Autocierre de un ingreso concedido: se cancela si llega otra lectura antes de que se cumpla.
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setTick] = useState(0); // para refrescar "copia de hace N min"

  function serverNow(): number {
    return Date.now() / 1000 + (verifierRef.current?.clockOffset ?? 0);
  }

  useEffect(() => {
    // Copia de contingencia del evento, renovada cada minuto mientras haya red.
    contingencyRef.current = null;
    setContingencyGeneratedAt(null);
    if (!token || eventId === null) return;
    let cancelled = false;
    async function refresh() {
      try {
        const copy = await api.contingency(token!, eventId!);
        if (cancelled) return;
        contingencyRef.current = copy;
        setContingencyGeneratedAt(copy.generated_at);
        setOnline(true);
      } catch (err) {
        if (!cancelled && isConnectivityError(err)) setOnline(false);
      }
      setTick((t) => t + 1);
    }
    void refresh();
    const timer = setInterval(() => void refresh(), CONTINGENCY_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token, eventId]);

  useEffect(() => {
    // Envia lo decidido sin red apenas vuelve la conexion (y reintenta cada 15 s). El efecto se
    // vuelve a ejecutar con cada decision nueva; syncingRef evita que salga un segundo envio con las
    // mismas decisiones mientras el anterior sigue en vuelo (duplicaria registros y alertas).
    if (!token) return;
    async function flush() {
      const pending = queueRef.current.filter((q) => !rejectedRef.current.has(q.decision.nonce));
      if (syncingRef.current || pending.length === 0) return;
      syncingRef.current = true;
      try {
        const outcome = await syncQueue(pending, (decisions) => api.syncOffline(token!, decisions));
        outcome.rejected.forEach((nonce) => rejectedRef.current.add(nonce));
        if (outcome.results.length) {
          const sent = new Set(outcome.results.map((r) => r.nonce));
          setQueue((q) => {
            const rest = q.filter((item) => !sent.has(item.decision.nonce));
            saveQueue(owner, rest);
            return rest;
          });
          setSyncReport({ synced: outcome.results.length, alerts: outcome.results.filter((r) => r.alert) });
          setOnline(true);
        }
        if (outcome.stopped === "offline") setOnline(false);
        setSyncProblem(syncProblemText(rejectedRef.current.size, outcome.stopped === "error"));
      } finally {
        syncingRef.current = false;
      }
    }
    void flush();
    const timer = setInterval(() => void flush(), SYNC_RETRY_MS);
    window.addEventListener("online", flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", flush);
    };
  }, [token, owner, queue.length]);

  useEffect(() => {
    // Claves de lector autorizado y del emisor: con ellas se verifica la cedula sin depender de la red.
    verifierRef.current = null;
    if (!token || eventId === null) return;
    api
      .verifierKeys(token, eventId)
      .then((keys) => {
        verifierRef.current = toVerifier(keys);
        setKeysError(null);
        setKeysReady(true);
      })
      .catch(() => setKeysError("No se pudieron obtener las claves del evento para leer los QR."));
    // El modelo biometrico se carga aqui mismo, con la red disponible, igual que las claves y la
    // copia de contingencia: despues queda en memoria y la comparacion funciona sin conexion
    // (ADR-15). Si falla, no se avisa: el escaner funciona igual y el boton de comparar reportara
    // el motivo cuando el guardia lo use.
    if (biometricsEnabled()) void loadModel().catch(() => {});
  }, [token, eventId]);

  useEffect(() => {
    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, READER_CONFIG);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        {
          fps: 10,
          // Sin recuadro: se lee el cuadro completo. Resolucion alta porque el QR con foto es denso.
          videoConstraints: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        },
        (decodedText) => void handleScan(decodedText),
        undefined,
      )
      .catch((err) => setCameraError(`No se pudo acceder a la cámara: ${String(err)}`));

    return () => {
      try {
        scanner
          .stop()
          .catch(() => {})
          .finally(() => {
            try {
              scanner.clear();
            } catch {
              // el scanner nunca llego a montarse (p.ej. camara no encontrada)
            }
          });
      } catch {
        // idem: stop() puede lanzar de forma sincrona si nunca inicio
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Pantalla siempre encendida mientras se escanea (si el navegador lo permite).
    let lock: WakeLockSentinel | null = null;
    async function acquire() {
      try {
        lock = (await navigator.wakeLock?.request("screen")) ?? null;
      } catch {
        lock = null;
      }
    }
    function onVisibility() {
      if (!document.hidden) void acquire();
    }
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      void lock?.release().catch(() => {});
    };
  }, []);

  useEffect(() => {
    // Pistola lectora en modo teclado: se escucha en toda la pagina (fase de captura) para que la
    // rafaga de teclas no active botones ni cambie los selectores.
    const wedge = new KeyboardWedge();
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      const { consume, scanned } = wedge.handleKey(e.key, e.timeStamp);
      if (consume) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (scanned) void handleWedgeScan(scanned);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!outcome) return;
    const admitted =
      (outcome.kind === "final" && outcome.response.granted) || (outcome.kind === "offlineRecorded" && outcome.decision === "admit");
    const rejected =
      (outcome.kind === "final" && !outcome.response.granted) ||
      (outcome.kind === "offlineRecorded" && outcome.decision === "reject") ||
      (outcome.kind === "offline" && outcome.verdict !== "stale") ||
      outcome.kind === "unreadable";
    if (admitted) setSession((c) => ({ ...c, admitted: c.admitted + 1 }));
    else if (rejected) setSession((c) => ({ ...c, rejected: c.rejected + 1 }));
  }, [outcome]);

  useEffect(() => {
    // Al salir del escaner se libera el puerto serie (si no, queda tomado hasta cerrar la pestana).
    return () => void serialDisconnect?.();
  }, [serialDisconnect]);

  useEffect(() => {
    // Un autocierre pendiente no debe dispararse despues de salir del escaner.
    const timers = dismissTimerRef;
    return () => {
      if (timers.current !== null) clearTimeout(timers.current);
    };
  }, []);

  async function toggleSerial() {
    setSerialError(null);
    if (serialDisconnect) {
      await serialDisconnect();
      setSerialDisconnect(null);
      return;
    }
    try {
      // La lectura por puerto serie llega por el mismo camino que la pistola en modo teclado.
      const disconnect = await connectSerialScanner(
        (text) => void handleWedgeScan(text),
        () => {
          setSerialDisconnect(null);
          setSerialError("Se desconectó la pistola lectora.");
        },
      );
      setSerialDisconnect(() => disconnect);
    } catch (err) {
      // Cerrar el selector de puerto sin elegir no es un error.
      if (err instanceof DOMException && err.name === "NotFoundError") return;
      setSerialError(err instanceof Error ? err.message : "No se pudo abrir el puerto de la pistola");
    }
  }

  async function handleWedgeScan(raw: string) {
    const current = outcomeRef.current;
    // Mientras el guardia decide sobre una persona, una nueva lectura espera.
    if (isDecisionInProgress(current)) return;
    let text: string;
    try {
      text = normalizeScannedText(raw);
    } catch (err) {
      busyRef.current = true;
      setOutcome({ kind: "unreadable", message: err instanceof Error ? err.message : "Lectura inválida" });
      return;
    }
    // Una lectura nueva reemplaza el resultado anterior (no hace falta tocar "Siguiente").
    if (current) next();
    lastQrRef.current = null;
    await handleScan(text);
  }

  function pauseCamera() {
    try {
      // Con el modulo biometrico encendido se deja de decodificar QR pero el video sigue vivo, para
      // que el guardia levante el telefono hacia la cara sin reiniciar la camara (ADR-16). Apagado,
      // se congela la imagen como siempre.
      scannerRef.current?.pause(!biometricsEnabled());
    } catch {
      // sin camara activa (p. ej. lectura desde imagen)
    }
  }

  function resumeCamera() {
    try {
      scannerRef.current?.resume();
    } catch {
      // idem
    }
  }

  function cancelDismiss() {
    if (dismissTimerRef.current !== null) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = null;
  }

  /** Cierra solo el resultado de un ingreso concedido, salvo que antes llegue otra lectura. */
  function scheduleDismiss() {
    cancelDismiss();
    dismissTimerRef.current = setTimeout(() => {
      dismissTimerRef.current = null;
      next();
    }, GRANTED_DISMISS_MS);
  }

  function adoptOthers() {
    setQueue(adoptOtherQueues(owner));
    setOtherPending(0);
  }

  function next() {
    cancelDismiss();
    setOutcome(null);
    setComparison(null);
    setFaceConsent(false);
    busyRef.current = false;
    resumeCamera();
  }

  /** Compara la foto firmada del QR con lo que ve la camara. Se dispara SOLO cuando la persona ya
   * consintio ante el guardia: nunca en automatico, porque el consentimiento tiene que ser expreso y
   * la via no biometrica queda siempre disponible (docs/ley-21719.md §4 y §5). */
  async function compareFace(photo: Uint8Array) {
    setFaceConsent(true);
    const video = document.getElementById(SCANNER_ELEMENT_ID)?.querySelector("video");
    if (!video) {
      setComparison({ error: "La camara no esta disponible" });
      return;
    }
    setComparison("running");
    try {
      // Ni el fotograma ni los vectores salen de compareFaceToCamera: solo el puntaje.
      setComparison(await compareFaceToCamera(photo, video));
    } catch (err) {
      setComparison({ error: err instanceof Error ? err.message : "No se pudo comparar" });
    }
  }

  async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    // Sin camara (p. ej. en un computador): se lee el QR desde una foto o captura de la pantalla del telefono.
    const file = e.target.files?.[0];
    e.target.value = "";
    // Misma regla que la pistola: una lectura nueva no pisa la decision en curso (el boton ya esta
    // deshabilitado mientras tanto; esto cubre una seleccion que llegue igual).
    if (!file || isDecisionInProgress(outcomeRef.current)) return;
    try {
      const text = await new Html5Qrcode(FILE_SCANNER_ELEMENT_ID, READER_CONFIG).scanFile(file, false);
      lastQrRef.current = null;
      busyRef.current = false;
      await handleScan(text);
    } catch {
      setOutcome({ kind: "unreadable", message: "No se encontró un QR legible en la imagen" });
    }
  }

  async function handleScan(qrText: string) {
    // La camara ve el mismo QR varias veces por segundo: se procesa una sola vez.
    if (!token || busyRef.current || qrText === lastQrRef.current) return;
    const verifier = verifierRef.current;
    if (!verifier) return;
    // Lectura nueva (p. ej. desde imagen): el autocierre del resultado anterior ya no aplica.
    cancelDismiss();
    busyRef.current = true;
    lastQrRef.current = qrText;
    pauseCamera();

    let contents;
    let identity: IdentityCore;
    try {
      contents = decodeQr(qrText, verifier.verifierSecret);
      identity = checkQr(contents, verifier.issuerPublic);
    } catch (err) {
      vibrate([90, 60, 90]);
      setOutcome({ kind: "unreadable", message: err instanceof CredentialError ? err.message : "QR inválido" });
      return;
    }
    const gate = gateIdRef.current;
    if (gate === null) {
      setOutcome({ kind: "unreadable", message: "Elige la fila antes de escanear" });
      return;
    }
    const seen: Seen = {
      identity,
      photo: contents.photo,
      payload: validatePayload(contents, gate),
      credentialId: credentialId(contents.core),
    };
    // La foto aparece de inmediato; el servidor verifica (sin registrar) en paralelo.
    setOutcome({ ...seen, kind: "checking" });
    try {
      const response = await api.validateQr(token, { ...seen.payload, action: "check" });
      setOnline(true);
      if (response.pending) {
        vibrate(60);
        setOutcome({ ...seen, kind: "pending" });
      } else {
        vibrate([90, 60, 90]);
        setOutcome({ ...seen, kind: "final", response });
      }
    } catch (err) {
      if (!isConnectivityError(err)) {
        setOutcome({ kind: "unreadable", message: err instanceof Error ? err.message : "Error del servidor" });
        return;
      }
      // Sin red: se decide con la copia de contingencia y con lo que este lector ya registro.
      setOnline(false);
      const copy = contingencyRef.current;
      const verdict = evaluateOffline({
        contingency: copy,
        eventId: eventIdRef.current,
        now: serverNow(),
        freshness: localFreshness(verifier, contents.issuedAt),
        rut: identity.rut,
        credentialId: seen.credentialId,
        nonce: seen.payload.nonce,
        ledger: ledgerRef.current,
      });
      vibrate(verdict === "ok" ? 60 : [90, 60, 90]);
      setOutcome(
        verdict === "ok" ? { ...seen, kind: "offlinePending", evaluatedWith: copy } : { ...seen, kind: "offline", verdict },
      );
    }
  }

  function recordOffline(seen: Seen, decision: "admit" | "reject") {
    const now = serverNow();
    // La copia sellada con que se decidio: el servidor solo cree scanned_at dentro de su vigencia. Si
    // la lectura se evaluo sin red, va esa copia aunque haya vencido mientras el guardia miraba la
    // foto; si la red se cayo al confirmar (hubo "check" en linea), la copia actual.
    const copy = seen.evaluatedWith ?? contingencyRef.current;
    const queued: QueuedDecision = {
      rut: seen.identity.rut,
      decision: {
        decision,
        scanned_at: Math.floor(now),
        ...sealFields(copy, eventIdRef.current),
        gate_id: seen.payload.gate_id,
        nonce: seen.payload.nonce,
        issued_at: seen.payload.issued_at,
        device_sig: seen.payload.device_sig,
        credential_core: seen.payload.credential_core,
        issuer_sig: seen.payload.issuer_sig,
        ...(faceConsent ? { face_consent: true } : {}),
      },
    };
    ledgerRef.current = recordInLedger(ledgerRef.current, queued);
    setQueue((q) => {
      const updated = [...q, queued];
      saveQueue(owner, updated);
      return updated;
    });
    vibrate(decision === "admit" ? 120 : [90, 60, 90]);
    setOutcome({ ...seen, kind: "offlineRecorded", decision });
    if (decision === "admit") scheduleDismiss();
  }

  async function decide(seen: Seen, samePerson: boolean, offline = false) {
    if (!token) return;
    if (offline) {
      recordOffline(seen, samePerson ? "admit" : "reject");
      return;
    }
    setOutcome({ ...seen, kind: "deciding" });
    try {
      const response = await api.validateQr(token, {
        ...seen.payload,
        action: samePerson ? "admit" : "reject",
        ...(faceConsent ? { face_consent: true } : {}),
      });
      vibrate(response.granted ? 120 : [90, 60, 90]);
      setOutcome({ ...seen, kind: "final", response });
      if (response.granted) scheduleDismiss();
    } catch (err) {
      if (!isConnectivityError(err)) {
        setOutcome({ kind: "unreadable", message: err instanceof Error ? err.message : "Error del servidor" });
        return;
      }
      // La red se cayo justo al confirmar: la decision del guardia queda pendiente y se envia despues
      // (si el servidor alcanzo a registrarla, la sincronizacion no la duplica).
      setOnline(false);
      recordOffline(seen, samePerson ? "admit" : "reject");
    }
  }

  const contingencyUsable = isContingencyUsable(contingencyRef.current, serverNow());
  const contingencyMinutes = contingencyRef.current ? Math.floor(contingencyAge(contingencyRef.current, serverNow()) / 60) : null;
  // Con red o sin ella: la copia trae la fecha de la lista de revocadas que usa el servidor (ADR-14).
  const revocation = revocationWarning(contingencyRef.current);
  const decisionInProgress = isDecisionInProgress(outcome);

  // Con la pistola conectada, que no haya camara no es un problema.
  const status =
    keysError ??
    gatesError ??
    serialError ??
    (serialDisconnect ? null : cameraError) ??
    (keysReady || eventId === null ? null : "Cargando claves del evento…");

  return (
    <div className="on-dark fixed inset-0 z-[60] flex flex-col bg-black text-white">
      {/* Barra superior: acciones arriba; evento y fila a lo ancho (en un celular no caben en una fila) */}
      <div className="absolute inset-x-0 top-0 z-20 space-y-2 bg-gradient-to-b from-black/90 via-black/70 to-transparent px-3 pb-8 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/historial")}
            aria-label="Salir del escáner"
            className="grid size-11 shrink-0 place-items-center rounded-md bg-white/12 hover:bg-white/20"
          >
            <X className="size-5" />
          </button>
          <p className="flex-1 text-[17px] font-semibold">Escanear cédula</p>
          {isSerialSupported() && (
            <button
              onClick={() => void toggleSerial()}
              aria-label={serialDisconnect ? "Desconectar pistola lectora" : "Conectar pistola lectora por puerto serie"}
              title={serialDisconnect ? "Pistola conectada (tocar para desconectar)" : "Conectar pistola lectora (puerto serie)"}
              className={`grid size-11 shrink-0 place-items-center rounded-md ${serialDisconnect ? "bg-ok" : "bg-white/12 hover:bg-white/20"}`}
            >
              <Usb className="size-5" />
            </button>
          )}
          <label
            aria-label="Leer QR desde una imagen"
            title={decisionInProgress ? "Termina primero la decisión en curso" : "Leer QR desde una imagen"}
            aria-disabled={decisionInProgress}
            className={`grid size-11 shrink-0 place-items-center rounded-md bg-white/12 ${decisionInProgress ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:bg-white/20"}`}
          >
            <ImageUp className="size-5" />
            <input
              type="file"
              accept="image/*"
              onChange={handleImage}
              disabled={decisionInProgress}
              data-testid="leer-imagen"
              className="hidden"
            />
          </label>
        </div>
        <div className="grid grid-cols-[3fr_2fr] gap-2">
          <select
            value={eventId ?? ""}
            onChange={(e) => {
              setEventId(Number(e.target.value));
              e.target.blur(); // que la pistola lectora no escriba en el selector
            }}
            aria-label="Evento"
            className="w-full min-w-0 truncate rounded-md border border-white/20 bg-black/40 px-3 py-2.5 text-[14px] font-medium [&>option]:text-black"
          >
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name}
              </option>
            ))}
          </select>
          <select
            value={gateId ?? ""}
            onChange={(e) => {
              setGateId(Number(e.target.value));
              e.target.blur();
            }}
            aria-label="Fila"
            className="w-full min-w-0 truncate rounded-md border border-white/20 bg-black/40 px-3 py-2.5 text-[14px] font-medium [&>option]:text-black"
          >
            {gates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-md bg-black/60 px-2.5 py-1.5 text-[13px] font-semibold text-white/80">
            Ingresos <span className="tnum text-white">{session.admitted}</span>
          </span>
          <span className="rounded-md bg-black/60 px-2.5 py-1.5 text-[13px] font-semibold text-white/80">
            Rechazos <span className="tnum text-white">{session.rejected}</span>
          </span>
          {serialDisconnect && (
            <span className="flex items-center gap-1.5 rounded-md bg-ok px-2.5 py-1.5 text-[13px] font-semibold">
              <Usb className="size-4" /> Pistola conectada
            </span>
          )}
          {!online && (
            <span className="flex items-center gap-1.5 rounded-md bg-warn-band px-2.5 py-1.5 text-[13px] font-semibold text-on-warn">
              <WifiOff className="size-4" />
              {contingencyUsable ? `Sin conexión, copia de hace ${contingencyMinutes} min` : "Sin conexión y sin copia vigente"}
            </span>
          )}
          {queue.length > 0 && (
            <span className="flex items-center gap-1.5 rounded-md bg-black/60 px-2.5 py-1.5 text-[13px] font-semibold text-warn-band">
              <CloudUpload className="size-4" /> {queue.length} por sincronizar
            </span>
          )}
        </div>
        {contingencyGeneratedAt === null && online && eventId !== null && (
          <p className="text-[13px] text-white/75">Descargando copia de contingencia…</p>
        )}
        {syncProblem && (
          <p role="alert" className="flex items-start gap-1.5 rounded-md bg-bad px-3 py-2 text-[13px] font-semibold leading-snug">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {syncProblem}
          </p>
        )}
        {otherPending > 0 && (
          <div role="status" className="flex flex-wrap items-center gap-2 rounded-md bg-warn-band px-3 py-2 text-[13px] font-semibold leading-snug text-on-warn">
            <CloudUpload className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">
              {otherPending === 1 ? "Hay 1 decisión" : `Hay ${otherPending} decisiones`} sin conexión de otra cuenta en este
              lector. Se envían cuando esa persona vuelva a entrar aquí; si no volverá, envíalas tú y quedarán a tu nombre.
            </span>
            <button onClick={adoptOthers} className="rounded-md bg-on-warn px-3 py-1.5 text-[13px] font-semibold text-white">
              Enviar a mi nombre
            </button>
          </div>
        )}
        {revocation && (
          <p role="status" className="flex items-start gap-1.5 rounded-md bg-warn-band px-3 py-2 text-[13px] font-semibold leading-snug text-on-warn">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {revocation.kind === "missing"
              ? "Sin lista de cédulas revocadas: un teléfono reportado como perdido pasaría como válido. Ante la duda, pide el carnet."
              : `Lista de cédulas revocadas de hace ${revocation.minutes} min: no se ven los reportes de pérdida recientes. Ante la duda, pide el carnet.`}
          </p>
        )}
      </div>

      {/* Camara a pantalla completa */}
      <div className="relative flex-1 overflow-hidden">
        <div id={SCANNER_ELEMENT_ID} className="absolute inset-0 [&_video]:!h-full [&_video]:!w-full [&_video]:!object-cover" />
        <div id={FILE_SCANNER_ELEMENT_ID} className="hidden" />
        {!outcome && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="relative size-[min(72vw,340px)]">
              {[
                "left-0 top-0 border-l-[3px] border-t-[3px]",
                "right-0 top-0 border-r-[3px] border-t-[3px]",
                "bottom-0 left-0 border-b-[3px] border-l-[3px]",
                "bottom-0 right-0 border-b-[3px] border-r-[3px]",
              ].map((corner) => (
                <span key={corner} className={`absolute size-10 border-white/85 ${corner}`} />
              ))}
            </div>
          </div>
        )}
        {!outcome && (
          <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 bg-gradient-to-t from-black/85 to-transparent px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-10">
            {syncReport && <SyncReport report={syncReport} onClose={() => setSyncReport(null)} />}
            {status ? (
              <p className="flex max-w-[480px] items-start gap-2 rounded-md bg-bad px-4 py-2.5 text-[14px] font-medium">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {status}
                {status === gatesError && (
                  // Tambien se reintenta solo cada pocos segundos (useEventSelection).
                  <button onClick={retryGates} className="ml-auto shrink-0 rounded-md bg-white px-3 py-1 text-[13px] font-semibold text-bad">
                    Reintentar
                  </button>
                )}
              </p>
            ) : (
              <p className="rounded-md bg-black/60 px-4 py-2 text-[14px] font-medium">
                {serialDisconnect ? "Pistola conectada: dispara al QR de la persona" : "Apunta al QR o escanéalo con la pistola lectora"}
              </p>
            )}
          </div>
        )}
      </div>

      {outcome && (
        <ResultSheet
          outcome={outcome}
          onDecide={decide}
          onNext={next}
          comparison={comparison}
          onFaceStep={setComparison}
          onCompare={compareFace}
        />
      )}
    </div>
  );
}

function BigIdentity({ identity, photo }: { identity: IdentityCore; photo: Uint8Array }) {
  const src = useMemo(() => photoDataUrl(photo), [photo]);
  return (
    <div className="flex items-center gap-4 rounded-[18px] bg-paper p-3">
      <img src={src} alt={`Foto de ${identity.name}`} className="h-[200px] w-[150px] shrink-0 rounded-[12px] bg-white object-cover shadow-soft" />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink-2">Firmado por el Registro Civil</p>
        <p className="mt-1 text-balance text-[24px] font-extrabold leading-tight text-ink">{identity.name}</p>
        <p className="tnum mt-1.5 text-[17px] font-medium text-ink-2">RUN {formatRut(identity.rut)}</p>
      </div>
    </div>
  );
}

type Tone = "good" | "bad" | "info" | "warn" | "neutral";

// El guardia mira a la persona, no la pantalla: la franja superior toma el color del veredicto para
// leerlo de reojo. Verde = pasa, rojo = no pasa, azul oscuro = falta su decision, ambar = sin conexion
// (falta su decision o hay que derivar a la persona). Es el unico lugar de la app con color pleno.
const SHEET_TONE: Record<Tone, string> = {
  good: "bg-ok text-white",
  bad: "bg-bad text-white",
  info: "bg-wait text-white",
  warn: "bg-warn-band text-on-warn",
  neutral: "bg-paper text-ink",
};

function SyncReport({ report, onClose }: { report: { synced: number; alerts: OfflineSyncResult[] }; onClose: () => void }) {
  const alerts = report.alerts.length;
  return (
    <div
      role="status"
      className={`flex w-full max-w-[480px] items-start gap-2 rounded-md px-4 py-2.5 text-[14px] ${alerts ? "bg-bad" : "bg-ok"}`}
    >
      <CloudUpload className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          Sincronizado: {report.synced} {report.synced === 1 ? "decisión tomada" : "decisiones tomadas"} sin conexión
        </p>
        {alerts > 0 && (
          <ul className="mt-1 space-y-0.5">
            {report.alerts.map((a) => (
              // El servidor no habria dejado pasar a esta persona: queda como alerta en el historial.
              <li key={a.nonce}>Alerta: entró sin conexión, pero {(REASON_LABEL[a.reason] ?? a.reason).toLowerCase()}</li>
            ))}
          </ul>
        )}
      </div>
      <button onClick={onClose} aria-label="Cerrar aviso" className="shrink-0 rounded-md p-0.5 hover:bg-white/15">
        <X className="size-4" />
      </button>
    </div>
  );
}

/** Bloque de comparacion biometrica (ADR-16). Solo se muestra con el modulo encendido.
 *
 * El puntaje es informacion para el guardia, no un veredicto: los botones de decidir son los
 * mismos de siempre y siguen siendo suyos. Por eso este bloque nunca decide ni bloquea nada.
 */
function FaceCheck({
  comparison,
  onStep,
  onCompare,
}: {
  comparison: FaceState;
  onStep: (next: FaceState) => void;
  onCompare: () => void;
}) {
  if (comparison === null) {
    return (
      <button
        type="button"
        onClick={() => onStep("consent")}
        className="btn btn-secondary mt-4 w-full"
      >
        Comparar rostro (opcional)
      </button>
    );
  }
  if (comparison === "consent") {
    // Lo que el art. 16 ter inc. 2 de la Ley 19.628 exige informar y el consentimiento expreso del
    // art. 16 (docs/ley-21719.md §4). Negarse no cambia nada: sigue la revision visual (§5).
    return (
      <div className="mt-4 rounded-md border border-line px-3 py-3 text-[14px] leading-5 text-ink">
        <p className="font-semibold">Antes de comparar, pregúntale a la persona si acepta:</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-ink-2">
          <li>Este lector compara su rostro con la foto firmada de su cédula.</li>
          <li>Es solo para confirmar su identidad en este ingreso.</li>
          <li>La imagen se usa durante la comparación y no se guarda.</li>
          <li>Puede negarse o retirar su consentimiento sin dar motivos, y sigue con la revisión visual. Sus derechos los ejerce ante el recinto.</li>
        </ul>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onStep("declined")} className="btn btn-secondary">
            No acepta
          </button>
          <button type="button" onClick={onCompare} className="btn btn-primary">
            Acepta: comparar
          </button>
        </div>
      </div>
    );
  }
  if (comparison === "declined") {
    return <p className="mt-4 text-[15px] text-ink-2">Sin comparación facial: compara tú la foto con la persona.</p>;
  }
  if (comparison === "running") {
    return <p className="mt-4 text-[15px] text-ink-2">Comparando…</p>;
  }
  if ("error" in comparison) {
    return <p className="mt-4 text-[15px] text-ink-2">{comparison.error}</p>;
  }
  // Sin detector de rostros: el puntaje dice cuánto se parecen dos imágenes, no que haya una persona
  // frente a la cámara (docs/results/biometric-noface-check.md). Por eso no afirma que el rostro coincida.
  const percent = (value: number) => (value * 100).toFixed(1).replace(".", ",");
  return (
    <div className="mt-4 rounded-md border border-line px-3 py-2 text-ink">
      <p className="tnum text-[15px] font-semibold">
        {comparison.match ? "Sobre la referencia" : "Bajo la referencia"} · {percent(comparison.score)} %
      </p>
      <p className="tnum text-[13px] text-ink-2">
        Referencia: {percent(comparison.threshold)} %. No comprueba que haya un rostro ni detecta una foto. Decide tú.
      </p>
    </div>
  );
}

function ResultSheet({
  outcome,
  onDecide,
  onNext,
  comparison,
  onFaceStep,
  onCompare,
}: {
  outcome: Outcome;
  onDecide: (seen: Seen, samePerson: boolean, offline?: boolean) => void;
  onNext: () => void;
  comparison: FaceState;
  onFaceStep: (next: FaceState) => void;
  onCompare: (photo: Uint8Array) => void;
}) {
  const nextButton = (
    <button onClick={onNext} className="btn btn-primary btn-lg mt-5 py-4 text-[17px]">
      Siguiente
    </button>
  );
  const decisionButtons = (seen: Seen, offline: boolean) => (
    <div className="mt-5 grid grid-cols-2 gap-3">
      <button
        onClick={() => onDecide(seen, false, offline)}
        className="btn btn-lg bg-bad-soft py-4 text-[17px] text-bad hover:bg-[#fbd6d2]"
      >
        <UserX className="size-6" /> No coincide
      </button>
      <button
        onClick={() => onDecide(seen, true, offline)}
        className="btn btn-lg bg-ok py-4 text-[17px] text-white shadow-[0_8px_18px_rgba(19,128,74,.25)] hover:bg-ok-strong"
      >
        <UserCheck className="size-6" /> Dejar pasar
      </button>
    </div>
  );

  let tone: Tone;
  let icon: React.ReactNode;
  let title: string;
  let detail: string | undefined;
  let actions = nextButton;

  if (outcome.kind === "unreadable") {
    tone = "bad";
    icon = <XCircle className="size-8 shrink-0" />;
    title = REASON_LABEL.invalid;
    detail = outcome.message;
  } else if (outcome.kind === "checking" || outcome.kind === "deciding") {
    tone = "neutral";
    icon = <Loader2 className="size-8 shrink-0 animate-spin" />;
    title = outcome.kind === "checking" ? "Verificando entrada…" : "Registrando…";
    actions = <div className="mt-5 h-[60px]" />;
  } else if (outcome.kind === "pending") {
    tone = "info";
    icon = <ShieldAlert className="size-8 shrink-0" />;
    title = "Cédula válida y con entrada";
    detail = "¿Es la persona que tienes al frente?";
    actions = decisionButtons(outcome, false);
  } else if (outcome.kind === "offlinePending") {
    tone = "warn";
    icon = <WifiOff className="size-8 shrink-0" />;
    title = "Sin conexión: cédula válida y con entrada";
    detail = "¿Es la persona que tienes al frente? Tu decisión se enviará al servidor cuando vuelva la red.";
    actions = decisionButtons(outcome, true);
  } else if (outcome.kind === "offlineRecorded") {
    tone = outcome.decision === "admit" ? "good" : "bad";
    icon = outcome.decision === "admit" ? <CheckCircle2 className="size-9" /> : <XCircle className="size-9" />;
    title = outcome.decision === "admit" ? "Ingreso registrado sin conexión" : REASON_LABEL.photo_mismatch;
    detail = "Queda guardado en este lector y se enviará al servidor cuando vuelva la red.";
    if (outcome.decision === "admit") actions = <div className="mt-5 h-[60px]" />;
  } else if (outcome.kind === "offline" && outcome.verdict === "stale") {
    // Protocolo sin conexion (ADR-15): sin datos recientes, este lector no deja pasar a nadie.
    tone = "warn";
    icon = <WifiOff className="size-8 shrink-0" />;
    title = "Sin conexión y sin datos recientes";
    detail = "No dejes pasar con este lector. Deriva a la persona a la fila normal (revisión con carnet físico).";
  } else if (outcome.kind === "offline") {
    tone = "bad";
    icon = <XCircle className="size-8 shrink-0" />;
    title = REASON_LABEL[outcome.verdict] ?? outcome.verdict;
    detail = "Sin conexión: según la copia de contingencia de este lector.";
  } else if (outcome.response.granted) {
    tone = "good";
    icon = <CheckCircle2 className="size-8 shrink-0" />;
    title = "Ingreso registrado";
    actions = <div className="mt-5 h-[60px]" />;
  } else {
    tone = "bad";
    icon = <XCircle className="size-8 shrink-0" />;
    title = REASON_LABEL[outcome.response.reason] ?? outcome.response.reason;
  }

  return (
    <div
      role="status"
      aria-live="assertive"
      className="absolute inset-x-0 bottom-0 z-30 mx-auto max-h-[88vh] w-full max-w-[560px] overflow-y-auto rounded-t-[26px] bg-surface text-ink shadow-[0_-12px_32px_rgba(20,32,57,.22)]"
    >
      <div className={`flex items-start gap-3 px-5 pb-4 pt-5 ${SHEET_TONE[tone]}`}>
        {icon}
        <div className="min-w-0">
          <p className="text-[22px] font-extrabold leading-tight">{title}</p>
          {detail && <p className="mt-1 text-[15px] leading-snug opacity-90">{detail}</p>}
        </div>
      </div>
      <div className="px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4">
      {outcome.kind !== "unreadable" && (
        <div>
          <BigIdentity identity={outcome.identity} photo={outcome.photo} />
          {/* Solo si queda una decisión por tomar: comparar a alguien ya rechazado o ya admitido sería
              tratar un dato sensible sin finalidad (art. 3 c, docs/ley-21719.md §6). */}
          {biometricsEnabled() && (outcome.kind === "pending" || outcome.kind === "offlinePending") && (
            <FaceCheck comparison={comparison} onStep={onFaceStep} onCompare={() => onCompare(outcome.photo)} />
          )}
        </div>
      )}
      {actions}
      </div>
    </div>
  );
}
