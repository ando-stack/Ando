// Fase 1: subida (arrastrar y soltar, varios archivos), análisis y pantalla de confirmación de grupos.
import {useRef, useState} from 'react';
import {api, uploadFile, waitJob, type Job} from '../api';
import {go} from '../App';
import {fmt} from '../state/player';
import {JobProgress} from './JobProgress';

interface Clip {
  id: string;
  name: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  creationTime?: string | null;
  device?: string | null;
  hasAudio: boolean;
  thumbnail?: string;
  text?: string;
  videoCodec: string;
}
interface Link {
  from: string;
  to: string;
  score: number;
  reasons: string[];
}
interface ImportData {
  id: string;
  name: string;
  clips: Clip[];
  groups: string[][];
  links: Link[];
  warnings?: string[];
}
interface Upload {
  file: File;
  progress: number;
  error?: string;
  done?: boolean;
}

const ACCEPT = ['.mp4', '.mov', '.mkv', '.webm'];

/** H.264/AAC si el navegador los reproduce; si no (p. ej. Chromium en Linux), VP9/Opus. */
export function browserProxyCodec(): 'h264' | 'vp9' {
  const v = document.createElement('video');
  return v.canPlayType('video/mp4; codecs="avc1.42E01E"') && v.canPlayType('audio/mp4; codecs="mp4a.40.2"') ? 'h264' : 'vp9';
}

