// Operaciones de edición manual sobre el proyecto. Las reglas de "ripple" son las mismas que
// backend/project_ops.py (borrar un tramo adelanta todo lo posterior).
import type {Project, Timed} from '../types';
import {segmentSpans, projectDuration} from '../remotion/timing';

export const newId = (prefix: string) => `${prefix}-${Math.random().toString(16).slice(2, 10)}`;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

type AnyTimed = Timed & {words?: {text: string; start: number; end: number}[]};

function shiftItems<T extends AnyTimed>(items: T[], start: number, end: number): T[] {
  const d = end - start;
  const out: T[] = [];
  for (const it of items) {
    const {start: s, end: e} = it;
    if (e <= start) out.push(it);
    else if (s >= end) out.push({...it, start: r3(s - d), end: r3(e - d), ...(it.words ? {words: it.words.map((w) => ({...w, start: r3(w.start - d), end: r3(w.end - d)}))} : {})});
    else if (s >= start && e <= end) continue;
    else {
      const ns = s < start ? s : start;
      const ne = e > end ? e - d : start;
      if (ne - ns < 0.1) continue;
      const next: T = {...it, start: r3(ns), end: r3(ne)};
      if (it.words) {
        const words = it.words
          .filter((w) => w.end <= start || w.start >= end)
          .map((w) => (w.start >= end ? {...w, start: r3(w.start - d), end: r3(w.end - d)} : w));
        if (!words.length) continue;
        (next as AnyTimed).words = words;
      }
      out.push(next);
    }
  }
  return out;
}

function shiftPoints<T>(items: T[], key: keyof T, start: number, end: number): T[] {
  const d = end - start;
  const out: T[] = [];
  for (const it of items) {
    const t = it[key] as unknown as number;
    if (t < start || Math.abs(t - start) < 1e-6) out.push(it);
    else if (t >= end) out.push({...it, [key]: r3(t - d)});
  }
  return out;
}

/** Elimina el tramo [start, end) del vídeo final y desplaza todo lo posterior. */
export function rippleDelete(p: Project, start: number, end: number, reason = 'tramo eliminado'): Project {
  const total = projectDuration(p);
  start = Math.max(0, start);
  end = Math.min(end, total);
  if (end - start < 0.02) return p;
  const segments = [];
  for (const {seg, start: a, end: b} of segmentSpans(p)) {
    if (b <= start || a >= end) {
      segments.push(seg);
      continue;
    }
    if (a < start) {
      const left = {...seg, outPoint: r3(seg.inPoint + (start - a))};
      if (left.outPoint - left.inPoint >= 0.04) segments.push(left);
    }
    if (b > end) {
      const right = {...seg, id: a < start ? newId('seg') : seg.id, inPoint: r3(seg.inPoint + (end - a))};
      if (right.outPoint - right.inPoint >= 0.04) segments.push(right);
    }
  }
  const cuts = shiftPoints(p.cuts, 'at', start, end).concat([{at: r3(start), reason}]).sort((x, y) => x.at - y.at);
  const speech = shiftItems(
    p.audio.speech.map(([a, b], i) => ({id: String(i), start: a, end: b})),
    start,
    end,
  ).map((x) => [x.start, x.end] as [number, number]);
  return {
    ...p,
    segments,
    texts: shiftItems(p.texts, start, end),
    emojis: shiftItems(p.emojis, start, end),
    zooms: shiftItems(p.zooms, start, end),
    captions: {...p.captions, blocks: shiftItems(p.captions.blocks, start, end)},
    faces: {...p.faces, pixelate: shiftItems(p.faces.pixelate, start, end)},
    transitions: shiftPoints(p.transitions, 'at', start, end),
    audio: {...p.audio, sfx: shiftPoints(p.audio.sfx, 'at', start, end), speech},
    cuts,
  };
}

