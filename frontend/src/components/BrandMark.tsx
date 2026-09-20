import { ShieldCheck } from "lucide-react";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-[14px] bg-[#0c3443] shadow-[0_10px_20px_rgba(17,85,100,.2)]">
        <div className="absolute -right-3 -top-3 size-8 rounded-full bg-[#39c6b6]/35 blur-sm" />
        <ShieldCheck className="relative size-[21px] text-[#61e4d0]" strokeWidth={2.25} />
      </div>
      {!compact && (
        <div className="leading-none">
          <p className="font-display text-[15px] font-extrabold tracking-[-.03em] text-[#14333e]">
            Control de <span className="text-[#18aa9c]">Acceso</span>
          </p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[.15em] text-[#91a4a8]">QR dinamico</p>
        </div>
      )}
    </div>
  );
}
