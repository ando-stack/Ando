/** Formatos de lienzo predefinidos.
 * Miniatura de YouTube: según la ayuda oficial (support.google.com/youtube/answer/72431,
 * consultada el 31-10-2026): 3840×2160 recomendado (16:9, ancho mínimo 640 px), JPG o PNG;
 * peso máximo 50 MB subiendo desde ordenador y 2 MB desde el móvil. */
export interface Formato {
  id: string;
  nombre: string;
  ancho: number;
  alto: number;
  maxBytes: number | null;
  dpi?: number;
  nota: string;
  previsualizacionMovil?: boolean;
}

const MB = 1024 * 1024;

export const FORMATOS: Formato[] = [
  { id: 'yt', nombre: 'Miniatura YouTube (4K)', ancho: 3840, alto: 2160, maxBytes: 50 * MB, nota: '16:9 · recomendado por YouTube · máx. 50 MB (ordenador)', previsualizacionMovil: true },
  { id: 'yt-movil', nombre: 'Miniatura YouTube (subida desde móvil)', ancho: 1280, alto: 720, maxBytes: 2 * MB, nota: '16:9 · máx. 2 MB (límite al subir desde el móvil)', previsualizacionMovil: true },
  { id: 'ig-45', nombre: 'Póster Instagram 4:5', ancho: 1080, alto: 1350, maxBytes: null, nota: '1080×1350 · vertical' },
  { id: 'ig-11', nombre: 'Instagram cuadrado 1:1', ancho: 1080, alto: 1080, maxBytes: null, nota: '1080×1080' },
  { id: 'historia', nombre: 'Historia / vertical 9:16', ancho: 1080, alto: 1920, maxBytes: null, nota: 'Historias, Reels, Shorts, TikTok' },
  { id: 'x-cabecera', nombre: 'Cabecera de X', ancho: 1500, alto: 500, maxBytes: 5 * MB, nota: '3:1 · 1500×500' },
  { id: 'a4', nombre: 'Póster A4 (300 ppp)', ancho: 2480, alto: 3508, maxBytes: null, dpi: 300, nota: '210×297 mm a 300 ppp' },
  { id: 'a3', nombre: 'Póster A3 (300 ppp)', ancho: 3508, alto: 4961, maxBytes: null, dpi: 300, nota: '297×420 mm a 300 ppp' },
];

export const formatoPorId = (id?: string) => FORMATOS.find((f) => f.id === id);

export function formatoParecido(w: number, h: number): Formato | undefined {
  const r = w / h;
  return FORMATOS.find((f) => Math.abs(f.ancho / f.alto - r) < 0.02);
}
