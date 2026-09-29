import { useEffect, useRef, useState } from "react";
import { Delete } from "lucide-react";

interface PinPadProps {
  length: number;
  /** Se llama al completar los dígitos. Devuelve false si el PIN no sirvió (sacude los puntos). */
  onComplete: (pin: string) => Promise<boolean> | boolean;
  disabled?: boolean;
}

/** PIN como en las apps de identidad: puntos y teclado numérico grande (también acepta el teclado físico). */
export function PinPad({ length, onComplete, disabled = false }: PinPadProps) {
  const [digits, setDigits] = useState("");
  const [shake, setShake] = useState(false);
  const busyRef = useRef(false);

  async function press(key: string) {
    if (disabled || busyRef.current) return;
    if (key === "borrar") {
      setDigits((d) => d.slice(0, -1));
      return;
    }
    if (digits.length >= length) return;
    const next = digits + key;
    setDigits(next);
    if (next.length === length) {
      busyRef.current = true;
      const ok = await onComplete(next);
      busyRef.current = false;
      setDigits("");
      if (!ok) {
        setShake(true);
        try {
          navigator.vibrate?.([80, 50, 80]);
        } catch {
          // opcional
        }
        setTimeout(() => setShake(false), 450);
      }
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (/^\d$/.test(e.key)) void press(e.key);
      else if (e.key === "Backspace") void press("borrar");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "borrar"];

  return (
    <div className="flex flex-col items-center">
      <div
        role="status"
        aria-label={`${digits.length} de ${length} dígitos ingresados`}
        className={`flex gap-3.5 ${shake ? "motion-safe:animate-[pin-shake_.4s_ease-in-out]" : ""}`}
      >
        {Array.from({ length }, (_, i) => (
          <span
            key={i}
            className={`size-3.5 rounded-full border-2 transition-colors ${
              i < digits.length ? "border-[#123f4a] bg-[#123f4a]" : "border-[#a9bfbd] bg-transparent"
            }`}
          />
        ))}
      </div>
      <div className="mt-7 grid grid-cols-3 gap-x-6 gap-y-3.5">
        {keys.map((key, i) =>
          key === "" ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => void press(key)}
              disabled={disabled}
              aria-label={key === "borrar" ? "Borrar último dígito" : key}
              className="grid size-[68px] place-items-center rounded-full text-[26px] font-semibold text-[#173c47] transition active:scale-95 active:bg-[#dcebe7] enabled:hover:bg-[#edf5f3] disabled:opacity-40"
            >
              {key === "borrar" ? <Delete className="size-6 text-[#4f6a6d]" /> : key}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
