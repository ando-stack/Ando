import { motion } from "motion/react";
import { NavLink, Outlet, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { sb, useDatos } from "../hooks/useDatos";
import { ExamenCtx } from "../hooks/useExamen";
import type { Examen, Tema } from "../lib/tipos";
import { CuentaAtras } from "./CuentaAtras";
import { Pomodoro } from "./Temporizador";
import { Aviso, Cargando } from "./ui";

const SECCIONES = [
  { a: "", t: "Panel", i: "📊" },
  { a: "plan", t: "Plan", i: "🗓️" },
  { a: "apuntes", t: "Apuntes", i: "📸" },
  { a: "resumenes", t: "Resúmenes", i: "📝" },
  { a: "esquemas", t: "Esquemas", i: "🧠" },
  { a: "flashcards", t: "Flashcards", i: "🃏" },
  { a: "tests", t: "Tests", i: "✅" },
  { a: "practica", t: "Exámenes de práctica", i: "🎓" },
  { a: "tutor", t: "Tutor", i: "💬" },
];

export function LayoutExamen() {
  const { id = "" } = useParams();
  const { datos, error, cargando, recargar } = useDatos(async () => {
    const [examen, temas] = await Promise.all([
      supabase.from("exams").select("*").eq("id", id).single().then(sb),
      supabase.from("exam_topics").select("id, exam_id, titulo, orden").eq("exam_id", id).order("orden").then(sb),
    ]);
    return { examen: examen as Examen, temas: (temas ?? []) as Tema[] };
  }, [id]);

  if (cargando && !datos) return <Cargando />;
  if (error || !datos) return <Aviso tipo="error" titulo="No hemos podido abrir el examen">{error ?? "Puede que se haya borrado."}</Aviso>;
  const { examen } = datos;

  return (
    <ExamenCtx.Provider value={{ ...datos, recargar: () => recargar(true) }}>
      <div className="space-y-4 pb-16">
        <motion.div layout className="relative overflow-hidden rounded-3xl p-4 text-white shadow-flota sm:p-5" style={{ background: `linear-gradient(135deg, ${examen.color}, #ec4899)` }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider opacity-80">{examen.curso || "Examen"}</p>
              <h1 className="truncate text-2xl font-extrabold">{examen.asignatura}</h1>
              <p className="text-sm opacity-90">
                {new Date(examen.fecha).toLocaleString("es-ES", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} · objetivo {String(examen.nota_objetivo).replace(".", ",")}
              </p>
            </div>
            <CuentaAtras fecha={examen.fecha} />
          </div>
        </motion.div>
        <nav className="sin-barra sticky top-0 z-20 -mx-4 flex gap-1.5 overflow-x-auto bg-fondo/90 px-4 py-2 backdrop-blur sm:top-[61px]" aria-label="Secciones del examen">
          {SECCIONES.map((s) => (
            <NavLink key={s.a} to={s.a ? `/examen/${id}/${s.a}` : `/examen/${id}`} end={!s.a} className={({ isActive }) => `shrink-0 rounded-full px-3.5 py-2 text-sm font-semibold transition ${isActive ? "bg-marca-600 text-white shadow-md shadow-marca-500/30" : "bg-white text-slate-600 ring-1 ring-slate-200"}`}>
              <span aria-hidden>{s.i}</span> {s.t}
            </NavLink>
          ))}
        </nav>
        <Outlet />
      </div>
      <Pomodoro examId={id} />
    </ExamenCtx.Provider>
  );
}
