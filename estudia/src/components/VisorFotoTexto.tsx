// Visor de la foto original junto al texto extraído, para revisar y corregir lo que la IA ha leído.
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { lanzarTrabajo, mensajeError } from "../lib/api";
import type { Duda, Subida, TextoExtraido } from "../lib/tipos";
import { Markdown } from "./Contenido";
import { Aviso, Cargando, useToast } from "./ui";

const RE_DUDA = /\[\[\?(.*?)\?\]\]/g;

export function dudasPendientes(texto: string): string[] {
  return [...texto.matchAll(RE_DUDA)].map((m) => m[1]);
}

export function VisorFotoTexto({ subida, alCerrar, alCambiar }: { subida: Subida; alCerrar: () => void; alCambiar: () => void }) {
  const aviso = useToast();
  const [url, setUrl] = useState<string | null>(null);
  const [txt, setTxt] = useState<TextoExtraido | null>(null);
  const [contenido, setContenido] = useState("");
  const [vista, setVista] = useState<"editar" | "previa">("previa");
  const [zoom, setZoom] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelMovil, setPanelMovil] = useState<"foto" | "texto">("texto");

  useEffect(() => {
    let vivo = true;
    if (subida.storage_path) {
      void supabase.storage
        .from("apuntes")
        .createSignedUrl(subida.storage_path, 3600)
        .then(({ data }) => vivo && setUrl(data?.signedUrl ?? null));
    }
    void supabase
      .from("extracted_texts")
      .select("*")
      .eq("upload_id", subida.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!vivo) return;
        setTxt(data as TextoExtraido | null);
        setContenido((data as TextoExtraido | null)?.contenido ?? "");
      });
    return () => {
      vivo = false;
    };
  }, [subida.id, subida.storage_path]);

  const pendientes = useMemo(() => dudasPendientes(contenido), [contenido]);
  const motivos = useMemo(() => new Map((txt?.dudas ?? []).map((d: Duda) => [d.texto, d.motivo])), [txt]);

  function resolver(textoDuda: string, reemplazo: string) {
    const marca = `[[?${textoDuda}?]]`;
    setContenido((c) => c.replace(marca, reemplazo));
  }

  async function guardar(confirmar: boolean) {
    if (!txt) return;
    if (confirmar && pendientes.length) {
      setError("Revisa primero las partes marcadas en amarillo (confírmalas o corrígelas).");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      const { error: e1 } = await supabase
        .from("extracted_texts")
        .update({
          contenido,
          revisado: confirmar,
          editado_por_usuario: contenido !== txt.contenido || txt.editado_por_usuario,
          dudas: (txt.dudas ?? []).map((d) => ({ ...d, resuelta: !contenido.includes(`[[?${d.texto}?]]`) })),
        })
        .eq("id", txt.id);
      if (e1) throw e1;
      if (confirmar) {
        const { error: e2 } = await supabase.from("uploads").update({ estado: "confirmado" }).eq("id", subida.id);
        if (e2) throw e2;
        await lanzarTrabajo("organizar_temas", subida.exam_id, { upload_ids: [subida.id] });
        aviso("¡Texto confirmado! Lo estamos organizando por temas y actualizando tus materiales.", "exito");
        alCambiar();
        alCerrar();
      } else {
        aviso("Cambios guardados.", "exito");
        setTxt({ ...txt, contenido });
        alCambiar();
      }
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setGuardando(false);
    }
  }

  async function releer() {
    try {
      await lanzarTrabajo("leer_apuntes", subida.exam_id, { upload_id: subida.id });
      aviso("Volviendo a leer la foto…", "info");
      alCambiar();
      alCerrar();
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  async function escribirAMano() {
    const { data, error } = await supabase
      .from("extracted_texts")
      .upsert({ upload_id: subida.id, user_id: subida.user_id, exam_id: subida.exam_id, contenido: "", legible: true, revisado: false, editado_por_usuario: true }, { onConflict: "upload_id" })
      .select("*")
      .single();
    if (error) return setError(mensajeError(error));
    await supabase.from("uploads").update({ estado: "revisar", error: null }).eq("id", subida.id);
    setTxt(data as TextoExtraido);
    setContenido("");
    setVista("editar");
    alCambiar();
  }

  const foto = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between pb-2">
        <p className="text-sm font-bold text-slate-700">Original</p>
        {subida.tipo === "imagen" && (
          <button type="button" className="chip bg-slate-100 text-slate-600" onClick={() => setZoom(!zoom)}>
            {zoom ? "🔍 Ajustar" : "🔍 Ampliar"}
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-2xl bg-slate-100">
        {subida.tipo === "texto" ? (
          <p className="p-4 text-sm text-slate-500">Texto pegado (no hay foto).</p>
        ) : !url ? (
          <Cargando texto="Cargando el original…" />
        ) : subida.tipo === "pdf" ? (
          <iframe src={url} title="PDF original" className="h-full min-h-[60vh] w-full" />
        ) : (
          <img src={url} alt="Foto original de los apuntes" className={zoom ? "max-w-none" : "w-full"} style={zoom ? { width: "220%" } : undefined} />
        )}
      </div>
    </div>
  );

  const texto = !txt ? (
    subida.estado === "leyendo" ? (
      <Cargando texto="La IA está leyendo tus apuntes…" />
    ) : (
      <div className="space-y-3">
        <Aviso tipo="aviso" titulo="Aún no hay texto">{subida.error ?? "Esta foto no se ha podido leer."}</Aviso>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="boton-secundario" onClick={releer}>↻ Intentarlo de nuevo</button>
          <button type="button" className="boton-secundario" onClick={escribirAMano}>✏️ Escribir el texto a mano</button>
        </div>
      </div>
    )
  ) : (
    <div className="flex h-full flex-col gap-3">
      {txt.aviso && (
        <Aviso tipo={txt.legible ? "aviso" : "error"} titulo={txt.legible ? "La foto se lee con dificultad" : "No se ha podido leer"}>
          {txt.aviso}
        </Aviso>
      )}
      {pendientes.length > 0 && (
        <div className="space-y-2 rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-200">
          <p className="text-sm font-bold text-amber-900">
            {pendientes.length === 1 ? "Hay 1 parte" : `Hay ${pendientes.length} partes`} que la IA no ha leído con seguridad. Compruébalas con la foto:
          </p>
          <AnimatePresence>
            {pendientes.slice(0, 6).map((d, i) => (
              <DudaFila key={`${d}-${i}`} texto={d} motivo={motivos.get(d)} alResolver={(r) => resolver(d, r)} />
            ))}
          </AnimatePresence>
        </div>
      )}
      <div className="flex gap-1 rounded-2xl bg-slate-100 p-1">
        {(["previa", "editar"] as const).map((v) => (
          <button key={v} type="button" onClick={() => setVista(v)} className={`flex-1 rounded-xl py-1.5 text-sm font-semibold ${vista === v ? "bg-white text-marca-700 shadow" : "text-slate-500"}`}>
            {v === "previa" ? "Vista previa" : "✏️ Editar texto"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {vista === "editar" ? (
          <textarea className="campo h-full min-h-[50vh] font-mono text-sm leading-relaxed" value={contenido} onChange={(e) => setContenido(e.target.value)} aria-label="Texto extraído" spellCheck />
        ) : (
          <div className="rounded-2xl bg-white p-3 ring-1 ring-slate-100">
            <Markdown texto={contenido.replace(/<!--\s*pagina:(\d+)\s*-->/g, "\n\n**— Página $1 —**\n\n")} />
          </div>
        )}
      </div>
      <p className="text-xs text-slate-500">Las fórmulas se escriben en LaTeX: $x^2$ en línea o $$\frac{"{a}"}{"{b}"}$$ en bloque.</p>
    </div>
  );

  return (
    <motion.div className="fixed inset-0 z-50 flex flex-col bg-fondo" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} role="dialog" aria-label="Revisar apuntes">
      <div className="flex items-center justify-between gap-2 border-b border-marca-100 bg-white px-4 py-3">
        <button type="button" className="boton-fantasma px-2" onClick={alCerrar}>← Volver</button>
        <p className="truncate font-bold">{subida.nombre_original ?? "Apuntes"}</p>
        <button type="button" className="chip bg-slate-100 text-slate-600" onClick={releer} disabled={subida.tipo === "texto"} title="Leer de nuevo con IA">↻ Releer</button>
      </div>
      <div className="flex gap-1 bg-white px-4 pb-2 sm:hidden">
        {(["foto", "texto"] as const).map((p) => (
          <button key={p} type="button" onClick={() => setPanelMovil(p)} className={`flex-1 rounded-xl py-1.5 text-sm font-semibold ${panelMovil === p ? "bg-marca-100 text-marca-700" : "text-slate-500"}`}>
            {p === "foto" ? "📷 Foto" : "📝 Texto"}
          </button>
        ))}
      </div>
      <div className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 gap-4 overflow-hidden p-4 sm:grid-cols-2">
        <div className={`min-h-0 ${panelMovil === "foto" ? "block" : "hidden"} sm:block`}>{foto}</div>
        <div className={`min-h-0 overflow-auto ${panelMovil === "texto" ? "block" : "hidden"} sm:block`}>{texto}</div>
      </div>
      {txt && (
        <div className="border-t border-marca-100 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {error && <div className="mb-2"><Aviso tipo="error">{error}</Aviso></div>}
          <div className="mx-auto flex max-w-6xl flex-wrap justify-end gap-2">
            <button type="button" className="boton-secundario" disabled={guardando} onClick={() => guardar(false)}>Guardar</button>
            <button type="button" className="boton-primario" disabled={guardando || pendientes.length > 0} onClick={() => guardar(true)} title={pendientes.length ? "Revisa antes las partes dudosas" : undefined}>
              {guardando ? "Guardando…" : "✓ El texto está bien"}
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function DudaFila({ texto, motivo, alResolver }: { texto: string; motivo?: string; alResolver: (r: string) => void }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(texto === "ilegible" ? "" : texto);
  return (
    <motion.div layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 30 }} className="rounded-xl bg-white p-2 text-sm ring-1 ring-amber-100">
      <p>
        <mark className="rounded bg-amber-200 px-1">{texto || "ilegible"}</mark> <span className="text-xs text-amber-800">{motivo ?? ""}</span>
      </p>
      {editando ? (
        <div className="mt-1.5 flex gap-1.5">
          <input className="campo py-1.5 text-sm" value={valor} onChange={(e) => setValor(e.target.value)} autoFocus aria-label="Texto correcto" placeholder="Escribe lo que pone" />
          <button type="button" className="boton-primario px-3 py-1.5" onClick={() => alResolver(valor)}>OK</button>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {texto && texto !== "ilegible" && <button type="button" className="chip bg-emerald-100 text-emerald-800" onClick={() => alResolver(texto)}>✓ Es correcto</button>}
          <button type="button" className="chip bg-marca-100 text-marca-800" onClick={() => setEditando(true)}>✏️ Corregir</button>
          <button type="button" className="chip bg-slate-100 text-slate-600" onClick={() => alResolver("")}>Quitar</button>
        </div>
      )}
    </motion.div>
  );
}
