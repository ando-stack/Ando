export type BlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export type Role = 'fondo' | 'sujeto' | 'objeto' | 'texto' | 'texto-imagen' | 'grafico' | 'original' | 'usuario' | 'efecto';

export interface Shadow {
  enabled: boolean;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
}

export interface Glow {
  enabled: boolean;
  color: string;
  blur: number;
  strength: number;
}

export interface Fill {
  type: 'solid' | 'linear';
  color: string;
  gradient: { colors: string[]; angle: number };
}

export interface BaseLayer {
  id: string;
  type: 'image' | 'text' | 'shape';
  name: string;
  role?: Role | string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
  locked: boolean;
  groupId?: string | null;
  confidence?: number | null;
  warnings?: string[];
}

export interface Adjustments {
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
  temperature: number; // -100..100
  sharpen: number; // 0..100
  blur: number; // 0..40 px
  filter: 'none' | 'bn' | 'sepia' | 'frio' | 'calido' | 'vintage' | 'invertir' | 'dramatico';
}

export interface ImageEffects {
  outline: { enabled: boolean; color: string; width: number };
  glow: Glow;
  shadow: Shadow;
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  src: string;
  maskSrc: string | null;
  adjustments: Adjustments;
  effects: ImageEffects;
  linkedTextId?: string;
}

export interface Stroke {
  color: string;
  width: number;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  text: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  letterSpacing: number;
  lineHeight: number;
  align: 'left' | 'center' | 'right';
  italic?: boolean;
  uppercase?: boolean;
  fill: Fill;
  strokes: Stroke[];
  shadow: Shadow;
  glow: Glow;
  extrude: { enabled: boolean; depth: number; color: string; angle: number };
  skewX: number;
  curve: number; // -100..100
  fontCandidates?: { familia: string; peso: number; puntuacion: number }[];
  inkBox?: { x: number; y: number; w: number; h: number };
  needsFit?: boolean;
  fidelity?: number;
}

export type ShapeType = 'rect' | 'ellipse' | 'arrow' | 'band' | 'badge' | 'star' | 'line';

export interface ShapeLayer extends BaseLayer {
  type: 'shape';
  shapeType: ShapeType;
  fill: Fill;
  stroke: Stroke;
  cornerRadius: number;
  points?: number; // insignias y estrellas
  shadow: Shadow;
}

export type Layer = ImageLayer | TextLayer | ShapeLayer;

export interface Group {
  id: string;
  name: string;
  collapsed?: boolean;
}

export interface CustomFont {
  family: string;
  url: string;
}

export interface Decomposition {
  metrics: { ssim: number; psnr: number; total_s?: number; [k: string]: unknown };
  reconstructionSrc?: string;
  warnings: string[];
}

export interface Doc {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  layers: Layer[]; // de abajo a arriba
  groups: Group[];
  palette: string[];
  guides: { x: number[]; y: number[] };
  customFonts: CustomFont[];
  formatId?: string;
  decomposition?: Decomposition;
  version: number;
  createdAt?: number;
  updatedAt?: number;
}

export type Tool =
  | 'select'
  | 'hand'
  | 'text'
  | 'shape'
  | 'mask-hide'
  | 'mask-show'
  | 'ai-erase'
  | 'segment'
  | 'eyedropper';
