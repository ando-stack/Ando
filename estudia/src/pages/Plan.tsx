import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { api, mensajeError } from "../lib/api";
import { sb, useDatos } from "../hooks/useDatos";
import { useAuth } from "../hooks/useAuth";
import { useExamen } from "../hooks/useExamen";
import { fechaLarga, formatearMinutos, hoyISO } from "../lib/fechas";
import { mensajeReajuste, necesitaReajuste } from "../lib/plan";
import type { PlanEstudio, TareaPlan } from "../lib/tipos";
import { Aviso, BarraProgreso, Cargando, useToast } from "../components/ui";

const FASE: Record<string, { t: string; c: string }> = {
  aprendizaje: { t: "Aprender", c: "bg-sky-100 text-sky-800" },
  practica: { t: "Practicar", c: "bg-violet-100 text-violet-800" },
  repaso_final: { t: "Repaso final", c: "bg-amber-100 text-amber-800" },
  descanso: { t: "Descanso", c: "bg-slate-100 text-slate-500" },
};
const ICONO: Record<string, string> = { estudio: "📖", flashcards: "🃏", test: "✅", simulacro: "🎓", repaso: "🔁" };
const RUTA: Record<string, string> = { estudio: "resumenes", flashcards: "flashcards", test: "tests", simulacro: "practica", repaso: "esquemas" };

