import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { cargarMeta } from './lib/datos';
import { fechaHora } from './lib/formato';
import type { MetaDatos } from './lib/tiposDatos';
import Acerca from './pages/Acerca';
import Historial from './pages/Historial';
import Jugador from './pages/Jugador';
import Resultados from './pages/Resultados';
import Simulador from './pages/Simulador';
import Torneo from './pages/Torneo';
import Torneos from './pages/Torneos';

export default function App() {
  const [meta, setMeta] = useState<MetaDatos | null>(null);
  useEffect(() => {
    cargarMeta().then(setMeta).catch(() => setMeta(null));
  }, []);
  const enlace = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-1.5 text-sm ${isActive ? 'bg-superficie-2 text-texto' : 'text-texto-2 hover:text-texto'}`;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-borde bg-fondo/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2">
          <NavLink to="/" className="mr-4 flex items-center gap-2 font-semibold text-texto">
            <img src="/favicon.svg" alt="" className="h-6 w-6" /> Simulador de tenis
          </NavLink>
          <nav className="flex flex-wrap gap-1">
            <NavLink to="/" end className={enlace}>
              Torneos
            </NavLink>
            <NavLink to="/simulador" className={enlace}>
              Simulador
            </NavLink>
            <NavLink to="/historial" className={enlace}>
              Historial
            </NavLink>
            <NavLink to="/acerca" className={enlace}>
              Acerca
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-4">
        <Routes>
          <Route path="/" element={<Torneos />} />
          <Route path="/torneo/:id" element={<Torneo />} />
          <Route path="/simulador" element={<Simulador />} />
          <Route path="/resultados/:id" element={<Resultados />} />
          <Route path="/jugador/:id" element={<Jugador />} />
          <Route path="/historial" element={<Historial />} />
          <Route path="/acerca" element={<Acerca />} />
          <Route path="*" element={<p className="text-texto-2">Página no encontrada.</p>} />
        </Routes>
      </main>
      <footer className="border-t border-borde px-4 py-3 text-xs text-texto-3">
        <div className="mx-auto max-w-7xl space-y-1">
          <p>
            Probabilidades simuladas, no predicciones seguras. No es asesoramiento de apuestas · +18 · Juego responsable.
          </p>
          <p>
            Datos actualizados: {meta ? fechaHora(meta.generado) : '—'} (hora de Madrid). Histórico: Jeff Sackmann (CC BY-NC-SA 4.0, uso no comercial); calendarios y
            cuadros: WTA, ESPN y Wikipedia (CC BY-SA). Detalle en «Acerca».
          </p>
        </div>
      </footer>
    </div>
  );
}
