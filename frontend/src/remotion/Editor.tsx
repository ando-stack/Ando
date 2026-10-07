// Composición principal: interpreta project.json. La usan el reproductor (Remotion Player, con
// proxies) y el render final (@remotion/renderer, con originales). Mismo código = mismo resultado.
import React, {useCallback, useMemo, useRef} from 'react';
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion';
import type {
  Animation,
  CaptionBlock,
  CaptionStyle,
  CompositionProps,
  EmojiItem,
  PixelateItem,
  Project,
  Source,
  TextItem,
  TransitionItem,
  ZoomItem,
} from '../types';
import {boxAt, blurRadius, expand, pixelBlocks} from './faces';
import {fontWeight, loadFonts} from './fonts';
import {clamp, segmentSpans, type Span} from './timing';

const on = (p: Project, track: keyof Project['tracks']) => p.tracks?.[track]?.enabled !== false;

function colorActive(p: Project) {
  return p.color.enabled && on(p, 'color');
}

function videoUrl(s: Source, p: Project, media: CompositionProps['media'], forceOriginal = false): string {
  const c = colorActive(p) && !forceOriginal;
  if (media.mode === 'render') {
    const rel = (c && s.corrected) || s.master || s.original;
    return media.baseUrl + rel;
  }
  const rel = (c && s.correctedProxy) || s.proxy || s.original;
  return media.baseUrl + rel;
}

// ---------------------------------------------------------------- geometría del vídeo
function videoRect(s: Source, W: number, H: number, centerX: number) {
  const sw = s.width;
  const sh = s.height;
  const vertical = H > W;
  if (vertical && sw > sh) {
    // reencuadre 9:16: cubrir en altura y desplazar hacia la persona
    const scale = H / sh;
    const vw = sw * scale;
    const left = clamp(W / 2 - centerX * vw, W - vw, 0);
    return {left, top: 0, width: vw, height: H};
  }
  const scale = Math.min(W / sw, H / sh);
  const vw = sw * scale;
  const vh = sh * scale;
  return {left: (W - vw) / 2, top: (H - vh) / 2, width: vw, height: vh};
}

function reframeCenter(p: Project, sourceId: string, t: number, override?: number | null): number {
  const off = p.reframe?.offset ?? 0;
  if (override !== null && override !== undefined) return clamp(override + off, 0, 1);
  const part = p.reframe?.parts?.find((x) => x.sourceId === sourceId);
  if (!part || !part.samples.length) return clamp(0.5 + off, 0, 1);
  const sm = part.samples;
  if (t <= sm[0].t) return clamp(sm[0].x + off, 0, 1);
  for (let i = 1; i < sm.length; i++) {
    if (sm[i].t >= t) {
      const f = (t - sm[i - 1].t) / Math.max(1e-6, sm[i].t - sm[i - 1].t);
      return clamp(sm[i - 1].x * (1 - f) + sm[i].x * f + off, 0, 1);
    }
  }
  return clamp(sm[sm.length - 1].x + off, 0, 1);
}

// ---------------------------------------------------------------- zooms y transiciones
function zoomTransform(zooms: ZoomItem[], t: number) {
  let scale = 1;
  let ox = 0.5;
  let oy = 0.5;
  for (const z of zooms) {
    if (t < z.start || t >= z.end) continue;
    let s = z.scale;
    if (z.kind === 'smooth') {
      const d = z.end - z.start;
      const inEnd = z.start + d * 0.7;
      const outStart = z.end - Math.min(0.35, d * 0.2);
      const k =
        t < inEnd
          ? Easing.inOut(Easing.cubic)((t - z.start) / Math.max(0.01, inEnd - z.start))
          : t > outStart
            ? 1 - Easing.inOut(Easing.cubic)((t - outStart) / Math.max(0.01, z.end - outStart))
            : 1;
      s = 1 + (z.scale - 1) * k;
    }
    scale *= s;
    ox = z.x;
    oy = z.y;
  }
  return {scale, ox, oy};
}

