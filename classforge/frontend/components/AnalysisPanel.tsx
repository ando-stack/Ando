"use client";

import { AlertTriangle, ClipboardList, FileOutput, Layers, ShieldAlert, Wand2 } from "lucide-react";
import { useState } from "react";
import type { FormatPref, Job } from "@/lib/api";
import { Banner, FileBadge, Section, Spinner, formatLabel } from "./ui";

const KIND_LABEL: Record<string, string> = { contenido: "Contenido", formato: "Formato", estructura: "Estructura", calculo: "Cálculo", grafico: "Gráfico", entrega: "Entrega", otro: "Otro" };
const PREFS: { v: FormatPref; label: string }[] = [
  { v: "auto", label: "Lo que pida la tarea" }, { v: "docx", label: "Word" }, { v: "xlsx", label: "Excel" },
  { v: "pptx", label: "PowerPoint" }, { v: "pdf", label: "PDF" }, { v: "csv", label: "CSV" },
];

interface Props {
  job: Job;
  formatPref: FormatPref;
  onFormatPref: (v: FormatPref) => void;
  busy: boolean;
  onGenerate: (notes: string) => void;
  onReanalyze: () => void;
}

export default function AnalysisPanel({ job, formatPref, onFormatPref, busy, onGenerate, onReanalyze }: Props) {
  const a = job.analysis!;
  const [notes, setNotes] = useState("");
  const [showAll, setShowAll] = useState(false);
  const fileName = (id: string | null) => job.files.find((f) => f.id === id)?.name;
  const conflicts = formatPref === "auto" ? [] : a.deliverables.filter((d) => d.format_explicitly_required && d.format !== formatPref);
  const reqs = showAll ? a.requirements : a.requirements.slice(0, 12);
  const generating = job.status === "generating";

  return (
    <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
      <div className="space-y-6">
        <Section title="Lo que voy a hacer" icon={<Wand2 className="h-4 w-4 text-accent" />} right={<span className="chip">{a.subject}</span>}>
          <h3 className="text-lg font-semibold">{a.title}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">{a.summary}</p>
          {a.exercises.length > 0 && (
            <div className="mt-5 grid gap-2">
              {a.exercises.map((e) => (
                <div key={e.id} className="rounded-xl border border-line bg-bg/40 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium"><span className="chip">{e.id}</span>{e.title}</div>
                  <p className="mt-1 text-xs text-muted">{e.description}</p>
                  {e.source_files.length > 0 && <p className="mt-1 text-[11px] text-muted">Archivos: {e.source_files.join(", ")}{e.deliverable_id ? ` → ${e.deliverable_id}` : ""}</p>}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title={`Instrucciones detectadas (${a.requirements.length})`} icon={<ClipboardList className="h-4 w-4 text-accent" />}>
          <ul className="divide-y divide-line">
            {reqs.map((r) => (
              <li key={r.id} className="flex gap-3 py-2.5 text-sm">
                <span className="chip h-fit shrink-0 font-mono">{r.id}</span>
                <div className="min-w-0">
                  <p>{r.text}</p>
                  <p className="mt-0.5 text-[11px] text-muted">{KIND_LABEL[r.kind] ?? r.kind} · {r.source}{!r.mandatory && " · opcional"}</p>
                </div>
              </li>
            ))}
          </ul>
          {a.requirements.length > 12 && (
            <button className="btn-ghost btn-sm mt-3" onClick={() => setShowAll(!showAll)}>{showAll ? "Ver menos" : `Ver las ${a.requirements.length}`}</button>
          )}
        </Section>

        {(a.ambiguities.length > 0 || a.impossible.length > 0) && (
          <Section title="Avisos" icon={<AlertTriangle className="h-4 w-4 text-warn" />}>
            <div className="space-y-3">
              {a.impossible.map((i, k) => <Banner key={`i${k}`} tone="warn" title={`No se puede hacer automáticamente: ${i.text}`}>{i.suggestion}</Banner>)}
              {a.ambiguities.map((i, k) => <Banner key={`a${k}`} tone="info" title={`Ambiguo: ${i.text}`}>{i.suggestion}</Banner>)}
            </div>
          </Section>
        )}

        {job.security_flags.length > 0 && (
          <Section title="Contenido sospechoso ignorado" icon={<ShieldAlert className="h-4 w-4 text-bad" />}>
            <p className="mb-3 text-sm text-muted">Estos fragmentos parecen intentar manipular a la IA. Se tratan como datos y no se obedecen.</p>
            <ul className="space-y-2 text-xs">
              {job.security_flags.slice(0, 8).map((f, i) => (
                <li key={i} className="rounded-lg border border-bad/20 bg-bad/5 p-2.5"><b>{f.source}</b> · {f.reason}<p className="mt-1 font-mono text-muted">«{f.snippet}»</p></li>
              ))}
            </ul>
          </Section>
        )}
      </div>

      <div className="space-y-6">
        <Section title="Entregables" icon={<FileOutput className="h-4 w-4 text-accent" />}>
          <ul className="space-y-3">
            {a.deliverables.map((d) => (
              <li key={d.id} className="flex gap-3 rounded-xl border border-line bg-bg/40 p-3">
                <FileBadge kind={d.format} size="sm" />
                <div className="min-w-0 text-sm">
                  <p className="truncate font-medium" title={d.filename}>{d.filename}</p>
                  <p className="text-xs text-muted">{d.description}</p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    <span className="chip">{formatLabel(d.format)}</span>
                    {d.base_file_id && <span className="chip" title="Se completa sobre la plantilla del profesor"><Layers className="h-3 w-3" />{fileName(d.base_file_id)}</span>}
                    {d.format_explicitly_required && <span className="chip">formato exigido</span>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {a.tools_needed.length > 0 && <p className="mt-4 text-xs text-muted">Herramientas: {a.tools_needed.join(" · ")}</p>}
        </Section>

        <div className="card space-y-4 p-6">
          <div>
            <label className="label" htmlFor="fmt">Formato de salida</label>
            <select id="fmt" className="input" value={formatPref} onChange={(e) => onFormatPref(e.target.value as FormatPref)} disabled={busy}>
              {PREFS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
            </select>
          </div>
          {conflicts.length > 0 && (
            <Banner tone="warn" title="Contradice la tarea">
              El profesor exige {conflicts.map((c) => `${c.filename} (${formatLabel(c.format)})`).join(", ")}. Se generará el formato exigido y además una versión en {formatLabel(formatPref)}.
            </Banner>
          )}
          <div>
            <label className="label" htmlFor="gnotes">Indicaciones para la generación (opcional)</label>
            <textarea id="gnotes" className="input min-h-[70px] resize-y" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="p. ej. Usa ejemplos de mi instituto." disabled={busy} />
          </div>
          <button className="btn-primary w-full py-3" disabled={busy} onClick={() => onGenerate(notes)}>
            {generating ? <><Spinner /> Generando…</> : <><Wand2 className="h-4 w-4" /> {job.versions.length ? "Regenerar trabajo" : "Generar trabajo"}</>}
          </button>
          <button className="btn-ghost w-full" disabled={busy} onClick={onReanalyze}>Volver a analizar</button>
        </div>
      </div>
    </div>
  );
}
