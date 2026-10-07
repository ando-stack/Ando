// Panel de propiedades: edita el elemento seleccionado en la timeline o añade elementos nuevos.
import {useState} from 'react';
import {commit, select, useEditor} from '../state/store';
import {player, fmt} from '../state/player';
import {deleteItem, duplicateItem, newId, splitAt} from '../state/timelineOps';
import {projectDuration, segmentSpans} from '../remotion/timing';
import type {Animation, CaptionStyle, EmojiItem, Project, TextItem, TransitionType} from '../types';
import {Btn, Check, ColorField, Num, Section, Select, Text, useLibrary} from './fields';

const ANIMS: [Animation, string][] = [
  ['pop', 'Pop'],
  ['fade', 'Fundido'],
  ['slide-up', 'Deslizar arriba'],
  ['slide-left', 'Deslizar lateral'],
  ['typewriter', 'Máquina de escribir'],
  ['bounce', 'Rebote'],
  ['none', 'Ninguna'],
];
const FONTS: [string, string][] = [
  ['Montserrat', 'Montserrat'],
  ['Anton', 'Anton'],
  ['BebasNeue', 'Bebas Neue'],
  ['Poppins', 'Poppins'],
  ['Inter', 'Inter'],
];
const TRANS: [TransitionType, string][] = [
  ['fade', 'Fundido a negro'],
  ['flash', 'Destello'],
  ['zoom', 'Zoom'],
  ['whip', 'Barrido'],
  ['glitch', 'Glitch'],
];

function updateIn<T extends {id: string}>(items: T[], id: string, patch: Partial<T>): T[] {
  return items.map((x) => (x.id === id ? {...x, ...patch} : x));
}

