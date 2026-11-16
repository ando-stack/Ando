"use client";

import { Clock, FileStack, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type JobSummary } from "@/lib/api";
import { relTime } from "@/lib/prefs";
import { Banner, Spinner } from "./ui";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
}

export function PreviewModal({ jobId, fileId, name, onClose }: { jobId: string; fileId: string; name: string; onClose: () => void }) {
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEscape(onClose);
  useEffect(() => {
    let alive = true;
    api.preview(jobId, fileId).then((h) => alive && setHtml(h)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [jobId, fileId]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm animate-fade-up" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Vista previa de ${name}`}>
      <div className="card flex h-[90vh] w-full max-w-5xl flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="truncate text-sm font-medium">{name}</p>
          <button className="rounded-lg p-1.5 hover:bg-elevated" onClick={onClose} aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 bg-elevated">
          {err ? <div className="p-6"><Banner tone="error" title="No se pudo cargar la vista previa">{err}</Banner></div>
            : html === null ? <div className="grid h-full place-items-center"><Spinner className="h-6 w-6 text-accent" /></div>
            // sandbox vacío: sin scripts, sin formularios, sin acceso al origen
            : <iframe title={`Vista previa de ${name}`} sandbox="" srcDoc={html} className="h-full w-full bg-white" />}
        </div>
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  uploaded: "Subido", analyzing: "Analizando", analyzed: "Analizado", analyzed_error: "Error al planificar", generating: "Generando",
  completed: "Completado", needs_review: "Revisar", failed: "Error",
};
const STATUS_TONE: Record<string, string> = { completed: "text-ok", needs_review: "text-warn", failed: "text-bad", analyzed_error: "text-bad" };

export function HistoryDrawer({ currentId, onOpen, onClose, onDeleted }: { currentId: string | null; onOpen: (id: string) => void; onClose: () => void; onDeleted: (id: string) => void }) {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  useEscape(onClose);
  useEffect(() => { api.listJobs().then(setJobs).catch((e) => setErr(e.message)); }, []);

  const del = async (id: string) => {
    if (!confirm("¿Borrar este trabajo y todos sus archivos del servidor?")) return;
    setDeleting(id);
    try {
      await api.deleteJob(id);
      setJobs((j) => j?.filter((x) => x.id !== id) ?? null);
      onDeleted(id);
    } catch (e) { setErr((e as Error).message); } finally { setDeleting(null); }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl animate-fade-up" onClick={(e) => e.stopPropagation()} aria-label="Historial de trabajos">
        <div className="flex items-center justify-between border-b border-line p-4">
          <h2 className="flex items-center gap-2 font-semibold"><FileStack className="h-4 w-4 text-accent" />Historial</h2>
          <button className="rounded-lg p-1.5 hover:bg-elevated" onClick={onClose} aria-label="Cerrar"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {err && <Banner tone="error" title={err} />}
          {jobs === null && !err && [0, 1, 2].map((i) => <div key={i} className="skeleton h-16" />)}
          {jobs?.length === 0 && <p className="py-10 text-center text-sm text-muted">Todavía no hay trabajos.</p>}
          {jobs?.map((j) => (
            <div key={j.id} className={`group flex items-center gap-3 rounded-xl border p-3 transition hover:bg-elevated ${j.id === currentId ? "border-accent/60" : "border-line"}`}>
              <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(j.id)}>
                <p className="truncate text-sm font-medium">{j.title || "Trabajo"}</p>
                <p className="mt-0.5 text-xs text-muted">
                  <span className={STATUS_TONE[j.status] ?? ""}>{STATUS_LABEL[j.status] ?? j.status}</span>
                  {j.subject ? ` · ${j.subject}` : ""} · {j.files} archivo(s){j.versions ? ` · v${j.versions}` : ""} · {relTime(j.created_at)}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted"><Clock className="h-3 w-3" />Se borra {new Date(j.expires_at_ts * 1000).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}</p>
              </button>
              <button className="rounded-lg p-2 text-muted opacity-70 hover:bg-bad/10 hover:text-bad group-hover:opacity-100" onClick={() => del(j.id)} aria-label="Borrar trabajo" disabled={deleting === j.id}>
                {deleting === j.id ? <Spinner /> : <Trash2 className="h-4 w-4" />}
              </button>
            </div>
          ))}
        </div>
        <p className="border-t border-line p-4 text-xs text-muted">El historial está ligado a este navegador. Los archivos se eliminan automáticamente del servidor tras el periodo de retención.</p>
      </aside>
    </div>
  );
}