function transitionState(transitions: TransitionItem[], t: number) {
  for (const tr of transitions) {
    const a = tr.at - tr.duration / 2;
    if (t >= a && t < a + tr.duration) {
      const u = (t - a) / tr.duration;
      return {tr, u, tri: 1 - Math.abs(2 * u - 1)};
    }
  }
  return null;
}

// ---------------------------------------------------------------- vídeo de un segmento
const SegmentVideo: React.FC<{span: Span; props: CompositionProps}> = ({span, props}) => {
  const s = props.project.sources.find((x) => x.id === span.seg.sourceId);
  return s ? <SegmentVideoInner span={span} props={props} s={s} /> : null;
};

const SegmentVideoInner: React.FC<{
  span: Span;
  props: CompositionProps;
  s: Source;
}> = ({span, props, s}) => {
  const {project: p, media} = props;
  const frame = useCurrentFrame();
  const {fps, width: W, height: H} = useVideoConfig();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smallRef = useRef<HTMLCanvasElement | null>(null);
  const tOut = span.start + frame / fps;
  const tSrc = span.seg.inPoint + frame / fps;
  const tSrcRef = useRef(tSrc);
  tSrcRef.current = tSrc;

  const pixItems: {item: PixelateItem; samples: NonNullable<ReturnType<typeof samplesFor>>}[] = useMemo(() => {
    if (!on(p, 'pixelado')) return [];
    return p.faces.pixelate
      .filter((it) => it.end > span.start && it.start < span.end)
      .map((item) => ({item, samples: samplesFor(p, item.faceId, s.id)}))
      .filter((x): x is {item: PixelateItem; samples: NonNullable<ReturnType<typeof samplesFor>>} => !!x.samples);
  }, [p, s, span.start, span.end]);

  const rect = videoRect(s, W, H, reframeCenter(p, s.id, tSrc, span.seg.reframeX));
  const zoom = on(p, 'zooms') ? zoomTransform(p.zooms, tOut) : {scale: 1, ox: 0.5, oy: 0.5};
  const trans = on(p, 'transiciones') ? transitionState(p.transitions, tOut) : null;
  let extraScale = 1;
  let tx = 0;
  let filter = '';
  if (trans) {
    const {tr, u, tri} = trans;
    if (tr.type === 'zoom') {
      extraScale = 1 + 0.25 * tri;
      filter = `blur(${(tri * 6).toFixed(2)}px)`;
    } else if (tr.type === 'whip') {
      tx = (u < 0.5 ? -1 : 1) * tri * W * 0.25;
      filter = `blur(${(tri * 14).toFixed(2)}px)`;
    } else if (tr.type === 'glitch') {
      tx = (random(`g${frame}`) - 0.5) * 40 * tri;
      filter = `hue-rotate(${Math.round(random(`h${frame}`) * 180 * tri)}deg) saturate(${1 + 2 * tri}) contrast(${1 + 0.5 * tri})`;
    }
  }
  const activePix = pixItems.filter(({item}) => tOut >= item.start && tOut < item.end);
  const audioUrl = s.audio ? media.baseUrl + s.audio : null;
  const volume = (span.seg.volume ?? 1) * (p.audio.voiceVolume ?? 1);

  // Pixelado: se dibujan solo las zonas de cara sobre un lienzo transparente encima del vídeo
  const onVideoFrame = useCallback(
    (img: CanvasImageSource) => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, c.width, c.height);
      const t = typeof HTMLVideoElement !== 'undefined' && img instanceof HTMLVideoElement ? img.currentTime : tSrcRef.current;
      const iw = (img as HTMLVideoElement).videoWidth || (img as HTMLImageElement).naturalWidth || (img as ImageBitmap).width;
      const ih = (img as HTMLVideoElement).videoHeight || (img as HTMLImageElement).naturalHeight || (img as ImageBitmap).height;
      if (!iw || !ih) return;
      const tOutNow = span.start + (t - span.seg.inPoint);
      for (const {item, samples} of pixItems) {
        if (tOutNow < item.start || tOutNow >= item.end) continue;
        const b = boxAt(samples, t);
        if (!b) continue;
        const [x, y, w, h] = expand(b, item.margin);
        const sx = clamp(x, 0, 1) * iw;
        const sy = clamp(y, 0, 1) * ih;
        const sw = (clamp(x + w, 0, 1) - clamp(x, 0, 1)) * iw;
        const sh = (clamp(y + h, 0, 1) - clamp(y, 0, 1)) * ih;
        if (sw < 2 || sh < 2) continue;
        const dx = (sx / iw) * c.width;
        const dy = (sy / ih) * c.height;
        const dw = (sw / iw) * c.width;
        const dh = (sh / ih) * c.height;
        if (item.mode === 'blur') {
          ctx.save();
          ctx.beginPath();
          ctx.rect(dx, dy, dw, dh);
          ctx.clip();
          ctx.filter = `blur(${blurRadius(dw, item.intensity)}px)`;
          // se dibuja una zona algo mayor para que el desenfoque no se aclare en los bordes
          const pad = blurRadius(dw, item.intensity) * 2;
          const px = Math.max(0, sx - (pad * iw) / c.width);
          const py = Math.max(0, sy - (pad * ih) / c.height);
          const pw = Math.min(iw - px, sw + (2 * pad * iw) / c.width);
          const ph = Math.min(ih - py, sh + (2 * pad * ih) / c.height);
          ctx.drawImage(img, px, py, pw, ph, (px / iw) * c.width, (py / ih) * c.height, (pw / iw) * c.width, (ph / ih) * c.height);
          ctx.restore();
        } else {
          const bx = pixelBlocks(item.intensity);
          const by = Math.max(2, Math.round((bx * sh) / sw));
          if (!smallRef.current) smallRef.current = document.createElement('canvas');
          const sm = smallRef.current;
          sm.width = bx;
          sm.height = by;
          const sctx = sm.getContext('2d');
          if (!sctx) continue;
          sctx.imageSmoothingEnabled = true;
          sctx.imageSmoothingQuality = 'high';
          sctx.drawImage(img, sx, sy, sw, sh, 0, 0, bx, by);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(sm, 0, 0, bx, by, dx, dy, dw, dh);
        }
      }
    },
    [pixItems, span.start, span.seg.inPoint],
  );

  const compare = media.mode === 'preview' && media.compare?.enabled && colorActive(p) && s.correctedProxy;
  const videoStyle: React.CSSProperties = {position: 'absolute', left: 0, top: 0, width: '100%', height: '100%'};
  const trimBefore = Math.round(span.seg.inPoint * fps);
  const showVideo = on(p, 'video');
  return (
    <AbsoluteFill>
      {showVideo && (
        <AbsoluteFill style={{transform: `translateX(${tx}px)`, filter: filter || undefined}}>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transform: `scale(${zoom.scale * extraScale})`,
              transformOrigin: `${zoom.ox * 100}% ${zoom.oy * 100}%`,
            }}
          >
            <div style={{position: 'absolute', left: rect.left, top: rect.top, width: rect.width, height: rect.height}}>
              <OffthreadVideo
                src={videoUrl(s, p, media)}
                trimBefore={trimBefore}
                muted={!!audioUrl}
                volume={audioUrl ? 0 : volume}
                style={videoStyle}
                pauseWhenBuffering
                onVideoFrame={pixItems.length ? onVideoFrame : undefined}
              />
              {compare && (
                <div style={{...videoStyle, clipPath: `inset(0 ${100 - (media.compare?.position ?? 50)}% 0 0)`}}>
                  <OffthreadVideo src={videoUrl(s, p, media, true)} trimBefore={trimBefore} muted style={videoStyle} pauseWhenBuffering />
                </div>
              )}
              {pixItems.length > 0 && (
                <canvas
                  ref={canvasRef}
                  width={Math.round(rect.width)}
                  height={Math.round(rect.height)}
                  style={{...videoStyle, opacity: activePix.length ? 1 : 0}}
                />
              )}
            </div>
          </div>
        </AbsoluteFill>
      )}
      {audioUrl && <Audio src={audioUrl} trimBefore={trimBefore} volume={volume} pauseWhenBuffering />}
    </AbsoluteFill>
  );
};

