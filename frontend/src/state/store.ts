// Estado del proyecto abierto: historial ilimitado de deshacer/rehacer y guardado automático.
// El backend valida project.json antes de guardar; si un cambio lo dejaría inválido se rechaza,
// se restaura el último estado válido y se muestra el motivo.
import {useSyncExternalStore} from 'react';
import {api, projectUrl} from '../api';
import type {Project} from '../types';
import type {Selection} from './timelineOps';

export interface EditorState {
  project: Project | null;
  past: Project[];
  future: Project[];
  selection: Selection | null;
  save: 'guardado' | 'pendiente' | 'guardando' | 'error';
  saveError: string | null;
  notice: string | null;
  version: number; // cambia en cada modificación (para la previsualización)
}

let state: EditorState = {
  project: null,
  past: [],
  future: [],
  selection: null,
  save: 'guardado',
  saveError: null,
  notice: null,
  version: 0,
};
const listeners = new Set<() => void>();
let lastSaved: Project | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> | null = null;

function emit(next: Partial<EditorState>) {
  state = {...state, ...next};
  listeners.forEach((l) => l());
}

export function useEditor<T>(sel: (s: EditorState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sel(state),
  );
}

export const getState = () => state;

export function openProject(p: Project) {
  lastSaved = p;
  emit({project: p, past: [], future: [], selection: null, save: 'guardado', saveError: null, version: state.version + 1});
}

export function closeProject() {
  emit({project: null, past: [], future: [], selection: null});
}

/** Aplica un cambio (queda en el historial y se guarda automáticamente). */
export function commit(next: Project | ((p: Project) => Project), opts: {history?: boolean} = {}) {
  const cur = state.project;
  if (!cur) return;
  const p = typeof next === 'function' ? next(cur) : next;
  if (p === cur) return;
  const history = opts.history !== false;
  emit({
    project: p,
    past: history ? [...state.past, cur] : state.past,
    future: history ? [] : state.future,
    version: state.version + 1,
  });
  scheduleSave();
}

/** Cierra un gesto (arrastrar/recortar) que se ha ido aplicando sin historial: una sola entrada. */
export function finishGesture(original: Project) {
  if (state.project && state.project !== original) {
    emit({past: [...state.past, original], future: []});
  }
}

/** Sustituye por una versión que ya ha guardado el servidor (p. ej. tras el chat): deshacible. */
const withoutMeta = (p: Project) => JSON.stringify({...p, chat: [], updatedAt: ''});

export function applyServerProject(p: Project, opts: {history?: boolean} = {history: true}) {
  const cur = state.project;
  lastSaved = p;
  // si solo cambia el historial del chat (p. ej. la IA ha hecho una pregunta) no es un paso de deshacer
  if (cur && withoutMeta(cur) === withoutMeta(p)) opts = {history: false};
  emit({
    project: p,
    past: cur && opts.history !== false ? [...state.past, cur] : state.past,
    future: opts.history !== false ? [] : state.future,
    version: state.version + 1,
    save: 'guardado',
  });
}

export function undo() {
  const {past, project} = state;
  if (!past.length || !project) return;
  const prev = {...past[past.length - 1], chat: project.chat}; // el historial del chat no se deshace
  emit({project: prev, past: past.slice(0, -1), future: [project, ...state.future], version: state.version + 1, selection: null});
  scheduleSave();
}

export function redo() {
  const {future, project} = state;
  if (!future.length || !project) return;
  const next = {...future[0], chat: project.chat};
  emit({project: next, past: [...state.past, project], future: future.slice(1), version: state.version + 1, selection: null});
  scheduleSave();
}

export function select(sel: Selection | null) {
  emit({selection: sel});
}

export function notify(msg: string | null) {
  emit({notice: msg});
  if (msg) setTimeout(() => state.notice === msg && emit({notice: null}), 6000);
}

function scheduleSave() {
  emit({save: 'pendiente'});
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushSave(), 700);
}

export async function flushSave(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (saving) await saving;
  const p = state.project;
  if (!p || p === lastSaved) {
    if (state.save !== 'guardado' && p === lastSaved) emit({save: 'guardado'});
    return;
  }
  emit({save: 'guardando'});
  saving = (async () => {
    try {
      await api.put(projectUrl(p.name), p);
      lastSaved = p;
      emit({save: state.project === p ? 'guardado' : 'pendiente', saveError: null});
    } catch (e) {
      const msg = (e as Error).message;
      // Cambio rechazado: se vuelve al último estado válido
      if (lastSaved && msg.includes('rechazado')) {
        emit({project: lastSaved, past: state.past.slice(0, -1), version: state.version + 1, save: 'error', saveError: msg});
      } else emit({save: 'error', saveError: msg});
    } finally {
      saving = null;
    }
  })();
  await saving;
}

export function setNotice(msg: string | null) {
  notify(msg);
}
