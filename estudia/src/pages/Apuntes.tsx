import { DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { lanzarTrabajo, mensajeError } from "../lib/api";
import { sb, useDatos } from "../hooks/useDatos";
import { puedeUsarIA, useAuth } from "../hooks/useAuth";
import { useExamen } from "../hooks/useExamen";
import type { Subida, Tema } from "../lib/tipos";
import { SubidaFotos } from "../components/SubidaFotos";
import { VisorFotoTexto, dudasPendientes } from "../components/VisorFotoTexto";
import { Aviso, Cargando, Vacio, useToast } from "../components/ui";

const ESTADO: Record<string, { t: string; c: string }> = {
  subido: { t: "En cola", c: "bg-slate-100 text-slate-600" },
  leyendo: { t: "Leyendo…", c: "bg-marca-100 text-marca-700 animate-pulse" },
  revisar: { t: "Revisar texto", c: "bg-amber-100 text-amber-800" },
  confirmado: { t: "✓ Listo", c: "bg-emerald-100 text-emerald-800" },
  error: { t: "No se pudo leer", c: "bg-rose-100 text-rose-700" },
};

interface FilaSubida extends Subida {
  dudas: number;
  miniatura?: string | null;
}

export default function Apuntes() {
  const { examen, temas, recargar: recargarExamen } = useExamen();
  const { perfil } = useAuth();
  const aviso = useToast();
  const [params, setParams] = useSearchParams();
  const [abierta, setAbierta] = useState<Subida | null>(null);
  const [nuevoTema, setNuevoTema] = useState("");
  const { datos, cargando, error, recargar, setDatos } = useDatos(async () => {
    const subidas = ((await supabase.from("uploads").select("*").eq("exam_id", examen.id).order("orden").then(sb)) ?? []) as Subida[];
    const textos = ((await supabase.from("extracted_texts").select("upload_id, contenido").eq("exam_id", examen.id).then(sb)) ?? []) as { upload_id: string; contenido: string }[];
    const rutas = subidas.filter((s) => s.tipo === "imagen" && s.storage_path).map((s) => s.storage_path!);
    const { data: firmadas } = rutas.length ? await supabase.storage.from("apuntes").createSignedUrls(rutas, 3600) : { data: [] };
    const urlDe = new Map((firmadas ?? []).map((f) => [f.path, f.signedUrl]));
    return subidas.map((s) => ({
      ...s,
      dudas: dudasPendientes(textos.find((t) => t.upload_id === s.id)?.contenido ?? "").length,
      miniatura: s.storage_path ? urlDe.get(s.storage_path) ?? null : null,
    })) as FilaSubida[];
  }, [examen.id]);

  const lista = datos ?? [];
  const leyendo = lista.some((s) => s.estado === "leyendo" || s.estado === "subido");

  // Mientras la IA lee, se actualiza sola
  useEffect(() => {
    if (!leyendo) return;
    const t = window.setInterval(() => void recargar(true), 3000);
    return () => window.clearInterval(t);
  }, [leyendo, recargar]);

  // ?ver=<id> abre directamente el visor (desde una cita)
  useEffect(() => {
    const ver = params.get("ver");
    if (ver && lista.length) {
      const s = lista.find((x) => x.id === ver);
      if (s) setAbierta(s);
    }
  }, [params, lista]);

  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }));

  async function alSoltar(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const de = lista.findIndex((s) => s.id === e.active.id);
    const a = lista.findIndex((s) => s.id === e.over!.id);
    const nueva = arrayMove(lista, de, a).map((s, i) => ({ ...s, orden: i }));
    setDatos(nueva);
    const r = await Promise.all(nueva.map((s) => supabase.from("uploads").update({ orden: s.orden }).eq("id", s.id)));
    if (r.some((x) => x.error)) aviso("No se pudo guardar el nuevo orden.", "error");
  }

  async function cambiarTema(s: FilaSubida, topicId: string) {
    const valor = topicId || null;
    const { error } = await supabase.from("uploads").update({ topic_id: valor }).eq("id", s.id);
    if (error) return aviso(mensajeError(error), "error");
    if (s.estado === "confirmado") {
      await supabase.from("chunks").update({ topic_id: valor }).eq("upload_id", s.id);
      await supabase.from("summaries").update({ desactualizado: true }).eq("exam_id", examen.id);
      await supabase.from("mindmaps").update({ desactualizado: true }).eq("exam_id", examen.id);
    }
    void recargar(true);
  }

  async function borrar(s: FilaSubida) {
    if (!window.confirm("¿Borrar estos apuntes? También se quitarán sus fragmentos de los materiales nuevos.")) return;
    if (s.storage_path) await supabase.storage.from("apuntes").remove([s.storage_path]);
    const { error } = await supabase.from("uploads").delete().eq("id", s.id);
    if (error) return aviso(mensajeError(error), "error");
    await supabase.from("summaries").update({ desactualizado: true }).eq("exam_id", examen.id);
    void recargar(true);
  }

  async function confirmarTodas() {
    const listas = lista.filter((s) => s.estado === "revisar" && s.dudas === 0);
    if (!listas.length) return;
    const ids = listas.map((s) => s.id);
    await supabase.from("extracted_texts").update({ revisado: true }).in("upload_id", ids);
    const { error } = await supabase.from("uploads").update({ estado: "confirmado" }).in("id", ids);
    if (error) return aviso(mensajeError(error), "error");
    try {
      await lanzarTrabajo("organizar_temas", examen.id, { upload_ids: ids });
      aviso(`${ids.length} apuntes confirmados. Los estamos organizando por temas.`, "exito");
    } catch (e) {
      aviso(mensajeError(e), "error");
    }
    void recargar(true);
    window.setTimeout(() => void recargarExamen(), 8000);
  }

  async function crearTema() {
    const t = nuevoTema.trim();
    if (!t || !perfil) return;
    const { error } = await supabase.from("exam_topics").insert({ exam_id: examen.id, user_id: perfil.id, titulo: t, orden: temas.length });
    if (error) return aviso(mensajeError(error), "error");
    setNuevoTema("");
    await recargarExamen();
  }

  const siguienteOrden = () => ({
    orden: lista.length ? Math.max(...lista.map((s) => s.orden)) + 1 : 0,
    fotos: lista.filter((s) => s.tipo === "imagen").length,
    textos: lista.filter((s) => s.tipo === "texto").length,
  });

  if (!puedeUsarIA(perfil)) {
    return (
      <Aviso tipo="info" titulo={perfil?.consentimiento_estado === "pendiente_tutor" ? "Falta el permiso de tu padre, madre o tutor" : "Activa el permiso para usar la IA"}>
        Para subir apuntes y que la IA los lea, {perfil?.consentimiento_estado === "pendiente_tutor" ? "tu padre, madre o tutor tiene que dar su permiso" : "acepta el tratamiento con IA"} desde tu <a href="/perfil" className="font-bold underline">perfil</a>.
      </Aviso>
    );
  }

  const paraConfirmar = lista.filter((s) => s.estado === "revisar" && s.dudas === 0).length;

  return (
    <div className="space-y-4">
      <SubidaFotos examId={examen.id} temas={temas} siguienteOrden={siguienteOrden} alSubir={() => void recargar(true)} />

      {cargando && !datos ? (
        <Cargando />
      ) : error ? (
        <Aviso tipo="error">{error}</Aviso>
      ) : lista.length === 0 ? (
        <Vacio icono="📸" titulo="Aún no hay apuntes" texto="Haz fotos de tus apuntes o súbelos en PDF. La IA los leerá y podrás revisar el texto junto a la foto." />
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">Tus apuntes ({lista.length})</h2>
            {paraConfirmar > 0 && (
              <button type="button" className="boton-primario" onClick={confirmarTodas}>
                ✓ Confirmar {paraConfirmar} sin dudas
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500">Arrastra para ordenarlos y elige el tema de cada uno. Toca para revisar el texto junto a la foto.</p>
          <DndContext sensors={sensores} collisionDetection={closestCenter} onDragEnd={alSoltar}>
            <SortableContext items={lista.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2">
                <AnimatePresence>
                  {lista.map((s) => (
                    <FilaOrdenable key={s.id} s={s} temas={temas} alAbrir={() => setAbierta(s)} alCambiarTema={(t) => cambiarTema(s, t)} alBorrar={() => borrar(s)} />
                  ))}
                </AnimatePresence>
              </ul>
            </SortableContext>
          </DndContext>
        </section>
      )}

      <section className="tarjeta space-y-2">
        <h2 className="font-bold">Temas del examen</h2>
        {temas.length === 0 ? <p className="text-sm text-slate-500">Si no los indicas, la IA los sacará de tus apuntes al confirmarlos.</p> : (
          <div className="flex flex-wrap gap-1.5">
            {temas.map((t) => <span key={t.id} className="chip bg-marca-50 text-marca-700">{t.titulo}</span>)}
          </div>
        )}
        <div className="flex gap-2">
          <input className="campo py-2" value={nuevoTema} onChange={(e) => setNuevoTema(e.target.value)} placeholder="Añadir un tema" maxLength={200} onKeyDown={(e) => e.key === "Enter" && crearTema()} />
          <button type="button" className="boton-secundario" onClick={crearTema} disabled={!nuevoTema.trim()}>Añadir</button>
        </div>
      </section>

      <AnimatePresence>
        {abierta && (
          <VisorFotoTexto
            subida={abierta}
            alCerrar={() => {
              setAbierta(null);
              if (params.get("ver")) setParams({}, { replace: true });
            }}
            alCambiar={() => {
              void recargar(true);
              window.setTimeout(() => void recargarExamen(), 8000);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function FilaOrdenable({ s, temas, alAbrir, alCambiarTema, alBorrar }: { s: FilaSubida; temas: Tema[]; alAbrir: () => void; alCambiarTema: (t: string) => void; alBorrar: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  const est = ESTADO[s.estado];
  return (
    <motion.li
      ref={setNodeRef}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -40 }}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }}
      className={`flex items-center gap-3 rounded-2xl bg-white p-2.5 shadow-suave ring-1 ring-marca-100 ${isDragging ? "shadow-flota" : ""}`}
    >
      <button type="button" {...attributes} {...listeners} className="cursor-grab touch-none px-1 text-slate-400 active:cursor-grabbing" aria-label="Arrastrar para ordenar">⠿</button>
      <button type="button" onClick={alAbrir} className="shrink-0" aria-label={`Revisar ${s.nombre_original ?? "apuntes"}`}>
        {s.miniatura ? <img src={s.miniatura} alt="" className="h-14 w-14 rounded-xl object-cover" /> : <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-marca-50 text-2xl">{s.tipo === "pdf" ? "📄" : "⌨️"}</div>}
      </button>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={alAbrir} className="block max-w-full truncate text-left font-semibold text-slate-900">{s.nombre_original ?? "Apuntes"}</button>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className={`chip ${est.c}`}>{est.t}</span>
          {s.estado === "revisar" && s.dudas > 0 && <span className="chip bg-amber-50 text-amber-700">{s.dudas} duda{s.dudas > 1 ? "s" : ""}</span>}
          <select className="rounded-full bg-slate-50 px-2 py-1 text-xs ring-1 ring-slate-200" value={s.topic_id ?? ""} onChange={(e) => alCambiarTema(e.target.value)} aria-label="Tema">
            <option value="">Sin tema</option>
            {temas.map((t) => <option key={t.id} value={t.id}>{t.titulo}</option>)}
          </select>
        </div>
        {s.estado === "error" && s.error && <p className="mt-1 text-xs text-rose-600">{s.error}</p>}
      </div>
      <button type="button" onClick={alBorrar} className="boton-fantasma px-2 text-slate-400" aria-label="Borrar">🗑️</button>
    </motion.li>
  );
}
