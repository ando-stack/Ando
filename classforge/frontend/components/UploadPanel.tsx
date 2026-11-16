"use client";

import { CalendarDays, FileUp, Sparkles, UploadCloud, User, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import type { Health } from "@/lib/api";
import { ACCEPT, ALLOWED_EXT, esToIso, formatBytes, isoToEs } from "@/lib/prefs";
import { Banner, FileBadge, Spinner } from "./ui";

function kindOf(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg"].includes(ext)) return "image";
  if (ext === "xlsm") return "xlsx";
  if (ext === "md") return "txt";
  return ext;
}

interface Props {
  health: Health | null;
  name: string;
  onName: (v: string) => void;
  date: string;
  onDate: (v: string) => void;
  busy: boolean;
  onSubmit: (files: File[], notes: string) => void;
}

export default function UploadPanel({ health, name, onName, date, onDate, busy, onSubmit }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [notes, setNotes] = useState("");
  const [drag, setDrag] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const maxMb = health?.limits.max_file_mb ?? 20;
  const maxFiles = health?.limits.max_files ?? 10;

  const add = useCallback((list: FileList | File[]) => {
    const errs: string[] = [];
    setFiles((prev) => {
      const next = [...prev];
      for (const f of Array.from(list)) {
        const ext = f.name.split(".").pop()?.toLowerCase() || "";
        if (!ALLOWED_EXT.includes(ext)) { errs.push(`«${f.name}»: formato no admitido.`); continue; }
        if (f.size > maxMb * 1024 * 1024) { errs.push(`«${f.name}» supera ${maxMb} MB.`); continue; }
        if (f.size === 0) { errs.push(`«${f.name}» está vacío.`); continue; }
        if (next.some((x) => x.name === f.name && x.size === f.size)) continue;
        if (next.length >= maxFiles) { errs.push(`Máximo ${maxFiles} archivos.`); break; }
        next.push(f);
      }
      return next;
    });
    setErrors(errs);
  }, [maxFiles, maxMb]);

  const canSubmit = files.length > 0 && name.trim().length > 0 && !busy;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <div className="space-y-4">
        <div
          role="button"
          tabIndex={0}
          aria-label="Zona para soltar archivos"
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
          className={`group relative flex min-h-[280px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed p-8 text-center transition-all
            ${drag ? "scale-[1.01] border-accent bg-accent/10" : "border-line bg-surface hover:border-accent/60 hover:bg-elevated/50"}`}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgb(var(--accent)/0.12),transparent_60%)]" />
          <div className={`relative mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-accent/15 text-accent transition ${drag ? "scale-110" : "group-hover:scale-105"}`}>
            <UploadCloud className="h-8 w-8" />
          </div>
          <p className="relative text-lg font-semibold">Arrastra aquí los documentos del profesor</p>
          <p className="relative mt-1 text-sm text-muted">o haz clic para elegirlos · Word, Excel, PowerPoint, PDF, CSV, imágenes</p>
          <p className="relative mt-3 text-xs text-muted">Hasta {maxFiles} archivos · {maxMb} MB por archivo</p>
          <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
        </div>

        {errors.length > 0 && <Banner tone="warn" title="Algunos archivos no se añadieron">{errors.join(" ")}</Banner>}

        {files.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {files.map((f, i) => (
              <li key={f.name + f.size} className="card flex items-center gap-3 p-3 animate-fade-up" style={{ animationDelay: `${i * 40}ms` }}>
                <FileBadge kind={kindOf(f.name)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={f.name}>{f.name}</p>
                  <p className="text-xs text-muted">{formatBytes(f.size)}</p>
                </div>
                <button className="rounded-lg p-1.5 text-muted hover:bg-elevated hover:text-fg" aria-label={`Quitar ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}>
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card h-fit space-y-5 p-6">
        <div>
          <h2 className="text-base font-semibold">Datos de la entrega</h2>
          <p className="mt-1 text-sm text-muted">Se usarán en los documentos (portada, encabezados, huecos de la plantilla).</p>
        </div>
        <div>
          <label className="label" htmlFor="name"><User className="mr-1 inline h-3.5 w-3.5" />Nombre y apellidos</label>
          <input id="name" className="input" value={name} maxLength={120} onChange={(e) => onName(e.target.value)} placeholder="p. ej. Ana López García" autoComplete="name" />
        </div>
        <div>
          <label className="label" htmlFor="date"><CalendarDays className="mr-1 inline h-3.5 w-3.5" />Fecha</label>
          <input id="date" type="date" className="input" value={esToIso(date)} onChange={(e) => onDate(isoToEs(e.target.value))} />
          <p className="mt-1 text-xs text-muted">Tomada del sistema; puedes cambiarla.</p>
        </div>
        <div>
          <label className="label" htmlFor="notes">Indicaciones adicionales (opcional)</label>
          <textarea id="notes" className="input min-h-[80px] resize-y" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="p. ej. Grupo 1ºB. Solo hay que hacer los ejercicios 1 a 3." />
        </div>
        {health && !health.ai_configured && (
          <Banner tone="error" title="IA no configurada en el servidor">Puedes subir documentos, pero el análisis requiere configurar ANTHROPIC_API_KEY en el backend.</Banner>
        )}
        <button className="btn-primary w-full py-3" disabled={!canSubmit} onClick={() => onSubmit(files, notes)}>
          {busy ? <><Spinner /> Subiendo y leyendo…</> : <><Sparkles className="h-4 w-4" /> Analizar documentos</>}
        </button>
        {!name.trim() && files.length > 0 && <p className="text-center text-xs text-muted"><FileUp className="mr-1 inline h-3 w-3" />Escribe tu nombre para continuar.</p>}
      </div>
    </div>
  );
}
