import type { JSX } from 'react';
import Konva from 'konva';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Ellipse, Group, Image as KImage, Line, Rect, Star, Text as KText, TextPath } from 'react-konva';
import { medirTinta } from '../fonts';
import type { Fill, ImageLayer, Layer, ShapeLayer, TextLayer } from '../types';
import { rgba } from '../utils/color';
import { cargarImagen, componer, type Compuesto } from './componer';

/** Máscaras que se están pintando ahora mismo (vista previa en vivo antes de guardar). */
export const mascarasEnVivo = new Map<string, HTMLCanvasElement>();
const oyentesMascara = new Set<() => void>();
export function avisarMascara() {
  oyentesMascara.forEach((f) => f());
}

function useImagen(url: string | null | undefined) {
  const [im, setIm] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let vivo = true;
    if (!url) {
      setIm(null);
      return;
    }
    cargarImagen(url)
      .then((i) => vivo && setIm(i))
      .catch(() => vivo && setIm(null));
    return () => {
      vivo = false;
    };
  }, [url]);
  return im;
}

export function propsComunes(l: Layer) {
  return {
    id: l.id,
    name: 'capa',
    x: l.x,
    y: l.y,
    rotation: l.rotation,
    scaleX: l.scaleX,
    scaleY: l.scaleY,
    opacity: l.opacity,
    visible: l.visible,
  };
}

// ------------------------------------------------------------------ imagen

export function NodoImagen({ capa }: { capa: ImageLayer }) {
  const im = useImagen(capa.src);
  const mascara = useImagen(capa.maskSrc);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const f = () => setTick((t) => t + 1);
    oyentesMascara.add(f);
    return () => {
      oyentesMascara.delete(f);
    };
  }, []);
  const vivo = mascarasEnVivo.get(capa.id) ?? null;
  const comp: Compuesto | null = useMemo(() => {
    if (!im) return null;
    return componer(im, vivo ?? mascara, capa.adjustments, capa.effects);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [im, mascara, vivo, tick, JSON.stringify(capa.adjustments), JSON.stringify(capa.effects)]);
  if (!comp || !im) return <Group {...propsComunes(capa)} />;
  const kx = capa.width / im.width;
  const ky = capa.height / im.height;
  const s = capa.effects.shadow;
  return (
    <Group {...propsComunes(capa)}>
      <KImage
        image={comp.canvas}
        x={-comp.pad * kx}
        y={-comp.pad * ky}
        width={comp.canvas.width * kx}
        height={comp.canvas.height * ky}
        globalCompositeOperation={capa.blendMode}
        shadowEnabled={s.enabled}
        shadowColor={s.color}
        shadowBlur={s.blur}
        shadowOffsetX={s.offsetX}
        shadowOffsetY={s.offsetY}
        shadowOpacity={s.opacity}
      />
    </Group>
  );
}

// ------------------------------------------------------------------ texto

function propsRelleno(f: Fill, w: number, h: number) {
  if (f.type !== 'linear' || f.gradient.colors.length < 2) return { fill: f.color };
  const a = (f.gradient.angle * Math.PI) / 180;
  const cx = w / 2;
  const cy = h / 2;
  const dx = (Math.cos(a) * w) / 2;
  const dy = (Math.sin(a) * h) / 2;
  const n = f.gradient.colors.length;
  return {
    fillPriority: 'linear-gradient',
    fillLinearGradientStartPoint: { x: cx - dx, y: cy - dy },
    fillLinearGradientEndPoint: { x: cx + dx, y: cy + dy },
    fillLinearGradientColorStops: f.gradient.colors.flatMap((c, i) => [i / (n - 1), c]),
  };
}

export function textoVisible(t: TextLayer) {
  return t.uppercase ? t.text.toUpperCase() : t.text;
}

/** Medidas de la caja de texto tal y como la dibuja Konva. */
export function medirTexto(t: TextLayer) {
  const lineas = textoVisible(t).split('\n');
  const ctx = document.createElement('canvas').getContext('2d');
  let ancho = 0;
  if (ctx) {
    ctx.font = `${t.italic ? 'italic ' : ''}${t.fontWeight} ${t.fontSize}px "${t.fontFamily}"`;
    for (const l of lineas) ancho = Math.max(ancho, ctx.measureText(l).width + Math.max(0, l.length) * t.letterSpacing);
  }
  return { ancho: Math.max(1, ancho), alto: lineas.length * t.fontSize * t.lineHeight };
}

