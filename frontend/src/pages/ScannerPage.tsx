import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { CheckCircle2, CloudUpload, ImageUp, Loader2, ShieldAlert, TriangleAlert, Usb, UserCheck, UserX, WifiOff, X, XCircle } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api, type Contingency, type OfflineSyncResult, type QRValidateRequest, type QRValidateResponse, type VerifierKeys } from "../api";
import { installBarcodeDetector } from "../barcodeDetector";
import { KeyboardWedge, normalizeScannedText } from "../keyboardWedge";
import {
  contingencyAge,
  emptyLedger,
  evaluateOffline,
  isConnectivityError,
  isContingencyUsable,
  loadQueue,
  recordInLedger,
  saveQueue,
  type OfflineVerdict,
  type QueuedDecision,
} from "../offline";
import { connectSerialScanner, isSerialSupported } from "../serialScanner";
import { b64decode, checkQr, credentialId, CredentialError, decodeQr, photoDataUrl, validatePayload, type IdentityCore } from "../credential";
import { REASON_LABEL } from "../reasons";
import { formatRut } from "../rut";
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

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // no todos los navegadores lo permiten
  }
}

export function ScannerPage() {
  const { token } = useAuth();
  const navigate = useNavigate();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const busyRef = useRef(false);
  const lastQrRef = useRef<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [keysReady, setKeysReady] = useState(false);
  // Pistola por puerto serie: funcion para desconectarla, o null si no esta conectada.
  const [serialDisconnect, setSerialDisconnect] = useState<(() => Promise<void>) | null>(null);
  const [serialError, setSerialError] = useState<string | null>(null);
  // Lo que lleva este guardia en la sesion: da contexto sin ir al historial.
  const [session, setSession] = useState({ admitted: 0, rejected: 0 });
  const { events, gates, eventId, setEventId, gateId, setGateId } = useEventSelection(token);
  // El callback del lector se registra una sola vez; leer puerta y claves desde refs evita
  // que queden "congeladas" en el valor del primer render.
  const gateIdRef = useRef<number | null>(gateId);
  gateIdRef.current = gateId;
  const verifierRef = useRef<Verifier | null>(null);
  const outcomeRef = useRef<Outcome | null>(outcome);
  outcomeRef.current = outcome;
  // Contingencia sin conexion (ADR-15): copia del evento (solo en memoria), decisiones pendientes de
  // enviar (sobreviven a recargar) y memoria de uso unico de este lector.
  const contingencyRef = useRef<Contingency | null>(null);
  const [contingencyGeneratedAt, setContingencyGeneratedAt] = useState<number | null>(null);
  const [online, setOnline] = useState(true);
  const [queue, setQueue] = useState<QueuedDecision[]>(() => loadQueue());
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const ledgerRef = useRef(queue.reduce(recordInLedger, emptyLedger()));
  const [syncReport, setSyncReport] = useState<{ synced: number; alerts: OfflineSyncResult[] } | null>(null);
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
    // Envia lo decidido sin red apenas vuelve la conexion (y reintenta cada 15 s).
    if (!token) return;
    let running = false;
    async function flush() {
      const pending = queueRef.current;
      if (running || pending.length === 0) return;
      running = true;
      try {
        const results = await api.syncOffline(token!, pending.map((q) => q.decision));
        const sent = new Set(results.map((r) => r.nonce));
        setQueue((q) => {
          const rest = q.filter((item) => !sent.has(item.decision.nonce));
          saveQueue(rest);
          return rest;
        });
        setSyncReport({ synced: results.length, alerts: results.filter((r) => r.alert) });
        setOnline(true);
      } catch (err) {
        if (isConnectivityError(err)) setOnline(false);
      } finally {
        running = false;
      }
    }
    void flush();
    const timer = setInterval(() => void flush(), SYNC_RETRY_MS);
    window.addEventListener("online", flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", flush);
    };
  }, [token, queue.length]);

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
    if (current && ["checking", "pending", "deciding", "offlinePending"].includes(current.kind)) return;
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
      scannerRef.current?.pause(true);
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

  function next() {
    setOutcome(null);
    busyRef.current = false;
    resumeCamera();
  }

  async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    // Sin camara (p. ej. en un computador): se lee el QR desde una foto o captura de la pantalla del telefono.
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
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
      const verdict = evaluateOffline({
        contingency: contingencyRef.current,
        now: serverNow(),
        freshness: localFreshness(verifier, contents.issuedAt),
        rut: identity.rut,
        credentialId: seen.credentialId,
        nonce: seen.payload.nonce,
        ledger: ledgerRef.current,
      });
      vibrate(verdict === "ok" ? 60 : [90, 60, 90]);
      setOutcome(verdict === "ok" ? { ...seen, kind: "offlinePending" } : { ...seen, kind: "offline", verdict });
    }
  }

  function recordOffline(seen: Seen, decision: "admit" | "reject") {
    const queued: QueuedDecision = {
      rut: seen.identity.rut,
      decision: {
        decision,
        scanned_at: Math.floor(serverNow()),
        gate_id: seen.payload.gate_id,
        nonce: seen.payload.nonce,
        issued_at: seen.payload.issued_at,
        device_sig: seen.payload.device_sig,
        credential_core: seen.payload.credential_core,
        issuer_sig: seen.payload.issuer_sig,
      },
    };
    ledgerRef.current = recordInLedger(ledgerRef.current, queued);
    setQueue((q) => {
      const updated = [...q, queued];
      saveQueue(updated);
      return updated;
    });
    vibrate(decision === "admit" ? 120 : [90, 60, 90]);
    setOutcome({ ...seen, kind: "offlineRecorded", decision });
    if (decision === "admit") setTimeout(() => next(), GRANTED_DISMISS_MS);
  }

  async function decide(seen: Seen, samePerson: boolean, offline = false) {
    if (!token) return;
    if (offline) {
      recordOffline(seen, samePerson ? "admit" : "reject");
      return;
    }
    setOutcome({ ...seen, kind: "deciding" });
    try {
      const response = await api.validateQr(token, { ...seen.payload, action: samePerson ? "admit" : "reject" });
      vibrate(response.granted ? 120 : [90, 60, 90]);
      setOutcome({ ...seen, kind: "final", response });
      if (response.granted) setTimeout(() => next(), GRANTED_DISMISS_MS);
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

  // Con la pistola conectada, que no haya camara no es un problema.
  const status =
    keysError ?? serialError ?? (serialDisconnect ? null : cameraError) ?? (keysReady || eventId === null ? null : "Cargando claves del evento…");

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black text-white">
      {/* Barra superior: acciones arriba; evento y fila a lo ancho (en un celular no caben en una fila) */}
      <div className="absolute inset-x-0 top-0 z-20 space-y-2 bg-gradient-to-b from-black/85 via-black/60 to-transparent px-3 pb-8 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/historial")}
            aria-label="Salir del escáner"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-white/15 backdrop-blur"
          >
            <X className="size-5" />
          </button>
          <p className="flex-1 text-[17px] font-extrabold">Escanear cédula</p>
          {isSerialSupported() && (
            <button
              onClick={() => void toggleSerial()}
              aria-label={serialDisconnect ? "Desconectar pistola lectora" : "Conectar pistola lectora por puerto serie"}
              title={serialDisconnect ? "Pistola conectada (tocar para desconectar)" : "Conectar pistola lectora (puerto serie)"}
              className={`grid size-11 shrink-0 place-items-center rounded-full backdrop-blur ${serialDisconnect ? "bg-[#0e806c]" : "bg-white/15"}`}
            >
              <Usb className="size-5" />
            </button>
          )}
          <label
            aria-label="Leer QR desde una imagen"
            title="Leer QR desde una imagen"
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-white/15 backdrop-blur"
          >
            <ImageUp className="size-5" />
            <input type="file" accept="image/*" onChange={handleImage} className="hidden" />
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
            className="w-full min-w-0 truncate rounded-xl bg-white/15 px-3 py-2.5 text-[14px] font-bold outline-none backdrop-blur [&>option]:text-black"
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
            className="w-full min-w-0 truncate rounded-xl bg-white/15 px-3 py-2.5 text-[14px] font-bold outline-none backdrop-blur [&>option]:text-black"
          >
            {gates.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-black/55 px-3 py-1.5 text-[13px] font-bold backdrop-blur">
            <span className="text-[#6ff0d8]">Ingresos {session.admitted}</span>
            <span className="mx-1.5 text-white/40">·</span>
            <span className="text-[#ff9aa3]">Rechazos {session.rejected}</span>
          </span>
          {serialDisconnect && (
            <span className="flex items-center gap-1.5 rounded-full bg-[#0e806c] px-3 py-1.5 text-[13px] font-bold">
              <Usb className="size-4" /> Pistola conectada
            </span>
          )}
          {!online && (
            <span className="flex items-center gap-1.5 rounded-full bg-[#e0a526] px-3 py-1.5 text-[13px] font-extrabold text-[#3d2a04]">
              <WifiOff className="size-4" />
              {contingencyUsable ? `Sin conexión · copia de hace ${contingencyMinutes} min` : "Sin conexión · sin copia vigente"}
            </span>
          )}
          {queue.length > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-black/55 px-3 py-1.5 text-[13px] font-bold text-[#ffd98a] backdrop-blur">
              <CloudUpload className="size-4" /> {queue.length} por sincronizar
            </span>
          )}
        </div>
        {contingencyGeneratedAt === null && online && eventId !== null && (
          <p className="text-[12px] font-semibold text-white/70">Descargando copia de contingencia…</p>
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
                "left-0 top-0 rounded-tl-3xl border-l-4 border-t-4",
                "right-0 top-0 rounded-tr-3xl border-r-4 border-t-4",
                "bottom-0 left-0 rounded-bl-3xl border-b-4 border-l-4",
                "bottom-0 right-0 rounded-br-3xl border-b-4 border-r-4",
              ].map((corner) => (
                <span key={corner} className={`absolute size-12 border-[#3ee0c6] ${corner}`} />
              ))}
            </div>
          </div>
        )}
        {!outcome && (
          <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-10">
            {syncReport && <SyncReport report={syncReport} onClose={() => setSyncReport(null)} />}
            {status ? (
              <p className="flex max-w-[480px] items-start gap-2 rounded-2xl bg-[#c6505b]/90 px-4 py-2.5 text-[12px] font-semibold">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" /> {status}
              </p>
            ) : (
              <p className="rounded-full bg-white/15 px-4 py-2 text-[13px] font-bold backdrop-blur">
                {serialDisconnect ? "Pistola conectada: dispara al QR de la persona" : "Apunta al QR o escanéalo con la pistola lectora"}
              </p>
            )}
          </div>
        )}
      </div>

      {outcome && <ResultSheet outcome={outcome} onDecide={decide} onNext={next} />}
    </div>
  );
}

