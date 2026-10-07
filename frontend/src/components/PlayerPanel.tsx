import {useEffect, useMemo, useRef, useState} from 'react';
import {Player, type PlayerRef} from '@remotion/player';
import {EditorComposition, durationInFrames} from '../remotion/Editor';
import {player, usePlaying, usePlayerTime, fmt} from '../state/player';
import type {CompositionProps, Project} from '../types';
import {projectDuration} from '../remotion/timing';

export interface CompareState {
  enabled: boolean;
  position: number;
}

export function PlayerPanel({project, compare, setCompare}: {project: Project; compare: CompareState; setCompare: (c: CompareState) => void}) {
  const ref = useRef<PlayerRef>(null);
  const fps = project.canvas.fps;
  const time = usePlayerTime();
  const playing = usePlaying();
  const total = projectDuration(project);
  const inputProps: CompositionProps = useMemo(
    () => ({
      project,
      media: {baseUrl: `/files/${encodeURIComponent(project.name)}/`, assetsUrl: '/assets/', mode: 'preview', compare},
      output: {width: project.canvas.width, height: project.canvas.height, aspect: project.canvas.aspect},
    }),
    [project, compare],
  );

  useEffect(() => {
    const r = ref.current;
    player.attach(r, fps);
    if (!r) return;
    const onFrame = (e: {detail: {frame: number}}) => player.setTime(e.detail.frame / fps);
    const onPlay = () => player.setPlaying(true);
    const onPause = () => player.setPlaying(false);
    r.addEventListener('frameupdate', onFrame);
    r.addEventListener('seeked', onFrame);
    r.addEventListener('play', onPlay);
    r.addEventListener('pause', onPause);
    r.addEventListener('ended', onPause);
    return () => {
      r.removeEventListener('frameupdate', onFrame);
      r.removeEventListener('seeked', onFrame);
      r.removeEventListener('play', onPlay);
      r.removeEventListener('pause', onPause);
      r.removeEventListener('ended', onPause);
    };
  }, [fps]);

  const ar = project.canvas.width / project.canvas.height;
  const dragRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({w: 640, h: 360});
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const W = el.clientWidth - 16;
      const H = el.clientHeight - 16;
      const w = Math.max(50, Math.min(W, H * ar));
      setSize({w, h: w / ar});
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ar]);
  const onDividerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const box = dragRef.current?.getBoundingClientRect();
    if (!box) return;
    const move = (ev: PointerEvent) =>
      setCompare({...compare, position: Math.max(0, Math.min(100, ((ev.clientX - box.left) / box.width) * 100))});
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const showCompare = compare.enabled && project.color.enabled && project.tracks.color.enabled;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div ref={boxRef} className="flex-1 min-h-0 flex items-center justify-center bg-black/60 overflow-hidden">
        <div ref={dragRef} className="relative" style={{width: size.w, height: size.h}}>
          <Player
            ref={ref}
            component={EditorComposition}
            inputProps={inputProps}
            durationInFrames={durationInFrames(project, fps)}
            fps={fps}
            compositionWidth={project.canvas.width}
            compositionHeight={project.canvas.height}
            style={{width: '100%', height: '100%'}}
            acknowledgeRemotionLicense
            clickToPlay
            spaceKeyToPlayOrPause={false}
          />
          {showCompare && (
            <>
              <div className="absolute top-2 left-2 text-xs bg-black/70 px-2 py-0.5 rounded pointer-events-none">Antes</div>
              <div className="absolute top-2 right-2 text-xs bg-black/70 px-2 py-0.5 rounded pointer-events-none">Después</div>
              <div
                onPointerDown={onDividerDown}
                className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize flex justify-center"
                style={{left: `${compare.position}%`}}
                title="Arrastra para comparar"
              >
                <div className="w-0.5 h-full bg-white shadow" />
                <div className="absolute top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white text-black text-[10px] flex items-center justify-center">⇔</div>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 px-3 py-2 border-t border-zinc-800 text-sm">
        <button onClick={() => player.seek(0)} className="px-2 hover:text-pink-400" title="Inicio">⏮</button>
        <button onClick={() => player.seek(time - 1 / fps)} className="px-2 hover:text-pink-400" title="Fotograma anterior (←)">◀︎</button>
        <button onClick={() => player.toggle()} className="w-9 h-9 rounded-full bg-pink-600 hover:bg-pink-500" title="Reproducir / pausa (espacio)">
          {playing ? '❚❚' : '▶'}
        </button>
        <button onClick={() => player.seek(time + 1 / fps)} className="px-2 hover:text-pink-400" title="Fotograma siguiente (→)">▶︎</button>
        <span className="font-mono text-zinc-300">
          {fmt(time)} / {fmt(total)}
        </span>
      </div>
    </div>
  );
}
