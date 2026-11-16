"use client";

import { AlertTriangle, CheckCircle2, FileImage, FileSpreadsheet, FileText, File as FileIcon, Loader2, Presentation, Sheet, XCircle } from "lucide-react";
import type { ReactNode } from "react";

const FORMAT_STYLE: Record<string, { color: string; label: string }> = {
  docx: { color: "text-sky-400 bg-sky-400/10 border-sky-400/20", label: "Word" },
  xlsx: { color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20", label: "Excel" },
  pptx: { color: "text-orange-400 bg-orange-400/10 border-orange-400/20", label: "PowerPoint" },
  pdf: { color: "text-rose-400 bg-rose-400/10 border-rose-400/20", label: "PDF" },
  csv: { color: "text-lime-400 bg-lime-400/10 border-lime-400/20", label: "CSV" },
  image: { color: "text-fuchsia-400 bg-fuchsia-400/10 border-fuchsia-400/20", label: "Imagen" },
  txt: { color: "text-slate-400 bg-slate-400/10 border-slate-400/20", label: "Texto" },
};

export function formatLabel(kind: string) {
  return FORMAT_STYLE[kind]?.label ?? kind.toUpperCase();
}

export function FileBadge({ kind, size = "md" }: { kind: string; size?: "sm" | "md" }) {
  const st = FORMAT_STYLE[kind] ?? FORMAT_STYLE.txt;
  const Icon = kind === "docx" || kind === "pdf" || kind === "txt" ? FileText : kind === "xlsx" ? FileSpreadsheet : kind === "csv" ? Sheet : kind === "pptx" ? Presentation : kind === "image" ? FileImage : FileIcon;
  const dim = size === "sm" ? "h-8 w-8" : "h-11 w-11";
  return (
    <div className={`grid shrink-0 place-items-center rounded-xl border ${st.color} ${dim}`}>
      <Icon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
    </div>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} />;
}

export function Banner({ tone, title, children, action }: { tone: "error" | "warn" | "ok" | "info"; title: string; children?: ReactNode; action?: ReactNode }) {
  const cfg = {
    error: { cls: "border-bad/30 bg-bad/10", Icon: XCircle, ic: "text-bad" },
    warn: { cls: "border-warn/30 bg-warn/10", Icon: AlertTriangle, ic: "text-warn" },
    ok: { cls: "border-ok/30 bg-ok/10", Icon: CheckCircle2, ic: "text-ok" },
    info: { cls: "border-accent/30 bg-accent/10", Icon: AlertTriangle, ic: "text-accent" },
  }[tone];
  return (
    <div className={`flex gap-3 rounded-xl border p-4 text-sm animate-fade-up ${cfg.cls}`} role={tone === "error" ? "alert" : "status"}>
      <cfg.Icon className={`mt-0.5 h-5 w-5 shrink-0 ${cfg.ic}`} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-1 text-muted">{children}</div>}
      </div>
      {action}
    </div>
  );
}

export function Section({ title, icon, children, right, className = "" }: { title: string; icon?: ReactNode; children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <section className={`card p-5 sm:p-6 animate-fade-up ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">{icon}{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}
