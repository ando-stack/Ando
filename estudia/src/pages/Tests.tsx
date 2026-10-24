import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { sb, useDatos } from "../hooks/useDatos";
import { useAuth } from "../hooks/useAuth";
import { useExamen } from "../hooks/useExamen";
import { barajar, notaSobre10, puntuarPregunta, type Respuesta } from "../lib/corregir";
import { hoyISO } from "../lib/fechas";
import type { Fuente, PreguntaTest, ResultadoPregunta, Test } from "../lib/tipos";
import { Markdown, VisorFragmento } from "../components/Contenido";
import { BotonGenerar } from "../components/Generar";
import { Celebracion } from "../components/Celebracion";
import { Aviso, BarraProgreso, Cargando, Citas, SelectorTema, Vacio, useToast } from "../components/ui";

const NOMBRE_TIPO: Record<string, string> = {
  opcion_multiple: "Opción múltiple",
  verdadero_falso: "Verdadero o falso (justifica)",
  respuesta_corta: "Respuesta corta",
  relacionar: "Relaciona",
  ordenar: "Ordena",
};

export default function Tests() {
  const { examen, temas } = useExamen();
  const [tema, setTema] = useState<string | null>(null);
  const [jugando, setJugando] = useState<Test | null>(null);
  const { datos, cargando, error, recargar } = useDatos(async () => {
    const [tests, intentos] = await Promise.all([
      supabase.from("quizzes").select("*").eq("exam_id", examen.id).order("created_at", { ascending: false }).then(sb),
      supabase.from("quiz_attempts").select("quiz_id, nota, created_at").eq("exam_id", examen.id).order("created_at", { ascending: false }).then(sb),
    ]);
    return { tests: (tests ?? []) as Test[], intentos: (intentos ?? []) as { quiz_id: string; nota: number }[] };
  }, [examen.id]);

  if (jugando) return <JugarTest test={jugando} alSalir={() => { setJugando(null); void recargar(true); }} />;
  if (cargando && !datos) return <Cargando />;
  if (error || !datos) return <Aviso tipo="error">{error}</Aviso>;

  const filtrados = datos.tests.filter((t) => (tema === null ? true : t.topic_id === tema));
  return (
    <div className="space-y-4">
      <div className="tarjeta space-y-3">
        <h2 className="font-bold">Nuevo test de práctica</h2>
        <p className="text-sm text-slate-500">Opción múltiple, verdadero/falso con justificación, respuesta corta, relacionar y ordenar. Con «Todo el examen» se mezclan los temas.</p>
        <SelectorTema temas={temas} valor={tema} alCambiar={setTema} />
        <BotonGenerar tipo="test" examId={examen.id} parametros={{ topic_id: tema, n: 10 }} texto="✨ Crear test de 10 preguntas" alTerminar={async (r) => {
          await recargar(true);
          const id = r?.quiz_id as string | undefined;
          if (id) {
            const { data } = await supabase.from("quizzes").select("*").eq("id", id).single();
            if (data) setJugando(data as Test);
          }
        }} />
      </div>
      {filtrados.length === 0 ? (
        <Vacio icono="✅" titulo="Aún no hay tests" texto="Hacer tests es una de las formas más eficaces de estudiar: recordar fija lo aprendido." />
      ) : (
        <ul className="space-y-2">
          {filtrados.map((t) => {
            const ints = datos.intentos.filter((i) => i.quiz_id === t.id);
            const mejor = ints.length ? Math.max(...ints.map((i) => Number(i.nota))) : null;
            return (
              <motion.li key={t.id} layout className="tarjeta flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{t.titulo}</p>
                  <p className="text-xs text-slate-500">{t.preguntas.length} preguntas · {new Date(t.created_at).toLocaleDateString("es-ES")}{mejor !== null ? ` · mejor nota ${mejor.toFixed(1).replace(".", ",")}` : ""}</p>
                </div>
                <button type="button" className="boton-primario" onClick={() => setJugando(t)}>{ints.length ? "Repetir" : "Hacer"}</button>
              </motion.li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function respuestaVacia(p: PreguntaTest): Respuesta {
  switch (p.tipo) {
    case "opcion_multiple":
      return { tipo: "opcion_multiple", indice: null };
    case "verdadero_falso":
      return { tipo: "verdadero_falso", valor: null, justificacion: "" };
    case "respuesta_corta":
      return { tipo: "respuesta_corta", texto: "" };
    case "relacionar":
      return { tipo: "relacionar", emparejamiento: {} };
    case "ordenar":
      return { tipo: "ordenar", orden: barajar(p.orden_correcto ?? [], p.id) };
  }
}

function completa(p: PreguntaTest, r: Respuesta): boolean {
  if (r.tipo === "opcion_multiple") return r.indice !== null;
  if (r.tipo === "verdadero_falso") return r.valor !== null && r.justificacion.trim().length >= 5;
  if (r.tipo === "respuesta_corta") return r.texto.trim().length > 0;
  if (r.tipo === "relacionar") return Object.keys(r.emparejamiento).length === (p.pares?.length ?? 0);
  return true;
}

function JugarTest({ test, alSalir }: { test: Test; alSalir: () => void }) {
  const { examen } = useExamen();
  const { perfil } = useAuth();
  const aviso = useToast();
  const [i, setI] = useState(0);
  const [respuestas, setRespuestas] = useState<Record<string, Respuesta>>({});
  const [comprobada, setComprobada] = useState(false);
  const [resultados, setResultados] = useState<ResultadoPregunta[]>([]);
  const [final, setFinal] = useState<number | null>(null);
  const [fuente, setFuente] = useState<Fuente | null>(null);
  const inicio = useRef(Date.now());
  const p = test.preguntas[i];
  const r = respuestas[p?.id] ?? (p ? respuestaVacia(p) : null);
  const derecha = useMemo(() => (p?.pares ? barajar(p.pares.map((x) => x.derecha), p.id) : []), [p]);

  const set = (nueva: Respuesta) => setRespuestas({ ...respuestas, [p.id]: nueva });

  function comprobar() {
    if (!r) return;
    const puntos = puntuarPregunta(p, r, derecha);
    setResultados([...resultados, { pregunta_id: p.id, topic_id: p.topic_id, correcta: puntos >= 0.999, puntos }]);
    setComprobada(true);
  }

  async function siguiente() {
    setComprobada(false);
    if (i + 1 < test.preguntas.length) {
      setI(i + 1);
      return;
    }
    const nota = notaSobre10(resultados);
    setFinal(nota);
    if (!perfil) return;
    const { error } = await supabase.from("quiz_attempts").insert({ user_id: perfil.id, exam_id: examen.id, quiz_id: test.id, respuestas, resultados, nota });
    if (error) aviso("No se ha podido guardar el resultado.", "error");
    const { count } = await supabase.from("quiz_attempts").select("id", { count: "exact", head: true }).eq("quiz_id", test.id);
    const tarea = test.topic_id ? `test:${test.topic_id}:${count ?? 1}` : `test:mixto:${hoyISO()}`;
    await supabase.from("study_sessions").insert({ user_id: perfil.id, exam_id: examen.id, fecha: hoyISO(), tipo: "test", tarea_id: tarea, minutos: Math.max(1, Math.round((Date.now() - inicio.current) / 60000)) });
  }

  if (final !== null) {
    const aciertos = resultados.filter((x) => x.correcta).length;
    return (
      <div className="space-y-4">
        <Celebracion activa={final >= 5} mensaje={final >= 9 ? "¡Brutal! 🏆" : final >= 7 ? "¡Muy bien! ⭐" : final >= 5 ? "¡Aprobado! 👏" : undefined} />
        <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="tarjeta text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-marca-600">Tu nota</p>
          <p className="text-6xl font-extrabold text-slate-900">{final.toFixed(1).replace(".", ",")}</p>
          <p className="text-slate-500">{aciertos} de {resultados.length} correctas</p>
          <p className="mt-3 text-sm text-slate-600">{final >= 7 ? "¡Lo llevas muy bien! Repite en unos días para que no se olvide." : "Cada fallo es una pista de qué repasar. Mira las explicaciones y vuelve a intentarlo mañana."}</p>
        </motion.div>
        <button type="button" className="boton-primario w-full" onClick={alSalir}>Volver a los tests</button>
      </div>
    );
  }

  const res = resultados.find((x) => x.pregunta_id === p.id);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button type="button" className="boton-fantasma px-2" onClick={alSalir}>✕</button>
        <BarraProgreso valor={(i / test.preguntas.length) * 100} />
        <span className="shrink-0 text-sm tabular-nums text-slate-500">{i + 1}/{test.preguntas.length}</span>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={p.id} initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -60, opacity: 0 }} className="tarjeta space-y-4">
          <span className="chip bg-marca-50 text-marca-700">{NOMBRE_TIPO[p.tipo]}</span>
          <Markdown texto={p.enunciado} className="text-base font-semibold text-slate-900" />
          {r && <EntradaPregunta p={p} r={r} derecha={derecha} set={set} bloqueada={comprobada} />}
          {comprobada && res && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`space-y-2 rounded-2xl p-3 ${res.correcta ? "bg-emerald-50 ring-1 ring-emerald-200" : res.puntos > 0 ? "bg-amber-50 ring-1 ring-amber-200" : "bg-rose-50 ring-1 ring-rose-200"}`}>
              <p className="font-bold">{res.correcta ? "¡Correcto! 🎉" : res.puntos > 0 ? `Casi: ${Math.round(res.puntos * 100)} % bien` : "No es correcto"}</p>
              <Solucion p={p} />
              <Markdown texto={p.explicacion} />
              <Citas fuentes={p.fuentes} ampliacion={p.ampliacion} alAbrir={setFuente} />
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
      {comprobada ? (
        <button type="button" className="boton-primario w-full py-3" onClick={siguiente}>{i + 1 < test.preguntas.length ? "Siguiente →" : "Ver mi nota"}</button>
      ) : (
        <button type="button" className="boton-primario w-full py-3" disabled={!r || !completa(p, r)} onClick={comprobar}>Comprobar</button>
      )}
      <VisorFragmento fuente={fuente} examId={examen.id} alCerrar={() => setFuente(null)} />
    </div>
  );
}

function Solucion({ p }: { p: PreguntaTest }) {
  if (p.tipo === "opcion_multiple") return <p className="text-sm">Respuesta correcta: <strong>{p.opciones?.[p.correcta ?? 0]}</strong></p>;
  if (p.tipo === "verdadero_falso") return <p className="text-sm">Es <strong>{p.verdadero ? "verdadero" : "falso"}</strong>. Compara tu justificación con esta:</p>;
  if (p.tipo === "respuesta_corta") return <p className="text-sm">Respuesta: <strong>{p.respuestas_aceptadas?.[0] ?? p.palabras_clave?.join(", ")}</strong></p>;
  if (p.tipo === "relacionar") return <ul className="text-sm">{p.pares?.map((x) => <li key={x.izquierda}><strong>{x.izquierda}</strong> → {x.derecha}</li>)}</ul>;
  return <ol className="list-decimal pl-5 text-sm">{p.orden_correcto?.map((x) => <li key={x}>{x}</li>)}</ol>;
}

function EntradaPregunta({ p, r, derecha, set, bloqueada }: { p: PreguntaTest; r: Respuesta; derecha: string[]; set: (r: Respuesta) => void; bloqueada: boolean }) {
  if (r.tipo === "opcion_multiple") {
    return (
      <div className="space-y-2">
        {p.opciones?.map((o, k) => {
          const elegida = r.indice === k;
          const correcta = bloqueada && k === p.correcta;
          return (
            <motion.button whileTap={{ scale: 0.98 }} key={k} type="button" disabled={bloqueada} onClick={() => set({ ...r, indice: k })} className={`flex w-full items-start gap-3 rounded-2xl p-3 text-left ring-2 transition ${correcta ? "bg-emerald-50 ring-emerald-400" : elegida ? (bloqueada ? "bg-rose-50 ring-rose-300" : "bg-marca-50 ring-marca-500") : "bg-white ring-slate-100"}`}>
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${elegida ? "bg-marca-600 text-white" : "bg-slate-100 text-slate-500"}`}>{String.fromCharCode(65 + k)}</span>
              <Markdown texto={o} />
            </motion.button>
          );
        })}
      </div>
    );
  }
  if (r.tipo === "verdadero_falso") {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[true, false].map((v) => (
            <button key={String(v)} type="button" disabled={bloqueada} onClick={() => set({ ...r, valor: v })} className={`rounded-2xl py-3 font-bold ring-2 ${r.valor === v ? "bg-marca-50 text-marca-800 ring-marca-500" : "bg-white ring-slate-100"}`}>
              {v ? "Verdadero" : "Falso"}
            </button>
          ))}
        </div>
        <textarea className="campo min-h-20" disabled={bloqueada} placeholder="¿Por qué? Justifícalo en una frase" value={r.justificacion} onChange={(e) => set({ ...r, justificacion: e.target.value })} aria-label="Justificación" />
      </div>
    );
  }
  if (r.tipo === "respuesta_corta") {
    return <input className="campo" disabled={bloqueada} value={r.texto} onChange={(e) => set({ ...r, texto: e.target.value })} placeholder="Escribe tu respuesta" aria-label="Respuesta" onKeyDown={(e) => e.key === "Enter" && e.preventDefault()} />;
  }
  if (r.tipo === "relacionar") {
    return (
      <div className="space-y-2">
        {p.pares?.map((par, k) => (
          <div key={par.izquierda} className="flex flex-col gap-1 rounded-2xl bg-slate-50 p-2 sm:flex-row sm:items-center">
            <span className="flex-1 text-sm font-semibold"><Markdown texto={par.izquierda} /></span>
            <select className="campo py-2 text-sm sm:w-1/2" disabled={bloqueada} value={r.emparejamiento[k] ?? ""} onChange={(e) => set({ ...r, emparejamiento: { ...r.emparejamiento, [k]: Number(e.target.value) } })} aria-label={`Pareja de ${par.izquierda}`}>
              <option value="" disabled>Elige…</option>
              {derecha.map((d, j) => <option key={d} value={j}>{d}</option>)}
            </select>
          </div>
        ))}
      </div>
    );
  }
  const mover = (k: number, d: -1 | 1) => {
    const o = [...r.orden];
    const j = k + d;
    if (j < 0 || j >= o.length) return;
    [o[k], o[j]] = [o[j], o[k]];
    set({ ...r, orden: o });
  };
  return (
    <ol className="space-y-2">
      {r.orden.map((x, k) => (
        <motion.li layout key={x} className="flex items-center gap-2 rounded-2xl bg-slate-50 p-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-marca-600 text-xs font-bold text-white">{k + 1}</span>
          <span className="flex-1 text-sm"><Markdown texto={x} /></span>
          <button type="button" disabled={bloqueada || k === 0} className="chip bg-white" onClick={() => mover(k, -1)} aria-label="Subir">▲</button>
          <button type="button" disabled={bloqueada || k === r.orden.length - 1} className="chip bg-white" onClick={() => mover(k, 1)} aria-label="Bajar">▼</button>
        </motion.li>
      ))}
    </ol>
  );
}
