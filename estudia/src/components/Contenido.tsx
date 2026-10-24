// Renderizado de texto de estudio: Markdown + fórmulas con KaTeX, citas y visor de fragmentos.
import { memo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Fuente, ItemCitado } from "../lib/tipos";
import { Aviso, Cargando, Citas, Modal } from "./ui";

interface NodoMd {
  type: string;
  value?: string;
  children?: NodoMd[];
  data?: Record<string, unknown>;
}

/** Plugin de remark: convierte las lecturas dudosas [[?…?]] en <mark> sin permitir HTML. */
function remarkDudas() {
  const re = /\[\[\?(.*?)\?\]\]/g;
  const recorrer = (n: NodoMd) => {
    if (!n.children) return;
    const nuevos: NodoMd[] = [];
    for (const h of n.children) {
      if (h.type === "text" && h.value && h.value.includes("[[?")) {
        let ultimo = 0;
        for (const m of h.value.matchAll(re)) {
          if (m.index! > ultimo) nuevos.push({ type: "text", value: h.value.slice(ultimo, m.index) });
          nuevos.push({ type: "emphasis", data: { hName: "mark", hProperties: { title: "Lectura dudosa: revísala" } }, children: [{ type: "text", value: m[1] || "ilegible" }] });
          ultimo = m.index! + m[0].length;
        }
        if (ultimo < h.value.length) nuevos.push({ type: "text", value: h.value.slice(ultimo) });
      } else {
        recorrer(h);
        nuevos.push(h);
      }
    }
    n.children = nuevos;
  };
  return (arbol: NodoMd) => recorrer(arbol);
}

export const Markdown = memo(function Markdown({ texto, className = "" }: { texto: string; className?: string }) {
  return (
    <div className={`prosa ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkDudas]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore" }]]}
        skipHtml
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-marca-700 underline">
              {children}
            </a>
          ),
        }}
      >
        {texto}
      </ReactMarkdown>
    </div>
  );
});

/** Lista de elementos generados con su cita. */
export function ListaCitada({ items, examId, marcador = "punto", ocultable = false }: { items: ItemCitado[]; examId: string; marcador?: "punto" | "ninguno"; ocultable?: boolean }) {
  const [fuente, setFuente] = useState<Fuente | null>(null);
  return (
    <>
      <ul className="space-y-3">
        {items.map((it, i) => (
          <ItemConCita key={i} item={it} marcador={marcador} ocultable={ocultable} alAbrir={setFuente} />
        ))}
      </ul>
      <VisorFragmento fuente={fuente} examId={examId} alCerrar={() => setFuente(null)} />
    </>
  );
}

function ItemConCita({ item, marcador, ocultable, alAbrir }: { item: ItemCitado; marcador: string; ocultable: boolean; alAbrir: (f: Fuente) => void }) {
  const [visible, setVisible] = useState(!ocultable);
  return (
    <li className={`rounded-2xl p-3 ${item.ampliacion ? "bg-amber-50/70 ring-1 ring-amber-200" : "bg-slate-50/70"}`}>
      <div className="flex gap-2">
        {marcador === "punto" && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-marca-400" aria-hidden />}
        <div className="min-w-0 flex-1">
          {visible ? (
            <Markdown texto={item.texto} />
          ) : (
            <button type="button" onClick={() => setVisible(true)} className="w-full rounded-xl border-2 border-dashed border-marca-200 px-3 py-2 text-left text-sm text-marca-600">
              🤔 Intenta recordarla… y toca para comprobar
            </button>
          )}
          <div className="mt-1.5">
            <Citas fuentes={item.fuentes} ampliacion={item.ampliacion} alAbrir={alAbrir} />
          </div>
        </div>
      </div>
    </li>
  );
}

/** Muestra el fragmento original de los apuntes de una cita. */
export function VisorFragmento({ fuente, examId, alCerrar }: { fuente: Fuente | null; examId: string; alCerrar: () => void }) {
  return (
    <Modal abierto={Boolean(fuente)} alCerrar={alCerrar} titulo={fuente ? `De tus apuntes · ${fuente.origen}` : ""}>
      {fuente && <ContenidoFragmento fuente={fuente} examId={examId} />}
    </Modal>
  );
}

function ContenidoFragmento({ fuente, examId }: { fuente: Fuente; examId: string }) {
  const [estado, setEstado] = useState<{ contenido: string; upload_id: string; seccion: string | null } | null | "error">(null);
  if (estado === null) {
    void supabase
      .from("chunks")
      .select("contenido, upload_id, seccion")
      .eq("id", fuente.chunk_id)
      .maybeSingle()
      .then(({ data }) => setEstado(data ?? "error"));
    return <Cargando texto="Buscando en tus apuntes…" />;
  }
  if (estado === "error") return <Aviso tipo="aviso">Este fragmento ya no existe (puede que hayas editado o borrado esos apuntes).</Aviso>;
  return (
    <div className="space-y-3">
      {estado.seccion && <p className="text-xs font-semibold uppercase tracking-wide text-marca-600">{estado.seccion}</p>}
      <div className="rounded-2xl bg-slate-50 p-3">
        <Markdown texto={estado.contenido} />
      </div>
      <Link to={`/examen/${examId}/apuntes?ver=${estado.upload_id}`} className="boton-secundario w-full">
        Ver la foto original
      </Link>
    </div>
  );
}

export function Seccion({ titulo, accion, children }: { titulo: string; accion?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">{titulo}</h2>
        {accion}
      </div>
      {children}
    </section>
  );
}
