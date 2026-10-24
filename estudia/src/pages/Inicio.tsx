import { motion } from "motion/react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { sb, useDatos } from "../hooks/useDatos";
import { puedeUsarIA, useAuth } from "../hooks/useAuth";
import { hoyISO } from "../lib/fechas";
import { LOGROS, mensajeMotivacion, rachaVigente, type Racha } from "../lib/progreso";
import type { DiaPlan, Examen } from "../lib/tipos";
import { CuentaAtras } from "../components/CuentaAtras";
import { Aviso, BarraProgreso, Cargando, Vacio } from "../components/ui";

const ENLACE_TAREA: Record<string, string> = { estudio: "resumenes", flashcards: "flashcards", test: "tests", simulacro: "practica", repaso: "esquemas" };

export default function Inicio() {
  const { perfil } = useAuth();
  const hoy = hoyISO();
  const { datos, cargando, error } = useDatos(async () => {
    const [examenes, planes, racha, logros, hechasHoy] = await Promise.all([
      supabase.from("exams").select("*").eq("archivado", false).order("fecha").then(sb),
      supabase.from("study_plans").select("exam_id, dias").then(sb),
      supabase.from("streaks").select("*").maybeSingle().then(sb),
      supabase.from("achievements").select("codigo, obtenido_en").order("obtenido_en", { ascending: false }).then(sb),
      supabase.from("study_sessions").select("tarea_id, minutos").eq("fecha", hoy).then(sb),
    ]);
    return {
      examenes: (examenes ?? []) as Examen[],
      planes: (planes ?? []) as { exam_id: string; dias: DiaPlan[] }[],
      racha: racha as Racha | null,
      logros: (logros ?? []) as { codigo: string }[],
      hechasHoy: (hechasHoy ?? []) as { tarea_id: string | null; minutos: number }[],
    };
  }, [hoy]);

  if (cargando) return <Cargando />;
  if (error || !datos) return <Aviso tipo="error">{error}</Aviso>;

  const ahora = new Date();
  const proximos = datos.examenes.filter((e) => new Date(e.fecha) > ahora);
  const pasados = datos.examenes.filter((e) => new Date(e.fecha) <= ahora);
  const hechas = new Set(datos.hechasHoy.map((h) => h.tarea_id).filter(Boolean));
  const minutosHoy = datos.hechasHoy.reduce((a, h) => a + (h.minutos ?? 0), 0);
  const racha = datos.racha ? rachaVigente({ ...datos.racha, descansos: (datos.racha.descansos as unknown as string[]) ?? [] }, hoy) : { dias: 0, enRiesgo: false, descansoDisponible: true };
  const tareasHoy = proximos.flatMap((e) => {
    const dia = datos.planes.find((p) => p.exam_id === e.id)?.dias.find((d) => d.fecha === hoy);
    return (dia?.tareas ?? []).map((t) => ({ ...t, examen: e }));
  });
  const completadas = tareasHoy.filter((t) => hechas.has(t.id)).length;

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-2xl font-extrabold text-slate-900">¡Hola{perfil?.nombre ? `, ${perfil.nombre}` : ""}! 👋</h1>
        <p className="text-slate-600">{mensajeMotivacion(racha.dias, minutosHoy > 0)}</p>
      </motion.div>

      {perfil?.consentimiento_estado === "pendiente_tutor" && (
        <Aviso tipo="info" titulo="Falta el permiso de tu padre, madre o tutor">
          Puedes crear exámenes y ver tu plan, pero para subir apuntes y usar la IA necesitamos su permiso. <Link to="/perfil" className="font-bold underline">Pedirlo ahora</Link>
        </Aviso>
      )}
      {perfil && perfil.consentimiento_estado !== "pendiente_tutor" && !puedeUsarIA(perfil) && (
        <Aviso tipo="info">
          Para leer tus apuntes con IA, activa el permiso en tu <Link to="/perfil" className="font-bold underline">perfil</Link>.
        </Aviso>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <motion.div whileHover={{ y: -2 }} className="tarjeta flex items-center gap-4 bg-gradient-to-br from-orange-50 to-white">
          <motion.div className="text-4xl" animate={racha.dias > 0 ? { scale: [1, 1.15, 1] } : {}} transition={{ repeat: Infinity, duration: 2 }} aria-hidden>
            🔥
          </motion.div>
          <div>
            <p className="text-2xl font-extrabold text-slate-900">{racha.dias} {racha.dias === 1 ? "día" : "días"}</p>
            <p className="text-xs text-slate-500">{racha.enRiesgo ? "¡Estudia hoy para mantenerla!" : racha.descansoDisponible ? "Tienes un día de descanso esta semana" : "Racha de estudio"}</p>
          </div>
        </motion.div>
        <div className="tarjeta sm:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-bold text-slate-900">Hoy toca</p>
            <p className="text-sm text-slate-500">{completadas}/{tareasHoy.length} hechas</p>
          </div>
          <BarraProgreso valor={tareasHoy.length ? (completadas / tareasHoy.length) * 100 : 0} />
          {tareasHoy.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">{proximos.length ? "Hoy no hay tareas en tu plan. ¡Disfruta del descanso!" : "Crea un examen para tener tu plan."}</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {tareasHoy.slice(0, 5).map((t) => (
                <li key={`${t.examen.id}-${t.id}`}>
                  <Link to={`/examen/${t.examen.id}/${ENLACE_TAREA[t.tipo] ?? "plan"}`} className={`flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-marca-50 ${hechas.has(t.id) ? "text-slate-400 line-through" : "text-slate-700"}`}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.examen.color }} aria-hidden />
                    <span className="truncate">{t.titulo}</span>
                    <span className="ml-auto shrink-0 text-xs text-slate-400">{t.minutos} min</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Tus exámenes</h2>
          <Link to="/nuevo" className="boton-primario">
            ➕ Nuevo examen
          </Link>
        </div>
        {proximos.length === 0 ? (
          <Vacio icono="🎯" titulo="Crea tu primer examen" texto="Indica la asignatura, la fecha y la nota que quieres sacar. Después sube fotos de tus apuntes y te preparamos todo.">
            <Link to="/nuevo" className="boton-primario">Empezar</Link>
          </Vacio>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {proximos.map((e, i) => (
              <motion.div key={e.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} whileHover={{ y: -3 }}>
                <Link to={`/examen/${e.id}`} className="block overflow-hidden rounded-3xl bg-white shadow-suave ring-1 ring-marca-100">
                  <div className="h-2" style={{ background: `linear-gradient(90deg, ${e.color}, #ec4899)` }} />
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-lg font-bold text-slate-900">{e.asignatura}</p>
                        <p className="text-sm text-slate-500">{new Date(e.fecha).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })} · objetivo {String(e.nota_objetivo).replace(".", ",")}</p>
                      </div>
                      <span className="chip shrink-0 bg-marca-50 text-marca-700">
                        ⏳ <CuentaAtras fecha={e.fecha} compacta />
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        )}
        {pasados.length > 0 && (
          <details className="tarjeta">
            <summary className="cursor-pointer text-sm font-semibold text-slate-600">Exámenes ya hechos ({pasados.length})</summary>
            <ul className="mt-2 space-y-1">
              {pasados.map((e) => (
                <li key={e.id}>
                  <Link to={`/examen/${e.id}`} className="text-sm text-marca-700 hover:underline">{e.asignatura} · {new Date(e.fecha).toLocaleDateString("es-ES")}</Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {datos.logros.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-slate-900">Logros</h2>
          <div className="sin-barra -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
            {datos.logros.map((l, i) => {
              const info = LOGROS[l.codigo];
              if (!info) return null;
              return (
                <motion.div key={l.codigo} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: i * 0.05, type: "spring" }} className="tarjeta w-36 shrink-0 text-center" title={info.descripcion}>
                  <div className="text-3xl" aria-hidden>{info.icono}</div>
                  <p className="mt-1 text-sm font-bold text-slate-900">{info.titulo}</p>
                  <p className="text-[11px] text-slate-500">{info.descripcion}</p>
                </motion.div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
