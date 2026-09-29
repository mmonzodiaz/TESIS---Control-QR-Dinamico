import { useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { CheckCircle2, DoorOpen, ImageUp, Loader2, ScanLine, TriangleAlert, WifiOff, XCircle } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api, type QRValidateResponse, type VerifierKeys } from "../api";
import { installBarcodeDetector } from "../barcodeDetector";
import { IdentityCard } from "../components/IdentityCard";
import { b64decode, checkIdentity, CredentialError, decodeQr, validatePayload, type IdentityCore } from "../credential";
import { REASON_LABEL, REASON_TONE } from "../reasons";
import { useEventSelection } from "../useEventSelection";

const SCANNER_ELEMENT_ID = "qr-scanner-region";
const FILE_SCANNER_ELEMENT_ID = "qr-file-region";
// El QR lleva la foto y es denso: se lee con BarcodeDetector (nativo o polyfill ZXing-C++), no con zxing-js.
const READER_CONFIG = {
  verbose: false,
  formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
  useBarCodeDetectorIfSupported: true,
};
installBarcodeDetector();
// Tiempo antes de aceptar otro QR. El resultado queda en pantalla hasta el siguiente escaneo.
const SCAN_COOLDOWN_MS = 2500;

interface Verifier {
  eventId: number;
  eventSecret: Uint8Array;
  issuerPublic: Uint8Array;
  ttl: number;
  skew: number;
  /** server_time - reloj local, en segundos. */
  clockOffset: number;
}

type Outcome =
  | { kind: "unreadable"; message: string }
  | { kind: "checking"; identity: IdentityCore; photo: Uint8Array }
  | { kind: "final"; identity: IdentityCore; photo: Uint8Array; response: QRValidateResponse }
  | { kind: "offline"; identity: IdentityCore; photo: Uint8Array; localReason: string };

