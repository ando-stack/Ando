// Fase 6: chat lateral. Cada cambio de la IA llega validado por el backend y entra en el
// historial de deshacer como cualquier otro cambio.
import {useEffect, useRef, useState} from 'react';
import {api, waitJob, type Job} from '../api';
import {applyServerProject, flushSave, getState, notify} from '../state/store';
import type {Project} from '../types';

const EXAMPLES = [
  'Quita el emoji del segundo 12',
  'Pon los subtítulos más grandes',
  'Haz la iluminación más cálida',
  'Añade un título "Bienvenidos" cuando digo "bienvenidos"',
  'Pixela la cara de la persona 1',
];

export function ChatPanel({project, ai, onJob}: {project: Project; ai: boolean; onJob: (j: Job | null) => void}) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({top: listRef.current.scrollHeight});
  }, [project.chat.length, pending]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setPending(text);
    setMsg('');
    try {
      await flushSave();
      const r = await api.post<{project: Project; reply: string; changes: string[]; colorJob: Job | null}>(
        `/api/projects/${encodeURIComponent(project.name)}/chat`,
        {message: text},
      );
      applyServerProject(r.project);
      if (r.colorJob) {
        onJob(r.colorJob);
        const fin = await waitJob(r.colorJob.id, onJob);
        if (fin.status === 'completada') {
          const p = await api.get<Project>(`/api/projects/${encodeURIComponent(project.name)}`);
          // el LUT forma parte del mismo cambio: no se añade otra entrada al historial
          applyServerProject({...p, chat: getState().project?.chat ?? p.chat}, {history: false});
        }
        onJob(null);
      }
    } catch (e) {
      setError((e as Error).message);
      setMsg(text);
      notify(`Chat: ${(e as Error).message}`);
    } finally {
      setPending(null);
      setBusy(false);
    }
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-zinc-800 text-sm font-semibold">💬 Chat de edición</div>
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3 text-sm">
        {!project.chat.length && (
          <div className="text-zinc-400 text-xs">
            <p className="mb-2">Pide cambios en lenguaje natural. Puedes referirte a momentos por tiempo («en el 1:20») o por lo que se dice («cuando digo "bienvenidos"»). Todo se puede deshacer con Ctrl+Z.</p>
            {ai &&
              EXAMPLES.map((e) => (
                <button key={e} onClick={() => setMsg(e)} className="block text-left text-pink-300 hover:text-pink-200 py-0.5">
                  «{e}»
                </button>
              ))}
          </div>
        )}
        {project.chat.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={`rounded-lg px-3 py-2 max-w-[90%] whitespace-pre-wrap ${m.role === 'user' ? 'bg-pink-700/70' : 'bg-zinc-800'}`}>
              {m.content}
              {m.role === 'assistant' && m.changes.length > 0 && (
                <ul className="mt-1 text-xs text-emerald-300 list-disc pl-4">
                  {m.changes.map((c, k) => (
                    <li key={k}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <>
            <div className="flex justify-end">
              <div className="rounded-lg px-3 py-2 bg-pink-700/40">{pending}</div>
            </div>
            <div className="text-zinc-400 text-xs animate-pulse">La IA está editando…</div>
          </>
        )}
        {error && <div className="text-red-400 text-xs">{error}</div>}
      </div>
      <form
        className="p-2 border-t border-zinc-800 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(msg);
        }}
      >
        <textarea
          value={msg}
          disabled={!ai}
          rows={2}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(msg);
            }
          }}
          placeholder={ai ? 'Escribe un cambio… (Intro para enviar)' : 'El chat necesita ANTHROPIC_API_KEY en .env'}
          className="flex-1 resize-none bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
        />
        <button disabled={!ai || busy || !msg.trim()} className="px-3 rounded bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-sm font-semibold">
          Enviar
        </button>
      </form>
    </div>
  );
}
