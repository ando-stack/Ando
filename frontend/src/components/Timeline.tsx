// Timeline propia por pistas: vídeo, subtítulos, textos, emojis, zooms, transiciones, color,
// pixelado, música y efectos de sonido. Seleccionar, mover, recortar, duplicar y borrar.
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {api} from '../api';
import {commit, finishGesture, getState, select, useEditor} from '../state/store';
import {player, usePlayerTime, fmt} from '../state/player';
import {setItemTimes, trimSegment, type ItemKind, type Selection} from '../state/timelineOps';
import {projectDuration, segmentSpans, sourceRangeToOutput} from '../remotion/timing';
import type {Project, TrackName} from '../types';

const TRACK_INFO: Record<TrackName, {label: string; icon: string; h: number; color: string}> = {
  video: {label: 'Vídeo', icon: '🎞️', h: 48, color: 'bg-sky-700'},
  subtitulos: {label: 'Subtítulos', icon: '💬', h: 26, color: 'bg-amber-600'},
  textos: {label: 'Textos', icon: '🔤', h: 26, color: 'bg-fuchsia-700'},
  emojis: {label: 'Emojis', icon: '😀', h: 26, color: 'bg-yellow-600'},
  zooms: {label: 'Efectos / zooms', icon: '🔍', h: 26, color: 'bg-emerald-700'},
  transiciones: {label: 'Transiciones', icon: '✨', h: 24, color: 'bg-violet-600'},
  color: {label: 'Color', icon: '🎨', h: 22, color: 'bg-orange-700'},
  pixelado: {label: 'Pixelado', icon: '🟦', h: 26, color: 'bg-blue-700'},
  musica: {label: 'Música', icon: '🎵', h: 26, color: 'bg-teal-700'},
  sfx: {label: 'Efectos de sonido', icon: '🔊', h: 24, color: 'bg-lime-700'},
};
const ORDER: TrackName[] = ['video', 'subtitulos', 'textos', 'emojis', 'zooms', 'transiciones', 'color', 'pixelado', 'musica', 'sfx'];
const HEADER_W = 150;

interface Block {
  kind: ItemKind;
  id: string;
  start: number;
  end: number;
  label: string;
  title?: string;
  movable: boolean;
  resizable: boolean;
  point?: boolean;
}

function blocksFor(p: Project, track: TrackName): Block[] {
  switch (track) {
    case 'video':
      return segmentSpans(p).map((s) => {
        const src = p.sources.find((x) => x.id === s.seg.sourceId);
        return {kind: 'segment', id: s.seg.id, start: s.start, end: s.end, label: src?.name ?? '', title: `${src?.name} [${s.seg.inPoint.toFixed(2)}–${s.seg.outPoint.toFixed(2)} s]`, movable: false, resizable: true};
      });
    case 'subtitulos':
      return p.captions.blocks.map((b) => ({kind: 'caption', id: b.id, start: b.start, end: b.end, label: b.words.map((w) => w.text).join(' '), movable: false, resizable: true}));
    case 'textos':
      return p.texts.map((t) => ({kind: 'text', id: t.id, start: t.start, end: t.end, label: t.text, movable: true, resizable: true}));
    case 'emojis':
      return p.emojis.map((e) => ({kind: 'emoji', id: e.id, start: e.start, end: e.end, label: e.emoji, movable: true, resizable: true}));
    case 'zooms':
      return p.zooms.map((z) => ({kind: 'zoom', id: z.id, start: z.start, end: z.end, label: `${z.kind === 'punch' ? '✂︎' : '🔍'} ×${z.scale.toFixed(2)}`, movable: true, resizable: true}));
    case 'transiciones':
      return p.transitions.map((t) => ({kind: 'transition', id: t.id, start: t.at - t.duration / 2, end: t.at + t.duration / 2, label: t.type, movable: true, resizable: false, point: true}));
    case 'pixelado':
      return p.faces.pixelate.map((x) => ({kind: 'pixelate', id: x.id, start: x.start, end: x.end, label: `${x.mode === 'blur' ? 'desenfoque' : 'pixelado'} · ${p.faces.tracks.find((t) => t.id === x.faceId)?.label ?? x.faceId}`, movable: true, resizable: true}));
    case 'musica': {
      const m = p.audio.music;
      if (!m) return [];
      const total = projectDuration(p);
      return [{kind: 'music', id: 'music', start: m.start, end: Math.min(m.end ?? total, total), label: `${m.file} · vol ${m.volume.toFixed(2)}`, movable: false, resizable: false}];
    }
    case 'sfx':
      return p.audio.sfx.map((s) => ({kind: 'sfx', id: s.id, start: s.at, end: s.at + 0.6, label: s.file, movable: true, resizable: false}));
    default:
      return [];
  }
}

// ---------------------------------------------------------------- forma de onda
const waveCache = new Map<string, Promise<{rate: number; peaks: number[]}>>();
function getWave(name: string, sourceId: string) {
  const k = `${name}/${sourceId}`;
  if (!waveCache.has(k)) waveCache.set(k, api.get(`/api/projects/${encodeURIComponent(name)}/waveform/${sourceId}`));
  return waveCache.get(k)!;
}

