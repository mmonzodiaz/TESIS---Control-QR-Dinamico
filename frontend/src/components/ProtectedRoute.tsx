import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import type { Role } from "../api";

export function ProtectedRoute({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { token, user, loading } = useAuth();

  if (loading) return <p className="mt-16 text-center text-[13px] font-medium text-[#82989a]">Cargando...</p>;
  // Sin sesión de personal se envia a la app de cédula digital, el caso mayoritario.
  if (!token || !user) return <Navigate to="/mi-cedula" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;

  return <>{children}</>;
}