function samplesFor(p: Project, faceId: string, sourceId: string) {
  const tr = p.faces.tracks.find((t) => t.id === faceId);
  const part = tr?.parts.find((x) => x.sourceId === sourceId);
  return part && part.samples.length ? part.samples : null;
}

// ---------------------------------------------------------------- overlays de transición
const TransitionOverlay: React.FC<{p: Project}> = ({p}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  if (!on(p, 'transiciones')) return null;
  const st = transitionState(p.transitions, frame / fps);
  if (!st) return null;
  if (st.tr.type === 'fade') return <AbsoluteFill style={{background: '#000', opacity: st.tri}} />;
  if (st.tr.type === 'flash') return <AbsoluteFill style={{background: '#fff', opacity: Math.pow(st.tri, 0.7)}} />;
  if (st.tr.type === 'glitch')
    return (
      <AbsoluteFill
        style={{
          background: `linear-gradient(transparent ${random(`a${frame}`) * 80}%, rgba(255,0,80,0.35) 0, rgba(0,255,255,0.35) ${random(`b${frame}`) * 20 + 80}%, transparent 0)`,
          opacity: st.tri,
          mixBlendMode: 'screen',
        }}
      />
    );
  return null;
};

// ---------------------------------------------------------------- animaciones de entrada/salida
function useEnterExit(start: number, end: number, animation: Animation) {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const t = frame / fps;
  const local = t - start;
  const remaining = end - t;
  const sp = spring({frame: Math.max(0, local * fps), fps, config: animation === 'bounce' ? {damping: 7, stiffness: 160} : {damping: 13, stiffness: 180}});
  const outK = clamp(remaining / 0.25, 0, 1);
  let opacity = outK;
  let scale = 1;
  let dx = 0;
  let dy = 0;
  switch (animation) {
    case 'fade':
      opacity *= clamp(local / 0.35, 0, 1);
      break;
    case 'pop':
    case 'bounce':
      scale = interpolate(sp, [0, 1], [0.4, 1]);
      opacity *= clamp(local / 0.12, 0, 1);
      break;
    case 'slide-up':
      dy = interpolate(sp, [0, 1], [60, 0]);
      opacity *= clamp(local / 0.25, 0, 1);
      break;
    case 'slide-left':
      dx = interpolate(sp, [0, 1], [120, 0]);
      opacity *= clamp(local / 0.25, 0, 1);
      break;
    default:
      break;
  }
  return {opacity, scale, dx, dy, local};
}