/** Inserta tiempo en `at` desplazando todo lo posterior (al alargar un segmento). */
function rippleInsert(p: Project, at: number, d: number): Project {
  const mv = <T extends AnyTimed>(items: T[]) =>
    items.map((it) =>
      it.start >= at
        ? {...it, start: r3(it.start + d), end: r3(it.end + d), ...(it.words ? {words: it.words.map((w) => ({...w, start: r3(w.start + d), end: r3(w.end + d)}))} : {})}
        : it,
    );
  const mvp = <T>(items: T[], key: keyof T) =>
    items.map((it) => ((it[key] as unknown as number) >= at ? {...it, [key]: r3((it[key] as unknown as number) + d)} : it));
  return {
    ...p,
    texts: mv(p.texts),
    emojis: mv(p.emojis),
    zooms: mv(p.zooms),
    captions: {...p.captions, blocks: mv(p.captions.blocks)},
    faces: {...p.faces, pixelate: mv(p.faces.pixelate)},
    transitions: mvp(p.transitions, 'at'),
    audio: {...p.audio, sfx: mvp(p.audio.sfx, 'at')},
    cuts: mvp(p.cuts, 'at'),
  };
}

export function splitAt(p: Project, t: number): Project {
  const segments = [];
  let did = false;
  for (const {seg, start: a, end: b} of segmentSpans(p)) {
    if (a + 0.04 < t && t < b - 0.04) {
      const cut = r3(seg.inPoint + (t - a));
      segments.push({...seg, outPoint: cut});
      segments.push({...seg, id: newId('seg'), inPoint: cut});
      did = true;
    } else segments.push(seg);
  }
  if (!did) return p;
  return {...p, segments, cuts: [...p.cuts, {at: r3(t), reason: 'división manual'}].sort((x, y) => x.at - y.at)};
}

/** Recorta un segmento de vídeo por un borde (ripple): todo lo posterior se mueve. */
export function trimSegment(p: Project, segId: string, edge: 'in' | 'out', newValue: number): Project {
  const spans = segmentSpans(p);
  const sp = spans.find((s) => s.seg.id === segId);
  if (!sp) return p;
  const src = p.sources.find((s) => s.id === sp.seg.sourceId);
  if (!src) return p;
  const seg = sp.seg;
  if (edge === 'in') {
    const v = Math.max(0, Math.min(newValue, seg.outPoint - 0.1));
    const delta = v - seg.inPoint;
    if (Math.abs(delta) < 0.01) return p;
    if (delta > 0) {
      return rippleDelete(p, sp.start, sp.start + delta, 'recorte manual');
    }
    const q = rippleInsert(p, sp.start - 1e-6, -delta);
    return {...q, segments: q.segments.map((s) => (s.id === segId ? {...s, inPoint: r3(v)} : s))};
  }
  const v = Math.min(src.duration, Math.max(newValue, seg.inPoint + 0.1));
  const delta = v - seg.outPoint;
  if (Math.abs(delta) < 0.01) return p;
  if (delta < 0) return rippleDelete(p, sp.end + delta, sp.end, 'recorte manual');
  const q = rippleInsert(p, sp.end - 1e-6, delta);
  return {...q, segments: q.segments.map((s) => (s.id === segId ? {...s, outPoint: r3(v)} : s))};
}

export type ItemKind = 'segment' | 'caption' | 'text' | 'emoji' | 'zoom' | 'transition' | 'pixelate' | 'sfx' | 'music';

export interface Selection {
  kind: ItemKind;
  id: string;
}

