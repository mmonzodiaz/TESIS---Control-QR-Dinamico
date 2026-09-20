import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { api, type AccessLog } from "../api";
import { REASON_LABEL, REASON_TONE } from "../reasons";

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function formatDate(value: string) {
  return new Date(`${value}Z`).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function LogsPage() {
  const { token } = useAuth();
  const [logs, setLogs] = useState<AccessLog[]>([]);

  useEffect(() => {
    if (!token) return;
    api.listLogs(token).then(setLogs);
  }, [token]);

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[.15em] text-[#1ba792]">
        <span className="size-1.5 rounded-full bg-[#1ba792]" /> Trazabilidad
      </div>
      <h1 className="font-display text-[26px] font-extrabold tracking-[-.05em] text-[#173c47]">Historial de accesos</h1>
      <p className="mt-2 max-w-[560px] text-[13px] leading-6 text-[#82989a]">Cada intento de acceso, concedido o rechazado, queda registrado aqui.</p>

      <div className="mt-6 rounded-[24px] border border-[#e3ebea] bg-white px-5 py-5 shadow-[0_12px_32px_rgba(37,73,79,.05)] sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-[#eaf0ff]">
            <ClipboardList className="size-[19px] text-[#3b69c8]" />
          </div>
          <div>
            <p className="font-display text-[14px] font-extrabold text-[#234953]">Actividad reciente</p>
            <p className="text-[11px] text-[#96a8a9]">Ultimos {logs.length} movimientos</p>
          </div>
        </div>

        <div className="mt-4">
          {logs.length === 0 && (
            <div className="rounded-2xl bg-[#f7fbfa] py-8 text-center text-[11px] text-[#91a4a5]">Sin movimientos registrados todavia.</div>
          )}
          {logs.map((log) => (
            <div key={log.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-[#edf2f1] py-3.5 last:border-b-0">
              <div className={`grid size-9 place-items-center rounded-xl text-[11px] font-extrabold ${REASON_TONE[log.reason] ?? "bg-[#f2f7f5] text-[#557276]"}`}>
                {log.user ? initials(log.user.full_name) : "?"}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-[12px] font-bold text-[#274b53]">{log.user?.full_name ?? "Codigo desconocido"}</p>
                  <span className={`hidden rounded-full px-1.5 py-0.5 text-[9px] font-bold sm:inline-flex ${REASON_TONE[log.reason] ?? "bg-[#f2f7f5] text-[#557276]"}`}>
                    {REASON_LABEL[log.reason] ?? log.reason}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-[#93a5a7]">Escaneado por {log.scanned_by?.full_name ?? "—"}</p>
              </div>
              <div className="text-right">
                <p className="text-[11px] font-bold text-[#3c5c62]">{formatDate(log.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