const TextView: React.FC<{item: TextItem; offset: number}> = ({item, offset}) => {
  const {width: W, height: H} = useVideoConfig();
  const a = useEnterExit(item.start - offset, item.end - offset, item.animation);
  const st = item.style;
  let text = st.uppercase ? item.text.toUpperCase() : item.text;
  if (item.animation === 'typewriter') text = text.slice(0, Math.ceil(text.length * clamp(a.local / 0.8, 0, 1)));
  const size = st.fontSize * H;
  return (
    <div
      style={{
        position: 'absolute',
        left: item.x * W,
        top: item.y * H,
        transform: `translate(-50%, -50%) translate(${a.dx}px, ${a.dy}px) scale(${a.scale})`,
        opacity: a.opacity,
        maxWidth: W * 0.86,
        textAlign: 'center',
        fontFamily: st.font,
        fontWeight: fontWeight(st.font, st.bold) as React.CSSProperties['fontWeight'],
        fontSize: size,
        lineHeight: 1.12,
        color: st.color,
        background: st.background || undefined,
        padding: st.background ? `${size * 0.18}px ${size * 0.4}px` : 0,
        borderRadius: size * 0.2,
        WebkitTextStroke: st.strokeColor ? `${Math.max(2, size * 0.06)}px ${st.strokeColor}` : undefined,
        paintOrder: 'stroke fill',
        textShadow: st.background ? undefined : `0 ${size * 0.05}px ${size * 0.15}px rgba(0,0,0,0.55)`,
        whiteSpace: 'pre-wrap',
        width: 'max-content',
      }}
    >
      {text}
    </div>
  );
};

