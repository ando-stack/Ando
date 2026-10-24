import { motion } from "motion/react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Recordatorios } from "./Recordatorios";

const NAV = [
  { a: "/", t: "Inicio", i: "🏠" },
  { a: "/calendario", t: "Calendario", i: "📅" },
  { a: "/nuevo", t: "Nuevo", i: "➕" },
  { a: "/perfil", t: "Perfil", i: "🙂" },
];

/** Estructura general: cabecera en escritorio y barra inferior en el móvil. */
export function Layout() {
  const loc = useLocation();
  return (
    <div className="min-h-dvh pb-24 sm:pb-8">
      <Recordatorios />
      <header className="sticky top-0 z-30 hidden border-b border-marca-100 bg-white/80 backdrop-blur sm:block">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <NavLink to="/" className="flex items-center gap-2 text-lg font-extrabold text-marca-700">
            <img src="/icono.svg" alt="" className="h-8 w-8" /> Estudia
          </NavLink>
          <nav className="flex gap-1">
            {NAV.map((n) => (
              <NavLink key={n.a} to={n.a} end={n.a === "/"} className={({ isActive }) => `boton ${isActive ? "bg-marca-100 text-marca-700" : "text-slate-600 hover:bg-slate-100"}`}>
                <span aria-hidden>{n.i}</span> {n.t}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      <motion.main key={loc.pathname.split("/").slice(0, 3).join("/")} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="mx-auto max-w-5xl px-4 pt-4 sm:px-6 sm:pt-6">
        <Outlet />
      </motion.main>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-marca-100 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden" aria-label="Navegación principal">
        <div className="grid grid-cols-4">
          {NAV.map((n) => (
            <NavLink key={n.a} to={n.a} end={n.a === "/"} className={({ isActive }) => `relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold ${isActive ? "text-marca-700" : "text-slate-500"}`}>
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="nav-activa" className="absolute inset-x-5 top-0 h-1 rounded-b-full bg-marca-500" />}
                  <span className="text-xl" aria-hidden>
                    {n.i}
                  </span>
                  {n.t}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
