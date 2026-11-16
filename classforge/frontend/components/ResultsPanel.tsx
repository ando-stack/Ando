"use client";

import { BookOpen, CheckCircle2, ChevronDown, Download, Eye, FileArchive, MessageSquareText, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { downloadFile, fileUrl, zipUrl, type Job, type Version } from "@/lib/api";
import { formatBytes } from "@/lib/prefs";
import { Banner, FileBadge, Section, Spinner } from "./ui";

interface Props {
  job: Job;
  busy: boolean;
  zipWithSteps: boolean;
  onZipWithSteps: (v: boolean) => void;
  onPreview: (fileId: string, name: string) => void;
  onRevise: (feedback: string) => void;
  onRegenerate: () => void;
  onError: (msg: string) => void;
}

const STATUS: Record<string, { tone: "ok" | "warn" | "error"; title: string }> = {
  completed: { tone: "ok", title: "Trabajo completado y verificado" },
  needs_review: { tone: "warn", title: "Archivos generados, pero hay aspectos que revisar" },
  failed: { tone: "error", title: "No se pudo generar el trabajo" },
};

export default function ResultsPanel({ job, busy, zipWithSteps, onZipWithSteps, onPreview, onRevise, onRegenerate, onError }: Props) {
  const [vIdx, setVIdx] = useState(job.versions.length - 1);
  const [feedback, setFeedback] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  useEffect(() => setVIdx(job.versions.length - 1), [job.versions.length]);
  const v: Version | undefined = job.versions[vIdx];
  if (!v) return null;
  const st = STATUS[v.status] ?? STATUS.needs_review;
  const reqText = Object.fromEntries((job.analysis?.requirements ?? []).map((r) => [r.id, r]));

  const dl = async (path: string, name: string, key: string) => {
    setDownloading(key);
    try { await downloadFile(path, name); } catch (e) { onError((e as Error).message); } finally { setDownloading(null); }
  };

  return (
    <div className="space-y-6">
      {job.versions.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Versiones">
          {job.versions.map((x, i) => (
            <button key={x.version} role="tab" aria-selected={i === vIdx} onClick={() => setVIdx(i)}
              className={`btn-sm btn ${i === vIdx ? "bg-accent text-white" : "border border-line bg-surface hover:bg-elevated"}`}>
              Versión {x.version}{x.feedback ? " · corrección" : ""}
            </button>
          ))}
        </div>
      )}

      <Banner tone={st.tone} title={st.title}>
        {v.status === "completed" ? "Todos los archivos se abren, se aplicaron las operaciones y se cubrieron los requisitos obligatorios."
          : v.validation.problems.length ? `${v.validation.problems.length} aspecto(s) detectados en la validación. Revísalos abajo o pide una corrección.` : null}
        {v.feedback && <p className="mt-1">Corrección solicitada: «{v.feedback}»</p>}
      </Banner>
      {v.warnings.map((w, i) => <Banner key={i} tone="warn" title={w} />)}

      <Section title="Archivos generados" icon={<Download className="h-4 w-4 text-accent" />}
        right={v.outputs.length > 0 && (
          <div className="flex items-center gap-3">
            <label className="hidden items-center gap-1.5 text-xs text-muted sm:flex">
              <input type="checkbox" checked={zipWithSteps} onChange={(e) => onZipWithSteps(e.target.checked)} className="accent-[rgb(var(--accent))]" />
              incluir procedimiento
            </label>
            <button className="btn-primary btn-sm" disabled={downloading === "zip"} onClick={() => dl(zipUrl(job.id, v.version, zipWithSteps), "trabajo.zip", "zip")}>
              {downloading === "zip" ? <Spinner className="h-3.5 w-3.5" /> : <FileArchive className="h-3.5 w-3.5" />} Descargar ZIP
            </button>
          </div>
        )}>
        {v.outputs.length === 0 ? <p className="text-sm text-muted">No se generó ningún archivo.</p> : (
          <ul className="grid gap-3 md:grid-cols-2">
            {v.outputs.map((o) => {
              const rep = v.validation.deliverables.find((d) => d.id === o.deliverable_id);
              const ok = rep && rep.opens && rep.checks.every((c) => c.ok) && rep.template.every((c) => c.ok) && rep.formula_errors.length === 0 && rep.failed_steps.length === 0;
              return (
                <li key={o.id} className="flex items-center gap-3 rounded-xl border border-line bg-bg/40 p-3">
                  <FileBadge kind={o.format} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" title={o.name}>{o.name}</p>
                    <p className="flex items-center gap-1 text-xs text-muted">
                      {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-ok" /> : <XCircle className="h-3.5 w-3.5 text-warn" />}
                      {formatBytes(o.size)} · {ok ? "verificado" : "revisar"}
                    </p>
                  </div>
                  <button className="btn-ghost btn-sm" onClick={() => onPreview(o.id, o.name)} aria-label={`Vista previa de ${o.name}`}><Eye className="h-3.5 w-3.5" /></button>
                  <button className="btn-ghost btn-sm" disabled={downloading === o.id} onClick={() => dl(fileUrl(job.id, o.id), o.name, o.id)} aria-label={`Descargar ${o.name}`}>
                    {downloading === o.id ? <Spinner className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Validación" icon={<ShieldCheck className="h-4 w-4 text-accent" />}>
          {v.validation.problems.length > 0 && (
            <ul className="mb-4 space-y-1.5 text-sm">
              {v.validation.problems.map((p, i) => <li key={i} className="flex gap-2"><XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" /><span>{p}</span></li>)}
            </ul>
          )}
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Requisitos</h3>
          <ul className="space-y-1.5 text-sm">
            {Object.entries(v.validation.coverage).map(([rid, status]) => {
              const rev = v.review?.items.find((i) => i.requirement_id === rid);
              const good = status === "cubierto" && (!rev || rev.status === "hecho");
              return (
                <li key={rid} className="flex gap-2" title={rev?.comment}>
                  {good ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />}
                  <span><span className="font-mono text-xs text-muted">{rid}</span> {reqText[rid]?.text ?? ""}
                    {status !== "cubierto" && <span className="chip ml-1">{status.replace("_", " ")}</span>}
                    {rev && rev.status !== "hecho" && <span className="chip ml-1">IA: {rev.status}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {v.review?.overall && <p className="mt-4 rounded-lg bg-elevated p-3 text-xs text-muted"><b>Revisión IA:</b> {v.review.overall}</p>}
          <details className="mt-4 text-sm">
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted">Comprobaciones técnicas</summary>
            {v.validation.deliverables.map((d) => (
              <div key={d.id} className="mt-3">
                <p className="text-xs font-semibold">{d.filename} {d.opens ? "· se abre correctamente" : "· NO se abre"}</p>
                <ul className="mt-1 space-y-1 text-xs">
                  {[...d.checks, ...d.template].map((c, i) => (
                    <li key={i} className="flex gap-1.5">{c.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-ok" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-bad" />}{c.description}</li>
                  ))}
                  {d.formula_errors.map((e, i) => <li key={`f${i}`} className="text-bad">{e.sheet}!{e.cell} {e.formula} → {e.value}</li>)}
                  {d.notes.map((n, i) => <li key={`n${i}`} className="text-muted">{n}</li>)}
                </ul>
              </div>
            ))}
            {!v.validation.formula_engine && <p className="mt-2 text-xs text-muted">Motor de recálculo (LibreOffice) no disponible: las fórmulas no se han podido evaluar en el servidor.</p>}
          </details>
        </Section>

        <Section title="Cómo se ha hecho" icon={<BookOpen className="h-4 w-4 text-accent" />}>
          <p className="mb-3 text-sm text-muted">Los pasos que realizó el sistema, explicados para que puedas repetirlos tú.</p>
          <div className="space-y-3">
            {v.deliverables.map((d) => (
              <details key={d.id} className="group rounded-xl border border-line bg-bg/40" open={v.deliverables.length === 1}>
                <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-medium">
                  <FileBadge kind={d.format} size="sm" /> <span className="truncate">{d.filename}</span>
                  <span className="ml-auto text-xs text-muted">{d.steps.length} pasos</span>
                  <ChevronDown className="h-4 w-4 text-muted transition group-open:rotate-180" />
                </summary>
                <ol className="space-y-2 border-t border-line p-3 text-sm">
                  {d.steps.map((s) => (
                    <li key={s.n} className="flex gap-2.5">
                      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${s.status === "ok" ? "bg-ok/15 text-ok" : "bg-bad/15 text-bad"}`}>{s.n}</span>
                      <div className="min-w-0">
                        <p>{s.explanation}</p>
                        <p className={`text-[11px] ${s.status === "ok" ? "text-muted" : "text-bad"}`}>{s.message}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            ))}
          </div>
        </Section>
      </div>

      <Section title="¿Quieres cambiar algo?" icon={<MessageSquareText className="h-4 w-4 text-accent" />}>
        <textarea className="input min-h-[90px] resize-y" maxLength={3000} value={feedback} onChange={(e) => setFeedback(e.target.value)} disabled={busy}
          placeholder="p. ej. En el ejercicio 2 usa la función BUSCARV y pon el gráfico en una hoja nueva." />
        <div className="mt-3 flex flex-wrap gap-3">
          <button className="btn-primary" disabled={busy || feedback.trim().length < 3} onClick={() => { onRevise(feedback.trim()); setFeedback(""); }}>
            {busy ? <Spinner /> : <MessageSquareText className="h-4 w-4" />} Solicitar corrección
          </button>
          <button className="btn-ghost" disabled={busy} onClick={onRegenerate}><RefreshCw className="h-4 w-4" /> Regenerar desde cero</button>
        </div>
      </Section>
    </div>
  );
}