function BigIdentity({ identity, photo }: { identity: IdentityCore; photo: Uint8Array }) {
  const src = useMemo(() => photoDataUrl(photo), [photo]);
  return (
    <div className="flex items-center gap-4">
      <img src={src} alt={`Foto de ${identity.name}`} className="h-[200px] w-[150px] shrink-0 rounded-2xl bg-white object-cover shadow-md ring-4 ring-white" />
      <div className="min-w-0">
        <p className="text-[11px] font-extrabold uppercase tracking-[.14em] opacity-70">Firmado por el Registro Civil</p>
        <p className="mt-1 text-balance font-display text-[24px] font-extrabold leading-tight tracking-[-.02em]">{identity.name}</p>
        <p className="mt-1.5 font-mono text-[16px] font-medium opacity-80">RUN {formatRut(identity.rut)}</p>
      </div>
    </div>
  );
}

type Tone = "good" | "bad" | "info" | "warn" | "neutral";

// El guardia mira a la persona, no la pantalla: todo el panel toma el color del veredicto para
// leerlo de reojo. Verde = pasa, rojo = no pasa, azul = falta su decision, ambar = sin conexion
// (falta su decision o hay que derivar a la persona).
const SHEET_TONE: Record<Tone, string> = {
  good: "bg-[#dff6ee] text-[#0b5e50]",
  bad: "bg-[#fde6e6] text-[#8e2f39]",
  info: "bg-[#e6f1fb] text-[#1f456b]",
  warn: "bg-[#fff1d6] text-[#7a4f0c]",
  neutral: "bg-white text-[#173c47]",
};

