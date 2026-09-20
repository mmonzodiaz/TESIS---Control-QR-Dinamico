import { useState, type ReactNode } from "react";
import { ClipboardList, LogOut, Menu, QrCode, ScanLine, UsersRound, Wifi, X } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { BrandMark } from "./BrandMark";
import type { Role } from "../api";

const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  guard: "Portero",
  resident: "Residente",
};

const NAV_ITEMS: { to: string; label: string; icon: typeof QrCode; roles: Role[] }[] = [
  { to: "/", label: "Mi acceso", icon: QrCode, roles: ["resident"] },
  { to: "/escanear", label: "Escanear", icon: ScanLine, roles: ["guard", "admin"] },
  { to: "/usuarios", label: "Usuarios", icon: UsersRound, roles: ["admin"] },
  { to: "/historial", label: "Historial", icon: ClipboardList, roles: ["admin", "guard"] },
];

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();

  const items = NAV_ITEMS.filter((item) => user && item.roles.includes(user.role));
  const currentLabel = items.find((item) => item.to === location.pathname)?.label ?? items[0]?.label ?? "";

  return (
    <div className="min-h-screen bg-[#f6f9f8] text-[#173c47]">
      <div className="fixed inset-x-0 top-0 z-40 flex h-[70px] items-center justify-between border-b border-[#e4ecea] bg-white/90 px-4 backdrop-blur-xl lg:hidden">
        <BrandMark compact />
        <button
          onClick={() => setSidebarOpen(true)}
          className="rounded-xl border border-[#e2ebea] bg-white p-2.5 text-[#31545b] shadow-sm"
          aria-label="Abrir menu"
        >
          <Menu className="size-5" />
        </button>
      </div>

      {sidebarOpen && (
        <button
          aria-label="Cerrar menu"
          className="fixed inset-0 z-40 bg-[#15343b]/30 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[264px] flex-col border-r border-[#e4ecea] bg-white px-4 py-5 transition-transform duration-300 lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between">
          <BrandMark />
          <button
            className="rounded-lg p-2 text-[#9aaeb0] transition hover:bg-[#f0f7f5] hover:text-[#31545b] lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Cerrar menu"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-9 flex items-center gap-3 rounded-2xl border border-[#e6efed] bg-[#f7fbfa] p-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#d8f0eb] text-[11px] font-extrabold text-[#167765]">
            {user ? initials(user.full_name) : ""}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-bold text-[#34565c]">{user?.full_name}</p>
            <p className="mt-0.5 text-[10px] text-[#94a9ab]">{user && ROLE_LABEL[user.role]}</p>
          </div>
        </div>

        <nav className="mt-8 flex-1 space-y-1 overflow-y-auto">
          <p className="mb-2 px-3 text-[9px] font-extrabold uppercase tracking-[.16em] text-[#a2b2b3]">Navegacion</p>
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  isActive ? "bg-[#e8f6f2] text-[#0d8b78]" : "text-[#6e8588] hover:bg-[#f4f8f7] hover:text-[#2e555c]"
                }`
              }
            >
              <item.icon className="size-[17px] shrink-0 stroke-[1.8]" />
              <span className="text-[12px] font-bold">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="space-y-3 border-t border-[#edf2f1] pt-4">
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[#809598] transition hover:bg-[#fff5f2] hover:text-[#bb684b]"
          >
            <LogOut className="size-[17px]" />
            <span className="text-[12px] font-bold">Salir</span>
          </button>
          <div className="flex items-center gap-2 rounded-xl bg-[#f8fbfa] px-3 py-2.5 text-[10px] text-[#97aaab]">
            <span className="size-2 rounded-full bg-[#2fc0a7] shadow-[0_0_0_4px_#ddf5ef]" /> Sistema operativo
          </div>
        </div>
      </aside>

      <main className="min-h-screen pt-[70px] transition-[padding] duration-300 lg:pt-0 lg:pl-[264px]">
        <header className="hidden h-[70px] items-center justify-between border-b border-[#e4ecea] bg-white/80 px-8 backdrop-blur-xl lg:flex xl:px-12">
          <div className="flex items-center gap-2 text-[11px] text-[#94a7a8]">
            <span>Recinto</span>
            <span className="text-[#c3cece]">/</span>
            <span className="font-bold text-[#46656a]">{currentLabel}</span>
          </div>
          <div className="hidden items-center gap-2 rounded-full bg-[#f1f8f6] px-3 py-1.5 text-[10px] font-bold text-[#5f7a7d] md:flex">
            <Wifi className="size-3 text-[#18a892]" /> Conectado
          </div>
        </header>

        <div className="mx-auto max-w-[1200px] px-5 py-7 sm:px-8 lg:px-10 xl:px-12 xl:py-9">{children}</div>
      </main>
    </div>
  );
}