export default function Plan() {
  const { examen } = useExamen();
  const { perfil } = useAuth();
  const aviso = useToast();
  const hoy = hoyISO();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [verPasados, setVerPasados] = useState(false);
  const revisado = useRef(false);
  const { datos, cargando, error, recargar } = useDatos(async () => {
    const [plan, sesiones] = await Promise.all([
      supabase.from("study_plans").select("*").eq("exam_id", examen.id).maybeSingle().then(sb),
      supabase.from("study_sessions").select("tarea_id").eq("exam_id", examen.id).not("tarea_id", "is", null).then(sb),
    ]);
    return { plan: plan as PlanEstudio | null, hechas: new Set(((sesiones ?? []) as { tarea_id: string }[]).map((s) => s.tarea_id)) };
  }, [examen.id]);

  async function regenerar(motivo?: "atrasado" | "adelantado") {
    try {
      await api("plan", { body: { exam_id: examen.id, hoy } });
      if (motivo) setMensaje(mensajeReajuste(motivo));
      await recargar(true);
    } catch (e) {
      aviso(mensajeError(e), "error");
    }
  }

  // Reajuste automático si se saltó días o va por delante
  useEffect(() => {
    if (!datos || revisado.current) return;
    revisado.current = true;
    if (!datos.plan) {
      void regenerar();
      return;
    }
    const motivo = necesitaReajuste(datos.plan.dias, datos.hechas, hoy);
    const desfasado = datos.plan.dias.length > 0 && datos.plan.dias[0].fecha < hoy;
    if (motivo) void regenerar(motivo);
    else if (desfasado) void regenerar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datos]);

  async function marcar(t: TareaPlan, fecha: string) {
    if (!perfil || !datos) return;
    if (datos.hechas.has(t.id)) {
      const { error } = await supabase.from("study_sessions").delete().eq("exam_id", examen.id).eq("tarea_id", t.id);
      if (error) return aviso(mensajeError(error), "error");
    } else {
      const tipo = t.tipo === "estudio" ? "estudio" : t.tipo;
      const { error } = await supabase.from("study_sessions").insert({ user_id: perfil.id, exam_id: examen.id, fecha: hoy, tipo, tarea_id: t.id, minutos: t.minutos });
      if (error) return aviso(mensajeError(error), "error");
      if (fecha > hoy) aviso("¡Vas adelantado! Reajustaremos el plan.", "exito");
      else aviso("¡Hecho! Un pasito más 💪", "exito");
    }
    await recargar(true);
    if (fecha > hoy) await regenerar("adelantado");
  }

  if (cargando && !datos) return <Cargando />;
  if (error || !datos) return <Aviso tipo="error">{error}</Aviso>;
  if (!datos.plan) return <Cargando texto="Preparando tu plan…" />;
  const { plan, hechas } = datos;
  const v = plan.viabilidad;
  const pasados = plan.dias.filter((d) => d.fecha < hoy);
  const futuros = plan.dias.filter((d) => d.fecha >= hoy);
  const totalTareas = plan.dias.flatMap((d) => d.tareas).length;
  const totalHechas = plan.dias.flatMap((d) => d.tareas).filter((t) => hechas.has(t.id)).length;

  return (
    <div className="space-y-4">
      <AnimatePresence>
        {mensaje && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Aviso tipo="exito">{mensaje}</Aviso>
          </motion.div>
        )}
      </AnimatePresence>

      <div className={`tarjeta space-y-2 ${v.alcanzable ? "bg-gradient-to-br from-emerald-50 to-white" : "bg-gradient-to-br from-amber-50 to-white"}`}>
        <p className="font-bold text-slate-900">{v.alcanzable ? "🎯 Tu objetivo es alcanzable" : "🧭 Ajustemos un poco el plan"}</p>
        <p className="text-sm text-slate-700">{v.mensaje}</p>
        {v.sugerencias.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-slate-700">{v.sugerencias.map((s, i) => <li key={i}>{s}</li>)}</ul>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-slate-500">
          <span>Necesitas ≈ {formatearMinutos(v.minutos_necesarios)} · tienes {formatearMinutos(v.minutos_disponibles)}</span>
          <Link to={`/examen/${examen.id}/editar`} className="chip bg-white text-marca-700 ring-1 ring-marca-200">Cambiar tiempo u objetivo</Link>
        </div>
      </div>

      <div className="tarjeta">
        <div className="mb-2 flex justify-between text-sm"><span className="font-semibold">Progreso del plan</span><span className="text-slate-500">{totalHechas}/{totalTareas} tareas</span></div>
        <BarraProgreso valor={totalTareas ? (totalHechas / totalTareas) * 100 : 0} />
      </div>

      {pasados.length > 0 && (
        <button type="button" className="boton-fantasma w-full text-sm" onClick={() => setVerPasados(!verPasados)}>{verPasados ? "Ocultar días anteriores" : `Ver días anteriores (${pasados.length})`}</button>
      )}

      <ol className="space-y-3">
        {(verPasados ? plan.dias : futuros).map((d, i) => {
          const esHoy = d.fecha === hoy;
          const hechasDia = d.tareas.filter((t) => hechas.has(t.id)).length;
          return (
            <motion.li key={d.fecha} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.4) }} className={`tarjeta ${esHoy ? "ring-2 ring-marca-400" : ""} ${d.fecha < hoy ? "opacity-70" : ""}`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="font-bold capitalize text-slate-900">{esHoy ? "Hoy · " : ""}{fechaLarga(d.fecha)}</p>
                  <p className="text-xs text-slate-500">{d.minutos_disponibles ? `${formatearMinutos(d.minutos_disponibles)} disponibles` : "Día libre"}</p>
                </div>
                <span className={`chip ${FASE[d.fase].c}`}>{FASE[d.fase].t}</span>
              </div>
              {d.tareas.length === 0 ? (
                <p className="text-sm text-slate-500">{d.fase === "descanso" ? "Descansa: también es parte del plan 😌" : "Sin tareas."}</p>
              ) : (
                <ul className="space-y-1.5">
                  {d.tareas.map((t) => {
                    const hecha = hechas.has(t.id);
                    return (
                      <li key={t.id} className="flex items-center gap-2">
                        <motion.button whileTap={{ scale: 0.85 }} type="button" onClick={() => marcar(t, d.fecha)} className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-2 ${hecha ? "bg-emerald-500 text-white ring-emerald-500" : "bg-white ring-slate-300"}`} aria-label={hecha ? "Marcar como no hecha" : "Marcar como hecha"} aria-pressed={hecha}>
                          {hecha && "✓"}
                        </motion.button>
                        <span aria-hidden>{ICONO[t.tipo]}</span>
                        <span className={`min-w-0 flex-1 text-sm ${hecha ? "text-slate-400 line-through" : "text-slate-700"}`}>{t.titulo}</span>
                        <span className="shrink-0 text-xs text-slate-400">{t.minutos}′</span>
                        {!hecha && (esHoy || d.fecha > hoy) && <Link to={`/examen/${examen.id}/${RUTA[t.tipo]}`} className="chip shrink-0 bg-marca-50 text-marca-700">Ir</Link>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {esHoy && d.tareas.length > 0 && hechasDia === d.tareas.length && <p className="mt-2 text-sm font-semibold text-emerald-700">🎉 ¡Has terminado lo de hoy!</p>}
            </motion.li>
          );
        })}
      </ol>
      <div className="rounded-3xl bg-gradient-to-r from-marca-600 to-fuchsia-500 p-4 text-center text-white">
        <p className="text-sm font-semibold opacity-90">Día del examen</p>
        <p className="text-lg font-extrabold capitalize">{fechaLarga(hoyISO(new Date(examen.fecha)))} · ¡a por todas! 💜</p>
      </div>
      <button type="button" className="boton-fantasma w-full text-sm" onClick={() => regenerar()}>↻ Recalcular el plan</button>
    </div>
  );
}
