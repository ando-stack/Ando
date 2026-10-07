// Comunicación entre el reproductor (Remotion Player) y la timeline.
import {useSyncExternalStore} from 'react';
import type {PlayerRef} from '@remotion/player';

let ref: PlayerRef | null = null;
let time = 0;
let playing = false;
let fps = 30;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const player = {
  attach(r: PlayerRef | null, f: number) {
    ref = r;
    fps = f;
  },
  setTime(t: number) {
    if (Math.abs(t - time) > 1e-4) {
      time = t;
      emit();
    }
  },
  setPlaying(p: boolean) {
    playing = p;
    emit();
  },
  seek(t: number) {
    time = Math.max(0, t);
    ref?.seekTo(Math.round(time * fps));
    emit();
  },
  toggle() {
    ref?.toggle();
  },
  pause() {
    ref?.pause();
  },
  get time() {
    return time;
  },
  get fps() {
    return fps;
  },
};

export function usePlayerTime() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => time,
  );
}

export function usePlaying() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => playing,
  );
}

export const fmt = (t: number) => {
  t = Math.max(0, t);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
};
