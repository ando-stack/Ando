import {useEffect, useState} from 'react';
import {api, loadProject, waitJob, type Job} from '../api';
import {go, type Status} from '../App';
import {applyServerProject, closeProject, commit, flushSave, getState, notify, openProject, redo, select, undo, useEditor} from '../state/store';
import {deleteItem, duplicateItem, splitAt} from '../state/timelineOps';
import {player} from '../state/player';
import {ChatPanel} from './ChatPanel';
import {JobProgress} from './JobProgress';
import {PlayerPanel, type CompareState} from './PlayerPanel';
import {PropertiesPanel} from './PropertiesPanel';
import {Timeline} from './Timeline';
import {AudioPanel, AutoEditPanel, ColorPanel, ExportPanel, FacesPanel} from './panels';
import {browserProxyCodec} from './ImportFlow';

type Tab = 'propiedades' | 'auto' | 'color' | 'caras' | 'audio' | 'exportar';
const TABS: [Tab, string][] = [
  ['propiedades', 'Propiedades'],
  ['auto', 'Edición auto'],
  ['color', 'Color'],
  ['caras', 'Caras'],
  ['audio', 'Audio'],
  ['exportar', 'Exportar'],
];

export function EditorView({name, status}: {name: string; status: Status | null}) {
  const project = useEditor((s) => s.project);
  const save = useEditor((s) => s.save);
  const saveError = useEditor((s) => s.saveError);
  const notice = useEditor((s) => s.notice);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const [tab, setTab] = useState<Tab>('auto');
  const [job, setJob] = useState<Job | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [compare, setCompare] = useState<CompareState>({enabled: false, position: 50});
  const ai = !!status?.ai;

  useEffect(() => {
    loadProject(name)
      .then((p) => {
        openProject(p);
        if (p.captions.blocks.length || p.texts.length) setTab('propiedades');
      })
      .catch((e) => setLoadError((e as Error).message));
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (getState().save !== 'guardado') e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      void flushSave().then(closeProject);
    };
  }, [name]);

  // Tareas en segundo plano: se guarda antes y al terminar se recarga el proyecto (deshacible)
  async function run(url: string, body?: unknown): Promise<Job | null> {
    if (job && (job.status === 'ejecutando' || job.status === 'pendiente')) {
      notify('Ya hay una tarea en marcha: espera a que termine o cancélala.');
      return null;
    }
    await flushSave();
    try {
      const j = await api.post<Job>(url, body ?? {});
      setJob(j);
      const fin = await waitJob(j.id, setJob);
      if (fin.status === 'completada') {
        applyServerProject(await loadProject(name));
        if (fin.warnings?.length) notify(`Hecho con avisos: ${fin.warnings.join(' · ')}`);
        setTimeout(() => setJob((cur) => (cur?.id === fin.id ? null : cur)), 4000);
      }
      return fin;
    } catch (e) {
      notify((e as Error).message);
      return null;
    }
  }

  // Atajos de teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const ctrl = e.ctrlKey || e.metaKey;
      const sel = getState().selection;
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (ctrl && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (sel) {
          let id: string | undefined;
          commit((p) => {
            const r = duplicateItem(p, sel);
            id = r.id;
            return r.project;
          });
          if (id) select({kind: sel.kind, id});
        }
      } else if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void flushSave();
      } else if (e.key === ' ') {
        e.preventDefault();
        player.toggle();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (sel) {
          e.preventDefault();
          commit((p) => deleteItem(p, sel));
          select(null);
        }
      } else if (e.key.toLowerCase() === 's' && !ctrl) {
        commit((p) => splitAt(p, player.time));
      } else if (e.key === 'ArrowLeft') {
        player.seek(player.time - (e.shiftKey ? 1 : 1 / player.fps));
      } else if (e.key === 'ArrowRight') {
        player.seek(player.time + (e.shiftKey ? 1 : 1 / player.fps));
      } else if (e.key === 'Escape') {
        select(null);
      } else if (e.key === 'Home') {
        player.seek(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (loadError) return <div className="p-8 text-red-400">No se pudo abrir el proyecto: {loadError}</div>;
  if (!project || project.name !== name) return <div className="p-8 text-zinc-400">Cargando proyecto…</div>;

  const setAspect = async (aspect: '16:9' | '9:16') => {
    commit((p) => ({...p, canvas: aspect === '9:16' ? {...p.canvas, width: 1080, height: 1920, aspect} : {...p.canvas, width: 1920, height: 1080, aspect}}));
    const p = getState().project!;
    if (aspect === '9:16' && p.reframe.auto && !p.reframe.parts.length && p.sources.some((s) => s.width > s.height)) {
      await run(`/api/projects/${encodeURIComponent(name)}/reframe`);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* barra superior */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-zinc-800 text-sm">
        <button onClick={() => void flushSave().then(() => go({view: 'home'}))} className="text-zinc-400 hover:text-white">
          ← Proyectos
        </button>
        <span className="font-semibold">{project.name}</span>
        <span className={`text-xs ${save === 'error' ? 'text-red-400' : 'text-zinc-500'}`} title={saveError ?? ''}>
          {save === 'guardado' ? '✓ Guardado' : save === 'guardando' ? 'Guardando…' : save === 'pendiente' ? '● Cambios sin guardar' : `⚠️ ${saveError ?? 'Error al guardar'}`}
        </span>
        <div className="ml-4 flex gap-1">
          <button disabled={!canUndo} onClick={undo} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30" title="Deshacer (Ctrl+Z)">
            ↶
          </button>
          <button disabled={!canRedo} onClick={redo} className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-30" title="Rehacer (Ctrl+Shift+Z)">
            ↷
          </button>
        </div>
        <div className="flex rounded overflow-hidden border border-zinc-700 ml-2">
          {(['16:9', '9:16'] as const).map((a) => (
            <button key={a} onClick={() => void setAspect(a)} className={`px-2 py-1 text-xs ${project.canvas.aspect === a ? 'bg-pink-600' : 'bg-zinc-900 hover:bg-zinc-800'}`}>
              {a}
            </button>
          ))}
        </div>
        {project.canvas.aspect === '9:16' && (
          <label className="text-xs flex items-center gap-1 text-zinc-400">
            Encuadre
            <input
              type="range"
              min={-0.5}
              max={0.5}
              step={0.01}
              value={project.reframe.offset}
              onChange={(e) => commit((p) => ({...p, reframe: {...p.reframe, offset: Number(e.target.value)}}), {history: false})}
              onPointerUp={() => commit((p) => ({...p}))}
            />
          </label>
        )}
        {notice && <span className="ml-auto text-xs text-amber-300 truncate max-w-[40%]" title={notice}>{notice}</span>}
      </div>
      {/* zona principal */}
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 flex">
            <div className="flex-1 min-w-0">
              <PlayerPanel project={project} compare={compare} setCompare={setCompare} />
            </div>
            <div className="w-[340px] shrink-0 border-l border-zinc-800 flex flex-col min-h-0">
              <div className="flex flex-wrap border-b border-zinc-800">
                {TABS.map(([t, label]) => (
                  <button key={t} onClick={() => setTab(t)} className={`px-2 py-1.5 text-xs ${tab === t ? 'text-pink-400 border-b-2 border-pink-500' : 'text-zinc-400 hover:text-white'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {job && (
                <div className="p-2">
                  <JobProgress job={job} compact />
                </div>
              )}
              <div className="flex-1 min-h-0 overflow-y-auto">
                {tab === 'propiedades' && <PropertiesPanel project={project} />}
                {tab === 'auto' && <AutoEditPanel project={project} run={run} ai={ai} />}
                {tab === 'color' && <ColorPanel project={project} run={run} compare={compare} setCompare={setCompare} />}
                {tab === 'caras' && <FacesPanel project={project} run={run} />}
                {tab === 'audio' && <AudioPanel project={project} />}
                {tab === 'exportar' && <ExportPanel project={project} run={run} />}
              </div>
            </div>
          </div>
          <div className="h-[330px] shrink-0 border-t border-zinc-800">
            <Timeline project={project} />
          </div>
        </div>
        <div className="w-[330px] shrink-0 border-l border-zinc-800">
          <ChatPanel project={project} ai={ai} onJob={setJob} />
        </div>
      </div>
      {project.previewCodec === 'h264' && browserProxyCodec() === 'vp9' && (
        <div className="text-xs text-red-300 px-3 py-1 border-t border-zinc-800">
          Este navegador no reproduce H.264/AAC (los proxies de este proyecto). Usa Chrome, Edge, Firefox o Safari para previsualizar; la exportación no se ve afectada.
        </div>
      )}
      {project.warnings.length > 0 && (
        <div className="text-xs text-amber-300 px-3 py-1 border-t border-zinc-800 truncate" title={project.warnings.join('\n')}>
          ⚠️ {project.warnings.join(' · ')}
        </div>
      )}
    </div>
  );
}
