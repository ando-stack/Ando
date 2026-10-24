import { motion } from "motion/react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { sb, useDatos } from "../hooks/useDatos";
import { useExamen } from "../hooks/useExamen";
import { dominadas } from "../lib/fsrs";
import { hoyISO } from "../lib/fechas";
import { dominioPorTema, notaEstimada, recomendaciones, type ResultadoPorTema, type TarjetaProgreso } from "../lib/progreso";
import type { Correccion, DiaPlan, PreguntaSimulacro, ResultadoPregunta } from "../lib/tipos";
import { LineaNotas, MapaCalor, MedidorNota, type PuntoNota } from "../components/Graficos";
import { Aviso, BarraProgreso, Cargando } from "../components/ui";

export default function Examen() {
  const { examen, temas } = useExamen();
  const { datos, cargando, error } = useDatos(async () => {
    const [intentos, simulacros, tarjetas, chunks, desact, plan, subidas] = await Promise.all([
      supabase.from("quiz_attempts").select("resultados, nota, created_at, quizzes(preguntas)").eq("exam_id", examen.id).then(sb),
      supabase.from("mock_exam_attempts").select("nota, created_at, correccion, mock_exams(preguntas)").eq("exam_id", examen.id).eq("estado", "corregido").then(sb),
      supabase.from("flashcards").select("topic_id, estado, estabilidad, dificultad, vence, ultima_revision, repeticiones, fallos, suspendida").eq("exam_id", examen.id).then(sb),
      supabase.from("chunks").select("topic_id").eq("exam_id", examen.id).then(sb),
      supabase.from("summaries").select("id", { count: "exact", head: true }).eq("exam_id", examen.id).eq("desactualizado", true),
      supabase.from("study_plans").select("dias").eq("exam_id", examen.id).maybeSingle().then(sb),
      supabase.from("uploads").select("estado").eq("exam_id", examen.id).then(sb),
    ]);
    return { intentos: intentos ?? [], simulacros: simulacros ?? [], tarjetas: (tarjetas ?? []) as (TarjetaProgreso & { suspendida: boolean })[], chunks: chunks ?? [], desactualizados: desact.count ?? 0, plan: plan as { dias: DiaPlan[] } | null, subidas: (subidas ?? []) as { estado: string }[] };
  }, [examen.id]);

  if (cargando && !datos) return <Cargando />;
  if (error || !datos) return <Aviso tipo="error">{error}</Aviso>;

  // Resultados por pregunta (tests + simulacros) para el dominio por tema
  const resultados: ResultadoPorTema[] = [];
  const puntos: PuntoNota[] = [];
  for (const i of datos.intentos as unknown as { resultados: ResultadoPregunta[]; nota: number; created_at: string; quizzes: { preguntas: { id: string; enunciado: string }[] } | null }[]) {
    puntos.push({ fecha: i.created_at, nota: Number(i.nota), tipo: "test" });
    for (const r of i.resultados ?? []) {
      resultados.push({ topic_id: r.topic_id, correcta: r.correcta, fecha: i.created_at, enunciado: i.quizzes?.preguntas.find((p) => p.id === r.pregunta_id)?.enunciado });
    }
  }
  const notasSim: { nota: number; fecha: string }[] = [];
  for (const s of datos.simulacros as unknown as { nota: number; created_at: string; correccion: Correccion | null; mock_exams: { preguntas: PreguntaSimulacro[] } | null }[]) {
    puntos.push({ fecha: s.created_at, nota: Number(s.nota), tipo: "simulacro" });
    notasSim.push({ nota: Number(s.nota), fecha: s.created_at });
    for (const c of s.correccion?.preguntas ?? []) {
      const p = s.mock_exams?.preguntas.find((x) => x.id === c.pregunta_id);
      if (p) resultados.push({ topic_id: p.topic_id, correcta: c.puntos_max > 0 && c.puntos_obtenidos / c.puntos_max >= 0.5, fecha: s.created_at, peso: 2, enunciado: p.enunciado });
    }
  }
  const tarjetasActivas = datos.tarjetas.filter((t) => !t.suspendida);
  const dominios = dominioPorTema(temas, resultados, tarjetasActivas, new Date(), examen.fecha);
  const pesos: Record<string, number> = {};
  for (const c of datos.chunks as { topic_id: string | null }[]) if (c.topic_id) pesos[c.topic_id] = (pesos[c.topic_id] ?? 0) + 1;
  const estimada = notaEstimada(dominios, pesos, notasSim);
  const vencidas = tarjetasActivas.filter((t) => t.estado !== "nueva" && new Date(t.vence) <= new Date()).length;
  const recs = recomendaciones(dominios, resultados.slice(-60), vencidas);
  const nDominadas = dominadas(tarjetasActivas);
  const hoy = datos.plan?.dias.find((d) => d.fecha === hoyISO());
  const objetivo = Number(examen.nota_objetivo);
  const porRevisar = datos.subidas.filter((s) => s.estado === "revisar").length;
  const sinApuntes = datos.subidas.length === 0;

  return (
    <div className="space-y-4">
      {sinApuntes && (
        <Aviso tipo="info" titulo="Empieza subiendo tus apuntes">
          Haz fotos de tus apuntes o del libro y la IA preparará todo tu material. <Link to={`/examen/${examen.id}/apuntes`} className="font-bold underline">Subir apuntes</Link>
        </Aviso>
      )}
      {porRevisar > 0 && (
        <Aviso tipo="aviso">
          Tienes {porRevisar} {porRevisar === 1 ? "foto" : "fotos"} con el texto listo para revisar. <Link to={`/examen/${examen.id}/apuntes`} className="font-bold underline">Revisar</Link>
        </Aviso>
      )}
      {datos.desactualizados > 0 && (
        <Aviso tipo="info">
          Has añadido apuntes nuevos: algunos resúmenes se están actualizando o puedes actualizarlos desde <Link to={`/examen/${examen.id}/resumenes`} className="font-bold underline">Resúmenes</Link>.
        </Aviso>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="tarjeta">
          <h2 className="font-bold">Nota estimada vs. objetivo</h2>
          <MedidorNota nota={estimada.nota} margen={estimada.margen} objetivo={objetivo} />
          <p className="text-center text-sm font-semibold text-slate-700">
            {estimada.nota === null ? "" : estimada.nota >= objetivo ? "¡Vas camino de tu objetivo! 🚀" : `Te faltan unos ${(objetivo - estimada.nota).toFixed(1).replace(".", ",")} puntos. ¡Se puede!`}
          </p>
          <p className="mt-1 text-center text-xs text-slate-500">{estimada.explicacion}</p>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }} className="tarjeta space-y-3">
          <h2 className="font-bold">Hoy</h2>
          {hoy && hoy.tareas.length ? (
            <ul className="space-y-1 text-sm">{hoy.tareas.map((t) => <li key={t.id} className="flex gap-2"><span>•</span><span className="flex-1">{t.titulo}</span><span className="text-slate-400">{t.minutos}′</span></li>)}</ul>
          ) : (
            <p className="text-sm text-slate-500">No hay tareas para hoy.</p>
          )}
          <Link to={`/examen/${examen.id}/plan`} className="boton-secundario w-full">Ver el plan completo</Link>
          <div>
            <div className="mb-1 flex justify-between text-sm"><span className="font-semibold">Flashcards dominadas</span><span className="text-slate-500">{nDominadas}/{tarjetasActivas.length}</span></div>
            <BarraProgreso valor={tarjetasActivas.length ? (nDominadas / tarjetasActivas.length) * 100 : 0} color="from-emerald-400 to-teal-500" />
            {vencidas > 0 && <p className="mt-1 text-xs text-marca-700">{vencidas} para repasar hoy · <Link className="underline" to={`/examen/${examen.id}/flashcards`}>repasar</Link></p>}
          </div>
        </motion.div>
      </div>

      {recs.length > 0 && (
        <div className="tarjeta space-y-2">
          <h2 className="font-bold">Recomendaciones</h2>
          <ul className="space-y-2">
            {recs.map((r, i) => (
              <motion.li key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex items-start gap-2 rounded-2xl bg-slate-50 p-3 text-sm">
                <span aria-hidden>{r.prioridad >= 3 ? "🎯" : "💡"}</span>
                <span className="flex-1">{r.texto}</span>
                <Link to={`/examen/${examen.id}/${r.topic_id ? "tests" : "flashcards"}`} className="chip shrink-0 bg-marca-50 text-marca-700">Ir</Link>
              </motion.li>
            ))}
          </ul>
        </div>
      )}

      <div className="tarjeta space-y-3">
        <h2 className="font-bold">Dominio por tema</h2>
        <MapaCalor dominios={dominios} />
      </div>

      <div className="tarjeta space-y-2">
        <h2 className="font-bold">Evolución de tus notas</h2>
        <LineaNotas puntos={puntos} objetivo={objetivo} />
      </div>

      <div className="flex justify-end">
        <Link to={`/examen/${examen.id}/editar`} className="boton-fantasma text-sm">⚙️ Editar el examen</Link>
      </div>
    </div>
  );
}
