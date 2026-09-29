import { useMemo } from "react";
import { photoDataUrl, type IdentityCore } from "../credential";
import { formatRut } from "../rut";

interface IdentityCardProps {
  identity: IdentityCore;
  photo: Uint8Array;
  /** Texto chico sobre el nombre, ej. "Cedula digital" o "Firmado por el Registro Civil". */
  caption: string;
  large?: boolean;
}

/** Foto, nombre y RUT tal como vienen firmados en la cedula digital (simulada). */
export function IdentityCard({ identity, photo, caption, large = false }: IdentityCardProps) {
  const src = useMemo(() => photoDataUrl(photo), [photo]);
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-[#e3ebea] bg-white p-3">
      <img
        src={src}
        alt={`Foto de ${identity.name}`}
        className={`${large ? "h-[168px] w-[126px]" : "h-[96px] w-[72px]"} shrink-0 rounded-xl bg-[#eef3f2] object-cover`}
      />
      <div className="min-w-0">
        <p className="text-[9px] font-extrabold uppercase tracking-[.15em] text-[#1ba792]">{caption}</p>
        <p className={`${large ? "text-[20px]" : "text-[15px]"} mt-1 font-display font-extrabold leading-tight tracking-[-.02em] text-[#173c47]`}>
          {identity.name}
        </p>
        <p className="mt-1 font-mono text-[12px] font-semibold text-[#557276]">RUT {formatRut(identity.rut)}</p>
      </div>
    </div>
  );
}