export function PropertiesPanel({project}: {project: Project}) {
  const sel = useEditor((s) => s.selection);
  const lib = useLibrary();
  const total = projectDuration(project);
  const [emojiFilter, setEmojiFilter] = useState('');

  const timeFields = (start: number, end: number, onChange: (s: number, e: number) => void) => (
    <>
      <Num label="Inicio (s)" value={start} min={0} max={total} step={0.05} onChange={(v) => onChange(v, Math.max(v + 0.1, end))} />
      <Num label="Fin (s)" value={end} min={0} max={total + 2} step={0.05} onChange={(v) => onChange(start, Math.max(start + 0.1, v))} />
    </>
  );
  const actions = (
    <div className="flex gap-2 mt-2">
      <Btn onClick={() => sel && commit((p) => duplicateItem(p, sel).project)}>Duplicar (Ctrl+D)</Btn>
      <Btn variant="danger" onClick={() => sel && (commit((p) => deleteItem(p, sel)), select(null))}>
        Eliminar (Supr)
      </Btn>
    </div>
  );

  const add = {
    text: () => {
      const t = player.time;
      const it: TextItem = {
        id: newId('txt'), start: t, end: Math.min(t + 2.5, total), text: 'Nuevo texto', kind: 'texto', x: 0.5, y: 0.25, animation: 'pop',
        style: {font: 'Montserrat', fontSize: 0.07, color: '#FFFFFF', background: '#E6007ED9', strokeColor: null, bold: true, uppercase: false},
      };
      commit((p) => ({...p, texts: [...p.texts, it]}));
      select({kind: 'text', id: it.id});
    },
    emoji: (e = '🔥') => {
      const t = player.time;
      const entry = lib?.emojis.find((x) => x.emoji === e) ?? lib?.emojis[0];
      if (!entry) return;
      const it: EmojiItem = {id: newId('emo'), start: t, end: Math.min(t + 1.5, total), emoji: entry.emoji, file: entry.file, x: 0.8, y: 0.3, size: 0.14, rotation: 0, animation: 'pop'};
      commit((p) => ({...p, emojis: [...p.emojis, it]}));
      select({kind: 'emoji', id: it.id});
    },
    zoom: () => {
      const t = player.time;
      const id = newId('zoom');
      commit((p) => ({...p, zooms: [...p.zooms, {id, start: t, end: Math.min(t + 2, total), kind: 'smooth', scale: 1.2, x: 0.5, y: 0.42}]}));
      select({kind: 'zoom', id});
    },
    transition: () => {
      const cuts = segmentSpans(project).slice(0, -1).map((s) => s.end);
      if (!cuts.length) return;
      const at = cuts.reduce((a, b) => (Math.abs(b - player.time) < Math.abs(a - player.time) ? b : a));
      const id = newId('trans');
      commit((p) => ({...p, transitions: [...p.transitions, {id, at, duration: 0.4, type: 'fade'}]}));
      select({kind: 'transition', id});
    },
    sfx: () => {
      if (!lib?.sfx.length) return;
      const id = newId('sfx');
      commit((p) => ({...p, audio: {...p.audio, sfx: [...p.audio.sfx, {id, file: lib.sfx[0], at: player.time, volume: 0.6}]}}));
      select({kind: 'sfx', id});
    },
  };

  const captionStyle = (st: CaptionStyle) => {
    const set = (patch: Partial<CaptionStyle>) => commit((p) => ({...p, captions: {...p.captions, style: {...p.captions.style, ...patch}}}));
    return (
      <Section title="Estilo de los subtítulos">
        <Select label="Estilo" value={st.preset} options={[['tiktok', 'TikTok (palabra resaltada)'], ['karaoke', 'Karaoke'], ['clasico', 'Clásico'], ['neon', 'Neón'], ['minimal', 'Minimalista']]} onChange={(v) => set({preset: v})} />
        <Select label="Fuente" value={st.font} options={FONTS} onChange={(v) => set({font: v})} />
        <Num label="Tamaño" value={st.fontSize} min={0.02} max={0.2} onChange={(v) => set({fontSize: v})} />
        <Num label="Posición vertical" value={st.y} min={0.05} max={0.95} onChange={(v) => set({y: v})} />
        <ColorField label="Color" value={st.color} onChange={(v) => v && set({color: v})} />
        <ColorField label="Resaltado" value={st.highlightColor} onChange={(v) => v && set({highlightColor: v})} />
        <ColorField label="Contorno" value={st.strokeColor} onChange={(v) => v && set({strokeColor: v})} />
        <Check label="Fondo" value={st.background} onChange={(v) => set({background: v})} />
        <Check label="Mayúsculas" value={st.uppercase} onChange={(v) => set({uppercase: v})} />
      </Section>
    );
  };

  if (!sel) {
    return (
      <div className="p-3 text-sm">
        <Section title="Añadir en el cabezal">
          <div className="flex flex-wrap gap-2">
            <Btn onClick={add.text}>🔤 Texto</Btn>
            <Btn onClick={() => add.emoji()}>😀 Emoji</Btn>
            <Btn onClick={add.zoom}>🔍 Zoom</Btn>
            <Btn onClick={add.transition}>✨ Transición</Btn>
            <Btn onClick={add.sfx} disabled={!lib?.sfx.length} title={lib?.sfx.length ? '' : 'Pon archivos en /assets/sfx'}>
              🔊 Efecto
            </Btn>
            <Btn onClick={() => commit((p) => splitAt(p, player.time))}>✂︎ Dividir clip (S)</Btn>
          </div>
        </Section>
        {captionStyle(project.captions.style)}
        <p className="text-xs text-zinc-500">Selecciona un elemento en la línea de tiempo para editarlo.</p>
      </div>
    );
  }

  const p = project;
  let body: React.ReactNode = <p className="text-xs text-zinc-500">Elemento no encontrado.</p>;
  switch (sel.kind) {
    case 'text': {
      const it = p.texts.find((x) => x.id === sel.id);
      if (!it) break;
      const set = (patch: Partial<TextItem>) => commit((q) => ({...q, texts: updateIn(q.texts, it.id, patch)}));
      const setStyle = (patch: Partial<TextItem['style']>) => set({style: {...it.style, ...patch}});
      body = (
        <Section title={`Texto · ${fmt(it.start)}`}>
          <Text label="Texto" value={it.text} onChange={(v) => set({text: v})} area />
          <Select label="Tipo" value={it.kind} options={[['titulo', 'Título'], ['texto', 'Texto clave'], ['dato', 'Dato']]} onChange={(v) => set({kind: v})} />
          {timeFields(it.start, it.end, (s, e) => set({start: s, end: e}))}
          <Num label="Posición X" value={it.x} min={0} max={1} onChange={(v) => set({x: v})} />
          <Num label="Posición Y" value={it.y} min={0} max={1} onChange={(v) => set({y: v})} />
          <Select label="Animación" value={it.animation} options={ANIMS} onChange={(v) => set({animation: v})} />
          <Select label="Fuente" value={it.style.font} options={FONTS} onChange={(v) => setStyle({font: v})} />
          <Num label="Tamaño" value={it.style.fontSize} min={0.02} max={0.3} onChange={(v) => setStyle({fontSize: v})} />
          <ColorField label="Color" value={it.style.color} onChange={(v) => v && setStyle({color: v})} />
          <ColorField label="Fondo" value={it.style.background} allowNone onChange={(v) => setStyle({background: v})} />
          <ColorField label="Contorno" value={it.style.strokeColor} allowNone onChange={(v) => setStyle({strokeColor: v})} />
          <Check label="Mayúsculas" value={it.style.uppercase} onChange={(v) => setStyle({uppercase: v})} />
          {actions}
        </Section>
      );
      break;
    }
    case 'emoji': {
      const it = p.emojis.find((x) => x.id === sel.id);
      if (!it) break;
      const set = (patch: Partial<EmojiItem>) => commit((q) => ({...q, emojis: updateIn(q.emojis, it.id, patch)}));
      const list = (lib?.emojis ?? []).filter((e) => !emojiFilter || e.keywords.includes(emojiFilter.toLowerCase()));
      body = (
        <Section title={`Emoji ${it.emoji} · ${fmt(it.start)}`}>
          <input placeholder="Buscar emoji (p. ej. risa, dinero)…" value={emojiFilter} onChange={(e) => setEmojiFilter(e.target.value)} className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs mb-1" />
          <div className="grid grid-cols-10 gap-0.5 max-h-28 overflow-auto mb-2">
            {list.map((e) => (
              <button key={e.file} title={e.keywords} onClick={() => set({emoji: e.emoji, file: e.file})} className={`text-lg rounded hover:bg-zinc-700 ${e.emoji === it.emoji ? 'bg-pink-700' : ''}`}>
                {e.emoji}
              </button>
            ))}
          </div>
          {timeFields(it.start, it.end, (s, e) => set({start: s, end: e}))}
          <Num label="Posición X" value={it.x} min={0} max={1} onChange={(v) => set({x: v})} />
          <Num label="Posición Y" value={it.y} min={0} max={1} onChange={(v) => set({y: v})} />
          <Num label="Tamaño" value={it.size} min={0.03} max={0.6} onChange={(v) => set({size: v})} />
          <Num label="Rotación" value={it.rotation} min={-180} max={180} step={1} onChange={(v) => set({rotation: v})} />
          <Select label="Animación" value={it.animation} options={ANIMS} onChange={(v) => set({animation: v})} />
          {actions}
        </Section>
      );
      break;
    }
    case 'zoom': {
      const it = p.zooms.find((x) => x.id === sel.id);
      if (!it) break;
      const set = (patch: Partial<typeof it>) => commit((q) => ({...q, zooms: updateIn(q.zooms, it.id, patch)}));
      body = (
        <Section title={`Zoom · ${fmt(it.start)}`}>
          <Select label="Tipo" value={it.kind} options={[['smooth', 'Suave (acercamiento)'], ['punch', 'Punch-in (directo)']]} onChange={(v) => set({kind: v})} />
          {timeFields(it.start, it.end, (s, e) => set({start: s, end: e}))}
          <Num label="Escala" value={it.scale} min={1} max={2.5} onChange={(v) => set({scale: v})} />
          <Num label="Enfoque X" value={it.x} min={0} max={1} onChange={(v) => set({x: v})} />
          <Num label="Enfoque Y" value={it.y} min={0} max={1} onChange={(v) => set({y: v})} />
          {actions}
        </Section>
      );
      break;
    }
    case 'transition': {
      const it = p.transitions.find((x) => x.id === sel.id);
      if (!it) break;
      const set = (patch: Partial<typeof it>) => commit((q) => ({...q, transitions: updateIn(q.transitions, it.id, patch)}));
      body = (
        <Section title={`Transición · ${fmt(it.at)}`}>
          <Select label="Tipo" value={it.type} options={TRANS} onChange={(v) => set({type: v})} />
          <Num label="Duración (s)" value={it.duration} min={0.1} max={2} onChange={(v) => set({duration: v})} />
          <Num label="Momento (s)" value={it.at} min={0} max={total} step={0.05} onChange={(v) => set({at: v})} />
          {actions}
        </Section>
      );
      break;
    }
    case 'caption': {
      const it = p.captions.blocks.find((x) => x.id === sel.id);
      if (!it) break;
      const setText = (v: string) => {
        const words = v.split(/\s+/).filter(Boolean);
        if (!words.length) return;
        // si el número de palabras no cambia se conservan los tiempos de cada palabra
        const same = words.length === it.words.length;
        const step = (it.end - it.start) / words.length;
        commit((q) => ({
          ...q,
          captions: {
            ...q.captions,
            blocks: updateIn(q.captions.blocks, it.id, {
              words: words.map((w, i) => (same ? {...it.words[i], text: w} : {text: w, start: it.start + i * step, end: it.start + (i + 1) * step})),
            }),
          },
        }));
      };
      body = (
        <>
          <Section title={`Subtítulo · ${fmt(it.start)}`}>
            <Text label="Texto" value={it.words.map((w) => w.text).join(' ')} onChange={setText} area />
            {actions}
          </Section>
          {captionStyle(p.captions.style)}
        </>
      );
      break;
    }
    case 'segment': {
      const sp = segmentSpans(p).find((s) => s.seg.id === sel.id);
      if (!sp) break;
      const src = p.sources.find((s) => s.id === sp.seg.sourceId);
      const set = (patch: Partial<typeof sp.seg>) => commit((q) => ({...q, segments: updateIn(q.segments, sp.seg.id, patch)}));
      body = (
        <Section title={`Clip · ${src?.name}`}>
          <div className="text-xs text-zinc-400 mb-1">
            Fuente: {sp.seg.inPoint.toFixed(2)}–{sp.seg.outPoint.toFixed(2)} s · en el vídeo: {fmt(sp.start)}–{fmt(sp.end)}
            <br />
            {src?.width}×{src?.height} · {src?.fps} fps · {src?.videoCodec}
          </div>
          <Num label="Volumen" value={sp.seg.volume} min={0} max={3} onChange={(v) => set({volume: v})} />
          {p.canvas.aspect === '9:16' && (
            <>
              <Num label="Encuadre X (9:16)" value={sp.seg.reframeX ?? 0.5} min={0} max={1} onChange={(v) => set({reframeX: v})} />
              <Btn onClick={() => set({reframeX: null})}>Encuadre automático</Btn>
            </>
          )}
          <div className="flex gap-2 mt-2">
            <Btn onClick={() => commit((q) => splitAt(q, player.time))}>✂︎ Dividir en el cabezal (S)</Btn>
            <Btn variant="danger" onClick={() => (commit((q) => deleteItem(q, sel)), select(null))} disabled={p.segments.length <= 1}>
              Eliminar tramo
            </Btn>
          </div>
          <p className="text-[11px] text-zinc-500 mt-2">Arrastra los bordes del clip en la timeline para recortarlo: lo que va detrás se desplaza.</p>
        </Section>
      );
      break;
    }
    case 'pixelate': {
      const it = p.faces.pixelate.find((x) => x.id === sel.id);
      if (!it) break;
      const set = (patch: Partial<typeof it>) => commit((q) => ({...q, faces: {...q.faces, pixelate: updateIn(q.faces.pixelate, it.id, patch)}}));
      body = (
        <Section title={`Pixelado · ${p.faces.tracks.find((t) => t.id === it.faceId)?.label ?? it.faceId}`}>
          <Select label="Modo" value={it.mode} options={[['pixelate', 'Pixelado'], ['blur', 'Desenfoque']]} onChange={(v) => set({mode: v})} />
          <Num label="Intensidad" value={it.intensity} min={0.05} max={1} onChange={(v) => set({intensity: v})} />
          <Num label="Margen" value={it.margin} min={0} max={1.5} onChange={(v) => set({margin: v})} />
          {timeFields(it.start, it.end, (s, e) => set({start: s, end: e}))}
          {actions}
        </Section>
      );
      break;
    }
    case 'sfx': {
      const it = p.audio.sfx.find((x) => x.id === sel.id);
      if (!it) break;
      const set = (patch: Partial<typeof it>) => commit((q) => ({...q, audio: {...q.audio, sfx: updateIn(q.audio.sfx, it.id, patch)}}));
      body = (
        <Section title={`Efecto de sonido · ${fmt(it.at)}`}>
          <Select label="Archivo" value={it.file} options={(lib?.sfx ?? [it.file]).map((f) => [f, f] as [string, string])} onChange={(v) => set({file: v})} />
          <Num label="Momento (s)" value={it.at} min={0} max={total} step={0.05} onChange={(v) => set({at: v})} />
          <Num label="Volumen" value={it.volume} min={0} max={2} onChange={(v) => set({volume: v})} />
          {actions}
        </Section>
      );
      break;
    }
    case 'music': {
      const m = p.audio.music;
      if (!m) break;
      const set = (patch: Partial<typeof m>) => commit((q) => ({...q, audio: {...q.audio, music: {...m, ...patch}}}));
      body = (
        <Section title="Música de fondo">
          <Select label="Archivo" value={m.file} options={(lib?.music ?? [m.file]).map((f) => [f, f] as [string, string])} onChange={(v) => set({file: v})} />
          <Num label="Volumen" value={m.volume} min={0} max={1.5} onChange={(v) => set({volume: v})} />
          <Check label="Ducking con voz" value={m.ducking} onChange={(v) => set({ducking: v})} />
          <Num label="Volumen con voz" value={m.duckVolume} min={0} max={1} onChange={(v) => set({duckVolume: v})} />
          <Num label="Empieza en (s)" value={m.start} min={0} max={total} step={0.1} onChange={(v) => set({start: v})} />
          <Btn variant="danger" onClick={() => (commit((q) => ({...q, audio: {...q.audio, music: null}})), select(null))}>
            Quitar música
          </Btn>
        </Section>
      );
      break;
    }
  }
  return (
    <div className="p-3 text-sm">
      <button className="text-xs text-zinc-400 hover:text-white mb-2" onClick={() => select(null)}>
        ← Añadir elementos / estilo de subtítulos
      </button>
      {body}
    </div>
  );
}
