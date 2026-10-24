import { AnimatePresence, motion } from "motion/react";
import { useContext, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { api, mensajeError } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { ExamenCtx } from "../hooks/useExamen";
import { ASIGNATURAS, COLORES_EXAMEN, CURSOS } from "../lib/asignaturas";
import { NOMBRES_DIAS, formatearMinutos, hoyISO } from "../lib/fechas";
import type { Distribucion, Nivel, TipoExamen, TipoPregunta } from "../lib/tipos";
import { Aviso, BarraProgreso } from "../components/ui";

const TIPOS: { v: TipoExamen; t: string; d: string; i: string }[] = [
  { v: "test", t: "Tipo test", d: "Preguntas con opciones", i: "🔘" },
  { v: "cortas", t: "Preguntas cortas", d: "Respuestas de pocas líneas", i: "✏️" },
  { v: "desarrollo", t: "Desarrollo", d: "Temas para explicar", i: "📜" },
  { v: "problemas", t: "Problemas", d: "Ejercicios y cálculos", i: "🧮" },
  { v: "mixto", t: "Mixto", d: "Un poco de todo", i: "🎲" },
];
const NIVELES: { v: Nivel; t: string; d: string; i: string }[] = [
  { v: "bajo", t: "Me cuesta", d: "Empiezo casi de cero", i: "🌱" },
  { v: "medio", t: "Normal", d: "Lo voy siguiendo", i: "🌿" },
  { v: "alto", t: "Lo llevo bien", d: "Quiero afinar", i: "🌳" },
];
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];
const PASOS = ["Asignatura", "Fecha", "Nota", "Formato", "Tiempo", "Nivel"];

function emojiNota(n: number) {
  return n >= 9.5 ? "🏆" : n >= 8.5 ? "🚀" : n >= 7 ? "⭐" : n >= 6 ? "👍" : "✅";
}

