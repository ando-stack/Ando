import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { sb, useDatos } from "../hooks/useDatos";
import { useExamen } from "../hooks/useExamen";
import type { Resumen } from "../lib/tipos";
import { ListaCitada } from "../components/Contenido";
import { BotonGenerar } from "../components/Generar";
import { Aviso, Cargando, SelectorTema, Vacio } from "../components/ui";

const NIVELES = [
  { k: "ideas_clave", t: "Ideas clave", d: "Lo imprescindible" },
  { k: "resumen", t: "Resumen", d: "Lo esencial con sus relaciones" },
  { k: "detallado", t: "Detallado", d: "Todo lo que puede caer" },
] as const;

export default function Resumenes() {
  const { examen, temas } = useExamen();
  const [tema, setTema] = useState<string | null>(temas[0]?.id ?? null);
  const [nivel, setNivel] = useState<(typeof NIVELES)[number]["k"]>("ideas_clave");
  const [autoevaluar, setAutoevaluar] = useState(false);
  const { datos, cargando, error, recargar } = useDatos(async () => {
    const q = supabase.from("summaries").select("*").eq("exam_id", examen.id);
    const r = await (tema ? q.eq("topic_id", tema) : q.is("topic_id", null)).maybeSingle().then(sb);
    return r as Resumen | null;
  }, [examen.id, tema]);

  const parametros = { topic_id: tema };
  return (
    <div className="space-y-4">
      <SelectorTema temas={temas} valor={tema} alCambiar={setTema} />
      {cargando ? (
        <Cargando />
      ) : error ? (
        <Aviso tipo="error">{error}</Aviso>
      ) : !datos ? (
        <Vacio icono="📝" titulo="Aún no hay resumen" texto="Generamos un resumen en tres niveles a partir de tus apuntes revisados. Cada idea indica de qué foto o página sale.">
          <BotonGenerar tipo="resumen" examId={examen.id} parametros={parametros} texto="✨ Generar resumen" alTerminar={() => void recargar(true)} />
        </Vacio>
      ) : (
        <>
          {datos.desactualizado && (
            <Aviso tipo="info" titulo="Has añadido apuntes nuevos">
              <div className="mt-2">
                <BotonGenerar tipo="resumen" examId={examen.id} parametros={parametros} texto="Actualizar el resumen" secundario alTerminar={() => void recargar(true)} />
              </div>
            </Aviso>
          )}
          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-white p-1 ring-1 ring-slate-200" role="tablist">
            {NIVELES.map((n) => (
              <button key={n.k} type="button" role="tab" aria-selected={nivel === n.k} onClick={() => setNivel(n.k)} className={`relative rounded-xl px-2 py-2 text-sm font-bold ${nivel === n.k ? "text-white" : "text-slate-600"}`}>
                {nivel === n.k && <motion.span layoutId="nivel-resumen" className="absolute inset-0 rounded-xl bg-gradient-to-r from-marca-600 to-fuchsia-500" />}
                <span className="relative">{n.t}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-slate-500">{NIVELES.find((n) => n.k === nivel)?.d}</p>
            {nivel === "ideas_clave" && (
              <label className="flex items-center gap-2 text-sm font-semibold text-marca-700">
                <input type="checkbox" className="h-4 w-4 accent-marca-600" checked={autoevaluar} onChange={(e) => setAutoevaluar(e.target.checked)} /> Ocultar para autoevaluarme
              </label>
            )}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={nivel + String(autoevaluar)} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="tarjeta">
              {datos[nivel].length === 0 ? (
                <p className="text-sm text-slate-500">No hay contenido en este nivel.</p>
              ) : (
                <ListaCitada items={datos[nivel]} examId={examen.id} ocultable={autoevaluar && nivel === "ideas_clave"} />
              )}
            </motion.div>
          </AnimatePresence>
          <div className="tarjeta flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-marca-50 to-fuchsia-50">
            <p className="text-sm font-semibold text-slate-700">Leer no basta: ¡ponte a prueba! Recordar es lo que más ayuda a fijar.</p>
            <div className="flex gap-2">
              <Link to={`/examen/${examen.id}/flashcards`} className="boton-secundario">🃏 Flashcards</Link>
              <Link to={`/examen/${examen.id}/tests`} className="boton-primario">✅ Hacer un test</Link>
            </div>
          </div>
          <div className="flex justify-end">
            <BotonGenerar tipo="resumen" examId={examen.id} parametros={parametros} texto="↻ Regenerar" secundario alTerminar={() => void recargar(true)} />
          </div>
        </>
      )}
    </div>
  );
}
