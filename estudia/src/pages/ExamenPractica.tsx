import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { mensajeError } from "../lib/api";
import { sb, useDatos } from "../hooks/useDatos";
import { useAuth } from "../hooks/useAuth";
import { useExamen } from "../hooks/useExamen";
import { useTrabajo } from "../hooks/useTrabajo";
import { composicionSimulacro } from "../lib/simulacro";
import { formatearMinutos, hoyISO } from "../lib/fechas";
import type { Fuente, IntentoSimulacro, Simulacro } from "../lib/tipos";
import { Markdown, VisorFragmento } from "../components/Contenido";
import { BotonGenerar } from "../components/Generar";
import { TemporizadorExamen } from "../components/Temporizador";
import { Celebracion } from "../components/Celebracion";
import { Aviso, Cargando, Citas, EstadoTrabajo, Vacio, useToast } from "../components/ui";

const NOMBRE: Record<string, string> = { test: "Tipo test", cortas: "Preguntas cortas", desarrollo: "Desarrollo", problemas: "Problemas" };

export default function ExamenPractica() {
  const { mockId } = useParams();
  return mockId ? <RealizarSimulacro mockId={mockId} /> : <ListaSimulacros />;
}

function ListaSimulacros() {
  const { examen } = useExamen();
  const { perfil } = useAuth();
  const navegar = useNavigate();
  const aviso = useToast();
  const { datos, cargando, error, recargar } = useDatos(async () => {
    const [mocks, intentos] = await Promise.all([
      supabase.from("mock_exams").select("id, titulo, duracion_min, distribucion, created_at, preguntas").eq("exam_id", examen.id).order("created_at", { ascending: false }).then(sb),
      supabase.from("mock_exam_attempts").select("id, mock_exam_id, estado, nota, created_at").eq("exam_id", examen.id).order("created_at", { ascending: false }).then(sb),
    ]);
    return { mocks: (mocks ?? []) as Simulacro[], intentos: (intentos ?? []) as IntentoSimulacro[] };
  }, [examen.id]);
  const comp = composicionSimulacro(examen.tipo, examen.distribucion, examen.duracion_min);

  async function empezar(m: Simulacro) {
    if (!perfil) return;
    const enCurso = datos?.intentos.find((i) => i.mock_exam_id === m.id && i.estado === "en_curso");
    if (enCurso) return navegar(`${m.id}?intento=${enCurso.id}`);
    const { data, error } = await supabase.from("mock_exam_attempts").insert({ user_id: perfil.id, exam_id: examen.id, mock_exam_id: m.id, respuestas: {}, inicio: new Date().toISOString() }).select("id").single();
    if (error) return aviso(mensajeError(error), "error");
    navegar(`${m.id}?intento=${data.id}`);
  }

  if (cargando && !datos) return <Cargando />;
  if (error || !datos) return <Aviso tipo="error">{error}</Aviso>;
  return (
    <div className="space-y-4">
      <div className="tarjeta space-y-3">
        <h2 className="font-bold">Examen de práctica con el formato real</h2>
        <p className="text-sm text-slate-600">
          {formatearMinutos(examen.duracion_min)} · {comp.map((c) => `${c.n} ${NOMBRE[c.tipo].toLowerCase()} (${c.puntos.toString().replace(".", ",")} pts)`).join(" · ")}
        </p>
        <p className="text-xs text-slate-500">Hazlo como si fuera el de verdad: sin mirar los apuntes y con el temporizador. Los tests se corrigen al instante; el resto lo corrige la IA con una rúbrica que podrás ver.</p>
        <BotonGenerar tipo="simulacro" examId={examen.id} texto="✨ Crear examen de práctica" alTerminar={() => void recargar(true)} />
      </div>
      {datos.mocks.length === 0 ? (
        <Vacio icono="🎓" titulo="Aún no hay exámenes de práctica" texto="Practicar con el mismo formato y tiempo que el examen real mejora la nota y reduce los nervios." />
      ) : (
        <ul className="space-y-2">
          {datos.mocks.map((m) => {
            const ints = datos.intentos.filter((i) => i.mock_exam_id === m.id);
            const corregidos = ints.filter((i) => i.estado === "corregido");
            return (
              <li key={m.id} className="tarjeta space-y-2">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{m.titulo}</p>
                    <p className="text-xs text-slate-500">{m.preguntas.length} preguntas · {formatearMinutos(m.duracion_min)}</p>
                  </div>
                  <button type="button" className="boton-primario" onClick={() => empezar(m)}>{ints.some((i) => i.estado === "en_curso") ? "Continuar" : corregidos.length ? "Repetir" : "Empezar"}</button>
                </div>
                {ints.filter((i) => i.estado !== "en_curso").length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {ints.filter((i) => i.estado !== "en_curso").map((i) => (
                      <Link key={i.id} to={`${m.id}?intento=${i.id}`} className="chip bg-marca-50 text-marca-700">
                        {i.estado === "corregido" ? `Nota ${Number(i.nota).toFixed(1).replace(".", ",")}` : i.estado === "corrigiendo" ? "Corrigiendo…" : "Error al corregir"} · {new Date(i.created_at).toLocaleDateString("es-ES")}
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RealizarSimulacro({ mockId }: { mockId: string }) {
  const { examen } = useExamen();
  const { perfil } = useAuth();
  const aviso = useToast();
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const intentoId = params.get("intento");
  const [respuestas, setRespuestas] = useState<Record<string, string | number>>({});
  const [fuente, setFuente] = useState<Fuente | null>(null);
  const guardarT = useRef<number | null>(null);
  const corr = useTrabajo(() => void recargar(true));

  const { datos, cargando, error, recargar } = useDatos(async () => {
    const mock = (await supabase.from("mock_exams").select("*").eq("id", mockId).single().then(sb)) as Simulacro;
    const intento = intentoId ? ((await supabase.from("mock_exam_attempts").select("*").eq("id", intentoId).single().then(sb)) as IntentoSimulacro) : null;
    return { mock, intento };
  }, [mockId, intentoId]);

  useEffect(() => {
    if (datos?.intento?.respuestas) setRespuestas(datos.intento.respuestas);
  }, [datos?.intento?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Si se está corrigiendo, consultar hasta que termine
  useEffect(() => {
    if (datos?.intento?.estado !== "corrigiendo") return;
    const t = window.setInterval(() => void recargar(true), 3000);
    return () => window.clearInterval(t);
  }, [datos?.intento?.estado, recargar]);

  function responder(id: string, v: string | number) {
    const nuevas = { ...respuestas, [id]: v };
    setRespuestas(nuevas);
    if (guardarT.current) window.clearTimeout(guardarT.current);
    guardarT.current = window.setTimeout(() => {
      if (intentoId) void supabase.from("mock_exam_attempts").update({ respuestas: nuevas }).eq("id", intentoId);
    }, 1200);
  }

  async function entregar(automatico = false) {
    if (!intentoId || !datos || !perfil) return;
    if (!automatico && !window.confirm("¿Entregar el examen? Ya no podrás cambiar las respuestas.")) return;
    if (guardarT.current) window.clearTimeout(guardarT.current);
    const { error } = await supabase.from("mock_exam_attempts").update({ respuestas }).eq("id", intentoId);
    if (error) return aviso(mensajeError(error), "error");
    const minutos = Math.max(1, Math.round((Date.now() - new Date(datos.intento!.inicio).getTime()) / 60000));
    const { count } = await supabase.from("mock_exam_attempts").select("id", { count: "exact", head: true }).eq("exam_id", examen.id).neq("estado", "en_curso");
    await supabase.from("study_sessions").insert({ user_id: perfil.id, exam_id: examen.id, fecha: hoyISO(), tipo: "simulacro", tarea_id: `simulacro:${(count ?? 0) + 1}`, minutos: Math.min(minutos, 600) });
    if (automatico) aviso("¡Se acabó el tiempo! Entregamos tu examen.", "info");
    const id = await corr.lanzar("corregir_simulacro", examen.id, { attempt_id: intentoId });
    if (id) void recargar(true);
  }

  if (cargando && !datos) return <Cargando />;
  if (error || !datos) return <Aviso tipo="error">{error}</Aviso>;
  const { mock, intento } = datos;
  if (!intento) return <Aviso tipo="aviso">Empieza el examen desde la lista. <Link className="underline" to=".." relative="path">Volver</Link></Aviso>;

  if (intento.estado === "corregido" && intento.correccion) return <VistaCorreccion mock={mock} intento={intento} alVerFuente={setFuente} fuente={fuente} />;
  if (intento.estado === "corrigiendo" || corr.enCurso) {
    return (
      <div className="space-y-3">
        <EstadoTrabajo trabajo={corr.trabajo ?? { id: "", tipo: "corregir_simulacro", estado: "en_curso", progreso: 40, mensaje: "Corrigiendo tu examen…", resultado: null, error: null, created_at: "" }} error={corr.error} />
        <p className="text-center text-sm text-slate-500">Puedes salir: la corrección seguirá y la verás en la lista.</p>
      </div>
    );
  }
  if (intento.estado === "error") {
    return (
      <div className="space-y-3">
        <Aviso tipo="error" titulo="No se ha podido corregir">{corr.error ?? "La IA ha fallado al corregir. Tus respuestas están guardadas."}</Aviso>
        <button type="button" className="boton-primario" onClick={() => entregar(true)}>Reintentar la corrección</button>
      </div>
    );
  }

  const respondidas = mock.preguntas.filter((p) => respuestas[p.id] !== undefined && String(respuestas[p.id]).trim() !== "").length;
  return (
    <div className="space-y-4">
      <div className="sticky top-14 z-10 flex items-center justify-between gap-2 rounded-2xl bg-marca-600 px-3 py-2 text-white shadow-flota sm:top-[120px]">
        <span className="text-sm font-semibold">{respondidas}/{mock.preguntas.length} respondidas</span>
        <TemporizadorExamen inicio={intento.inicio} minutos={mock.duracion_min} alAcabar={() => entregar(true)} />
      </div>
      {mock.preguntas.map((p, k) => (
        <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(k * 0.03, 0.3) }} className="tarjeta space-y-3">
          <div className="flex items-center justify-between">
            <span className="chip bg-marca-50 text-marca-700">{k + 1}. {NOMBRE[p.tipo]}</span>
            <span className="text-xs font-semibold text-slate-500">{String(p.puntos).replace(".", ",")} pts</span>
          </div>
          <Markdown texto={p.enunciado} className="font-semibold text-slate-900" />
          {p.tipo === "test" ? (
            <div className="space-y-2">
              {p.opciones?.map((o, j) => (
                <button key={j} type="button" onClick={() => responder(p.id, j)} className={`flex w-full items-start gap-3 rounded-2xl p-3 text-left ring-2 ${respuestas[p.id] === j ? "bg-marca-50 ring-marca-500" : "bg-white ring-slate-100"}`}>
                  <span className="font-bold text-slate-500">{String.fromCharCode(97 + j)})</span>
                  <Markdown texto={o} />
                </button>
              ))}
            </div>
          ) : (
            <textarea className={`campo ${p.tipo === "cortas" ? "min-h-24" : "min-h-48"}`} value={String(respuestas[p.id] ?? "")} onChange={(e) => responder(p.id, e.target.value)} placeholder={p.tipo === "problemas" ? "Escribe el planteamiento, los pasos y el resultado. Fórmulas con $…$" : "Escribe tu respuesta"} aria-label={`Respuesta a la pregunta ${k + 1}`} />
          )}
        </motion.div>
      ))}
      <button type="button" className="boton-primario w-full py-3 text-base" onClick={() => entregar(false)}>Entregar examen</button>
      <button type="button" className="boton-fantasma w-full" onClick={() => navegar("..", { relative: "path" })}>Salir (se guardan tus respuestas)</button>
      <EstadoTrabajo trabajo={null} error={corr.error} />
    </div>
  );
}

function VistaCorreccion({ mock, intento, alVerFuente, fuente }: { mock: Simulacro; intento: IntentoSimulacro; alVerFuente: (f: Fuente | null) => void; fuente: Fuente | null }) {
  const { examen } = useExamen();
  const c = intento.correccion!;
  const [celebrar, setCelebrar] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setCelebrar(false), 3500);
    return () => window.clearTimeout(t);
  }, []);
  const objetivo = Number(examen.nota_objetivo);
  return (
    <div className="space-y-4">
      <Celebracion activa={celebrar} mensaje={c.nota >= objetivo ? "¡Objetivo alcanzado! 🏆" : "¡Examen terminado! 💪"} />
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="tarjeta text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-marca-600">Nota estimada</p>
        <p className="text-6xl font-extrabold text-slate-900">{c.nota.toFixed(1).replace(".", ",")}</p>
        <p className="text-sm text-slate-500">Tu objetivo: {String(objetivo).replace(".", ",")} · corrección orientativa hecha con IA</p>
        <p className="mt-3 text-slate-700">{c.resumen}</p>
      </motion.div>
      {c.para_subir_nota.length > 0 && (
        <div className="tarjeta space-y-2 bg-gradient-to-br from-amber-50 to-white">
          <h3 className="font-bold">📈 Para subir nota</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{c.para_subir_nota.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {mock.preguntas.map((p, k) => {
        const cp = c.preguntas.find((x) => x.pregunta_id === p.id);
        const resp = intento.respuestas[p.id];
        const ok = cp && cp.puntos_obtenidos >= cp.puntos_max - 1e-9;
        return (
          <div key={p.id} className="tarjeta space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="chip bg-marca-50 text-marca-700">{k + 1}. {NOMBRE[p.tipo]}</span>
              <span className={`chip ${ok ? "bg-emerald-100 text-emerald-800" : (cp?.puntos_obtenidos ?? 0) > 0 ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-700"}`}>
                {String(cp?.puntos_obtenidos ?? 0).replace(".", ",")} / {String(p.puntos).replace(".", ",")}
              </span>
            </div>
            <Markdown texto={p.enunciado} className="font-semibold" />
            <div className="rounded-2xl bg-slate-50 p-3 text-sm">
              <p className="mb-1 text-xs font-bold uppercase text-slate-500">Tu respuesta</p>
              {p.tipo === "test" ? <p>{typeof resp === "number" ? p.opciones?.[resp] : "Sin responder"}</p> : <Markdown texto={String(resp ?? "") || "_(en blanco)_"} />}
            </div>
            {cp && cp.criterios.length > 0 && (
              <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-marca-50 text-left text-xs uppercase text-marca-800"><tr><th className="p-2">Criterio de la rúbrica</th><th className="p-2 text-right">Puntos</th></tr></thead>
                  <tbody>
                    {cp.criterios.map((cr, i) => (
                      <tr key={i} className="border-t border-slate-100 align-top">
                        <td className="p-2"><p className="font-semibold">{cr.criterio}</p><p className="text-xs text-slate-500">{cr.comentario}</p></td>
                        <td className="p-2 text-right font-bold tabular-nums">{String(cr.puntos_obtenidos).replace(".", ",")}/{String(cr.puntos_max).replace(".", ",")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {cp?.comentario && <p className="text-sm text-slate-700">{cp.comentario}</p>}
            {cp?.para_subir_nota && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">📈 {cp.para_subir_nota}</p>}
            {p.respuesta_modelo && (
              <details className="rounded-2xl bg-emerald-50/60 p-3">
                <summary className="cursor-pointer text-sm font-semibold text-emerald-800">Ver respuesta modelo (de tus apuntes)</summary>
                <Markdown texto={p.respuesta_modelo} className="mt-2" />
              </details>
            )}
            <Citas fuentes={cp?.fuentes.length ? cp.fuentes : p.fuentes} alAbrir={alVerFuente} />
          </div>
        );
      })}
      <Link to={`/examen/${examen.id}/practica`} className="boton-primario w-full">Volver a los exámenes de práctica</Link>
      <VisorFragmento fuente={fuente} examId={examen.id} alCerrar={() => alVerFuente(null)} />
    </div>
  );
}
