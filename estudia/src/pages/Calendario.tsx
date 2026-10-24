import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { sb, useDatos } from "../hooks/useDatos";
import { NOMBRES_MESES, aISOLocal, fechaLarga, hoyISO } from "../lib/fechas";
import type { DiaPlan, Examen } from "../lib/tipos";
import { Aviso, Cargando } from "../components/ui";

export default function Calendario() {
  const hoy = hoyISO();
  const [mes, setMes] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [seleccion, setSeleccion] = useState(hoy);
  const { datos, cargando, error } = useDatos(async () => {
    const [ex, planes, ses] = await Promise.all([
      supabase.from("exams").select("*").eq("archivado", false).then(sb),
      supabase.from("study_plans").select("exam_id, dias").then(sb),
      supabase.from("study_sessions").select("tarea_id, fecha").not("tarea_id", "is", null).then(sb),
    ]);
    return { examenes: (ex ?? []) as Examen[], planes: (planes ?? []) as { exam_id: string; dias: DiaPlan[] }[], hechas: new Set(((ses ?? []) as { tarea_id: string }[]).map((s) => s.tarea_id)) };
  }, []);

  if (cargando && !datos) return <Cargando />;
  if (error || !datos) return <Aviso tipo="error">{error}</Aviso>;

  const examenDe = new Map(datos.examenes.map((e) => [e.id, e]));
  const tareasDe = (fecha: string) =>
    datos.planes.flatMap((p) => {
      const e = examenDe.get(p.exam_id);
      if (!e) return [];
      return (p.dias.find((d) => d.fecha === fecha)?.tareas ?? []).map((t) => ({ ...t, examen: e }));
    });
  const examenesDe = (fecha: string) => datos.examenes.filter((e) => aISOLocal(new Date(e.fecha)) === fecha);

  // Rejilla del mes (lunes primero)
  const primero = new Date(mes);
  const desfase = (primero.getDay() + 6) % 7;
  const diasMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0).getDate();
  const celdas: (string | null)[] = [...Array(desfase).fill(null), ...Array.from({ length: diasMes }, (_, i) => aISOLocal(new Date(mes.getFullYear(), mes.getMonth(), i + 1)))];
  while (celdas.length % 7) celdas.push(null);

  const tareasSel = tareasDe(seleccion);
  const examenesSel = examenesDe(seleccion);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold text-slate-900">Calendario</h1>
      <div className="tarjeta">
        <div className="mb-3 flex items-center justify-between">
          <button type="button" className="boton-fantasma px-3" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))} aria-label="Mes anterior">‹</button>
          <p className="text-lg font-bold capitalize">{NOMBRES_MESES[mes.getMonth()]} {mes.getFullYear()}</p>
          <button type="button" className="boton-fantasma px-3" onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))} aria-label="Mes siguiente">›</button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-400">
          {["L", "M", "X", "J", "V", "S", "D"].map((d) => <div key={d}>{d}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {celdas.map((f, i) => {
            if (!f) return <div key={i} />;
            const ex = examenesDe(f);
            const ts = tareasDe(f);
            const sel = f === seleccion;
            return (
              <motion.button whileTap={{ scale: 0.9 }} key={f} type="button" onClick={() => setSeleccion(f)} className={`relative flex aspect-square flex-col items-center justify-start rounded-2xl pt-1.5 text-sm ${sel ? "bg-marca-600 text-white" : f === hoy ? "bg-marca-50 font-bold text-marca-700" : "hover:bg-slate-50"}`} aria-label={`${fechaLarga(f)}${ex.length ? `, examen de ${ex.map((e) => e.asignatura).join(", ")}` : ""}${ts.length ? `, ${ts.length} tareas` : ""}`}>
                <span className="tabular-nums">{Number(f.slice(8))}</span>
                {ex.length > 0 && <span className="text-xs" aria-hidden>🎓</span>}
                {ex.length === 0 && ts.length > 0 && (
                  <span className="mt-0.5 flex gap-0.5">
                    {[...new Set(ts.map((t) => t.examen.color))].slice(0, 3).map((c) => <span key={c} className="h-1.5 w-1.5 rounded-full" style={{ background: sel ? "#fff" : c }} />)}
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={seleccion} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="tarjeta space-y-3">
          <p className="font-bold capitalize">{fechaLarga(seleccion)}</p>
          {examenesSel.map((e) => (
            <Link key={e.id} to={`/examen/${e.id}`} className="flex items-center gap-2 rounded-2xl p-3 text-white" style={{ background: `linear-gradient(135deg, ${e.color}, #ec4899)` }}>
              🎓 <span className="font-bold">Examen de {e.asignatura}</span>
              <span className="ml-auto text-sm">{new Date(e.fecha).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}</span>
            </Link>
          ))}
          {tareasSel.length === 0 && examenesSel.length === 0 && <p className="text-sm text-slate-500">Nada planificado este día.</p>}
          <ul className="space-y-1.5">
            {tareasSel.map((t) => (
              <li key={`${t.examen.id}-${t.id}`}>
                <Link to={`/examen/${t.examen.id}/plan`} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-slate-50 ${datos.hechas.has(t.id) ? "text-slate-400 line-through" : ""}`}>
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.examen.color }} />
                  <span className="shrink-0 text-xs font-semibold text-slate-500">{t.examen.asignatura}</span>
                  <span className="min-w-0 flex-1 truncate">{t.titulo}</span>
                  <span className="text-xs text-slate-400">{t.minutos}′</span>
                </Link>
              </li>
            ))}
          </ul>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
