import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { mensajeError } from "../lib/api";
import { sb, useDatos } from "../hooks/useDatos";
import { useAuth } from "../hooks/useAuth";
import { useExamen } from "../hooks/useExamen";
import { colaDelDia, dominadas, formatearIntervalo, previsualizar, repasar, type Calificacion } from "../lib/fsrs";
import { hoyISO } from "../lib/fechas";
import type { Flashcard, Fuente, TipoFlashcard } from "../lib/tipos";
import { TarjetaFlashcard } from "../components/TarjetaFlashcard";
import { VisorFragmento, Markdown } from "../components/Contenido";
import { BotonGenerar } from "../components/Generar";
import { Celebracion } from "../components/Celebracion";
import { Aviso, BarraProgreso, Cargando, Citas, Modal, SelectorTema, Vacio, useToast } from "../components/ui";

const BOTONES: { g: Calificacion; t: string; c: string }[] = [
  { g: 1, t: "Otra vez", c: "bg-rose-100 text-rose-700 ring-rose-200" },
  { g: 2, t: "Difícil", c: "bg-amber-100 text-amber-800 ring-amber-200" },
  { g: 3, t: "Bien", c: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
  { g: 4, t: "Fácil", c: "bg-sky-100 text-sky-800 ring-sky-200" },
];

export default function Flashcards() {
  const { examen, temas } = useExamen();
  const { perfil } = useAuth();
  const aviso = useToast();
  const [vista, setVista] = useState<"repasar" | "lista">("repasar");
  const [temaGenerar, setTemaGenerar] = useState<string | null>(temas[0]?.id ?? null);
  const [cola, setCola] = useState<Flashcard[] | null>(null);
  const [girada, setGirada] = useState(false);
  const [hechas, setHechas] = useState(0);
  const [fin, setFin] = useState(false);
  const [fuente, setFuente] = useState<Fuente | null>(null);
  const [editando, setEditando] = useState<Partial<Flashcard> | null>(null);
  const inicio = useRef<number>(0);
  const mostradaEn = useRef<number>(0);
  const retencion = perfil?.preferencias?.retencion ?? 0.9;

  const { datos, cargando, error, recargar, setDatos } = useDatos(async () => (((await supabase.from("flashcards").select("*").eq("exam_id", examen.id).order("created_at").then(sb)) ?? []) as Flashcard[]), [examen.id]);
  const tarjetas = datos ?? [];
  const ahora = new Date();
  const colaHoy = useMemo(() => colaDelDia(tarjetas, ahora, { fechaExamen: examen.fecha, retencion }), [tarjetas, examen.fecha, retencion]); // eslint-disable-line react-hooks/exhaustive-deps
  const nuevas = tarjetas.filter((t) => t.estado === "nueva" && !t.suspendida).length;
  const nDominadas = dominadas(tarjetas);

  function empezar() {
    setCola(colaHoy);
    setHechas(0);
    setFin(false);
    setGirada(false);
    inicio.current = Date.now();
    mostradaEn.current = Date.now();
  }

  async function calificar(g: Calificacion) {
    if (!cola?.length || !perfil) return;
    const actual = cola[0];
    const r = repasar(actual, g, new Date(), { fechaExamen: examen.fecha, retencion });
    const actualizada: Flashcard = { ...actual, ...r.tarjeta };
    // Si toca volver a verla en esta sesión (< 20 min), se pone al final
    const resto = cola.slice(1);
    const nuevaCola = r.intervaloDias * 1440 < 20 ? [...resto, actualizada] : resto;
    setCola(nuevaCola);
    setGirada(false);
    setHechas((h) => h + 1);
    setDatos(tarjetas.map((t) => (t.id === actual.id ? actualizada : t)));
    const duracion = Date.now() - mostradaEn.current;
    mostradaEn.current = Date.now();
    const [u, rv] = await Promise.all([
      supabase.from("flashcards").update(r.tarjeta).eq("id", actual.id),
      supabase.from("reviews").insert({
        user_id: perfil.id,
        exam_id: examen.id,
        flashcard_id: actual.id,
        calificacion: g,
        recuperabilidad: r.recuperabilidad,
        estabilidad: r.tarjeta.estabilidad,
        dificultad: r.tarjeta.dificultad,
        intervalo_dias: r.intervaloDias,
        duracion_ms: Math.min(duracion, 600000),
      }),
    ]);
    if (u.error || rv.error) aviso("No se ha podido guardar el repaso. Revisa tu conexión.", "error");
    if (nuevaCola.length === 0) {
      setFin(true);
      const minutos = Math.max(1, Math.round((Date.now() - inicio.current) / 60000));
      await supabase.from("study_sessions").insert({ user_id: perfil.id, exam_id: examen.id, fecha: hoyISO(), tipo: "flashcards", tarea_id: `flash:${hoyISO()}`, minutos });
      window.setTimeout(() => setFin(false), 3500);
    }
  }

  async function guardarTarjeta() {
    if (!editando || !perfil) return;
    const anverso = (editando.anverso ?? "").trim();
    const reverso = (editando.reverso ?? "").trim();
    if (!anverso || !reverso) return aviso("Escribe la pregunta y la respuesta.", "aviso");
    const r = editando.id
      ? await supabase.from("flashcards").update({ anverso, reverso, tipo: editando.tipo, editada: true }).eq("id", editando.id)
      : await supabase.from("flashcards").insert({ user_id: perfil.id, exam_id: examen.id, topic_id: editando.topic_id ?? null, tipo: editando.tipo ?? "pregunta", anverso, reverso, editada: true });
    if (r.error) return aviso(mensajeError(r.error), "error");
    setEditando(null);
    void recargar(true);
  }

  async function borrar(t: Flashcard) {
    if (!window.confirm("¿Borrar esta tarjeta?")) return;
    const { error } = await supabase.from("flashcards").delete().eq("id", t.id);
    if (error) return aviso(mensajeError(error), "error");
    setDatos(tarjetas.filter((x) => x.id !== t.id));
  }

  async function suspender(t: Flashcard) {
    const { error } = await supabase.from("flashcards").update({ suspendida: !t.suspendida }).eq("id", t.id);
    if (error) return aviso(mensajeError(error), "error");
    setDatos(tarjetas.map((x) => (x.id === t.id ? { ...x, suspendida: !t.suspendida } : x)));
  }

  if (cargando && !datos) return <Cargando />;
  if (error) return <Aviso tipo="error">{error}</Aviso>;

  // ── Sesión de repaso ──
  if (cola && cola.length > 0) {
    const actual = cola[0];
    const prev = previsualizar(actual, new Date(), { fechaExamen: examen.fecha, retencion });
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button type="button" className="boton-fantasma px-2" onClick={() => setCola(null)}>✕ Salir</button>
          <BarraProgreso valor={(hechas / (hechas + cola.length)) * 100} />
          <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-500">{cola.length} quedan</span>
        </div>
        <AnimatePresence mode="wait">
          <motion.div key={actual.id + hechas} initial={{ x: 80, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: -80, opacity: 0 }} transition={{ type: "spring", stiffness: 300, damping: 30 }}>
            <TarjetaFlashcard tarjeta={actual} girada={girada} alGirar={() => setGirada(!girada)} alVerFuente={setFuente} />
          </motion.div>
        </AnimatePresence>
        <div className="mx-auto grid max-w-lg grid-cols-4 gap-2">
          {girada ? (
            BOTONES.map((b) => (
              <motion.button key={b.g} type="button" whileTap={{ scale: 0.92 }} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: b.g * 0.03 }} onClick={() => calificar(b.g)} className={`flex flex-col items-center rounded-2xl py-2.5 text-sm font-bold ring-1 ${b.c}`}>
                {b.t}
                <span className="text-[11px] font-medium opacity-75">{formatearIntervalo(prev[b.g])}</span>
              </motion.button>
            ))
          ) : (
            <button type="button" className="boton-primario col-span-4 py-3 text-base" onClick={() => setGirada(true)}>Ver respuesta</button>
          )}
        </div>
        <p className="text-center text-xs text-slate-400">Sé sincero: así el algoritmo te enseña lo que más necesitas.</p>
        <VisorFragmento fuente={fuente} examId={examen.id} alCerrar={() => setFuente(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Celebracion activa={fin} mensaje={`¡Sesión completada! ${hechas} repasos 🎉`} />
      <div className="grid grid-cols-3 gap-2">
        <div className="tarjeta text-center"><p className="text-2xl font-extrabold text-marca-700">{colaHoy.length}</p><p className="text-xs text-slate-500">para hoy</p></div>
        <div className="tarjeta text-center"><p className="text-2xl font-extrabold text-fuchsia-600">{nuevas}</p><p className="text-xs text-slate-500">nuevas</p></div>
        <div className="tarjeta text-center"><p className="text-2xl font-extrabold text-emerald-600">{nDominadas}/{tarjetas.length}</p><p className="text-xs text-slate-500">dominadas</p></div>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-white p-1 ring-1 ring-slate-200">
        {(["repasar", "lista"] as const).map((v) => (
          <button key={v} type="button" onClick={() => setVista(v)} className={`rounded-xl py-2 text-sm font-bold ${vista === v ? "bg-marca-600 text-white" : "text-slate-600"}`}>
            {v === "repasar" ? "Repasar" : `Mis tarjetas (${tarjetas.length})`}
          </button>
        ))}
      </div>

      {vista === "repasar" ? (
        tarjetas.length === 0 ? (
          <Vacio icono="🃏" titulo="Aún no tienes flashcards" texto="Las creamos a partir de tus apuntes revisados: preguntas, huecos, definiciones, fórmulas y fechas. Después las repasarás con repetición espaciada.">
            <div className="w-full space-y-3">
              <SelectorTema temas={temas} valor={temaGenerar} alCambiar={setTemaGenerar} />
              <BotonGenerar tipo="flashcards" examId={examen.id} parametros={{ topic_id: temaGenerar }} texto="✨ Crear flashcards" alTerminar={(r) => { void recargar(true); aviso(`${(r?.creadas as number) ?? 0} flashcards creadas.`, "exito"); }} />
            </div>
          </Vacio>
        ) : (
          <div className="tarjeta space-y-3 text-center">
            {colaHoy.length ? (
              <>
                <p className="text-lg font-bold">Tienes {colaHoy.length} tarjeta{colaHoy.length === 1 ? "" : "s"} para repasar</p>
                <p className="text-sm text-slate-500">Primero las que más se te están olvidando{new Date(examen.fecha).getTime() - Date.now() < 3 * 86400000 ? " y las que podrías olvidar antes del examen" : ""}.</p>
                <button type="button" className="boton-primario px-8 py-3 text-base" onClick={empezar}>Empezar repaso</button>
              </>
            ) : (
              <>
                <p className="text-4xl">🌟</p>
                <p className="text-lg font-bold">¡Todo al día!</p>
                <p className="text-sm text-slate-500">Vuelve más tarde: el algoritmo te avisará cuando toque repasar para no olvidar.</p>
              </>
            )}
          </div>
        )
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" className="boton-secundario" onClick={() => setEditando({ tipo: "pregunta", anverso: "", reverso: "", topic_id: temas[0]?.id ?? null })}>➕ Añadir a mano</button>
          </div>
          <div className="tarjeta space-y-2">
            <p className="text-sm font-semibold">Crear más con IA</p>
            <SelectorTema temas={temas} valor={temaGenerar} alCambiar={setTemaGenerar} />
            <BotonGenerar tipo="flashcards" examId={examen.id} parametros={{ topic_id: temaGenerar }} texto="✨ Crear más flashcards" secundario alTerminar={(r) => { void recargar(true); aviso(`${(r?.creadas as number) ?? 0} flashcards nuevas.`, "exito"); }} />
          </div>
          <ul className="space-y-2">
            {tarjetas.map((t) => (
              <li key={t.id} className={`tarjeta space-y-2 ${t.suspendida ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <Markdown texto={t.anverso} className="font-semibold" />
                    <div className="mt-1 rounded-xl bg-slate-50 px-3 py-1"><Markdown texto={t.reverso} /></div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button type="button" className="chip bg-slate-100" onClick={() => setEditando(t)} aria-label="Editar">✏️</button>
                    <button type="button" className="chip bg-slate-100" onClick={() => suspender(t)} aria-label={t.suspendida ? "Reactivar" : "Pausar"} title={t.suspendida ? "Reactivar" : "No mostrar en los repasos"}>{t.suspendida ? "▶️" : "⏸️"}</button>
                    <button type="button" className="chip bg-slate-100" onClick={() => borrar(t)} aria-label="Borrar">🗑️</button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <Citas fuentes={t.fuentes} ampliacion={t.ampliacion} alAbrir={setFuente} />
                  {t.editada && <span className="chip bg-slate-100 text-slate-600">Editada por ti</span>}
                  <span>{t.estado === "nueva" ? "Nueva" : `Próximo repaso: ${new Date(t.vence).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal abierto={Boolean(editando)} alCerrar={() => setEditando(null)} titulo={editando?.id ? "Editar tarjeta" : "Nueva tarjeta"}>
        {editando && (
          <div className="space-y-3">
            <select className="campo" value={editando.tipo ?? "pregunta"} onChange={(e) => setEditando({ ...editando, tipo: e.target.value as TipoFlashcard })} aria-label="Tipo">
              <option value="pregunta">Pregunta</option>
              <option value="huecos">Huecos</option>
              <option value="definicion">Definición</option>
              <option value="formula">Fórmula</option>
              <option value="fecha">Fecha</option>
            </select>
            <div>
              <label className="etiqueta" htmlFor="anv">Pregunta</label>
              <textarea id="anv" className="campo min-h-20" value={editando.anverso ?? ""} onChange={(e) => setEditando({ ...editando, anverso: e.target.value })} />
            </div>
            <div>
              <label className="etiqueta" htmlFor="rev">Respuesta</label>
              <textarea id="rev" className="campo min-h-20" value={editando.reverso ?? ""} onChange={(e) => setEditando({ ...editando, reverso: e.target.value })} />
            </div>
            {!editando.id && temas.length > 0 && (
              <select className="campo" value={editando.topic_id ?? ""} onChange={(e) => setEditando({ ...editando, topic_id: e.target.value || null })} aria-label="Tema">
                <option value="">Sin tema</option>
                {temas.map((t) => <option key={t.id} value={t.id}>{t.titulo}</option>)}
              </select>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" className="boton-fantasma" onClick={() => setEditando(null)}>Cancelar</button>
              <button type="button" className="boton-primario" onClick={guardarTarjeta}>Guardar</button>
            </div>
          </div>
        )}
      </Modal>
      <VisorFragmento fuente={fuente} examId={examen.id} alCerrar={() => setFuente(null)} />
    </div>
  );
}