function rutaCurva(ancho: number, alto: number, curva: number) {
  const b0 = Math.max(0.05, (Math.abs(curva) / 100) * Math.PI); // curvatura del texto: hasta 180°
  const R = ancho / b0;
  // el arco es más largo que el texto (que va centrado) para que nunca se corte
  const barrido = Math.min(Math.PI * 1.9, b0 * 1.5);
  const cx = ancho / 2;
  if (curva > 0) {
    const cy = R + alto * 0.1;
    const x0 = cx - R * Math.sin(barrido / 2);
    const y0 = cy - R * Math.cos(barrido / 2);
    const x1 = cx + R * Math.sin(barrido / 2);
    return `M ${x0} ${y0} A ${R} ${R} 0 ${barrido > Math.PI ? 1 : 0} 1 ${x1} ${y0}`;
  }
  const cy = -R + alto;
  const x0 = cx - R * Math.sin(barrido / 2);
  const y0 = cy + R * Math.cos(barrido / 2);
  const x1 = cx + R * Math.sin(barrido / 2);
  return `M ${x0} ${y0} A ${R} ${R} 0 ${barrido > Math.PI ? 1 : 0} 0 ${x1} ${y0}`;
}

export function NodoTexto({ capa, onMedida }: { capa: TextLayer; onMedida?: (id: string, w: number, h: number) => void }) {
  const ref = useRef<Konva.Group>(null);
  const texto = textoVisible(capa);
  const { ancho, alto } = medirTexto(capa);
  const curvo = Math.abs(capa.curve) > 1;
  const base = {
    text: curvo ? texto.split('\n')[0] : texto,
    fontFamily: capa.fontFamily,
    fontStyle: `${capa.italic ? 'italic ' : ''}${capa.fontWeight}`,
    fontSize: capa.fontSize,
    letterSpacing: capa.letterSpacing,
    lineHeight: capa.lineHeight,
    align: capa.align,
    lineJoin: 'round' as const,
    perfectDrawEnabled: false,
    listening: true,
    globalCompositeOperation: capa.blendMode,
  };
  const ruta = curvo ? rutaCurva(ancho, alto, capa.curve) : '';
  const T = (p: Record<string, unknown>, k: string) =>
    curvo ? <TextPath key={k} data={ruta} {...base} align="center" {...p} /> : <KText key={k} {...base} width={capa.align === 'left' ? undefined : ancho} {...p} />;

  const acumulados = capa.strokes.reduce<number[]>((acc, s) => [...acc, (acc[acc.length - 1] ?? 0) + s.width], []);
  const exterior = acumulados[acumulados.length - 1] ?? 0;
  const colorExt = capa.strokes[capa.strokes.length - 1]?.color ?? capa.fill.color;
  const piezas: JSX.Element[] = [];
  const sombra = capa.shadow.enabled
    ? { shadowEnabled: true, shadowColor: capa.shadow.color, shadowBlur: capa.shadow.blur, shadowOffsetX: capa.shadow.offsetX, shadowOffsetY: capa.shadow.offsetY, shadowOpacity: capa.shadow.opacity }
    : {};

  // extrusión 3D: copias desplazadas de atrás hacia delante
  if (capa.extrude.enabled && capa.extrude.depth > 0) {
    const n = Math.min(40, Math.max(2, Math.round(capa.extrude.depth)));
    const a = (capa.extrude.angle * Math.PI) / 180;
    for (let i = n; i >= 1; i--) {
      const d = (capa.extrude.depth * i) / n;
      piezas.push(
        T(
          { x: Math.cos(a) * d, y: Math.sin(a) * d, fill: capa.extrude.color, stroke: capa.extrude.color, strokeWidth: exterior * 2, fillAfterStrokeEnabled: true, ...(i === n ? sombra : {}) },
          `ext${i}`,
        ),
      );
    }
  }
  // resplandor
  if (capa.glow.enabled) {
    piezas.push(
      T(
        { fill: capa.glow.color, stroke: capa.glow.color, strokeWidth: exterior * 2 + 2, shadowEnabled: true, shadowColor: capa.glow.color, shadowBlur: capa.glow.blur, shadowOpacity: Math.min(1, capa.glow.strength), shadowOffsetX: 0, shadowOffsetY: 0 },
        'glow',
      ),
    );
    if (capa.glow.strength > 1)
      piezas.push(T({ fill: capa.glow.color, stroke: capa.glow.color, strokeWidth: exterior * 2 + 2, shadowEnabled: true, shadowColor: capa.glow.color, shadowBlur: capa.glow.blur * 1.6, shadowOffsetX: 0, shadowOffsetY: 0 }, 'glow2'));
  }
  // contornos (del más externo al más interno); la sombra va en el exterior
  const sinExtrusion = !(capa.extrude.enabled && capa.extrude.depth > 0);
  for (let i = capa.strokes.length - 1; i >= 0; i--) {
    const s = capa.strokes[i];
    if (s.width <= 0) continue;
    piezas.push(
      T({ fill: s.color, stroke: s.color, strokeWidth: acumulados[i] * 2, fillAfterStrokeEnabled: true, ...(i === capa.strokes.length - 1 && sinExtrusion ? sombra : {}) }, `st${i}`),
    );
  }
  const sombraEnRelleno = sinExtrusion && (exterior === 0 || !capa.strokes.some((s) => s.width > 0));
  piezas.push(T({ ...propsRelleno(capa.fill, ancho, alto), ...(sombraEnRelleno ? sombra : {}) }, 'relleno'));
  void colorExt;

  useEffect(() => {
    const g = ref.current;
    if (!g) return;
    const r = g.getClientRect({ skipTransform: true });
    onMedida?.(capa.id, r.width, r.height);
    // con opacidad o fusión, el grupo se dibuja como una sola imagen
    if (capa.opacity < 1 || capa.blendMode !== 'source-over') {
      try {
        g.cache({ pixelRatio: 1 });
      } catch {
        /* grupo vacío */
      }
    } else g.clearCache();
  });

  return (
    <Group ref={ref} {...propsComunes(capa)} skewX={capa.skewX / 100}>
      {piezas}
    </Group>
  );
}

