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

function Field({ label, value, numeric = false }: { label: string; value: string; numeric?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-ink-2">{label}</p>
      <p className={`truncate text-ink ${numeric ? "tnum text-[16px] font-semibold" : "text-[17px] font-bold leading-tight"}`}>{value}</p>
    </div>
  );
}

/** La cédula digital con la proporción del carnet (ID-1, 85,6 × 54 mm) y los datos firmados. */
export function CedulaCard({ identity, photo }: { identity: IdentityCore; photo: Uint8Array }) {
  const src = useMemo(() => photoDataUrl(photo), [photo]);
  return (
    <div className="guilloche relative aspect-[85.6/54] w-full overflow-hidden rounded-[16px] border border-line shadow-[0_2px_0_var(--color-line)]">
      <div className="flex items-center justify-between bg-brand px-4 py-2 text-white">
        <p className="text-[13px] font-bold">Cédula digital</p>
        <p className="text-[12px] text-white/85">Registro Civil (simulado)</p>
      </div>
      <div className="flex h-[calc(100%-34px)] gap-4 px-4 py-3">
        <img src={src} alt={`Foto de ${identity.name}`} className="aspect-[3/4] h-full shrink-0 rounded-[4px] border border-line bg-white object-cover" />
        <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
          <Field label="Nombre" value={identity.name} />
          <Field label="RUN" value={formatRut(identity.rut)} numeric />
          <Field label="Emisión" value={documentDate(identity.issuedAt)} numeric />
        </div>
      </div>
      <span className="absolute bottom-2 right-3 text-[12px] text-ink-3">Prototipo</span>
    </div>
  );
}

/** Marca de la app del ciudadano (distinta de la del sistema del recinto). */
export function CedulaBrand() {
  return (
    <div className="flex items-center gap-2.5">
      <IdCard className="size-7 shrink-0 text-brand" strokeWidth={1.75} aria-hidden />
      <div className="leading-tight">
        <p className="text-[18px] font-bold text-ink">Mi cédula</p>
        <p className="text-[13px] text-ink-2">Prototipo de tesis</p>
      </div>
    </div>
  );
}