function toVerifier(keys: VerifierKeys): Verifier {
  return {
    eventId: keys.event_id,
    eventSecret: b64decode(keys.event_private_key),
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

export function ScannerPage() {
  const { token } = useAuth();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const busyRef = useRef(false);
  const lastQrRef = useRef<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [keysError, setKeysError] = useState<string | null>(null);
  const { events, gates, eventId, setEventId, gateId, setGateId } = useEventSelection(token);
  // El callback del lector se registra una sola vez; leer puerta y claves desde refs evita
  // que queden "congeladas" en el valor del primer render.
  const gateIdRef = useRef<number | null>(gateId);
  gateIdRef.current = gateId;
  const verifierRef = useRef<Verifier | null>(null);

  useEffect(() => {
    // Claves del evento elegido: con ellas el lector descifra y verifica el QR sin depender de la red.
    verifierRef.current = null;
    if (!token || eventId === null) return;
    setKeysError(null);
    api
      .verifierKeys(token, eventId)
      .then((keys) => {
        verifierRef.current = toVerifier(keys);
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
          qrbox: (width, height) => {
            const side = Math.floor(Math.min(width, height) * 0.85);
            return { width: side, height: side };
          },
        },
        (decodedText) => void handleScan(decodedText),
        undefined,
      )
      .catch((err) => setCameraError(String(err)));

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

  async function handleImage(e: React.ChangeEvent<HTMLInputElement>) {
    // Sin camara (p. ej. en un computador): se lee el QR desde una foto o captura de la pantalla del telefono.
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await new Html5Qrcode(FILE_SCANNER_ELEMENT_ID, READER_CONFIG).scanFile(file, false);
      lastQrRef.current = null;
      await handleScan(text);
    } catch {
      setOutcome({ kind: "unreadable", message: "No se encontro un QR legible en la imagen" });
    }
  }

  async function handleScan(qrText: string) {
    // La camara ve el mismo QR varias veces por segundo: se procesa una sola vez.
    if (!token || busyRef.current || qrText === lastQrRef.current) return;
    const verifier = verifierRef.current;
    if (!verifier) return;
    busyRef.current = true;
    lastQrRef.current = qrText;
    try {
      let contents;
      let identity: IdentityCore;
      try {
        contents = decodeQr(qrText, verifier.eventSecret);
        identity = checkIdentity(contents, verifier.issuerPublic);
      } catch (err) {
        setOutcome({ kind: "unreadable", message: err instanceof CredentialError ? err.message : "QR invalido" });
        return;
      }
      // La foto aparece de inmediato; el veredicto del servidor llega enseguida.
      setOutcome({ kind: "checking", identity, photo: contents.photo });
      try {
        const response = await api.validateQr(token, validatePayload(contents, gateIdRef.current));
        setOutcome({ kind: "final", identity, photo: contents.photo, response });
      } catch {
        const localReason = contents.eventId !== verifier.eventId ? "wrong_event" : localFreshness(verifier, contents.issuedAt);
        setOutcome({ kind: "offline", identity, photo: contents.photo, localReason });
      }
    } finally {
      setTimeout(() => {
        busyRef.current = false;
      }, SCAN_COOLDOWN_MS);
    }
  }

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-[480px]">
        <div className="mb-6 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.15em] text-[#1ba792]">
          <span className="size-1.5 rounded-full bg-[#1ba792]" /> Control de ingreso
        </div>
        <h1 className="font-display text-[26px] font-extrabold tracking-[-.05em] text-[#173c47]">Escanear QR de acceso</h1>
        <p className="mt-2 text-[13px] leading-6 text-[#82989a]">
          Apunta la camara al codigo que muestra la persona. Compara la foto que aparece con quien tienes al frente.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2 rounded-2xl border border-[#e3ebea] bg-white p-3">
          <label className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a2b2b3]">
            Evento
            <select
              value={eventId ?? ""}
              onChange={(e) => setEventId(Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-[#e4ecea] bg-[#fbfdfc] px-3 py-2 text-[12px] font-semibold normal-case tracking-normal text-[#274b53] outline-none"
            >
              {events.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] font-bold uppercase tracking-[.1em] text-[#a2b2b3]">
            <span className="flex items-center gap-1">
              <DoorOpen className="size-3" /> Fila
            </span>
            <select
              value={gateId ?? ""}
              onChange={(e) => setGateId(Number(e.target.value))}
              className="mt-1 w-full rounded-xl border border-[#e4ecea] bg-[#fbfdfc] px-3 py-2 text-[12px] font-semibold normal-case tracking-normal text-[#274b53] outline-none"
            >
              {gates.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-6 overflow-hidden rounded-[24px] border border-[#e3ebea] bg-white shadow-[0_12px_32px_rgba(37,73,79,.06)]">
          <div className="flex items-center gap-3 border-b border-[#edf2f1] px-6 py-5">
            <div className="grid size-10 place-items-center rounded-2xl bg-[#e5f7f1]">
              <ScanLine className="size-[19px] text-[#0e806c]" />
            </div>
            <div>
              <p className="font-display text-[14px] font-extrabold text-[#234953]">Lector de camara</p>
              <p className="text-[11px] text-[#96a8a9]">Escaneo continuo en vivo</p>
            </div>
          </div>

          <div className="p-6">
            <div id={SCANNER_ELEMENT_ID} className="overflow-hidden rounded-2xl border border-[#e3ebea] bg-[#0c2a32]" />

            {cameraError && (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-[#fdeceb] px-3 py-2.5 text-[11px] font-semibold text-[#c6505b]">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> No se pudo acceder a la camara: {cameraError}
              </p>
            )}
            <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-[#e4ecea] bg-[#fbfdfc] px-3 py-2 text-[11px] font-bold text-[#557276] hover:border-[#8dcfc3]">
              <ImageUp className="size-3.5" /> Leer QR desde una imagen
              <input type="file" accept="image/*" onChange={handleImage} className="hidden" />
            </label>
            <div id={FILE_SCANNER_ELEMENT_ID} className="hidden" />
            {keysError && (
              <p className="mt-4 flex items-start gap-2 rounded-xl bg-[#fdeceb] px-3 py-2.5 text-[11px] font-semibold text-[#c6505b]">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {keysError}
              </p>
            )}

            {outcome && <ScanResult outcome={outcome} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function ScanResult({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === "unreadable") {
    return (
      <div className={`mt-4 flex items-center gap-3 rounded-2xl px-4 py-3.5 ${REASON_TONE.invalid}`}>
        <XCircle className="size-5 shrink-0" />
        <div>
          <p className="text-[12px] font-extrabold">{REASON_LABEL.invalid}</p>
          <p className="text-[11px] font-semibold opacity-80">{outcome.message}</p>
        </div>
      </div>
    );
  }

  let banner;
  if (outcome.kind === "checking") {
    banner = (
      <div className="flex items-center gap-3 rounded-2xl bg-[#f2f7f5] px-4 py-3.5 text-[#557276]">
        <Loader2 className="size-5 shrink-0 animate-spin" />
        <p className="text-[12px] font-extrabold">Consultando uso unico y prohibiciones...</p>
      </div>
    );
  } else if (outcome.kind === "offline") {
    const ok = outcome.localReason === "ok";
    banner = (
      <div className="flex items-center gap-3 rounded-2xl bg-[#fff3d9] px-4 py-3.5 text-[#a26a11]">
        <WifiOff className="size-5 shrink-0" />
        <div>
          <p className="text-[12px] font-extrabold">
            Sin conexion: {ok ? "cedula autentica y QR vigente" : REASON_LABEL[outcome.localReason]}
          </p>
          <p className="text-[11px] font-semibold opacity-80">
            No se pudo comprobar uso unico ni prohibiciones. Aplica el protocolo sin conexion del recinto.
          </p>
        </div>
      </div>
    );
  } else {
    const { response } = outcome;
    banner = (
      <div className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 ${REASON_TONE[response.reason] ?? "bg-[#f2f7f5] text-[#557276]"}`}>
        {response.granted ? <CheckCircle2 className="size-5 shrink-0" /> : <XCircle className="size-5 shrink-0" />}
        <div>
          <p className="text-[12px] font-extrabold">{REASON_LABEL[response.reason] ?? response.reason}</p>
          {response.latency_ms !== null && <p className="text-[10px] opacity-60">Validado en {response.latency_ms.toFixed(1)} ms</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      {banner}
      <IdentityCard identity={outcome.identity} photo={outcome.photo} caption="Firmado por el Registro Civil" large />
      <p className="text-center text-[10px] font-semibold text-[#82989a]">
        Si la foto no corresponde a la persona, no la dejes pasar aunque el codigo sea valido.
      </p>
    </div>
  );
}
