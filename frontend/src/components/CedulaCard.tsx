import { useMemo } from "react";
import { IdCard } from "lucide-react";
import { photoDataUrl, type IdentityCore } from "../credential";
import { formatRut } from "../rut";

/** Fecha de emisión de la cédula digital, como en un documento: 29 SEP 2026. */
function documentDate(unix: number): string {
  return new Date(unix * 1000)
    .toLocaleDateString("es-CL", { day: "2-digit", month: "short", year: "numeric" })
    .replace(/\./g, "")
    .toUpperCase();
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-bold uppercase tracking-[.14em] text-[#4f6a6d]">{label}</p>
      <p className={`mt-0.5 truncate text-[#123f4a] ${mono ? "font-mono text-[14px] font-medium tracking-[.02em]" : "text-[15px] font-extrabold leading-tight"}`}>
        {value}
      </p>
    </div>
  );
}

/** La cédula digital con la proporción del carnet (ID-1, 85,6 × 54 mm) y los datos firmados. */
export function CedulaCard({ identity, photo }: { identity: IdentityCore; photo: Uint8Array }) {
  const src = useMemo(() => photoDataUrl(photo), [photo]);
  return (
    <div className="guilloche relative aspect-[85.6/54] w-full overflow-hidden rounded-[18px] border border-[#cfe3dd] shadow-[0_14px_34px_rgba(18,63,74,.14)]">
      <div className="flex items-center justify-between bg-[#123f4a] px-4 py-2 text-white">
        <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[.16em]">
          <IdCard className="size-3.5 text-[#61e4d0]" /> Cédula digital
        </p>
        <p className="text-[9px] font-bold uppercase tracking-[.12em] text-[#9fd8cd]">Registro Civil simulado</p>
      </div>
      <div className="flex h-[calc(100%-32px)] gap-3.5 px-4 py-3">
        <img src={src} alt={`Foto de ${identity.name}`} className="aspect-[3/4] h-full shrink-0 rounded-lg bg-white object-cover ring-1 ring-[#cfe3dd]" />
        <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
          <Field label="Nombre" value={identity.name} />
          <Field label="RUN" value={formatRut(identity.rut)} mono />
          <Field label="Emisión" value={documentDate(identity.issuedAt)} mono />
        </div>
      </div>
      <span className="absolute bottom-2 right-3 rounded-full bg-white/80 px-2 py-0.5 text-[8px] font-extrabold uppercase tracking-[.14em] text-[#b0643d]">
        Prototipo
      </span>
    </div>
  );
}

/** Marca de la app del ciudadano (distinta de la del sistema del recinto). */
export function CedulaBrand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-9 place-items-center rounded-[12px] bg-[#123f4a]">
        <IdCard className="size-[19px] text-[#61e4d0]" />
      </div>
      <div className="leading-none">
        <p className="font-display text-[16px] font-extrabold tracking-[-.02em] text-[#123f4a]">Mi cédula</p>
        <p className="mt-1 text-[10px] font-bold uppercase tracking-[.12em] text-[#b0643d]">Prototipo de tesis</p>
      </div>
    </div>
  );
}