/** Coloca un texto detectado por la IA para que su tinta coincida con la del original. */
export function ajustarTextoDetectado(t: TextLayer): TextLayer {
  if (!t.needsFit || !t.inkBox) return t;
  const linea = textoVisible(t).split('\n')[0];
  const m = medirTinta(linea, t.fontFamily, t.fontWeight, t.fontSize, t.italic, t.lineHeight);
  const a = (t.rotation * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const x = t.inkBox.x - (cos * m.izq - sin * m.arriba);
  const y = t.inkBox.y - (sin * m.izq + cos * m.arriba);
  return { ...t, x, y, needsFit: false };
}

// ------------------------------------------------------------------ formas

export function puntosFlecha(w: number, h: number) {
  const cuerpo = h * 0.3;
  const punta = Math.min(w * 0.4, h * 0.9);
  return [0, h / 2 - cuerpo, w - punta, h / 2 - cuerpo, w - punta, 0, w, h / 2, w - punta, h, w - punta, h / 2 + cuerpo, 0, h / 2 + cuerpo];
}

export function NodoForma({ capa }: { capa: ShapeLayer }) {
  const { width: w, height: h } = capa;
  const relleno = propsRelleno(capa.fill, w, h);
  const s = capa.shadow;
  const comun = {
    ...relleno,
    stroke: capa.stroke.width > 0 ? capa.stroke.color : undefined,
    strokeWidth: capa.stroke.width,
    globalCompositeOperation: capa.blendMode,
    shadowEnabled: s.enabled,
    shadowColor: s.color,
    shadowBlur: s.blur,
    shadowOffsetX: s.offsetX,
    shadowOffsetY: s.offsetY,
    shadowOpacity: s.opacity,
    perfectDrawEnabled: false,
  };
  let forma: JSX.Element;
  switch (capa.shapeType) {
    case 'ellipse':
      forma = <Ellipse x={w / 2} y={h / 2} radiusX={w / 2} radiusY={h / 2} {...comun} />;
      break;
    case 'arrow':
      forma = <Line points={puntosFlecha(w, h)} closed lineJoin="round" {...comun} />;
      break;
    case 'band': {
      const d = Math.min(h * 0.6, w * 0.2);
      forma = <Line points={[d, 0, w, 0, w - d, h, 0, h]} closed {...comun} />;
      break;
    }
    case 'badge':
    case 'star': {
      const r = Math.min(w, h) / 2;
      forma = (
        <Star
          x={w / 2}
          y={h / 2}
          numPoints={capa.points ?? (capa.shapeType === 'badge' ? 16 : 5)}
          innerRadius={capa.shapeType === 'badge' ? r * 0.82 : r * 0.45}
          outerRadius={r}
          scaleX={w / (2 * r)}
          scaleY={h / (2 * r)}
          {...comun}
        />
      );
      break;
    }
    case 'line':
      forma = <Line points={[0, h / 2, w, h / 2]} stroke={capa.fill.color} strokeWidth={Math.max(2, h)} lineCap="round" globalCompositeOperation={capa.blendMode} />;
      break;
    default:
      forma = <Rect width={w} height={h} cornerRadius={capa.cornerRadius} {...comun} />;
  }
  return (
    <Group {...propsComunes(capa)}>
      {forma}
      {/* zona de selección transparente para formas finas */}
      <Rect width={w} height={h} fill={rgba('#000000', 0)} />
    </Group>
  );
}

export function NodoCapa({ capa, onMedida }: { capa: Layer; onMedida?: (id: string, w: number, h: number) => void }) {
  if (capa.type === 'image') return <NodoImagen capa={capa} />;
  if (capa.type === 'text') return <NodoTexto capa={capa} onMedida={onMedida} />;
  return <NodoForma capa={capa} />;
}