function SyncReport({ report, onClose }: { report: { synced: number; alerts: OfflineSyncResult[] }; onClose: () => void }) {
  const alerts = report.alerts.length;
  return (
    <div
      role="status"
      className={`flex w-full max-w-[480px] items-start gap-2 rounded-2xl px-4 py-2.5 text-[13px] font-semibold ${alerts ? "bg-[#c6505b]/95" : "bg-[#0e806c]/95"}`}
    >
      <CloudUpload className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-extrabold">
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
      <button onClick={onClose} aria-label="Cerrar aviso" className="shrink-0 rounded-full p-0.5 hover:bg-white/15">
        <X className="size-4" />
      </button>
    </div>
  );
}

function ResultSheet({
  outcome,
  onDecide,
  onNext,
}: {
  outcome: Outcome;
  onDecide: (seen: Seen, samePerson: boolean, offline?: boolean) => void;
  onNext: () => void;
}) {
  const nextButton = (
    <button onClick={onNext} className="mt-5 w-full rounded-2xl bg-[#123f4a] py-4 text-[17px] font-extrabold text-white">
      Siguiente
    </button>
  );
  const decisionButtons = (seen: Seen, offline: boolean) => (
    <div className="mt-5 grid grid-cols-2 gap-3">
      <button
        onClick={() => onDecide(seen, false, offline)}
        className="flex items-center justify-center gap-2 rounded-2xl bg-white py-4 text-[17px] font-extrabold text-[#b23f4a] ring-2 ring-[#f0b9bf]"
      >
        <UserX className="size-6" /> No coincide
      </button>
      <button
        onClick={() => onDecide(seen, true, offline)}
        className="flex items-center justify-center gap-2 rounded-2xl bg-[#0e806c] py-4 text-[17px] font-extrabold text-white"
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
    icon = <XCircle className="size-9" />;
    title = REASON_LABEL.invalid;
    detail = outcome.message;
  } else if (outcome.kind === "checking" || outcome.kind === "deciding") {
    tone = "neutral";
    icon = <Loader2 className="size-9 animate-spin" />;
    title = outcome.kind === "checking" ? "Verificando entrada…" : "Registrando…";
    actions = <div className="mt-5 h-[60px]" />;
  } else if (outcome.kind === "pending") {
    tone = "info";
    icon = <ShieldAlert className="size-9" />;
    title = "Cédula válida y con entrada";
    detail = "¿Es la persona que tienes al frente?";
    actions = decisionButtons(outcome, false);
  } else if (outcome.kind === "offlinePending") {
    tone = "warn";
    icon = <WifiOff className="size-9" />;
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
    icon = <WifiOff className="size-9" />;
    title = "Sin conexión y sin datos recientes";
    detail = "No dejes pasar con este lector. Deriva a la persona a la fila normal (revisión con carnet físico).";
  } else if (outcome.kind === "offline") {
    tone = "bad";
    icon = <XCircle className="size-9" />;
    title = REASON_LABEL[outcome.verdict] ?? outcome.verdict;
    detail = "Sin conexión: según la copia de contingencia de este lector.";
  } else if (outcome.response.granted) {
    tone = "good";
    icon = <CheckCircle2 className="size-9" />;
    title = "Ingreso registrado";
    actions = <div className="mt-5 h-[60px]" />;
  } else {
    tone = "bad";
    icon = <XCircle className="size-9" />;
    title = REASON_LABEL[outcome.response.reason] ?? outcome.response.reason;
  }

  return (
    <div
      role="status"
      aria-live="assertive"
      className={`absolute inset-x-0 bottom-0 z-30 mx-auto max-h-[88vh] w-full max-w-[560px] overflow-y-auto rounded-t-[28px] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5 shadow-[0_-12px_40px_rgba(0,0,0,.35)] ${SHEET_TONE[tone]}`}
    >
      <div className="flex items-center gap-3">
        {icon}
        <div className="min-w-0">
          <p className="text-[22px] font-extrabold leading-tight">{title}</p>
          {detail && <p className="mt-0.5 text-[15px] font-semibold opacity-85">{detail}</p>}
        </div>
      </div>
      {outcome.kind !== "unreadable" && (
        <div className="mt-4">
          <BigIdentity identity={outcome.identity} photo={outcome.photo} />
        </div>
      )}
      {actions}
    </div>
  );
}
