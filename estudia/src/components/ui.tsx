// Componentes de interfaz reutilizables.
import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Fuente, Tema, TrabajoIA } from "../lib/tipos";

export function Cargando({ texto = "Cargando…" }: { texto?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-marca-600" role="status" aria-live="polite">
      <motion.div
        className="h-10 w-10 rounded-full border-4 border-marca-200 border-t-marca-600"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}
      />
      <p className="text-sm font-medium text-slate-500">{texto}</p>
    </div>
  );
}

export function Vacio({ icono = "📚", titulo, texto, children }: { icono?: string; titulo: string; texto?: string; children?: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="tarjeta flex flex-col items-center gap-2 py-10 text-center">
      <div className="text-4xl" aria-hidden>
        {icono}
      </div>
      <h3 className="text-lg font-bold text-slate-900">{titulo}</h3>
      {texto && <p className="max-w-md text-sm text-slate-500">{texto}</p>}
      {children && <div className="mt-3 flex flex-wrap justify-center gap-2">{children}</div>}
    </motion.div>
  );
}

type TipoAviso = "info" | "exito" | "aviso" | "error";
const ESTILO_AVISO: Record<TipoAviso, string> = {
  info: "bg-marca-50 text-marca-900 ring-marca-200",
  exito: "bg-emerald-50 text-emerald-900 ring-emerald-200",
  aviso: "bg-amber-50 text-amber-900 ring-amber-200",
  error: "bg-rose-50 text-rose-900 ring-rose-200",
};
const ICONO_AVISO: Record<TipoAviso, string> = { info: "💡", exito: "✅", aviso: "⚠️", error: "😕" };

export function Aviso({ tipo = "info", titulo, children }: { tipo?: TipoAviso; titulo?: string; children?: ReactNode }) {
  return (
    <div className={`flex gap-3 rounded-2xl px-4 py-3 text-sm ring-1 ${ESTILO_AVISO[tipo]}`} role={tipo === "error" ? "alert" : "status"}>
      <span aria-hidden className="text-base leading-5">
        {ICONO_AVISO[tipo]}
      </span>
      <div className="min-w-0 flex-1">
        {titulo && <p className="font-bold">{titulo}</p>}
        {children && <div className="leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}

export function BarraProgreso({ valor, color = "from-marca-500 to-fuchsia-500", alto = "h-2.5" }: { valor: number; color?: string; alto?: string }) {
  return (
    <div className={`w-full overflow-hidden rounded-full bg-slate-100 ${alto}`} role="progressbar" aria-valuenow={Math.round(valor)} aria-valuemin={0} aria-valuemax={100}>
      <motion.div className={`h-full rounded-full bg-gradient-to-r ${color}`} initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, valor))}%` }} transition={{ type: "spring", stiffness: 80, damping: 20 }} />
    </div>
  );
}

/** Estado de un trabajo de IA en curso, con progreso. */
export function EstadoTrabajo({ trabajo, error }: { trabajo: TrabajoIA | null; error: string | null }) {
  if (error) {
    return (
      <Aviso tipo={/límite diario/i.test(error) ? "aviso" : "error"} titulo={/límite diario/i.test(error) ? "Límite diario alcanzado" : "No se ha podido completar"}>
        {error}
      </Aviso>
    );
  }
  if (!trabajo || trabajo.estado === "completado") return null;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="tarjeta space-y-2" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-semibold text-marca-700">
        <motion.span animate={{ scale: [1, 1.25, 1] }} transition={{ repeat: Infinity, duration: 1.4 }} aria-hidden>
          ✨
        </motion.span>
        {trabajo.mensaje ?? "Trabajando…"}
      </div>
      <BarraProgreso valor={Math.max(5, trabajo.progreso)} />
      <p className="text-xs text-slate-500">Puede tardar un poco. Puedes seguir usando la web mientras tanto.</p>
    </motion.div>
  );
}

/** Chips con el origen de cada contenido. */
export function Citas({ fuentes, ampliacion, alAbrir }: { fuentes: Fuente[]; ampliacion?: boolean; alAbrir?: (f: Fuente) => void }) {
  if (ampliacion) {
    return (
      <span className="chip bg-amber-100 text-amber-800" title="No aparece en tus apuntes: conviene comprobarlo">
        ⚠️ Ampliación · compruébalo
      </span>
    );
  }
  const unicas = [...new Map(fuentes.map((f) => [f.origen, f])).values()];
  return (
    <span className="inline-flex flex-wrap gap-1">
      {unicas.map((f) => (
        <button
          key={f.chunk_id}
          type="button"
          onClick={() => alAbrir?.(f)}
          className="chip bg-marca-50 text-marca-700 ring-1 ring-marca-100 transition hover:bg-marca-100"
          title="Ver el fragmento de tus apuntes"
        >
          📎 {f.origen}
        </button>
      ))}
    </span>
  );
}

export function Modal({ abierto, alCerrar, titulo, children, ancho = "max-w-lg" }: { abierto: boolean; alCerrar: () => void; titulo: string; children: ReactNode; ancho?: string }) {
  return (
    <AnimatePresence>
      {abierto && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={alCerrar}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={titulo}
            className={`max-h-[90vh] w-full ${ancho} overflow-y-auto rounded-t-3xl bg-white p-5 shadow-flota sm:rounded-3xl`}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-900">{titulo}</h2>
              <button type="button" onClick={alCerrar} className="boton-fantasma px-2 py-1" aria-label="Cerrar">
                ✕
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Selector de alcance: examen completo o un tema. */
export function SelectorTema({ temas, valor, alCambiar, conCompleto = true }: { temas: Tema[]; valor: string | null; alCambiar: (v: string | null) => void; conCompleto?: boolean }) {
  const opciones = [...(conCompleto ? [{ id: null as string | null, titulo: "Todo el examen" }] : []), ...temas.map((t) => ({ id: t.id as string | null, titulo: t.titulo }))];
  return (
    <div className="sin-barra -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist">
      {opciones.map((o) => {
        const activo = o.id === valor;
        return (
          <button
            key={o.id ?? "todo"}
            role="tab"
            aria-selected={activo}
            type="button"
            onClick={() => alCambiar(o.id)}
            className={`relative shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition ${activo ? "text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-marca-300"}`}
          >
            {activo && <motion.span layoutId="selector-tema" className="absolute inset-0 rounded-full bg-gradient-to-r from-marca-600 to-fuchsia-500" transition={{ type: "spring", stiffness: 400, damping: 32 }} />}
            <span className="relative">{o.titulo}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Avisos flotantes (toasts) ─────────────────────────────
interface Toast {
  id: number;
  texto: string;
  tipo: TipoAviso;
}
const ToastCtx = createContext<(texto: string, tipo?: TipoAviso) => void>(() => {});

export function ProveedorToasts({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const mostrar = useCallback((texto: string, tipo: TipoAviso = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, texto, tipo }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={mostrar}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: -16, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -16 }} className="pointer-events-auto w-full max-w-md shadow-flota">
              <Aviso tipo={t.tipo}>{t.texto}</Aviso>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