export function deleteItem(p: Project, sel: Selection): Project {
  switch (sel.kind) {
    case 'segment': {
      const sp = segmentSpans(p).find((s) => s.seg.id === sel.id);
      if (!sp || p.segments.length <= 1) return p;
      return rippleDelete(p, sp.start, sp.end, 'segmento eliminado');
    }
    case 'caption':
      return {...p, captions: {...p.captions, blocks: p.captions.blocks.filter((b) => b.id !== sel.id)}};
    case 'text':
      return {...p, texts: p.texts.filter((x) => x.id !== sel.id)};
    case 'emoji':
      return {...p, emojis: p.emojis.filter((x) => x.id !== sel.id)};
    case 'zoom':
      return {...p, zooms: p.zooms.filter((x) => x.id !== sel.id)};
    case 'transition':
      return {...p, transitions: p.transitions.filter((x) => x.id !== sel.id)};
    case 'pixelate':
      return {...p, faces: {...p.faces, pixelate: p.faces.pixelate.filter((x) => x.id !== sel.id)}};
    case 'sfx':
      return {...p, audio: {...p.audio, sfx: p.audio.sfx.filter((x) => x.id !== sel.id)}};
    case 'music':
      return {...p, audio: {...p.audio, music: null}};
  }
}

export function duplicateItem(p: Project, sel: Selection): {project: Project; id?: string} {
  const dup = <T extends Timed>(items: T[], prefix: string) => {
    const it = items.find((x) => x.id === sel.id);
    if (!it) return {items, id: undefined};
    const d = it.end - it.start;
    const copy = {...JSON.parse(JSON.stringify(it)), id: newId(prefix), start: r3(it.end), end: r3(it.end + d)};
    return {items: [...items, copy], id: copy.id as string};
  };
  switch (sel.kind) {
    case 'text': {
      const r = dup(p.texts, 'txt');
      return {project: {...p, texts: r.items}, id: r.id};
    }
    case 'emoji': {
      const r = dup(p.emojis, 'emo');
      return {project: {...p, emojis: r.items}, id: r.id};
    }
    case 'zoom': {
      const r = dup(p.zooms, 'zoom');
      return {project: {...p, zooms: r.items}, id: r.id};
    }
    case 'pixelate': {
      const r = dup(p.faces.pixelate, 'pix');
      return {project: {...p, faces: {...p.faces, pixelate: r.items}}, id: r.id};
    }
    default:
      return {project: p};
  }
}

/** Mueve o recorta un elemento con tiempo (no segmentos de vídeo). */
export function setItemTimes(p: Project, sel: Selection, start: number, end?: number): Project {
  const total = projectDuration(p);
  const fix = <T extends Timed>(it: T): T => {
    const d = it.end - it.start;
    let s = Math.max(0, Math.min(start, total - 0.05));
    let e = end === undefined ? s + d : end;
    e = Math.min(Math.max(e, s + 0.1), total + 5);
    s = r3(s);
    e = r3(e);
    return {...it, start: s, end: e};
  };
  const upd = <T extends Timed>(items: T[]) => items.map((x) => (x.id === sel.id ? fix(x) : x));
  switch (sel.kind) {
    case 'text':
      return {...p, texts: upd(p.texts)};
    case 'emoji':
      return {...p, emojis: upd(p.emojis)};
    case 'zoom':
      return {...p, zooms: upd(p.zooms)};
    case 'pixelate':
      return {...p, faces: {...p.faces, pixelate: upd(p.faces.pixelate)}};
    case 'transition':
      return {...p, transitions: p.transitions.map((x) => (x.id === sel.id ? {...x, at: r3(Math.max(0, Math.min(start, total)))} : x))};
    case 'sfx':
      return {...p, audio: {...p.audio, sfx: p.audio.sfx.map((x) => (x.id === sel.id ? {...x, at: r3(Math.max(0, Math.min(start, total)))} : x))}};
    case 'caption':
      // los subtítulos van pegados a la voz: se pueden recortar (fin) pero no desplazar las palabras
      return {
        ...p,
        captions: {
          ...p.captions,
          blocks: p.captions.blocks.map((b) => (b.id === sel.id ? {...b, start: r3(Math.max(0, start)), end: r3(end ?? b.end)} : b)),
        },
      };
    default:
      return p;
  }
}