const Waveform: React.FC<{project: string; sourceId: string; inPoint: number; outPoint: number; width: number; height: number}> = ({project, sourceId, inPoint, outPoint, width, height}) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    getWave(project, sourceId)
      .then((w) => {
        const c = ref.current;
        if (!alive || !c) return;
        const ctx = c.getContext('2d')!;
        c.width = Math.max(1, Math.round(width));
        c.height = height;
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        for (let x = 0; x < c.width; x++) {
          const t0 = inPoint + ((outPoint - inPoint) * x) / c.width;
          const t1 = inPoint + ((outPoint - inPoint) * (x + 1)) / c.width;
          let m = 0;
          for (let i = Math.floor(t0 * w.rate); i <= Math.ceil(t1 * w.rate) && i < w.peaks.length; i++) m = Math.max(m, w.peaks[i] ?? 0);
          const h = Math.max(1, m * height * 0.9);
          ctx.fillRect(x, (height - h) / 2, 1, h);
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [project, sourceId, inPoint, outPoint, width, height]);
  return <canvas ref={ref} className="absolute inset-0 pointer-events-none" style={{width, height}} />;
};

// ---------------------------------------------------------------- componente
export function Timeline({project}: {project: Project}) {
  const selection = useEditor((s) => s.selection);
  const time = usePlayerTime();
  const total = Math.max(0.1, projectDuration(project));
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pps, setPps] = useState<number | null>(null); // píxeles por segundo
  const [viewW, setViewW] = useState(800);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = pps ?? Math.max(10, (viewW - 20) / total);
  const width = Math.max(viewW, total * scale + 40);

  // seguir el cabezal durante la reproducción
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = time * scale;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - 60);
  }, [time, scale]);

  const zoomBy = (f: number) => setPps(Math.min(600, Math.max(4, scale * f)));

  const unreliable = useMemo(() => {
    const out: [number, number][] = [];
    for (const u of project.faces.unreliable) out.push(...sourceRangeToOutput(project, u.sourceId, u.start, u.end));
    return out;
  }, [project]);

  const timeFromEvent = (e: React.PointerEvent | PointerEvent) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, (e.clientX - r.left + el.scrollLeft) / scale);
  };

  function onRulerDown(e: React.PointerEvent) {
    player.pause();
    player.seek(Math.min(total, timeFromEvent(e)));
    const move = (ev: PointerEvent) => player.seek(Math.min(total, timeFromEvent(ev)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function onBlockDown(e: React.PointerEvent, b: Block, mode: 'move' | 'left' | 'right') {
    e.stopPropagation();
    const sel: Selection = {kind: b.kind, id: b.id};
    select(sel);
    if (mode === 'move' && !b.movable) {
      player.seek(timeFromEvent(e));
      return;
    }
    const original = getState().project!;
    const t0 = timeFromEvent(e);
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dt = timeFromEvent(ev) - t0;
      if (Math.abs(dt) * scale < 3 && !moved) return;
      moved = true;
      if (b.kind === 'segment') {
        const seg = original.segments.find((s) => s.id === b.id)!;
        commit(trimSegment(original, b.id, mode === 'left' ? 'in' : 'out', mode === 'left' ? seg.inPoint + dt : seg.outPoint + dt), {history: false});
        return;
      }
      if (b.point) {
        const tr = original.transitions.find((x) => x.id === b.id);
        commit(setItemTimes(original, sel, (tr ? tr.at : b.start) + dt), {history: false});
        return;
      }
      if (mode === 'move') commit(setItemTimes(original, sel, b.start + dt), {history: false});
      else if (mode === 'left') commit(setItemTimes(original, sel, Math.min(b.start + dt, b.end - 0.1), b.end), {history: false});
      else commit(setItemTimes(original, sel, b.start, Math.max(b.end + dt, b.start + 0.1)), {history: false});
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) finishGesture(original);
      else player.seek(timeFromEvent(e));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const toggleTrack = (t: TrackName) =>
    commit((p) => ({...p, tracks: {...p.tracks, [t]: {enabled: !p.tracks[t].enabled}}}));

  const ticks = useMemo(() => {
    const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = steps.find((s) => s * scale >= 70) ?? 600;
    const out = [];
    for (let t = 0; t <= total + step; t += step) out.push(t);
    return out;
  }, [scale, total]);

  return (
    <div className="h-full flex flex-col bg-zinc-950 select-none">
      <div className="flex items-center gap-2 px-3 py-1 border-b border-zinc-800 text-xs text-zinc-400">
        <span>Línea de tiempo</span>
        <button className="px-2 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => zoomBy(1 / 1.5)} title="Alejar (−)">−</button>
        <button className="px-2 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => zoomBy(1.5)} title="Acercar (+)">+</button>
        <button className="px-2 rounded bg-zinc-800 hover:bg-zinc-700" onClick={() => setPps(null)}>Ajustar</button>
        <span className="ml-auto">Clic: seleccionar · Arrastrar: mover · Bordes: recortar · S: dividir · Supr: borrar · Ctrl+D: duplicar</span>
      </div>
      <div className="flex-1 min-h-0 flex overflow-y-auto">
        <div className="shrink-0 border-r border-zinc-800" style={{width: HEADER_W}}>
          <div className="h-6 border-b border-zinc-800" />
          {ORDER.map((t) => (
            <div key={t} className="flex items-center gap-1 px-2 border-b border-zinc-900 text-xs" style={{height: TRACK_INFO[t].h}}>
              <button
                onClick={() => toggleTrack(t)}
                title={project.tracks[t].enabled ? 'Desactivar pista' : 'Activar pista'}
                className={`w-5 ${project.tracks[t].enabled ? '' : 'opacity-30'}`}
              >
                {project.tracks[t].enabled ? '👁' : '🚫'}
              </button>
              <span className={project.tracks[t].enabled ? 'text-zinc-300' : 'text-zinc-600 line-through'}>
                {TRACK_INFO[t].icon} {TRACK_INFO[t].label}
              </span>
            </div>
          ))}
        </div>
        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto overflow-y-hidden relative"
          onWheel={(e) => {
            if (e.ctrlKey) {
              e.preventDefault();
              zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2);
            }
          }}
        >
          <div style={{width}} className="relative">
            {/* regla */}
            <div className="h-6 border-b border-zinc-800 relative cursor-pointer" onPointerDown={onRulerDown}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full border-l border-zinc-700 text-[10px] text-zinc-500 pl-1" style={{left: t * scale}}>
                  {fmt(t).replace(/\.0$/, '')}
                </div>
              ))}
              {project.cuts.map((c, i) => (
                <div key={i} className="absolute bottom-0 w-px h-2 bg-red-500" style={{left: c.at * scale}} title={`Corte: ${c.reason} (${fmt(c.at)})`} />
              ))}
            </div>
            {ORDER.map((track) => {
              const info = TRACK_INFO[track];
              const enabled = project.tracks[track].enabled;
              const blocks = track === 'color' ? [] : blocksFor(project, track);
              return (
                <div
                  key={track}
                  className={`relative border-b border-zinc-900 ${enabled ? '' : 'opacity-40'}`}
                  style={{height: info.h}}
                  onPointerDown={(e) => {
                    select(null);
                    onRulerDown(e);
                  }}
                >
                  {track === 'color' && (
                    <div
                      className={`absolute top-0.5 bottom-0.5 rounded text-[10px] px-2 flex items-center truncate ${project.color.enabled ? info.color : 'bg-zinc-800 text-zinc-500'}`}
                      style={{left: 0, width: total * scale}}
                      title={project.color.message}
                    >
                      {project.color.enabled
                        ? `LUT ${Math.round(project.color.intensity * 100)} % · temp ${project.color.temperature.toFixed(2)} · exp ${project.color.exposure.toFixed(2)}`
                        : project.color.analyzed
                          ? project.color.needsCorrection
                            ? 'Corrección disponible (desactivada)'
                            : 'Iluminación correcta: sin corrección'
                          : 'Sin analizar'}
                    </div>
                  )}
                  {track === 'pixelado' &&
                    unreliable.map(([a, b], i) => (
                      <div key={i} className="absolute top-0 bottom-0 stripes" style={{left: a * scale, width: Math.max(2, (b - a) * scale)}} title="Detección de caras poco fiable en este tramo: revísalo" />
                    ))}
                  {blocks.map((b) => {
                    const sel = selection?.id === b.id;
                    const left = b.start * scale;
                    const w = Math.max(b.point ? 8 : 3, (b.end - b.start) * scale);
                    const seg = b.kind === 'segment' ? project.segments.find((s) => s.id === b.id) : null;
                    return (
                      <div
                        key={b.id}
                        title={b.title ?? `${b.label} (${fmt(b.start)}–${fmt(b.end)})`}
                        onPointerDown={(e) => onBlockDown(e, b, 'move')}
                        className={`absolute top-0.5 bottom-0.5 rounded overflow-hidden text-[11px] leading-none flex items-center ${info.color} ${sel ? 'ring-2 ring-white z-10' : 'ring-1 ring-black/40'} ${b.movable ? 'cursor-grab' : 'cursor-pointer'} ${b.point ? 'rotate-0 justify-center' : 'px-1'}`}
                        style={{left, width: w}}
                      >
                        {seg && (
                          <Waveform project={project.name} sourceId={seg.sourceId} inPoint={seg.inPoint} outPoint={seg.outPoint} width={w} height={info.h - 4} />
                        )}
                        <span className={`relative truncate ${track === 'emojis' ? 'text-base' : ''}`}>{b.label}</span>
                        {b.resizable && w > 10 && (
                          <>
                            <div className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/50" onPointerDown={(e) => onBlockDown(e, b, 'left')} />
                            <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/50" onPointerDown={(e) => onBlockDown(e, b, 'right')} />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {/* cabezal */}
            <div className="absolute top-0 bottom-0 w-px bg-pink-500 pointer-events-none z-20" style={{left: time * scale}}>
              <div className="w-3 h-3 -ml-1.5 bg-pink-500 rotate-45 -mt-1" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
