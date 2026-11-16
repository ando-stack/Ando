"use client";

import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/format";
import { useApp } from "@/lib/store";

export function Toaster() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2 lg:bottom-4" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cn("pointer-events-auto card flex items-start gap-2.5 px-3.5 py-3 text-sm shadow-xl animate-slide-in",
          t.kind === "error" && "border-danger/40", t.kind === "ok" && "border-ok/30")}>
          {t.kind === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> :
            t.kind === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" /> :
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent-soft" />}
          <span className="flex-1 text-fg">{t.text}</span>
          <button onClick={() => dismiss(t.id)} className="text-faint hover:text-fg" aria-label="Cerrar aviso"><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
    </div>
  );
}
