// Paneles laterales: edición automática, color, caras, audio y exportación.
import {useEffect, useState} from 'react';
import {api, fileUrl, type Job} from '../api';
import {applyServerProject, commit, flushSave} from '../state/store';
import {fmt} from '../state/player';
import type {AutoEditSettings, Project} from '../types';
import {Btn, Check, Num, Section, Select, useLibrary} from './fields';
import type {CompareState} from './PlayerPanel';

export type RunJob = (url: string, body?: unknown) => Promise<Job | null>;

// ====================================================================== edición automática
export function AutoEditPanel({project, run, ai}: {project: Project; run: RunJob; ai: boolean}) {
  const [s, setS] = useState<AutoEditSettings>(project.autoEdit);
  const [report, setReport] = useState<{done: string[]; warnings: string[]} | null>(null);
  const lib = useLibrary();
  const set = (patch: Partial<AutoEditSettings>) => setS((x) => ({...x, ...patch}));
  const hasEdits = project.texts.length + project.emojis.length + project.zooms.length + project.captions.blocks.length > 0;
  return (
    <div className="p-3 text-sm">
      <Section title="1 · Limpieza">
        <Check label="Quitar silencios" value={s.silences} onChange={(v) => set({silences: v})} />
        <Num label="Umbral (dB)" value={s.silenceThresholdDb} min={-70} max={-15} step={1} onChange={(v) => set({silenceThresholdDb: v})} />
        <Num label="Silencio mínimo (s)" value={s.minSilence} min={0.2} max={3} step={0.05} onChange={(v) => set({minSilence: v})} />
        <Num label="Margen (s)" value={s.silencePadding} min={0} max={0.5} step={0.01} onChange={(v) => set({silencePadding: v})} />
        <Check label="Quitar muletillas" value={s.fillers} onChange={(v) => set({fillers: v})} />
        <Check label="Quitar tomas repetidas" value={s.retakes} onChange={(v) => set({retakes: v})} />
      </Section>
      <Section title="2 · Ritmo">
        <Check label="Punch-in en cortes" value={s.punchIns} onChange={(v) => set({punchIns: v})} />
        <Num label="Escala punch-in" value={s.punchInScale} min={1.02} max={1.5} onChange={(v) => set({punchInScale: v})} />
        <Check label="Zooms suaves (IA)" value={s.smoothZooms} onChange={(v) => set({smoothZooms: v})} />
      </Section>
      <Section title="3 · Subtítulos">
        <Check label="Subtítulos" value={s.subtitles} onChange={(v) => set({subtitles: v})} />
        <Select label="Estilo" value={s.captionPreset} options={[['tiktok', 'TikTok'], ['karaoke', 'Karaoke'], ['clasico', 'Clásico'], ['neon', 'Neón'], ['minimal', 'Minimalista']]} onChange={(v) => set({captionPreset: v})} />
      </Section>
      <Section title="4 · Textos, emojis y transiciones (IA)">
        <Check label="Títulos y textos" value={s.texts} onChange={(v) => set({texts: v})} />
        <Check label="Emojis" value={s.emojis} onChange={(v) => set({emojis: v})} />
        <Num label="Emojis / minuto" value={s.emojisPerMinute} min={0} max={12} step={0.5} onChange={(v) => set({emojisPerMinute: v})} />
        <Check label="Transiciones" value={s.transitions} onChange={(v) => set({transitions: v})} />
        <Num label="Intensidad creativa" value={s.intensity} min={0} max={1} onChange={(v) => set({intensity: v})} />
        {!ai && <p className="text-amber-400 text-xs">Sin clave de API estos pasos se omiten (se avisará).</p>}
      </Section>
      <Section title="5 · Audio">
        <Check label="Normalizar volumen" value={s.normalizeAudio} onChange={(v) => set({normalizeAudio: v})} />
        <Check label="Reducir ruido" value={s.denoise} onChange={(v) => set({denoise: v})} />
        <Select
          label="Música"
          value={s.music ?? ''}
          options={[['', 'Sin música'], ...((lib?.music ?? []).map((m) => [m, m]) as [string, string][])]}
          onChange={(v) => set({music: v || null})}
        />
        <Num label="Volumen música" value={s.musicVolume} min={0} max={1} onChange={(v) => set({musicVolume: v})} />
        <Check label="Efectos de sonido" value={s.sfx} onChange={(v) => set({sfx: v})} />
        {lib && !lib.music.length && <p className="text-xs text-zinc-500">Pon tus pistas en /assets/music para poder elegirlas.</p>}
      </Section>
      <Section title="6 · Color">
        <Check label="Corregir color si hace falta" value={s.color} onChange={(v) => set({color: v})} />
      </Section>
      {hasEdits && <p className="text-xs text-amber-300 mb-2">La edición automática rehace los cortes y sustituye textos, emojis, zooms y subtítulos actuales (puedes deshacerlo con Ctrl+Z).</p>}
      <Btn
        variant="primary"
        className="w-full py-2.5 text-sm"
        onClick={async () => {
          commit((p) => ({...p, autoEdit: s}));
          const j = await run(`/api/projects/${encodeURIComponent(project.name)}/autoedit`, s);
          if (j?.status === 'completada') setReport(j.result as {done: string[]; warnings: string[]});
        }}
      >
        ✨ Editar automáticamente
      </Btn>
      {report && (
        <div className="mt-3 text-xs space-y-1">
          {report.done.map((d, i) => (
            <div key={i} className="text-emerald-300">✓ {d}</div>
          ))}
          {report.warnings.map((d, i) => (
            <div key={i} className="text-amber-300">⚠️ {d}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ====================================================================== color
export function ColorPanel({project, run, compare, setCompare}: {project: Project; run: RunJob; compare: CompareState; setCompare: (c: CompareState) => void}) {
  const c = project.color;
  const [v, setV] = useState({intensity: c.intensity, temperature: c.temperature, exposure: c.exposure, contrast: c.contrast, saturation: c.saturation});
  useEffect(() => setV({intensity: c.intensity, temperature: c.temperature, exposure: c.exposure, contrast: c.contrast, saturation: c.saturation}), [c.intensity, c.temperature, c.exposure, c.contrast, c.saturation]);
  const url = `/api/projects/${encodeURIComponent(project.name)}/color`;
  const dirty = (Object.keys(v) as (keyof typeof v)[]).some((k) => Math.abs(v[k] - c[k]) > 1e-3);
  return (
    <div className="p-3 text-sm">
      <Section title="Análisis de iluminación">
        {c.analyzed && c.analysis ? (
          <div className="text-xs space-y-0.5 text-zinc-300">
            <div>Luminancia media: {c.analysis.luma.toFixed(2)} · contraste {c.analysis.contrast.toFixed(2)} · saturación {c.analysis.saturation.toFixed(2)}</div>
            <div>Balance de blancos: {c.analysis.tempBias > 0 ? 'cálido' : 'frío'} {Math.abs(c.analysis.tempBias).toFixed(3)}</div>
            <div className={c.analysis.issues.length ? 'text-amber-300' : 'text-emerald-300'}>
              {c.analysis.issues.length ? `Problemas: ${c.analysis.issues.join(', ')}` : '✓ La iluminación es correcta: no hace falta corregir.'}
            </div>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">Sin analizar.</p>
        )}
        {c.message && <p className="text-xs text-zinc-400 mt-1">{c.message}</p>}
        <Btn className="mt-2" onClick={() => run(url, {reanalyze: true})}>
          Analizar de nuevo
        </Btn>
      </Section>
      <Section title="Corrección (LUT)">
        <Check label="Activada" value={c.enabled} onChange={(en) => run(url, {...v, enabled: en})} />
        <Num label="Intensidad LUT" value={v.intensity} min={0} max={1} onChange={(x) => setV({...v, intensity: x})} />
        <Num label="Temperatura" value={v.temperature} min={-1} max={1} onChange={(x) => setV({...v, temperature: x})} />
        <Num label="Exposición" value={v.exposure} min={-1} max={1} onChange={(x) => setV({...v, exposure: x})} />
        <Num label="Contraste" value={v.contrast} min={-1} max={1} onChange={(x) => setV({...v, contrast: x})} />
        <Num label="Saturación" value={v.saturation} min={-1} max={1} onChange={(x) => setV({...v, saturation: x})} />
        <div className="flex gap-2 mt-2">
          <Btn variant="primary" disabled={!dirty} onClick={() => run(url, {...v, enabled: true})}>
            Aplicar ajustes
          </Btn>
          <Btn onClick={() => setV({intensity: 1, temperature: 0, exposure: 0, contrast: 0, saturation: 0})}>Restablecer</Btn>
        </div>
        <p className="text-[11px] text-zinc-500 mt-1">Al aplicar se regenera lut.cube y las versiones corregidas (los originales no se tocan).</p>
      </Section>
      <Section title="Comparar antes / después">
        <Check label="Línea divisoria" value={compare.enabled} onChange={(en) => setCompare({...compare, enabled: en})} />
        {compare.enabled && !c.enabled && <p className="text-xs text-zinc-500">Activa la corrección para comparar.</p>}
        {compare.enabled && <p className="text-xs text-zinc-500">Arrastra la línea blanca sobre el vídeo.</p>}
      </Section>
      {c.lutFile && (
        <a className="text-xs text-pink-400 underline" href={`/api/projects/${encodeURIComponent(project.name)}/download/${c.lutFile}`}>
          Descargar lut.cube
        </a>
      )}
    </div>
  );
}

// ====================================================================== caras
export function FacesPanel({project, run}: {project: Project; run: RunJob}) {
  const f = project.faces;
  const base = `/api/projects/${encodeURIComponent(project.name)}/faces`;
  const [chosen, setChosen] = useState<string[]>([]);
  const [mode, setMode] = useState<'pixelate' | 'blur'>('pixelate');
  const [intensity, setIntensity] = useState(0.75);
  const [verifyImg, setVerifyImg] = useState<string | null>(null);
  const pixelated = new Set(f.pixelate.map((x) => x.faceId));
  return (
    <div className="p-3 text-sm">
      <p className="text-xs text-zinc-400 mb-3">El pixelado nunca se aplica solo: elige aquí qué caras ocultar (o pídelo en el chat). Las caras se analizan en tu ordenador.</p>
      <Btn variant={f.analyzed ? 'normal' : 'primary'} onClick={() => run(`${base}/analyze`)}>
        {f.analyzed ? 'Volver a detectar caras' : '🔍 Detectar caras'}
      </Btn>
      {f.analyzed && (
        <>
          <Section title={`Personas detectadas (${f.tracks.length})`}>
            {!f.tracks.length && <p className="text-xs text-zinc-500">No se ha encontrado ninguna cara.</p>}
            <div className="grid grid-cols-3 gap-2">
              {f.tracks.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setChosen((c) => (c.includes(t.id) ? c.filter((x) => x !== t.id) : [...c, t.id]))}
                  className={`rounded-lg overflow-hidden border-2 text-xs ${chosen.includes(t.id) ? 'border-pink-500' : 'border-zinc-700'}`}
                >
                  {t.thumbnail ? <img src={fileUrl(project.name, t.thumbnail)} className="w-full aspect-square object-cover" alt="" /> : <div className="aspect-square bg-zinc-800" />}
                  <div className="py-0.5">
                    {t.label} {pixelated.has(t.id) ? '🟦' : ''}
                  </div>
                </button>
              ))}
            </div>
            {f.unreliable.length > 0 && (
              <p className="text-xs text-amber-300 mt-2">⚠️ Hay {f.unreliable.length} tramo(s) donde la detección no es fiable: aparecen rayados en rojo en la pista de pixelado.</p>
            )}
          </Section>
          <Section title="Pixelar">
            <Select label="Modo" value={mode} options={[['pixelate', 'Pixelado'], ['blur', 'Desenfoque']]} onChange={setMode} />
            <Num label="Intensidad" value={intensity} min={0.05} max={1} onChange={setIntensity} />
            <div className="flex gap-2 flex-wrap mt-1">
              <Btn variant="primary" disabled={!chosen.length} onClick={() => applyPix(chosen)}>
                Pixelar seleccionadas
              </Btn>
              <Btn disabled={!f.tracks.length} onClick={() => applyPix(f.tracks.map((t) => t.id))}>
                Pixelar todas
              </Btn>
              <Btn variant="danger" disabled={!f.pixelate.length} onClick={() => commit((p) => ({...p, faces: {...p.faces, pixelate: []}}))}>
                Quitar todo el pixelado
              </Btn>
            </div>
          </Section>
          {f.pixelate.length > 0 && (
            <Section title="Verificación">
              <Btn
                onClick={async () => {
                  const j = await run(`${base}/verify`);
                  if (j?.status === 'completada') setVerifyImg(`${fileUrl(project.name, 'cache/faces/verificacion.jpg')}?v=${Date.now()}`);
                }}
              >
                Comprobar en varios fotogramas
              </Btn>
              {f.verification.length > 0 && (
                <div className="text-xs mt-2 space-y-0.5">
                  {f.verification.map((r, i) => (
                    <div key={i} className={r.ok === false ? 'text-red-400' : r.ok ? 'text-emerald-300' : 'text-zinc-500'}>
                      {r.ok === false ? '✗' : r.ok ? '✓' : '·'} {fmt(r.time)} — {r.note}
                    </div>
                  ))}
                </div>
              )}
              {verifyImg && <img src={verifyImg} className="mt-2 rounded" alt="Verificación" />}
            </Section>
          )}
        </>
      )}
    </div>
  );

  async function applyPix(ids: string[]) {
    await flushSave();
    const p = await api.post<Project>(`${base}/pixelate`, {faceIds: ids, mode, intensity});
    applyServerProject(p);
  }
}

// ====================================================================== audio
export function AudioPanel({project}: {project: Project}) {
  const lib = useLibrary();
  const a = project.audio;
  return (
    <div className="p-3 text-sm">
      <Section title="Voz">
        <Num label="Volumen voz" value={a.voiceVolume} min={0} max={3} onChange={(v) => commit((p) => ({...p, audio: {...p.audio, voiceVolume: v}}))} />
        <p className="text-xs text-zinc-500">
          Normalización: {a.normalize ? 'sí' : 'no'} · reducción de ruido: {a.denoise ? 'sí' : 'no'} (se aplican en la edición automática).
        </p>
      </Section>
      <Section title="Música de fondo">
        <Select
          label="Pista"
          value={a.music?.file ?? ''}
          options={[['', 'Sin música'], ...((lib?.music ?? []).map((m) => [m, m]) as [string, string][])]}
          onChange={(file) =>
            commit((p) => ({
              ...p,
              audio: {...p.audio, music: file ? {file, volume: p.audio.music?.volume ?? 0.25, ducking: true, duckVolume: 0.08, start: 0, end: null, fadeIn: 1, fadeOut: 2} : null},
            }))
          }
        />
        {a.music && (
          <>
            <Num label="Volumen" value={a.music.volume} min={0} max={1.5} onChange={(v) => commit((p) => ({...p, audio: {...p.audio, music: {...p.audio.music!, volume: v}}}))} />
            <Check label="Ducking con voz" value={a.music.ducking} onChange={(v) => commit((p) => ({...p, audio: {...p.audio, music: {...p.audio.music!, ducking: v}}}))} />
            <Num label="Volumen con voz" value={a.music.duckVolume} min={0} max={1} onChange={(v) => commit((p) => ({...p, audio: {...p.audio, music: {...p.audio.music!, duckVolume: v}}}))} />
          </>
        )}
        {lib && !lib.music.length && <p className="text-xs text-zinc-500">No hay música: copia tus archivos (mp3, wav, m4a…) en /assets/music.</p>}
      </Section>
      <Section title="Efectos de sonido">
        <p className="text-xs text-zinc-500">{a.sfx.length} efecto(s). {lib?.sfx.length ? `Disponibles: ${lib.sfx.join(', ')}` : 'Copia tus efectos en /assets/sfx.'}</p>
      </Section>
    </div>
  );
}

// ====================================================================== exportación
interface Preset {
  id: string;
  label: string;
  available: boolean;
  reason: string;
}
interface ExportEntry {
  folder: string;
  files: string[];
}

export function ExportPanel({project, run}: {project: Project; run: RunJob}) {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [exportsList, setExports] = useState<ExportEntry[]>([]);
  const name = encodeURIComponent(project.name);
  const refresh = () => api.get<ExportEntry[]>(`/api/projects/${name}/exports`).then(setExports).catch(() => undefined);
  useEffect(() => {
    api.get<Preset[]>(`/api/projects/${name}/presets`).then(setPresets).catch(() => undefined);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  return (
    <div className="p-3 text-sm">
      <Section title="Exportar vídeo final">
        <p className="text-xs text-zinc-400 mb-2">Render con Remotion a partir de los archivos originales (máxima calidad), H.264 + AAC en .mp4. Se exportan también los subtítulos .srt, el LUT .cube y el project.json.</p>
        <div className="space-y-2">
          {presets.map((p) => (
            <div key={p.id} className="flex items-center justify-between bg-zinc-900 rounded px-2 py-1.5">
              <span className={p.available ? '' : 'text-zinc-500'}>
                {p.label}
                {!p.available && <span className="text-xs"> ({p.reason})</span>}
              </span>
              <Btn
                variant="primary"
                disabled={!p.available}
                onClick={async () => {
                  await run(`/api/projects/${name}/export`, {preset: p.id});
                  void refresh();
                }}
              >
                Exportar
              </Btn>
            </div>
          ))}
        </div>
        {project.canvas.aspect === '16:9' && <p className="text-[11px] text-zinc-500 mt-2">El vertical 9:16 se reencuadra solo, centrado en la persona que habla. Cambia la vista a 9:16 (arriba) para revisarlo y ajustarlo a mano.</p>}
      </Section>
      <Section title="Exportaciones">
        {!exportsList.length && <p className="text-xs text-zinc-500">Todavía no hay exportaciones.</p>}
        {exportsList.map((e) => (
          <div key={e.folder} className="mb-2 text-xs">
            <div className="text-zinc-400">{e.folder.split('/').pop()}</div>
            {e.files.map((f) => (
              <a key={f} className="block text-pink-400 underline truncate" href={`/api/projects/${name}/download/${f}`}>
                ⬇ {f.split('/').pop()}
              </a>
            ))}
          </div>
        ))}
      </Section>
    </div>
  );
}
