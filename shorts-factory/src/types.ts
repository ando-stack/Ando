export type Tone = "gold" | "gain" | "loss";

export type Scene = {
  text: string;
  big?: string;
  emoji?: string;
  tone?: Tone;
  // Filled in by scripts/render.mjs
  audio?: string;
  frames?: number;
};

export type ShortProps = {
  handle: string;
  playbackRate: number;
  scenes: Scene[];
};

export type ThumbnailProps = {
  top: string;
  big: string;
  bottom: string;
  emoji: string;
  tone?: Tone;
};
