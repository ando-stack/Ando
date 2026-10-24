// Subida de apuntes: varias fotos (cámara o galería), PDF o texto pegado. Mejora las fotos antes de enviarlas.
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { lanzarTrabajo, mensajeError } from "../lib/api";
import { mejorarFoto } from "../lib/imagen";
import { useAuth } from "../hooks/useAuth";
import type { Tema } from "../lib/tipos";
import { Aviso, BarraProgreso, Modal } from "./ui";

interface EnCola {
  id: string;
  nombre: string;
  estado: "mejorando" | "borrosa" | "subiendo" | "enviada" | "error";
  vista?: string;
  blob?: Blob;
  error?: string;
  tipo: "imagen" | "pdf";
}

const MAX_MB = 25;

export function SubidaFotos({ examId, temas, siguienteOrden, alSubir }: { examId: string; temas: Tema[]; siguienteOrden: () => { orden: number; fotos: number; textos: number }; alSubir: () => void }) {
  const { sesion } = useAuth();
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const pdf = useRef<HTMLInputElement>(null);
  const [cola, setCola] = useState<EnCola[]>([]);
  const [tema, setTema] = useState<string>("");
  const [modalTexto, setModalTexto] = useState(false);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const contadores = useRef<{ orden: number; fotos: number; textos: number } | null>(null);

  const actualizar = (id: string, cambios: Partial<EnCola>) => setCola((c) => c.map((x) => (x.id === id ? { ...x, ...cambios } : x)));

  function siguiente() {
    if (!contadores.current) contadores.current = siguienteOrden();
    const actual = { ...contadores.current };
    contadores.current.orden++;
    return actual;
  }

  async function subir(item: EnCola, blob: Blob, extension: string, mime: string) {
    if (!sesion) return;
    actualizar(item.id, { estado: "subiendo" });
    try {
      const c = siguiente();
      let nombre = item.nombre;
      if (item.tipo === "imagen") {
        contadores.current!.fotos++;
        nombre = `Foto ${c.fotos + 1}`;
      }
      const ruta = `${sesion.user.id}/${examId}/${crypto.randomUUID()}.${extension}`;
      const { error: e1 } = await supabase.storage.from("apuntes").upload(ruta, blob, { contentType: mime, upsert: false });
      if (e1) throw e1;
      const { data, error: e2 } = await supabase
        .from("uploads")
        .insert({ user_id: sesion.user.id, exam_id: examId, topic_id: tema || null, tipo: item.tipo, storage_path: ruta, nombre_original: nombre, orden: c.orden })
        .select("id")
        .single();
      if (e2) throw e2;
      await lanzarTrabajo("leer_apuntes", examId, { upload_id: data.id });
      actualizar(item.id, { estado: "enviada", nombre });
      alSubir();
      window.setTimeout(() => setCola((x) => x.filter((y) => y.id !== item.id)), 2500);
    } catch (e) {
      actualizar(item.id, { estado: "error", error: mensajeError(e) });
      alSubir();
    }
  }

  async function procesar(archivos: FileList | null, tipo: "imagen" | "pdf") {
    if (!archivos?.length) return;
    setError(null);
    contadores.current = null;
    const items: EnCola[] = [...archivos].map((f) => ({ id: crypto.randomUUID(), nombre: f.name, estado: "mejorando", tipo }));
    setCola((c) => [...c, ...items]);
    const lista = [...archivos];
    for (let i = 0; i < lista.length; i++) {
      const f = lista[i];
      const item = items[i];
      if (f.size > MAX_MB * 1024 * 1024) {
        actualizar(item.id, { estado: "error", error: `El archivo supera ${MAX_MB} MB.` });
        continue;
      }
      if (tipo === "pdf") {
        if (f.type !== "application/pdf") {
          actualizar(item.id, { estado: "error", error: "Solo se admiten archivos PDF." });
          continue;
        }
        await subir(item, f, "pdf", "application/pdf");
        continue;
      }
      if (!f.type.startsWith("image/")) {
        actualizar(item.id, { estado: "error", error: "Este archivo no es una imagen." });
        continue;
      }
      try {
        const r = await mejorarFoto(f);
        const vista = URL.createObjectURL(r.blob);
        if (r.posibleBorrosa) {
          actualizar(item.id, { estado: "borrosa", vista, blob: r.blob });
          continue;
        }
        actualizar(item.id, { vista });
        await subir({ ...item, vista }, r.blob, "jpg", "image/jpeg");
      } catch {
        // Formatos que el navegador no puede procesar (p. ej. HEIC en algunos navegadores): se sube tal cual
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase();
        const mime = ["image/jpeg", "image/png", "image/webp"].includes(f.type) ? f.type : "";
        if (!mime) {
          actualizar(item.id, { estado: "error", error: "No podemos abrir este formato de imagen. Prueba con JPG o PNG (en iPhone: Ajustes → Cámara → Formatos → Más compatible)." });
          continue;
        }
        await subir(item, f, ext, mime);
      }
    }
  }

  async function guardarTexto() {
    if (!sesion || texto.trim().length < 20) {
      setError("Pega al menos un par de frases.");
      return;
    }
    try {
      const c = siguienteOrden();
      const { data, error: e1 } = await supabase
        .from("uploads")
        .insert({ user_id: sesion.user.id, exam_id: examId, topic_id: tema || null, tipo: "texto", nombre_original: `Texto ${c.textos + 1}`, orden: c.orden, estado: "revisar" })
        .select("id")
        .single();
      if (e1) throw e1;
      const { error: e2 } = await supabase.from("extracted_texts").insert({ upload_id: data.id, user_id: sesion.user.id, exam_id: examId, contenido: texto.trim(), legible: true, calidad: "buena", revisado: false });
      if (e2) throw e2;
      setTexto("");
      setModalTexto(false);
      alSubir();
    } catch (e) {
      setError(mensajeError(e));
    }
  }

  return (
    <div className="tarjeta space-y-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Sube tus apuntes</h2>
          <p className="text-sm text-slate-500">Fotos de tus apuntes o del libro, PDF o texto. Puedes subir varias a la vez.</p>
        </div>
        {temas.length > 0 && (
          <select className="campo w-auto py-2 text-sm" value={tema} onChange={(e) => setTema(e.target.value)} aria-label="Tema de los apuntes que vas a subir">
            <option value="">Tema: lo decide la IA</option>
            {temas.map((t) => (
              <option key={t.id} value={t.id}>Tema: {t.titulo}</option>
            ))}
          </select>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <motion.button whileTap={{ scale: 0.95 }} type="button" className="boton-primario flex-col py-4" onClick={() => camara.current?.click()}>
          <span className="text-2xl" aria-hidden>📷</span> Hacer foto
        </motion.button>
        <motion.button whileTap={{ scale: 0.95 }} type="button" className="boton-secundario flex-col py-4" onClick={() => galeria.current?.click()}>
          <span className="text-2xl" aria-hidden>🖼️</span> Galería
        </motion.button>
        <motion.button whileTap={{ scale: 0.95 }} type="button" className="boton-secundario flex-col py-4" onClick={() => pdf.current?.click()}>
          <span className="text-2xl" aria-hidden>📄</span> PDF
        </motion.button>
        <motion.button whileTap={{ scale: 0.95 }} type="button" className="boton-secundario flex-col py-4" onClick={() => setModalTexto(true)}>
          <span className="text-2xl" aria-hidden>⌨️</span> Pegar texto
        </motion.button>
      </div>
      <input ref={camara} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { void procesar(e.target.files, "imagen"); e.target.value = ""; }} />
      <input ref={galeria} type="file" accept="image/*" multiple hidden onChange={(e) => { void procesar(e.target.files, "imagen"); e.target.value = ""; }} />
      <input ref={pdf} type="file" accept="application/pdf" multiple hidden onChange={(e) => { void procesar(e.target.files, "pdf"); e.target.value = ""; }} />
      <p className="text-xs text-slate-500">💡 Consejo: buena luz, sin sombras, la hoja entera y el móvil paralelo al papel. Recortamos, enderezamos y mejoramos el contraste automáticamente.</p>

      {error && <Aviso tipo="error">{error}</Aviso>}

      <AnimatePresence>
        {cola.map((c) => (
          <motion.div key={c.id} layout initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-2">
            {c.vista ? <img src={c.vista} alt="" className="h-14 w-14 rounded-xl object-cover" /> : <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-white text-2xl">{c.tipo === "pdf" ? "📄" : "🖼️"}</div>}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{c.nombre}</p>
              {c.estado === "mejorando" && <p className="text-xs text-marca-600">Mejorando la foto…</p>}
              {c.estado === "subiendo" && <BarraProgreso valor={60} alto="h-1.5" />}
              {c.estado === "enviada" && <p className="text-xs text-emerald-600">✓ Subida. La IA la está leyendo…</p>}
              {c.estado === "error" && <p className="text-xs text-rose-600">{c.error}</p>}
              {c.estado === "borrosa" && (
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-amber-700">Parece borrosa. Si no se lee bien, la IA no podrá leerla.</p>
                  <div className="flex gap-2">
                    <button type="button" className="chip bg-marca-600 text-white" onClick={() => { setCola((x) => x.filter((y) => y.id !== c.id)); camara.current?.click(); }}>Hacer otra</button>
                    <button type="button" className="chip bg-white text-slate-700 ring-1 ring-slate-200" onClick={() => c.blob && subir(c, c.blob, "jpg", "image/jpeg")}>Subir igualmente</button>
                  </div>
                </div>
              )}
            </div>
            {(c.estado === "error" || c.estado === "borrosa") && (
              <button type="button" aria-label="Quitar" className="boton-fantasma px-2" onClick={() => setCola((x) => x.filter((y) => y.id !== c.id))}>✕</button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>

      <Modal abierto={modalTexto} alCerrar={() => setModalTexto(false)} titulo="Pegar texto de tus apuntes">
        <textarea className="campo min-h-60 font-mono text-sm" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Pega aquí tus apuntes. Puedes usar Markdown y fórmulas con $…$." />
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="boton-fantasma" onClick={() => setModalTexto(false)}>Cancelar</button>
          <button type="button" className="boton-primario" onClick={guardarTexto}>Añadir</button>
        </div>
      </Modal>
    </div>
  );
}