export function ImportFlow() {
  const [name, setName] = useState('mi-video');
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [importId, setImportId] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [data, setData] = useState<ImportData | null>(null);
  const [groups, setGroups] = useState<string[][]>([]);
  const [groupNames, setGroupNames] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | File[]) {
    setError(null);
    const list = Array.from(files).filter((f) => ACCEPT.some((e) => f.name.toLowerCase().endsWith(e)));
    if (!list.length) {
      setError('Formatos admitidos: .mp4, .mov, .mkv, .webm');
      return;
    }
    let id = importId;
    if (!id) {
      id = (await api.post<{importId: string}>('/api/imports', {name})).importId;
      setImportId(id);
    }
    const start = uploads.length;
    setUploads((u) => [...u, ...list.map((file) => ({file, progress: 0}))]);
    // Subidas de 2 en 2
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const i = next++;
        const idx = start + i;
        try {
          await uploadFile(id!, list[i], (p) => setUploads((u) => u.map((x, k) => (k === idx ? {...x, progress: p} : x))));
          setUploads((u) => u.map((x, k) => (k === idx ? {...x, progress: 1, done: true} : x)));
        } catch (e) {
          setUploads((u) => u.map((x, k) => (k === idx ? {...x, error: (e as Error).message} : x)));
        }
      }
    };
    await Promise.all([worker(), worker()]);
  }

  async function analyze() {
    if (!importId) return;
    setBusy(true);
    const j = await api.post<Job>(`/api/imports/${importId}/analyze`, {language: 'es', proxyCodec: browserProxyCodec()});
    const fin = await waitJob(j.id, setJob);
    setBusy(false);
    if (fin.status !== 'completada') return;
    const d = await api.get<ImportData>(`/api/imports/${importId}`);
    setData(d);
    setGroups(d.groups);
    setGroupNames(d.groups.map((_, i) => (d.groups.length === 1 ? name : `${name}-video-${i + 1}`)));
  }

  async function confirm() {
    if (!importId) return;
    setBusy(true);
    setError(null);
    try {
      const keep = groups.map((g, i) => ({g, n: groupNames[i]})).filter((x) => x.g.length);
      const r = await api.post<{projects: string[]}>(`/api/imports/${importId}/confirm`, {
        groups: keep.map((x) => x.g),
        names: keep.map((x) => x.n),
      });
      go({view: 'editor', name: r.projects[0]});
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- arrastrar clips entre grupos
  const dragged = useRef<string | null>(null);
  function moveClip(clipId: string, toGroup: number, toIndex: number) {
    setGroups((gs) => {
      const next = gs.map((g) => g.filter((c) => c !== clipId));
      if (toGroup >= next.length) {
        next.push([clipId]);
        setGroupNames((n) => [...n, `${name}-video-${next.length}`]);
      } else {
        const g = [...next[toGroup]];
        const fromSame = gs[toGroup].indexOf(clipId);
        const idx = fromSame >= 0 && fromSame < toIndex ? toIndex - 1 : toIndex;
        g.splice(Math.max(0, Math.min(idx, g.length)), 0, clipId);
        next[toGroup] = g;
      }
      return next;
    });
  }

  const clip = (id: string) => data?.clips.find((c) => c.id === id);
  const linkInfo = (a: string, b: string) => data?.links.find((l) => l.from === a && l.to === b);
  const allUploaded = uploads.length > 0 && uploads.every((u) => u.done || u.error);

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto p-8">
        <button onClick={() => go({view: 'home'})} className="text-zinc-400 hover:text-white text-sm mb-4">
          ← Volver
        </button>
        <h1 className="text-2xl font-bold mb-6">Nuevo vídeo</h1>

        {!data && (
          <>
            <label className="block text-sm text-zinc-400 mb-1">Nombre del proyecto</label>
            <input
              value={name}
              disabled={!!importId}
              onChange={(e) => setName(e.target.value)}
              className="bg-zinc-900 border border-zinc-700 rounded px-3 py-2 mb-4 w-80"
            />
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                void addFiles(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition ${drag ? 'border-pink-500 bg-pink-500/10' : 'border-zinc-700 hover:border-zinc-500'}`}
            >
              <div className="text-5xl mb-3">📂</div>
              <div className="text-lg font-semibold">Arrastra aquí tus vídeos o clips</div>
              <div className="text-zinc-400 text-sm mt-1">Varios a la vez · .mp4 .mov .mkv .webm · los originales nunca se modifican</div>
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={ACCEPT.join(',')}
                className="hidden"
                onChange={(e) => e.target.files && void addFiles(e.target.files)}
              />
            </div>
            {uploads.length > 0 && (
              <div className="mt-6 space-y-2">
                {uploads.map((u, i) => (
                  <div key={i} className="bg-zinc-900 rounded px-3 py-2 text-sm">
                    <div className="flex justify-between">
                      <span className="truncate">{u.file.name}</span>
                      <span className={u.error ? 'text-red-400' : 'text-zinc-400'}>
                        {u.error ? u.error : u.done ? '✓ subido' : `${Math.round(u.progress * 100)} %`}
                      </span>
                    </div>
                    <div className="h-1.5 bg-zinc-800 rounded mt-1">
                      <div className={`h-full rounded ${u.error ? 'bg-red-500' : 'bg-pink-500'}`} style={{width: `${u.progress * 100}%`}} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {job && <div className="mt-6"><JobProgress job={job} /></div>}
            <button
              disabled={!allUploaded || busy || !uploads.some((u) => u.done)}
              onClick={analyze}
              className="mt-6 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 px-5 py-3 rounded-lg font-semibold"
            >
              {busy ? 'Analizando…' : 'Analizar y agrupar clips'}
            </button>
          </>
        )}

        {data && (
          <>
            <p className="text-zinc-300 mb-1">
              La IA ha agrupado los clips en <b>{groups.filter((g) => g.length).length}</b> vídeo(s). Arrastra los clips para cambiar el grupo o
              el orden antes de editar.
            </p>
            {data.warnings?.map((w, i) => (
              <p key={i} className="text-amber-400 text-sm">⚠️ {w}</p>
            ))}
            <div className="flex gap-4 overflow-x-auto pb-4 mt-4 items-start">
              {[...groups, []].map((g, gi) => (
                <div
                  key={gi}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragged.current) moveClip(dragged.current, gi, g.length);
                  }}
                  className={`w-72 shrink-0 rounded-xl border ${gi === groups.length ? 'border-dashed border-zinc-700' : 'border-zinc-700 bg-zinc-900'} p-3`}
                >
                  {gi < groups.length ? (
                    <input
                      value={groupNames[gi] ?? ''}
                      onChange={(e) => setGroupNames((n) => n.map((x, k) => (k === gi ? e.target.value : x)))}
                      className="w-full bg-transparent font-semibold mb-2 border-b border-zinc-700 focus:outline-none"
                    />
                  ) : (
                    <div className="text-zinc-500 text-sm text-center py-6">Suelta aquí para crear otro vídeo</div>
                  )}
                  {gi < groups.length && g.length === 0 && <div className="text-zinc-600 text-sm">Grupo vacío (se ignorará)</div>}
                  {g.map((cid, ci) => {
                    const c = clip(cid);
                    if (!c) return null;
                    const link = ci > 0 ? linkInfo(g[ci - 1], cid) : null;
                    return (
                      <div key={cid}>
                        {ci > 0 && (
                          <div className="text-[11px] text-zinc-500 py-1 pl-2" title={link?.reasons.join(', ')}>
                            ↓ {link ? `continuidad ${Math.round(link.score * 100)} % · ${link.reasons.slice(0, 2).join(', ')}` : 'orden manual'}
                          </div>
                        )}
                        <div
                          draggable
                          onDragStart={() => (dragged.current = cid)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (dragged.current && dragged.current !== cid) moveClip(dragged.current, gi, ci);
                          }}
                          className="bg-zinc-800 rounded-lg overflow-hidden cursor-grab active:cursor-grabbing border border-zinc-700 hover:border-pink-500"
                        >
                          <div className="flex">
                            {c.thumbnail && <img src={`/import-files/${data.id}/${c.thumbnail}`} className="w-24 h-16 object-cover" alt="" />}
                            <div className="p-2 text-xs min-w-0">
                              <div className="font-semibold truncate text-sm">
                                {ci + 1}. {c.name}
                              </div>
                              <div className="text-zinc-400">
                                {fmt(c.duration)} · {c.width}×{c.height} · {Math.round(c.fps)} fps {c.hasAudio ? '' : '· sin audio'}
                              </div>
                              {c.creationTime && <div className="text-zinc-500">{new Date(c.creationTime).toLocaleString('es-ES')}</div>}
                            </div>
                          </div>
                          {c.text && <div className="px-2 pb-2 text-[11px] text-zinc-400 line-clamp-2">«{c.text}»</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {error && <p className="text-red-400 mt-2">{error}</p>}
            <button
              onClick={confirm}
              disabled={busy || !groups.some((g) => g.length)}
              className="mt-4 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 px-5 py-3 rounded-lg font-semibold"
            >
              {busy ? 'Uniendo clips…' : 'Confirmar y crear vídeo(s)'}
            </button>
          </>
        )}
        {error && !data && <p className="text-red-400 mt-4">{error}</p>}
      </div>
    </div>
  );
}
