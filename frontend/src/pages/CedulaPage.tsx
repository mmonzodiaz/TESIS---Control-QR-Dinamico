import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2, Lock, ShieldX } from "lucide-react";
import { api, ApiError } from "../api";
import { CedulaBrand, CedulaCard } from "../components/CedulaCard";
import { PinPad } from "../components/PinPad";
import { b64encode, credentialId, devicePublicKey, newSecretKey } from "../credential";
import { formatRut, isValidRut } from "../rut";
import {
  clearPinAttempts,
  deleteWallet,
  loadPinAttempts,
  loadSealedWallet,
  newWallet,
  openWallet,
  PIN_LENGTH,
  registerPinFailure,
  saveClockOffset,
  sealWallet,
  storeSealedWallet,
  WrongPinError,
  type SealedWallet,
  type UnlockedWallet,
} from "../wallet";
import { CedulaView, DiferenciaClavePanel, DondeSeAceptaPanel, QueEsEstoPanel } from "./CedulaView";
import { useDocumentTitle } from "../useDocumentTitle";

// La app de cédula digital (como Identificación Digital): es de la persona, no de un evento. Se
// activa una vez con el Registro Civil, queda protegida con un PIN y muestra el QR dinámico que
// cualquier lector autorizado puede verificar.

// Como la app real: si pasa un rato en segundo plano, vuelve a pedir el PIN.
const AUTO_LOCK_MS = 60_000;

const input = "field mt-1.5 py-3";
const codeInput = `${input} tracking-[.08em]`;
const primaryButton = "btn btn-primary btn-lg mt-6";
const title = "text-balance text-[28px] font-bold leading-tight text-ink";
const lead = "mt-2 text-[17px] leading-6 text-ink-2";
const quietButton = "mt-4 w-full py-2 text-[17px] font-medium text-ink-2 hover:text-ink";

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <p role="alert" className="notice notice-error mt-4">
      {error}
    </p>
  ) : null;
}

/** Error junto al campo que falló (Anexo A.2, adoptante potencial informado). */
function FieldError({ id, error }: { id: string; error: string | null }) {
  return error ? (
    <p id={id} role="alert" className="mt-1.5 text-[16px] font-medium text-bad">
      {error}
    </p>
  ) : null;
}

type FormError = { field: "rut" | "clave" | "general"; message: string };

const INVALID_RUT: FormError = { field: "rut", message: "El RUN no es válido. Revisa el dígito verificador." };

/** Traduce el error del Registro Civil a un mensaje claro y al campo donde corresponde mostrarlo. */
function registryError(err: unknown): FormError {
  if (err instanceof ApiError) {
    if (err.status === 401) return { field: "clave", message: err.message };
    if (err.status === 422) return { field: "clave", message: "Revisa tu clave de activación: tiene 8 caracteres." };
    if (err.status >= 500) return { field: "general", message: "El Registro Civil no responde. Inténtalo de nuevo en un momento." };
    return { field: "general", message: err.message };
  }
  // fetch lanza TypeError cuando no hay red; su mensaje ("Failed to fetch") no le sirve a nadie.
  if (err instanceof Error && !(err instanceof TypeError)) return { field: "general", message: err.message };
  return { field: "general", message: "No se pudo contactar al Registro Civil. Revisa tu conexión e inténtalo de nuevo." };
}

/** El enrolamiento es una secuencia real de dos pasos: activar la cédula y crear el PIN. */
function Steps({ current }: { current: 1 | 2 }) {
  const labels = ["activar la cédula", "crear el PIN"];
  return (
    <div className="mb-6">
      <p className="text-[16px] text-ink-2">
        Paso {current} de 2: {labels[current - 1]}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-1.5" aria-hidden>
        {labels.map((label, i) => (
          <span key={label} className={`h-1.5 rounded-full ${i < current ? "bg-brand" : "bg-line"}`} />
        ))}
      </div>
    </div>
  );
}

