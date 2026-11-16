"use client";

import { Anvil, History, Moon, Plus, RotateCcw, Sun } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import AccessGate from "@/components/AccessGate";
import AnalysisPanel from "@/components/AnalysisPanel";
import { HistoryDrawer, PreviewModal } from "@/components/Overlays";
import ResultsPanel from "@/components/ResultsPanel";
import StageProgress from "@/components/StageProgress";
import UploadPanel from "@/components/UploadPanel";
import { Banner, FileBadge, Spinner } from "@/components/ui";
import { api, ApiError, type FormatPref, type Health, type Job } from "@/lib/api";
import { defaultPrefs, loadPrefs, savePrefs, todayEs, type Prefs } from "@/lib/prefs";

const BUSY = new Set(["analyzing", "generating"]);

export default function Home() {
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  const [loaded, setLoaded] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);
  const [date, setDate] = useState(todayEs());
  const [job, setJob] = useState<Job | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState(false);
  const [preview, setPreview] = useState<{ id: string; name: string } | null>(null);
  const [needKey, setNeedKey] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const update = useCallback((p: Partial<Prefs>) => {
    setPrefs((old) => { const n = { ...old, ...p }; savePrefs(n); return n; });
  }, []);

  // Carga inicial: preferencias, estado del servidor y último trabajo abierto
  useEffect(() => {
    const p = loadPrefs();
    setPrefs(p);
    setLoaded(true);
    api.health().then(async (h) => {
      setHealth(h);
      if (h.access_required) {
        try { await api.checkAccess(); } catch (e) { if (e instanceof ApiError && e.status === 403) { setNeedKey(true); return; } }
      }
      if (p.currentJob) api.getJob(p.currentJob).then(setJob).catch(() => update({ currentJob: null }));
    }).catch((e) => setHealthErr(e.message));
  }, [update]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", prefs.theme === "dark");
  }, [prefs.theme]);

  // Sondeo mientras el servidor trabaja
  useEffect(() => {
    if (pollRef.current) clearTimeout(pollRef.current);
    if (!job || !BUSY.has(job.status)) return;
    pollRef.current = setTimeout(async () => {
      try { setJob(await api.getJob(job.id)); } catch (e) {
        if (e instanceof ApiError && e.status === 404) { setJob(null); update({ currentJob: null }); setError("El trabajo ya no existe (puede haber caducado)."); }
        else setJob({ ...job }); // reintentar
      }
    }, 1500);
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [job, update]);

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 403) setNeedKey(true);
    else setError((e as Error).message);
  };

  const run = async (fn: () => Promise<Job>) => {
    setError(null);
    try { setJob(await fn()); } catch (e) { fail(e); }
  };

  const submit = async (files: File[], notes: string) => {
    setUploading(true);
    setError(null);
    try {
      const j = await api.createJob(files, prefs.name.trim(), date, notes);
      setJob(j);
      update({ currentJob: j.id });
      if (j.progress[0].status === "done" && health?.ai_configured) await run(() => api.analyze(j.id));
    } catch (e) { fail(e); } finally { setUploading(false); }
  };

  const openJob = async (id: string) => {
    setHistory(false);
    setError(null);
    try { const j = await api.getJob(id); setJob(j); update({ currentJob: id }); } catch (e) { setError((e as Error).message); }
  };

  const newJob = () => { setJob(null); setError(null); update({ currentJob: null }); setDate(todayEs()); };
  const busy = !!job && BUSY.has(job.status);
  const showAnalysis = job?.analysis && job.status !== "analyzing";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <button onClick={newJob} className="flex items-center gap-2.5" aria-label="Inicio">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-white shadow-lg shadow-accent/30"><Anvil className="h-5 w-5" /></div>
            <span className="text-base font-semibold tracking-tight">ClassForge <span className="text-accent">AI</span></span>
          </button>
          <div className="ml-auto flex items-center gap-2">
            {health && (
              <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-muted sm:flex" title={health.ai_configured ? `Modelo: ${health.model}` : "Falta ANTHROPIC_API_KEY en el servidor"}>
                <span className={`h-1.5 w-1.5 rounded-full ${health.ai_configured ? "bg-ok" : "bg-bad"}`} />{health.ai_configured ? "IA lista" : "IA sin configurar"}
              </span>
            )}
            {job && <button className="btn-ghost btn-sm" onClick={newJob}><Plus className="h-3.5 w-3.5" /><span className="hidden sm:inline">Nuevo</span></button>}
            <button className="btn-ghost btn-sm" onClick={() => setHistory(true)}><History className="h-3.5 w-3.5" /><span className="hidden sm:inline">Historial</span></button>
            <button className="btn-ghost btn-sm" onClick={() => update({ theme: prefs.theme === "dark" ? "light" : "dark" })} aria-label="Cambiar tema">
              {prefs.theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        {healthErr && <Banner tone="error" title="Servidor no disponible">{healthErr}</Banner>}
        {error && <Banner tone="error" title="Algo ha fallado" action={<button className="text-xs text-muted hover:text-fg" onClick={() => setError(null)}>Cerrar</button>}>{error}</Banner>}

        {!job && loaded && (
          <>
            <div className="mx-auto max-w-2xl pb-2 text-center animate-fade-up">
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Del enunciado al trabajo <span className="text-accent">entregable</span></h1>
              <p className="mt-3 text-muted">Sube los documentos de tu profesor. ClassForge interpreta las instrucciones y genera los archivos Word, Excel, PowerPoint o PDF reales, verificados y listos para descargar.</p>
            </div>
            <UploadPanel health={health} name={prefs.name} onName={(v) => update({ name: v })} date={date} onDate={setDate} busy={uploading} onSubmit={submit} />
          </>
        )}

        {job && (
          <>
            <div className="flex flex-wrap items-center gap-3 animate-fade-up">
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-2xl font-semibold tracking-tight">{job.analysis?.title || job.title}</h1>
                <p className="text-sm text-muted">{job.student_name} · {job.date}</p>
              </div>
            </div>

            <div className="flex gap-3 overflow-x-auto pb-1">
              {job.files.map((f) => (
                <button key={f.id} onClick={() => setPreview({ id: f.id, name: f.name })} className="card flex min-w-[220px] max-w-[280px] items-center gap-3 p-3 text-left transition hover:border-accent/50" title="Ver documento original">
                  <FileBadge kind={f.kind} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{f.name}</p>
                    <p className={`truncate text-xs ${f.ingest?.ok === false ? "text-bad" : "text-muted"}`}>{f.ingest?.ok === false ? f.ingest.error : f.ingest?.summary}</p>
                  </div>
                </button>
              ))}
            </div>

            <StageProgress stages={job.progress} />

            {job.error && !busy && (
              <Banner tone="error" title="El proceso se detuvo" action={
                job.analysis
                  ? <button className="btn-ghost btn-sm" onClick={() => run(() => api.generate(job.id, prefs.formatPref, ""))}><RotateCcw className="h-3.5 w-3.5" />Reintentar</button>
                  : <button className="btn-ghost btn-sm" onClick={() => run(() => api.analyze(job.id))}><RotateCcw className="h-3.5 w-3.5" />Reintentar</button>
              }>{job.error}</Banner>
            )}

            {job.status === "uploaded" && !job.error && (
              <div className="card flex flex-col items-center gap-3 p-8 text-center">
                <p className="text-sm text-muted">Documentos leídos. {health?.ai_configured ? "Pulsa para que la IA analice las instrucciones." : "La IA no está configurada en el servidor."}</p>
                <button className="btn-primary" disabled={!health?.ai_configured} onClick={() => run(() => api.analyze(job.id))}>Analizar con IA</button>
              </div>
            )}

            {job.status === "analyzing" && (
              <div className="card space-y-3 p-6" aria-busy="true">
                <p className="flex items-center gap-2 text-sm text-muted"><Spinner className="h-4 w-4 text-accent" />Claude está leyendo los documentos e identificando ejercicios, recursos y formato de entrega…</p>
                <div className="skeleton h-5 w-2/3" /><div className="skeleton h-4 w-full" /><div className="skeleton h-4 w-5/6" /><div className="skeleton h-24 w-full" />
              </div>
            )}

            {job.versions.length > 0 && (
              <ResultsPanel job={job} busy={busy} zipWithSteps={prefs.zipWithSteps} onZipWithSteps={(v) => update({ zipWithSteps: v })}
                onPreview={(id, name) => setPreview({ id, name })} onError={setError}
                onRevise={(fb) => run(() => api.revise(job.id, fb, prefs.formatPref))}
                onRegenerate={() => run(() => api.generate(job.id, prefs.formatPref, ""))} />
            )}

            {showAnalysis && (
              <details className="group" open={job.versions.length === 0}>
                <summary className={`mb-4 cursor-pointer list-none text-sm font-medium text-muted hover:text-fg ${job.versions.length === 0 ? "hidden" : ""}`}>
                  Ver análisis de la tarea e instrucciones detectadas
                </summary>
                <AnalysisPanel job={job} formatPref={prefs.formatPref} onFormatPref={(v: FormatPref) => update({ formatPref: v })} busy={busy}
                  onGenerate={(notes) => run(() => api.generate(job.id, prefs.formatPref, notes))} onReanalyze={() => run(() => api.analyze(job.id))} />
              </details>
            )}
          </>
        )}
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-10 text-center text-xs text-muted sm:px-6">
        Los archivos se borran del servidor tras {health?.limits.retention_hours ?? 24} h. Revisa siempre el trabajo antes de entregarlo: es tu responsabilidad.
      </footer>

      {needKey && <AccessGate onOk={() => { setNeedKey(false); setError(null); }} />}
      {history && <HistoryDrawer currentId={job?.id ?? null} onOpen={openJob} onClose={() => setHistory(false)} onDeleted={(id) => { if (job?.id === id) newJob(); }} />}
      {preview && job && <PreviewModal jobId={job.id} fileId={preview.id} name={preview.name} onClose={() => setPreview(null)} />}
    </div>
  );
}
