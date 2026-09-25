import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { Layout } from "./components/Layout";
import { LoginPage } from "./pages/LoginPage";
import { ClaimTicketPage } from "./pages/ClaimTicketPage";
import { EventsPage } from "./pages/EventsPage";
import { ScannerPage } from "./pages/ScannerPage";
import { UsersPage } from "./pages/UsersPage";
import { LogsPage } from "./pages/LogsPage";

function HomeRedirect() {
  const { user } = useAuth();
  if (user?.role === "guard") return <Navigate to="/escanear" replace />;
  return <Navigate to="/eventos" replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Publica: el asistente obtiene su QR con RUT + codigo de entrada, sin cuenta. */}
        <Route path="/mi-entrada" element={<ClaimTicketPage />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <Layout>
                <Routes>
                  <Route index element={<HomeRedirect />} />
                  <Route path="escanear" element={<ProtectedRoute roles={["guard", "admin"]}><ScannerPage /></ProtectedRoute>} />
                  <Route path="eventos" element={<ProtectedRoute roles={["admin"]}><EventsPage /></ProtectedRoute>} />
                  <Route path="usuarios" element={<ProtectedRoute roles={["admin"]}><UsersPage /></ProtectedRoute>} />
                  <Route path="historial" element={<ProtectedRoute roles={["admin", "guard"]}><LogsPage /></ProtectedRoute>} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Layout>
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
