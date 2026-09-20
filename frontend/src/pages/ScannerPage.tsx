import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { CheckCircle2, ScanLine, TriangleAlert, XCircle } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api, type QRValidateResponse } from "../api";
import { REASON_LABEL, REASON_TONE } from "../reasons";

const SCANNER_ELEMENT_ID = "qr-scanner-region";

export function ScannerPage() {
  const { token } = useAuth();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const busyRef = useRef(false);
  const [result, setResult] = useState<QRValidateResponse | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => handleScan(decodedText),
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

  async function handleScan(qrToken: string) {
    if (!token || busyRef.current) return;
    busyRef.current = true;
    try {
      const res = await api.validateQr(token, qrToken);
      setResult(res);
    } catch {
      setResult({ granted: false, reason: "invalid", user: null });
    } finally {
      setTimeout(() => {
        busyRef.current = false;
        setResult(null);
      }, 2500);
    }
  }

  return (
    <div className="flex justify-center">
      <div className="w-full max-w-[480px]">
        <div className="mb-6 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.15em] text-[#1ba792]">
          <span className="size-1.5 rounded-full bg-[#1ba792]" /> Porteria
        </div>
        <h1 className="font-display text-[26px] font-extrabold tracking-[-.05em] text-[#173c47]">Escanear QR de acceso</h1>
        <p className="mt-2 text-[13px] leading-6 text-[#82989a]">Apunta la camara al codigo que muestra la persona en su dispositivo.</p>

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

            {result && (
              <div className={`mt-4 flex items-center gap-3 rounded-2xl px-4 py-3.5 ${REASON_TONE[result.reason] ?? "bg-[#f2f7f5] text-[#557276]"}`}>
                {result.granted ? <CheckCircle2 className="size-5 shrink-0" /> : <XCircle className="size-5 shrink-0" />}
                <div>
                  <p className="text-[12px] font-extrabold">{REASON_LABEL[result.reason] ?? result.reason}</p>
                  {result.user && <p className="text-[11px] font-semibold opacity-80">{result.user.full_name}</p>}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
