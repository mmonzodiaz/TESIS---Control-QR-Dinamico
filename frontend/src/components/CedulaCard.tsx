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
      <p className="text-[11px] font-medium text-white/75">{label}</p>
      <p className={`truncate text-white ${numeric ? "tnum text-[15px] font-bold" : "text-[17px] font-extrabold leading-tight"}`}>{value}</p>
    </div>
  );
}

/** La cédula digital con la proporción del carnet (ID-1, 85,6 × 54 mm) y los datos firmados. */
export function CedulaCard({ identity, photo }: { identity: IdentityCore; photo: Uint8Array }) {
  const src = useMemo(() => photoDataUrl(photo), [photo]);
  return (
    <div className="guilloche relative aspect-[85.6/54] w-full overflow-hidden rounded-[22px] shadow-card">
      <div className="flex items-center justify-between px-4 pt-3 text-[12px] font-bold text-white">
        <p>Cédula digital</p>
        <p className="text-white/80">Registro Civil (simulado)</p>
      </div>
      <div className="flex h-[calc(100%-38px)] gap-4 px-4 pb-3.5 pt-2.5">
        <img src={src} alt={`Foto de ${identity.name}`} className="aspect-[3/4] h-full shrink-0 rounded-[10px] bg-white object-cover" />
        <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
          <Field label="Nombre" value={identity.name} />
          <Field label="RUN" value={formatRut(identity.rut)} numeric />
          <Field label="Emisión" value={documentDate(identity.issuedAt)} numeric />
        </div>
      </div>
      <span className="absolute bottom-2.5 right-4 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-bold text-white">Prototipo</span>
    </div>
  );
}

/** Marca de la app del ciudadano (distinta de la del sistema del recinto). */
export function CedulaBrand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-10 shrink-0 place-items-center rounded-[12px] bg-brand text-white">
        <IdCard className="size-[22px]" strokeWidth={2} aria-hidden />
      </span>
      <div className="leading-tight">
        <p className="text-[17px] font-extrabold text-ink">Mi cédula</p>
        <p className="text-[13px] font-medium text-ink-2">Prototipo de tesis</p>
      </div>
    </div>
  );
}
