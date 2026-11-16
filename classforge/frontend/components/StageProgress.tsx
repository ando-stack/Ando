"use client";

import { Check, X } from "lucide-react";
import type { Stage } from "@/lib/api";
import { Spinner } from "./ui";

export default function StageProgress({ stages }: { stages: Stage[] }) {
  const done = stages.filter((s) => s.status === "done").length;
  const pct = Math.round((done / stages.length) * 100);
  const current = stages.find((s) => s.status === "running") || stages.find((s) => s.status === "error");
  return (
    <div className="card p-5 animate-fade-up">
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="font-medium">{current ? `${current.label}: ${current.detail || "en curso…"}` : pct === 100 ? "Proceso completado" : done === 0 ? "Preparando…" : done === 1 ? "Documentos leídos" : "Análisis listo: revisa el resumen y pulsa «Generar trabajo»"}</span>
        <span className="tabular-nums text-muted">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
        <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${Math.max(pct, current?.status === "running" ? pct + 8 : pct)}%` }} />
      </div>
      <ol className="mt-5 grid grid-cols-3 gap-y-4 sm:grid-cols-6">
        {stages.map((s, i) => (
          <li key={s.key} className="flex flex-col items-center gap-1.5 text-center" title={s.detail}>
            <div className={`grid h-8 w-8 place-items-center rounded-full border text-xs font-semibold transition-colors
              ${s.status === "done" ? "border-ok/40 bg-ok/15 text-ok" : s.status === "running" ? "border-accent bg-accent/15 text-accent" : s.status === "error" ? "border-bad/40 bg-bad/15 text-bad" : "border-line text-muted"}`}>
              {s.status === "done" ? <Check className="h-4 w-4" /> : s.status === "running" ? <Spinner className="h-4 w-4" /> : s.status === "error" ? <X className="h-4 w-4" /> : i + 1}
            </div>
            <span className={`text-xs ${s.status === "pending" ? "text-muted" : ""}`}>{s.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