const EmojiView: React.FC<{item: EmojiItem; assetsUrl: string; offset: number}> = ({item, assetsUrl, offset}) => {
  const {width: W, height: H} = useVideoConfig();
  const frame = useCurrentFrame();
  const a = useEnterExit(item.start - offset, item.end - offset, item.animation);
  const size = item.size * H;
  const wobble = Math.sin(frame / 6) * 4;
  return (
    <Img
      src={`${assetsUrl}emojis/${item.file}`}
      style={{
        position: 'absolute',
        left: item.x * W - size / 2,
        top: item.y * H - size / 2,
        width: size,
        height: size,
        opacity: a.opacity,
        transform: `translate(${a.dx}px, ${a.dy}px) scale(${a.scale}) rotate(${item.rotation + wobble}deg)`,
        filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.35))',
      }}
    />
  );
};

// ---------------------------------------------------------------- subtítulos
const CaptionView: React.FC<{block: CaptionBlock; style: CaptionStyle; offset: number}> = ({block, style, offset}) => {
  const frame = useCurrentFrame();
  const {fps, width: W, height: H} = useVideoConfig();
  const t = frame / fps + offset;
  const size = style.fontSize * H;
  const preset = style.preset;
  const local = t - block.start;
  const enter = spring({frame: Math.max(0, local * fps), fps, config: {damping: 14, stiffness: 220}});
  const current = block.words.findIndex((w) => t >= w.start && t < w.end);
  const spoken = (i: number) => t >= block.words[i].start;
  const upper = style.uppercase && preset !== 'minimal';
  const baseScale = preset === 'tiktok' ? interpolate(enter, [0, 1], [0.85, 1]) : 1;
  return (
    <div
      style={{
        position: 'absolute',
        left: W / 2,
        top: style.y * H,
        transform: `translate(-50%, -50%) scale(${baseScale})`,
        width: W * 0.88,
        textAlign: 'center',
        fontFamily: style.font,
        fontWeight: fontWeight(style.font, true) as React.CSSProperties['fontWeight'],
        fontSize: preset === 'minimal' ? size * 0.75 : size,
        lineHeight: 1.18,
      }}
    >
      <span
        style={{
          background: style.background || preset === 'minimal' ? style.backgroundColor : undefined,
          padding: style.background || preset === 'minimal' ? `${size * 0.12}px ${size * 0.3}px` : undefined,
          borderRadius: size * 0.18,
          boxDecorationBreak: 'clone',
          WebkitBoxDecorationBreak: 'clone',
        }}
      >
        {block.words.map((w, i) => {
          const isCur = i === current;
          let color = style.color;
          if (preset === 'karaoke') color = spoken(i) ? style.highlightColor : style.color;
          else if (isCur && preset !== 'minimal') color = style.highlightColor;
          const pop = isCur && preset === 'tiktok' ? 1.08 : 1;
          return (
            <span
              key={i}
              style={{
                display: 'inline-block',
                margin: `0 ${size * 0.17}px`,
                color,
                transform: `scale(${pop})`,
                WebkitTextStroke: preset === 'minimal' || preset === 'neon' ? undefined : `${Math.max(2, size * 0.08)}px ${style.strokeColor}`,
                paintOrder: 'stroke fill',
                textShadow:
                  preset === 'neon'
                    ? `0 0 ${size * 0.15}px ${style.highlightColor}, 0 0 ${size * 0.4}px ${style.highlightColor}`
                    : preset === 'minimal'
                      ? undefined
                      : `0 ${size * 0.06}px ${size * 0.12}px rgba(0,0,0,0.6)`,
              }}
            >
              {upper ? w.text.toUpperCase() : w.text}
            </span>
          );
        })}
      </span>
    </div>
  );
};