export default function NuevoExamen() {
  const ctx = useContext(ExamenCtx); // en modo edición
  const editar = ctx?.examen;
  const { sesion } = useAuth();
  const navegar = useNavigate();
  const [paso, setPaso] = useState(0);
  const [direccion, setDireccion] = useState(1);
  const [etapa, setEtapa] = useState<keyof typeof ASIGNATURAS>("ESO");
  const [asignatura, setAsignatura] = useState(editar?.asignatura ?? "");
  const [curso, setCurso] = useState(editar?.curso ?? "");
  const [temas, setTemas] = useState<string[]>([]);
  const [nuevoTema, setNuevoTema] = useState("");
  const fechaIni = editar ? new Date(editar.fecha) : null;
  const [fecha, setFecha] = useState(fechaIni ? hoyISO(fechaIni) : "");
  const [hora, setHora] = useState(fechaIni ? fechaIni.toTimeString().slice(0, 5) : "09:00");
  const [nota, setNota] = useState(editar ? Number(editar.nota_objetivo) : 7);
  const [tipo, setTipo] = useState<TipoExamen>(editar?.tipo ?? "mixto");
  const [dist, setDist] = useState<Required<Distribucion>>({ test: 40, cortas: 30, desarrollo: 30, problemas: 0, ...(editar?.distribucion ?? {}) });
  const [duracion, setDuracion] = useState(editar?.duracion_min ?? 60);
  const [disp, setDisp] = useState<Record<string, number>>(editar?.disponibilidad ?? { "0": 30, "1": 60, "2": 60, "3": 60, "4": 60, "5": 45, "6": 30 });
  const [nivel, setNivel] = useState<Nivel>(editar?.nivel_actual ?? "medio");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sumaDist = dist.test + dist.cortas + dist.desarrollo + dist.problemas;
  const totalSemana = Object.values(disp).reduce((a, b) => a + b, 0);
  const fechaCompleta = fecha ? new Date(`${fecha}T${hora || "09:00"}`) : null;

  const valido = useMemo(() => {
    switch (paso) {
      case 0:
        return asignatura.trim().length > 0;
      case 1:
        return Boolean(fechaCompleta && fechaCompleta.getTime() > Date.now());
      case 3:
        return tipo !== "mixto" || sumaDist > 0;
      case 4:
        return totalSemana > 0;
      default:
        return true;
    }
  }, [paso, asignatura, fechaCompleta, tipo, sumaDist, totalSemana]);

  const ir = (n: number) => {
    setDireccion(n > paso ? 1 : -1);
    setPaso(n);
  };

  async function guardar() {
    if (!sesion || !fechaCompleta) return;
    setGuardando(true);
    setError(null);
    try {
      const fila = {
        user_id: sesion.user.id,
        asignatura: asignatura.trim(),
        curso: curso || null,
        fecha: fechaCompleta.toISOString(),
        nota_objetivo: nota,
        tipo,
        distribucion: tipo === "mixto" ? dist : { [tipo]: 100 },
        duracion_min: duracion,
        disponibilidad: disp,
        nivel_actual: nivel,
      };
      let examId = editar?.id;
      if (editar) {
        const { error } = await supabase.from("exams").update(fila).eq("id", editar.id);
        if (error) throw error;
      } else {
        const { count } = await supabase.from("exams").select("id", { count: "exact", head: true });
        const { data, error } = await supabase.from("exams").insert({ ...fila, color: COLORES_EXAMEN[(count ?? 0) % COLORES_EXAMEN.length] }).select("id").single();
        if (error) throw error;
        examId = data.id;
      }
      if (temas.length && examId) {
        const inicio = ctx?.temas.length ?? 0;
        const { error } = await supabase.from("exam_topics").insert(temas.map((t, i) => ({ exam_id: examId, user_id: sesion.user.id, titulo: t, orden: inicio + i })));
        if (error) throw error;
      }
      await api("plan", { body: { exam_id: examId, hoy: hoyISO() } }).catch(() => null);
      if (ctx) await ctx.recargar();
      navegar(editar ? `/examen/${examId}/plan` : `/examen/${examId}/apuntes`);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  }

  const añadirTema = () => {
    const t = nuevoTema.trim();
    if (t && !temas.includes(t)) setTemas([...temas, t.slice(0, 200)]);
    setNuevoTema("");
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">{editar ? "Editar examen" : "Nuevo examen"}</h1>
        <p className="text-sm text-slate-500">
          Paso {paso + 1} de {PASOS.length}: {PASOS[paso]}
        </p>
        <div className="mt-2">
          <BarraProgreso valor={((paso + 1) / PASOS.length) * 100} />
        </div>
      </div>

      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" custom={direccion}>
          <motion.div
            key={paso}
            custom={direccion}
            initial={{ x: direccion * 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: direccion * -60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="tarjeta space-y-4"
          >
            {paso === 0 && (
              <>
                <div>
                  <label className="etiqueta" htmlFor="asig">¿De qué es el examen?</label>
                  <input id="asig" className="campo" value={asignatura} onChange={(e) => setAsignatura(e.target.value)} placeholder="Escribe la asignatura o elige una" maxLength={120} />
                </div>
                <div className="flex gap-1.5">
                  {(Object.keys(ASIGNATURAS) as (keyof typeof ASIGNATURAS)[]).map((e) => (
                    <button key={e} type="button" onClick={() => setEtapa(e)} className={`chip px-3 py-1.5 ${etapa === e ? "bg-marca-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                      {e}
                    </button>
                  ))}
                </div>
                <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
                  {ASIGNATURAS[etapa].map((a) => (
                    <motion.button whileTap={{ scale: 0.95 }} key={a} type="button" onClick={() => setAsignatura(a)} className={`chip px-3 py-1.5 ring-1 ${asignatura === a ? "bg-marca-100 text-marca-800 ring-marca-300" : "bg-white text-slate-600 ring-slate-200"}`}>
                      {a}
                    </motion.button>
                  ))}
                </div>
                <div>
                  <label className="etiqueta" htmlFor="curso">Curso</label>
                  <select id="curso" className="campo" value={curso} onChange={(e) => setCurso(e.target.value)}>
                    <option value="">Elige tu curso</option>
                    {CURSOS.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="etiqueta" htmlFor="tema">Temas que entran <span className="font-normal text-slate-400">(opcional; si no, los sacamos de tus apuntes)</span></label>
                  {ctx && ctx.temas.length > 0 && <p className="mb-2 text-xs text-slate-500">Ya tienes: {ctx.temas.map((t) => t.titulo).join(", ")}</p>}
                  <div className="flex gap-2">
                    <input id="tema" className="campo" value={nuevoTema} onChange={(e) => setNuevoTema(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); añadirTema(); } }} placeholder="Ej.: Tema 3. La Revolución Francesa" />
                    <button type="button" className="boton-secundario" onClick={añadirTema} disabled={!nuevoTema.trim()}>Añadir</button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <AnimatePresence>
                      {temas.map((t) => (
                        <motion.span key={t} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="chip bg-marca-50 text-marca-700">
                          {t}
                          <button type="button" aria-label={`Quitar ${t}`} onClick={() => setTemas(temas.filter((x) => x !== t))}>✕</button>
                        </motion.span>
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              </>
            )}

            {paso === 1 && (
              <>
                <h2 className="text-lg font-bold">¿Cuándo es el examen?</h2>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="etiqueta" htmlFor="fecha">Fecha</label>
                    <input id="fecha" type="date" className="campo" value={fecha} min={hoyISO()} onChange={(e) => setFecha(e.target.value)} />
                  </div>
                  <div>
                    <label className="etiqueta" htmlFor="hora">Hora</label>
                    <input id="hora" type="time" className="campo" value={hora} onChange={(e) => setHora(e.target.value)} />
                  </div>
                </div>
                {fechaCompleta && fechaCompleta.getTime() <= Date.now() && <Aviso tipo="aviso">La fecha tiene que ser en el futuro.</Aviso>}
                {fechaCompleta && fechaCompleta.getTime() > Date.now() && (
                  <p className="text-sm text-slate-600">Quedan <strong>{Math.max(0, Math.ceil((fechaCompleta.getTime() - Date.now()) / 86_400_000))} días</strong>. ¡Tiempo para prepararlo bien!</p>
                )}
              </>
            )}

            {paso === 2 && (
              <>
                <h2 className="text-lg font-bold">¿Qué nota quieres sacar?</h2>
                <div className="text-center">
                  <motion.div key={nota} initial={{ scale: 0.7 }} animate={{ scale: 1 }} className="text-6xl" aria-hidden>{emojiNota(nota)}</motion.div>
                  <p className="mt-1 text-5xl font-extrabold text-marca-700 tabular-nums">{nota.toFixed(1).replace(".", ",")}</p>
                </div>
                <input type="range" min={5} max={10} step={0.5} value={nota} onChange={(e) => setNota(Number(e.target.value))} className="w-full accent-marca-600" aria-label="Nota objetivo" />
                <div className="flex justify-between text-xs text-slate-400"><span>5</span><span>7,5</span><span>10</span></div>
                <p className="text-sm text-slate-500">Adaptaremos el plan a tu objetivo. Siempre podrás cambiarlo.</p>
              </>
            )}

            {paso === 3 && (
              <>
                <h2 className="text-lg font-bold">¿Cómo es el examen?</h2>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {TIPOS.map((t) => (
                    <motion.button whileTap={{ scale: 0.96 }} key={t.v} type="button" onClick={() => setTipo(t.v)} className={`rounded-2xl p-3 text-left ring-2 transition ${tipo === t.v ? "bg-marca-50 ring-marca-500" : "bg-white ring-slate-100"}`}>
                      <div className="text-2xl" aria-hidden>{t.i}</div>
                      <p className="font-bold text-slate-900">{t.t}</p>
                      <p className="text-xs text-slate-500">{t.d}</p>
                    </motion.button>
                  ))}
                </div>
                {tipo === "mixto" && (
                  <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-700">Porcentaje aproximado de cada parte (si lo sabes)</p>
                    {(["test", "cortas", "desarrollo", "problemas"] as TipoPregunta[]).map((k) => (
                      <div key={k} className="flex items-center gap-3">
                        <span className="w-24 text-sm capitalize text-slate-600">{k === "cortas" ? "Cortas" : k === "test" ? "Test" : k === "desarrollo" ? "Desarrollo" : "Problemas"}</span>
                        <input type="range" min={0} max={100} step={5} value={dist[k]} onChange={(e) => setDist({ ...dist, [k]: Number(e.target.value) })} className="flex-1 accent-marca-600" aria-label={`Porcentaje de ${k}`} />
                        <span className="w-12 text-right text-sm font-bold tabular-nums">{sumaDist ? Math.round((dist[k] / sumaDist) * 100) : 0}%</span>
                      </div>
                    ))}
                  </div>
                )}
                <div>
                  <label className="etiqueta" htmlFor="dur">Duración del examen: {formatearMinutos(duracion)}</label>
                  <input id="dur" type="range" min={15} max={240} step={5} value={duracion} onChange={(e) => setDuracion(Number(e.target.value))} className="w-full accent-marca-600" />
                </div>
              </>
            )}

            {paso === 4 && (
              <>
                <h2 className="text-lg font-bold">¿Cuánto tiempo puedes estudiar cada día?</h2>
                <div className="flex flex-wrap gap-1.5">
                  {[30, 45, 60, 90].map((m) => (
                    <button key={m} type="button" className="chip bg-marca-50 px-3 py-1.5 text-marca-700" onClick={() => setDisp(Object.fromEntries(ORDEN_DIAS.map((d) => [String(d), m])))}>
                      {m} min todos los días
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  {ORDEN_DIAS.map((d) => (
                    <div key={d} className="flex items-center gap-3">
                      <span className="w-20 text-sm font-semibold capitalize text-slate-700">{NOMBRES_DIAS[d]}</span>
                      <input type="range" min={0} max={240} step={15} value={disp[String(d)] ?? 0} onChange={(e) => setDisp({ ...disp, [String(d)]: Number(e.target.value) })} className="flex-1 accent-marca-600" aria-label={`Minutos el ${NOMBRES_DIAS[d]}`} />
                      <span className="w-16 text-right text-sm tabular-nums text-slate-600">{disp[String(d)] ? formatearMinutos(disp[String(d)]) : "libre"}</span>
                    </div>
                  ))}
                </div>
                <p className="text-sm text-slate-500">En total: <strong>{formatearMinutos(totalSemana)}</strong> a la semana. Los días libres también cuentan: descansar ayuda a recordar.</p>
              </>
            )}

            {paso === 5 && (
              <>
                <h2 className="text-lg font-bold">¿Cómo crees que llevas la asignatura?</h2>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {NIVELES.map((n) => (
                    <motion.button whileTap={{ scale: 0.96 }} key={n.v} type="button" onClick={() => setNivel(n.v)} className={`rounded-2xl p-4 text-left ring-2 ${nivel === n.v ? "bg-marca-50 ring-marca-500" : "bg-white ring-slate-100"}`}>
                      <div className="text-3xl" aria-hidden>{n.i}</div>
                      <p className="font-bold">{n.t}</p>
                      <p className="text-xs text-slate-500">{n.d}</p>
                    </motion.button>
                  ))}
                </div>
                <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">
                  <p className="font-bold text-slate-800">Resumen</p>
                  <p>{asignatura}{curso ? ` · ${curso}` : ""}</p>
                  <p>{fechaCompleta?.toLocaleString("es-ES", { dateStyle: "full", timeStyle: "short" })}</p>
                  <p>Objetivo: {nota.toFixed(1).replace(".", ",")} · {TIPOS.find((t) => t.v === tipo)?.t} · {formatearMinutos(duracion)}</p>
                </div>
              </>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {error && <Aviso tipo="error">{error}</Aviso>}

      <div className="flex justify-between gap-2">
        <button type="button" className="boton-fantasma" onClick={() => (paso === 0 ? navegar(-1) : ir(paso - 1))}>
          ← {paso === 0 ? "Cancelar" : "Atrás"}
        </button>
        {paso < PASOS.length - 1 ? (
          <button type="button" className="boton-primario px-6" disabled={!valido} onClick={() => ir(paso + 1)}>
            Siguiente →
          </button>
        ) : (
          <button type="button" className="boton-primario px-6" disabled={guardando} onClick={guardar}>
            {guardando ? "Guardando…" : editar ? "Guardar cambios" : "¡Crear examen! 🎉"}
          </button>
        )}
      </div>
    </div>
  );
}
