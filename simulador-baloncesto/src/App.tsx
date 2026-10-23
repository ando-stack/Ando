import { NavLink, Route, Routes } from 'react-router-dom';
import SimuladorPage from './pages/Simulador';
import ResultadosPage from './pages/Resultados';
import EquiposPage from './pages/Equipos';
import HistorialPage from './pages/Historial';
import AcercaPage from './pages/Acerca';
import { useApp } from './lib/state';

const links = [
  { to: '/', label: 'Simulador' },
  { to: '/resultados', label: 'Resultados' },
  { to: '/equipos', label: 'Equipos' },
  { to: '/historial', label: 'Historial' },
  { to: '/acerca', label: 'Acerca' },
];

export default function App() {
  const { run } = useApp();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-borde bg-panel/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="font-semibold text-white flex items-center gap-2">
            <span className="inline-block w-6 h-6 rounded-full bg-acento" aria-hidden />
            Simulador de baloncesto
          </div>
          <nav className="flex gap-1 overflow-x-auto -mx-1 px-1">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end className={({ isActive }) => `tab ${isActive ? 'tab-active' : 'text-slate-400 hover:text-white'}`}>
                {l.label}
                {l.to === '/resultados' && run ? <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-acento align-middle" /> : null}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<SimuladorPage />} />
          <Route path="/resultados" element={<ResultadosPage />} />
          <Route path="/equipos" element={<EquiposPage />} />
          <Route path="/historial" element={<HistorialPage />} />
          <Route path="/acerca" element={<AcercaPage />} />
          <Route path="*" element={<SimuladorPage />} />
        </Routes>
      </main>
      <footer className="border-t border-borde text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 py-4 space-y-1">
          <p>
            Los resultados son probabilidades simuladas a partir de datos históricos, no predicciones seguras. Herramienta de
            uso personal y no comercial. Datos: NBA.com vía PBP Stats, Euroleague Basketball y ACB (ver «Acerca»).
          </p>
        </div>
      </footer>
    </div>
  );
}