/** Paso 1: obtener la cédula digital del Registro Civil (simulado). */
function EnrollScreen({ onEnrolled, onReportLoss }: { onEnrolled: (wallet: UnlockedWallet) => void; onReportLoss: () => void }) {
  const [rut, setRut] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidRut(rut)) {
      setError(INVALID_RUT);
      return;
    }
    setBusy(true);
    try {
      // La clave del teléfono se crea aquí y el Registro Civil la firma dentro de la cédula: solo este
      // teléfono podrá generar QR válidos con ella.
      const deviceSecret = newSecretKey();
      const res = await api.enroll(rut, clave, b64encode(devicePublicKey(deviceSecret)));
      saveClockOffset(res.server_time);
      onEnrolled(newWallet(res, deviceSecret));
    } catch (err) {
      setError(registryError(err)); // lo ingresado se conserva: se reintenta sin reiniciar
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Steps current={1} />
      <h1 className={title}>Activa tu cédula digital</h1>
      <p className={lead}>
        Se hace una sola vez en este teléfono. El Registro Civil te entrega tu cédula firmada, con tu nombre, RUN y foto, ligada
        a este teléfono. Si la tenías en otro teléfono, allá quedará desactivada.
      </p>
      <label htmlFor="enroll-rut" className="field-label mt-6">
        RUN
      </label>
      <input
        id="enroll-rut"
        value={rut}
        spellCheck={false}
        onChange={(e) => {
          setRut(formatRut(e.target.value));
          if (error?.field === "rut") setError(null);
        }}
        required
        autoFocus
        autoComplete="off"
        placeholder="12.345.678-5"
        aria-invalid={error?.field === "rut"}
        aria-describedby={error?.field === "rut" ? "enroll-rut-error" : undefined}
        className={`${input} tnum`}
      />
      <FieldError id="enroll-rut-error" error={error?.field === "rut" ? error.message : null} />
      <label htmlFor="enroll-clave" className="field-label mt-4">
        Clave de activación
      </label>
      <input
        id="enroll-clave"
        value={clave}
        autoCapitalize="characters"
        spellCheck={false}
        onChange={(e) => {
          setClave(e.target.value.toUpperCase());
          if (error?.field === "clave") setError(null);
        }}
        required
        autoComplete="off"
        placeholder="Ej. RCUNO234"
        aria-invalid={error?.field === "clave"}
        aria-describedby={error?.field === "clave" ? "enroll-clave-error" : undefined}
        className={codeInput}
      />
      <FieldError id="enroll-clave-error" error={error?.field === "clave" ? error.message : null} />
      <p className="mt-2.5 text-[16px] leading-5 text-ink-2">
        En la app real esto se hace con tu ClaveÚnica y una prueba facial. En este prototipo, la clave de activación reemplaza
        ese paso.
      </p>
      <ErrorText error={error?.field === "general" ? error.message : null} />
      <button type="submit" disabled={busy} className={primaryButton}>
        {busy && <Loader2 className="size-5 animate-spin" />}
        {busy ? "Consultando al Registro Civil…" : "Obtener mi cédula digital"}
      </button>
      <button type="button" onClick={onReportLoss} className={quietButton}>
        ¿Perdiste tu teléfono? Desactiva tu cédula
      </button>
    </form>
  );
}

