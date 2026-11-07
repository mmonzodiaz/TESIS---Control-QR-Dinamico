import { useState, type ReactNode } from "react";
import { Ban, CalendarDays, ClipboardList, LogOut, Menu, QrCode, ScanLine, UsersRound, X } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { BrandMark } from "./BrandMark";
import type { Role } from "../api";

const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  guard: "Guardia",
};

const NAV_ITEMS: { to: string; label: string; icon: typeof QrCode; roles: Role[] }[] = [
  { to: "/escanear", label: "Escanear", icon: ScanLine, roles: ["guard", "admin"] },
  { to: "/eventos", label: "Eventos", icon: CalendarDays, roles: ["admin"] },
  { to: "/prohibiciones", label: "Prohibiciones", icon: Ban, roles: ["admin"] },
  { to: "/usuarios", label: "Personal", icon: UsersRound, roles: ["admin"] },
  { to: "/historial", label: "Historial", icon: ClipboardList, roles: ["admin", "guard"] },
];

export function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const items = NAV_ITEMS.filter((item) => user && item.roles.includes(user.role));

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-surface px-4 lg:hidden">
        <BrandMark compact />
        <button onClick={() => setSidebarOpen(true)} className="btn btn-secondary px-2.5 py-2" aria-label="Abrir menú">
          <Menu className="size-5" />
        </button>
      </header>

      {sidebarOpen && (
        <button aria-label="Cerrar menú" className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col border-r border-line bg-surface transition-transform duration-200 lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between px-5 pb-6 pt-5">
          <BrandMark />
          <button className="p-1.5 text-ink-2 lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Cerrar menú">
            <X className="size-5" />
          </button>
        </div>

        <nav aria-label="Secciones" className="flex-1 overflow-y-auto">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 border-l-[3px] py-2.5 pl-[17px] pr-4 text-[14px] transition-colors ${
                  isActive ? "border-ink bg-paper font-semibold text-ink" : "border-transparent text-ink-2 hover:bg-paper hover:text-ink"
                }`
              }
            >
              <item.icon className="size-[18px] shrink-0" strokeWidth={1.75} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-line px-5 py-4">
          <p className="truncate text-[14px] font-semibold text-ink">{user?.full_name}</p>
          <p className="text-[13px] text-ink-2">{user && ROLE_LABEL[user.role]}</p>
          <button onClick={logout} className="mt-3 flex items-center gap-2 text-[14px] font-medium text-ink-2 hover:text-ink">
            <LogOut className="size-4" /> Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="min-h-screen pt-14 lg:pl-[240px] lg:pt-0">
        <div className="mx-auto max-w-[1120px] px-5 py-8 sm:px-8 lg:px-10 lg:py-10">{children}</div>
      </main>
    </div>
  );
}
