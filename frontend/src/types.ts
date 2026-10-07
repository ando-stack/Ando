// Tipos de project.json (reflejo de backend/schema.py)

export interface Source {
  id: string;
  name: string;
  original: string;
  proxy?: string | null;
  audio?: string | null;
  corrected?: string | null;
  correctedProxy?: string | null;
  master?: string | null; // solo en el render
  duration: number;
  width: number;
  height: number;
  fps: number;
  rotation: number;
  hasAudio: boolean;
  videoCodec: string;
  audioCodec: string;
  creationTime?: string | null;
  device?: string | null;
}

export interface Segment {
  id: string;
  sourceId: string;
  inPoint: number;
  outPoint: number;
  volume: number;
  reframeX?: number | null;
}

export interface Timed {
  id: string;
  start: number;
  end: number;
}

export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}
export interface CaptionBlock extends Timed {
  words: CaptionWord[];
}
export type CaptionPreset = 'clasico' | 'tiktok' | 'neon' | 'minimal' | 'karaoke';
export interface CaptionStyle {
  preset: CaptionPreset;
  font: string;
  fontSize: number;
  color: string;
  highlightColor: string;
  strokeColor: string;
  background: boolean;
  backgroundColor: string;
  y: number;
  uppercase: boolean;
  maxWords: number;
}

export type Animation = 'none' | 'fade' | 'pop' | 'slide-up' | 'slide-left' | 'typewriter' | 'bounce';

export interface TextStyle {
  font: string;
  fontSize: number;
  color: string;
  background?: string | null;
  strokeColor?: string | null;
  bold: boolean;
  uppercase: boolean;
}
export interface TextItem extends Timed {
  text: string;
  kind: 'titulo' | 'texto' | 'dato';
  x: number;
  y: number;
  animation: Animation;
  style: TextStyle;
}
export interface EmojiItem extends Timed {
  emoji: string;
  file: string;
  x: number;
  y: number;
  size: number;
  rotation: number;
  animation: Animation;
}
export interface ZoomItem extends Timed {
  kind: 'punch' | 'smooth';
  scale: number;
  x: number;
  y: number;
}
export type TransitionType = 'fade' | 'flash' | 'zoom' | 'whip' | 'glitch';
export interface TransitionItem {
  id: string;
  at: number;
  duration: number;
  type: TransitionType;
  sfx?: string | null;
}

export interface ColorAnalysis {
  luma: number;
  contrast: number;
  saturation: number;
  tempBias: number;
  tintBias: number;
  clippedHigh: number;
  clippedLow: number;
  issues: string[];
}
export interface ColorSettings {
  enabled: boolean;
  needsCorrection: boolean;
  analyzed: boolean;
  analysis?: ColorAnalysis | null;
  lutFile?: string | null;
  intensity: number;
  temperature: number;
  exposure: number;
  contrast: number;
  saturation: number;
  version: number;
  message: string;
}

export interface FaceSample {
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
  interpolated: boolean;
}
export interface FaceTrack {
  id: string;
  label: string;
  thumbnail?: string | null;
  parts: { sourceId: string; samples: FaceSample[] }[];
}
export interface PixelateItem extends Timed {
  faceId: string;
  mode: 'pixelate' | 'blur';
  intensity: number;
  margin: number;
}
export interface Faces {
  analyzed: boolean;
  tracks: FaceTrack[];
  unreliable: { sourceId: string; start: number; end: number }[];
  pixelate: PixelateItem[];
  verification: { itemId: string; faceId: string; time: number; ok: boolean | null; note: string }[];
}

export interface Music {
  file: string;
  volume: number;
  ducking: boolean;
  duckVolume: number;
  start: number;
  end?: number | null;
  fadeIn: number;
  fadeOut: number;
}
export interface SfxItem {
  id: string;
  file: string;
  at: number;
  volume: number;
}
export interface AudioSettings {
  normalize: boolean;
  denoise: boolean;
  voiceVolume: number;
  music?: Music | null;
  sfx: SfxItem[];
  speech: [number, number][];
}

export const TRACKS = [
  'video',
  'subtitulos',
  'textos',
  'emojis',
  'zooms',
  'transiciones',
  'color',
  'pixelado',
  'musica',
  'sfx',
] as const;
export type TrackName = (typeof TRACKS)[number];

export interface AutoEditSettings {
  silences: boolean;
  silenceThresholdDb: number;
  minSilence: number;
  silencePadding: number;
  fillers: boolean;
  retakes: boolean;
  punchIns: boolean;
  punchInScale: number;
  smoothZooms: boolean;
  subtitles: boolean;
  captionPreset: CaptionPreset;
  texts: boolean;
  emojis: boolean;
  emojisPerMinute: number;
  transitions: boolean;
  normalizeAudio: boolean;
  denoise: boolean;
  music?: string | null;
  musicVolume: number;
  sfx: boolean;
  color: boolean;
  intensity: number;
  language: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  time: string;
  changes: string[];
  pending: boolean;
}

export interface Reframe {
  auto: boolean;
  offset: number;
  parts: { sourceId: string; samples: { t: number; x: number }[] }[];
}

export interface Project {
  version: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  canvas: { width: number; height: number; fps: number; aspect: '16:9' | '9:16' };
  previewCodec: 'h264' | 'vp9';
  sources: Source[];
  segments: Segment[];
  captions: { style: CaptionStyle; blocks: CaptionBlock[] };
  texts: TextItem[];
  emojis: EmojiItem[];
  zooms: ZoomItem[];
  transitions: TransitionItem[];
  color: ColorSettings;
  faces: Faces;
  audio: AudioSettings;
  reframe: Reframe;
  tracks: Record<TrackName, { enabled: boolean }>;
  cuts: { at: number; reason: string }[];
  autoEdit: AutoEditSettings;
  warnings: string[];
  chat: ChatMessage[];
  transcript: { sourceId: string; start: number; end: number; text: string }[];
}

export interface MediaConfig {
  baseUrl: string; // URL de la carpeta del proyecto (termina en /)
  assetsUrl: string; // URL de /assets (termina en /)
  mode: 'preview' | 'render';
  compare?: { enabled: boolean; position: number } | null;
}

export interface OutputConfig {
  width: number;
  height: number;
  aspect: '16:9' | '9:16';
}

export interface CompositionProps {
  project: Project;
  media: MediaConfig;
  output: OutputConfig;
  [key: string]: unknown;
}