/** "Perdí mi teléfono": desde otro dispositivo, desactiva la cédula del teléfono perdido (ADR-14). */
function ReportLossScreen({ onBack }: { onBack: () => void }) {
  const [rut, setRut] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<FormError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidRut(rut)) {
      setError(INVALID_RUT);
      return;
    }
    setBusy(true);
    try {
      await api.reportLoss(rut, clave);
      setDone(true);
    } catch (err) {
      setError(registryError(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div>
        <CheckCircle2 className="size-8 text-ok" strokeWidth={1.75} />
        <h1 className={`${title} mt-3`}>Cédula desactivada</h1>
        <p className={lead}>
          Los QR del teléfono perdido serán rechazados por los lectores en alrededor de un minuto, aunque alguien conozca tu PIN.
          Puedes activar tu cédula en este teléfono cuando quieras.
        </p>
        <button type="button" onClick={onBack} className={primaryButton}>
          Activar mi cédula aquí
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <h1 className={title}>Desactiva tu cédula perdida</h1>
      <p className={lead}>
        El Registro Civil revoca la cédula que quedó en el teléfono perdido o robado. Se identifica con los mismos datos que al
        activarla.
      </p>
      <label htmlFor="loss-rut" className="field-label mt-6">
        RUN
      </label>
      <input
        id="loss-rut"
        value={rut}
        spellCheck={false}
        onChange={(e) => {
          setRut(formatRut(e.target.value));
          if (error?.field === "rut") setError(null);
        }}
        required
        autoFocus
        autoComplete="off"
        placeholder="12.345.678-5"
        aria-invalid={error?.field === "rut"}
        aria-describedby={error?.field === "rut" ? "loss-rut-error" : undefined}
        className={`${input} tnum`}
      />
      <FieldError id="loss-rut-error" error={error?.field === "rut" ? error.message : null} />
      <label htmlFor="loss-clave" className="field-label mt-4">
        Clave de activación
      </label>
      <input
        id="loss-clave"
        value={clave}
        autoCapitalize="characters"
        spellCheck={false}
        onChange={(e) => {
          setClave(e.target.value.toUpperCase());
          if (error?.field === "clave") setError(null);
        }}
        required
        autoComplete="off"
        placeholder="Ej. RCUNO234"
        aria-invalid={error?.field === "clave"}
        aria-describedby={error?.field === "clave" ? "loss-clave-error" : undefined}
        className={codeInput}
      />
      <FieldError id="loss-clave-error" error={error?.field === "clave" ? error.message : null} />
      <ErrorText error={error?.field === "general" ? error.message : null} />
      <button type="submit" disabled={busy} className="btn btn-danger btn-lg mt-6">
        {busy && <Loader2 className="size-5 animate-spin" />}
        {busy ? "Consultando al Registro Civil…" : "Desactivar mi cédula"}
      </button>
      <button type="button" onClick={onBack} className={quietButton}>
        Volver
      </button>
    </form>
  );
}

/** La cédula de este teléfono fue revocada: se activó en otro teléfono o se reportó la pérdida. */
function RevokedScreen({ onReset }: { onReset: () => void }) {
  return (
    <div>
      <ShieldX className="size-8 text-bad" strokeWidth={1.75} />
      <h1 className={`${title} mt-3`}>Tu cédula ya no es válida en este teléfono</h1>
      <p className={lead}>
        Se activó en otro teléfono o se reportó la pérdida de este. Los lectores rechazarán sus QR. Si fuiste tú, puedes
        activarla de nuevo aquí.
      </p>
      <button type="button" onClick={onReset} className={primaryButton}>
        Borrar de este teléfono y activar de nuevo
      </button>
    </div>
  );
}

/** Paso 2: crear el PIN (dos veces) que protege la cédula en este teléfono. */
function CreatePinScreen({ wallet, onDone, onCancel }: { wallet: UnlockedWallet; onDone: (sealed: SealedWallet) => void; onCancel: () => void }) {
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function complete(pin: string) {
    if (first === null) {
      setFirst(pin);
      setError(null);
      return true;
    }
    if (pin !== first) {
      setFirst(null);
      setError("Los PIN no coinciden. Créalo de nuevo.");
      return false;
    }
    setSaving(true);
    const sealed = await sealWallet(pin, wallet);
    storeSealedWallet(sealed);
    onDone(sealed);
    return true;
  }

  return (
    <div>
      <Steps current={2} />
      <CedulaCard identity={wallet.identity} photo={wallet.credential.photo} />
      <h1 className="mt-7 text-center text-[24px] font-semibold text-ink">
        {first === null ? "Crea tu PIN de 6 dígitos" : "Repite tu PIN"}
      </h1>
      <p className="mx-auto mt-1.5 max-w-[320px] text-center text-[17px] leading-6 text-ink-2">
        Lo pediremos cada vez que abras tu cédula. Tu cédula queda cifrada con él.
      </p>
      <div className="mt-6">
        {saving ? (
          <p className="flex items-center justify-center gap-2 py-16 text-[17px] text-ink-2">
            <Loader2 className="size-5 animate-spin" /> Protegiendo tu cédula…
          </p>
        ) : (
          <PinPad key={first === null ? "primero" : "repetir"} length={PIN_LENGTH} onComplete={complete} />
        )}
      </div>
      <ErrorText error={error} />
      <button type="button" onClick={onCancel} className={quietButton}>
        Cancelar
      </button>
    </div>
  );
}

/** Uso diario: desbloquear la cédula con el PIN. */
function UnlockScreen({ sealed, onUnlocked, onForgot }: { sealed: SealedWallet; onUnlocked: (w: UnlockedWallet) => void; onForgot: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(loadPinAttempts);
  const [now, setNow] = useState(() => Date.now());
  const [confirmForgot, setConfirmForgot] = useState(false);
  const lockedFor = Math.max(0, Math.ceil((attempts.lockedUntil - now) / 1000));

  useEffect(() => {
    if (!attempts.lockedUntil) return;
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [attempts.lockedUntil]);

  async function tryPin(pin: string) {
    setBusy(true);
    setError(null);
    try {
      const wallet = await openWallet(pin, sealed);
      clearPinAttempts();
      onUnlocked(wallet);
      return true;
    } catch (err) {
      if (!(err instanceof WrongPinError)) throw err;
      const next = registerPinFailure(attempts);
      setAttempts(next);
      setNow(Date.now());
      setError(next.lockedUntil ? "Demasiados intentos. Espera un minuto." : "PIN incorrecto. Inténtalo de nuevo.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center">
      <h1 className="mt-4 text-[24px] font-semibold text-ink">Ingresa tu PIN</h1>
      <p className="mt-1 text-[17px] text-ink-2">Para abrir tu cédula digital.</p>
      <div className="mt-7 w-full">
        {lockedFor > 0 ? (
          <p role="status" className="notice notice-warn py-4 text-center text-[17px] font-semibold">
            Bloqueado por seguridad. Intenta de nuevo en {lockedFor} s.
          </p>
        ) : (
          <PinPad length={PIN_LENGTH} onComplete={tryPin} disabled={busy} />
        )}
      </div>
      {busy && (
        <p className="mt-3 flex items-center gap-2 text-[16px] text-ink-2">
          <Loader2 className="size-4 animate-spin" /> Verificando…
        </p>
      )}
      <div className="w-full">
        <ErrorText error={error} />
      </div>

      {confirmForgot ? (
        <div className="notice notice-warn mt-6 w-full p-4 text-[17px]">
          <p>Se borrará tu cédula de este teléfono y tendrás que activarla de nuevo con el Registro Civil.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={onForgot} className="btn btn-danger">
              Borrar y activar de nuevo
            </button>
            <button onClick={() => setConfirmForgot(false)} className="btn btn-secondary">
              Cancelar
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirmForgot(true)} className="mt-6 py-2 text-[17px] font-medium text-ink-2 hover:text-ink">
          ¿Olvidaste tu PIN?
        </button>
      )}
    </div>
  );
}

export function CedulaPage() {
  useDocumentTitle("Mi cédula", null);
  const [sealed, setSealed] = useState<SealedWallet | null>(loadSealedWallet);
  const [wallet, setWallet] = useState<UnlockedWallet | null>(null);
  const [enrolled, setEnrolled] = useState<UnlockedWallet | null>(null); // falta crear el PIN
  const [notice, setNotice] = useState<string | null>(null);
  const [reportingLoss, setReportingLoss] = useState(false);
  const [revoked, setRevoked] = useState(false);

  useEffect(() => {
    // Al abrir la cédula, corrige el reloj con la hora oficial (el QR lleva la hora) y revisa si esta
    // cédula fue revocada (ADR-14). Sin red, sigue igual: los lectores igual la rechazarían.
    if (!wallet) return;
    api
      .officialTime()
      .then((res) => saveClockOffset(res.server_time))
      .catch(() => {});
    const id = credentialId(wallet.credential.core);
    api
      .revocations()
      .then((list) => setRevoked(list.revoked.includes(id)))
      .catch(() => {});
  }, [wallet]);

  useEffect(() => {
    // Bloqueo automático al volver después de un rato en segundo plano.
    if (!wallet) return;
    let hiddenAt = 0;
    function onVisibility() {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) setWallet(null);
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [wallet]);

  function forgotPin() {
    deleteWallet();
    setSealed(null);
    setNotice("Se borró la cédula de este teléfono. Actívala de nuevo.");
  }

  function resetRevoked() {
    deleteWallet();
    setSealed(null);
    setWallet(null);
    setRevoked(false);
    setNotice(null);
  }

  let content;
  if (wallet && revoked) {
    content = <RevokedScreen onReset={resetRevoked} />;
  } else if (wallet) {
    content = <CedulaView wallet={wallet} />;
  } else if (enrolled) {
    content = (
      <CreatePinScreen
        wallet={enrolled}
        onDone={(s) => {
          setSealed(s);
          setWallet(enrolled);
          setEnrolled(null);
        }}
        onCancel={() => setEnrolled(null)}
      />
    );
  } else {
    content = (
      <>
        {sealed ? (
          <UnlockScreen sealed={sealed} onUnlocked={setWallet} onForgot={forgotPin} />
        ) : reportingLoss ? (
          <ReportLossScreen onBack={() => setReportingLoss(false)} />
        ) : (
          <>
            <EnrollScreen onEnrolled={setEnrolled} onReportLoss={() => setReportingLoss(true)} />
            {/* Antes de activar, no después: quien nunca oyó de esto decide aquí si le sirve (Anexo A.2). */}
            <div className="disclosure-group mt-8">
              <QueEsEstoPanel />
              <DondeSeAceptaPanel />
              <DiferenciaClavePanel />
            </div>
          </>
        )}
        <p className="mt-8 text-[16px] text-ink-2">
          ¿Verificas identidades en un recinto?{" "}
          <Link to="/login" className="btn-link">
            Ingresa como personal
          </Link>
        </p>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-paper px-4 pb-10 pt-[max(20px,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-[420px]">
        <header className="mb-8 flex items-center justify-between">
          <CedulaBrand />
          {wallet && (
            <button
              onClick={() => setWallet(null)}
              className="btn btn-secondary px-3 py-2 text-[16px]"
            >
              <Lock className="size-4" /> Bloquear
            </button>
          )}
        </header>
        <main>
          {notice && !wallet && (
            <p role="status" className="notice notice-warn mb-5">
              {notice}
            </p>
          )}
          {content}
        </main>
      </div>
    </div>
  );
}