// ---------------------------------------------------------------- audio: música con ducking y efectos
function duckAmount(speech: [number, number][], t: number) {
  const ramp = 0.3;
  let best = 0;
  for (const [a, b] of speech) {
    if (t >= a && t <= b) return 1;
    const d = t < a ? a - t : t - b;
    if (d < ramp) best = Math.max(best, 1 - d / ramp);
    if (a > t + ramp) break;
  }
  return best;
}

const MusicTrack: React.FC<{p: Project; assetsUrl: string; total: number}> = ({p, assetsUrl, total}) => {
  const {fps} = useVideoConfig();
  const m = p.audio.music;
  if (!m || !on(p, 'musica')) return null;
  const start = m.start ?? 0;
  const end = Math.min(m.end ?? total, total);
  if (end - start < 0.1) return null;
  return (
    <Sequence from={Math.round(start * fps)} durationInFrames={Math.max(1, Math.round((end - start) * fps))} layout="none">
      <Audio
        src={`${assetsUrl}music/${encodeURIComponent(m.file)}`}
        loop
        volume={(f) => {
          const t = start + f / fps;
          const fadeIn = clamp((t - start) / Math.max(0.01, m.fadeIn), 0, 1);
          const fadeOut = clamp((end - t) / Math.max(0.01, m.fadeOut), 0, 1);
          const duck = m.ducking ? duckAmount(p.audio.speech, t) : 0;
          return (m.volume - (m.volume - m.duckVolume) * duck) * fadeIn * fadeOut;
        }}
      />
    </Sequence>
  );
};

// ---------------------------------------------------------------- composición
export const EditorComposition: React.FC<CompositionProps> = (props) => {
  const {project: p, media} = props;
  const {fps} = useVideoConfig();
  loadFonts(media.assetsUrl);
  const spans = useMemo(() => segmentSpans(p), [p]);
  const total = spans.length ? spans[spans.length - 1].end : 0;
  const f = (t: number) => Math.round(t * fps);
  const seq = (start: number, end: number) => ({from: f(start), durationInFrames: Math.max(1, f(end) - f(start))});
  return (
    <AbsoluteFill style={{background: '#000', overflow: 'hidden'}}>
      {spans.map((sp) => {
        const from = f(sp.start);
        const dur = Math.max(1, f(sp.end) - from);
        return (
          <Sequence key={sp.seg.id} from={from} durationInFrames={dur} premountFor={media.mode === 'preview' ? fps : 0}>
            <SegmentVideo span={sp} props={props} />
          </Sequence>
        );
      })}
      <TransitionOverlay p={p} />
      {on(p, 'textos') &&
        p.texts.map((it) => (
          <Sequence key={it.id} {...seq(it.start, it.end)} layout="none">
            <TextView item={it} offset={it.start} />
          </Sequence>
        ))}
      {on(p, 'emojis') &&
        p.emojis.map((it) => (
          <Sequence key={it.id} {...seq(it.start, it.end)} layout="none">
            <EmojiView item={it} assetsUrl={media.assetsUrl} offset={it.start} />
          </Sequence>
        ))}
      {on(p, 'subtitulos') &&
        p.captions.blocks.map((b) => (
          <Sequence key={b.id} {...seq(b.start, b.end)} layout="none">
            <CaptionView block={b} style={p.captions.style} offset={b.start} />
          </Sequence>
        ))}
      <MusicTrack p={p} assetsUrl={media.assetsUrl} total={total} />
      {on(p, 'sfx') &&
        p.audio.sfx.map((s) => (
          <Sequence key={s.id} from={f(s.at)} durationInFrames={f(5)} layout="none">
            <Audio src={`${media.assetsUrl}sfx/${encodeURIComponent(s.file)}`} volume={s.volume} />
          </Sequence>
        ))}
    </AbsoluteFill>
  );
};

export function durationInFrames(p: Project, fps: number) {
  const spans = segmentSpans(p);
  const total = spans.length ? spans[spans.length - 1].end : 0;
  return Math.max(1, Math.round(total * fps));
}
