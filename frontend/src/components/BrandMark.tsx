import { ShieldCheck } from "lucide-react";

/** Marca del sistema del recinto (distinta de la app de la cédula). */
export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <ShieldCheck className="size-6 shrink-0 text-brand" strokeWidth={1.75} aria-hidden />
      <div className="leading-tight">
        <p className="text-[16px] font-bold text-ink">Control de acceso</p>
        {!compact && <p className="text-[13px] text-ink-2">Prototipo de tesis</p>}
      </div>
    </div>
  );
}
