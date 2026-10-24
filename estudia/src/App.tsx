import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { configuracionCompleta } from "./lib/supabase";
import { Layout } from "./components/Layout";
import { LayoutExamen } from "./components/LayoutExamen";
import { Aviso, Cargando } from "./components/ui";
import { ErrorLimite } from "./components/ErrorLimite";

const Login = lazy(() => import("./pages/Login"));
const Inicio = lazy(() => import("./pages/Inicio"));
const NuevoExamen = lazy(() => import("./pages/NuevoExamen"));
const Examen = lazy(() => import("./pages/Examen"));
const Apuntes = lazy(() => import("./pages/Apuntes"));
const Resumenes = lazy(() => import("./pages/Resumenes"));
const Esquemas = lazy(() => import("./pages/Esquemas"));
const Flashcards = lazy(() => import("./pages/Flashcards"));
const Tests = lazy(() => import("./pages/Tests"));
const ExamenPractica = lazy(() => import("./pages/ExamenPractica"));
const Tutor = lazy(() => import("./pages/Tutor"));
const Plan = lazy(() => import("./pages/Plan"));
const Calendario = lazy(() => import("./pages/Calendario"));
const Perfil = lazy(() => import("./pages/Perfil"));
const Consentimiento = lazy(() => import("./pages/Consentimiento"));
const Legal = lazy(() => import("./pages/Legal"));

function Protegida({ children }: { children: ReactNode }) {
  const { sesion, cargando } = useAuth();
  const loc = useLocation();
  if (cargando) return <Cargando />;
  if (!sesion) return <Navigate to="/login" replace state={{ desde: loc.pathname }} />;
  return <>{children}</>;
}

export default function App() {
  if (!configuracionCompleta) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <Aviso tipo="aviso" titulo="Falta configurar la web">
          Copia <code>.env.example</code> a <code>.env</code> y rellena <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code>. Consulta el README.
        </Aviso>
      </div>
    );
  }
  return (
    <ErrorLimite>
      <Suspense fallback={<Cargando />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/consentimiento/:token" element={<Consentimiento />} />
          <Route path="/privacidad" element={<Legal tipo="privacidad" />} />
          <Route path="/terminos" element={<Legal tipo="terminos" />} />
          <Route
            element={
              <Protegida>
                <Layout />
              </Protegida>
            }
          >
            <Route index element={<Inicio />} />
            <Route path="nuevo" element={<NuevoExamen />} />
            <Route path="calendario" element={<Calendario />} />
            <Route path="perfil" element={<Perfil />} />
            <Route path="examen/:id" element={<LayoutExamen />}>
              <Route index element={<Examen />} />
              <Route path="plan" element={<Plan />} />
              <Route path="apuntes" element={<Apuntes />} />
              <Route path="resumenes" element={<Resumenes />} />
              <Route path="esquemas" element={<Esquemas />} />
              <Route path="flashcards" element={<Flashcards />} />
              <Route path="tests" element={<Tests />} />
              <Route path="practica" element={<ExamenPractica />} />
              <Route path="practica/:mockId" element={<ExamenPractica />} />
              <Route path="tutor" element={<Tutor />} />
              <Route path="editar" element={<NuevoExamen />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorLimite>
  );
}
