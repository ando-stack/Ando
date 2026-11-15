import React, { useMemo } from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import type { Brand } from "../props";

/** Procedural palm silhouette (original shape, not traced from anything). */
const Palm: React.FC<{ x: number; y: number; scale: number; flip?: boolean; sway: number; color: string }> = ({ x, y, scale, flip, sway, color }) => {
  const fronds = [-150, -115, -80, -45, -15, 20, 55];
  return (
    <g transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`}>
      <path d="M0 0 C 10 -160, 40 -320, 70 -470 L 86 -468 C 58 -318, 28 -158, 22 0 Z" fill={color} />
      <g transform={`translate(78 -470) rotate(${sway})`}>
        {fronds.map((a, i) => (
          <path
            key={i}
            transform={`rotate(${a})`}
            d="M0 0 C 60 -18, 130 -10, 200 30 C 150 10, 90 6, 40 14 C 70 24, 110 40, 150 70 C 100 44, 50 30, 0 6 Z"
            fill={color}
          />
        ))}
      </g>
    </g>
  );
};

/**
 * Persistent animated backdrop shared by every scene: sunset gradient, striped
 * sun, perspective grid, palms, drifting particles. Continuity across cuts is
 * what keeps the edit from feeling like a slideshow.
 */
export const Background: React.FC<{ brand: Brand; intensity?: number }> = ({ brand, intensity = 1 }) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const t = frame / fps;
  const [g1, g2, g3] = brand.gradient;
  const horizon = height * 0.66;

  const particles = useMemo(
    () =>
      new Array(38).fill(0).map((_, i) => ({
        x: random(`px${i}`) * width,
        y: random(`py${i}`) * height,
        r: 2 + random(`pr${i}`) * 6,
        speed: 10 + random(`ps${i}`) * 40,
        o: 0.15 + random(`po${i}`) * 0.45,
      })),
    [width, height],
  );

  const gridLines = 14;
  const scroll = (t * 0.6) % 1;

  return (
    <AbsoluteFill style={{ backgroundColor: brand.dark, opacity: intensity }}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, #120624 0%, #2A0B45 28%, ${g3} 46%, ${g2} 58%, ${g1} 66%, #120624 66.2%, #07030F 100%)`,
        }}
      />
      <svg width={width} height={height} style={{ position: "absolute" }}>
        <defs>
          <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={brand.accent} />
            <stop offset="100%" stopColor={g2} />
          </linearGradient>
          <mask id="stripes">
            <rect width={width} height={height} fill="white" />
            {new Array(9).fill(0).map((_, i) => (
              <rect key={i} x={0} y={horizon - 230 + i * 30 + ((t * 18) % 30)} width={width} height={4 + i * 1.6} fill="black" />
            ))}
          </mask>
        </defs>
        <circle cx={width / 2} cy={horizon - 40} r={330} fill="url(#sun)" mask="url(#stripes)" opacity={0.85} />
        {/* perspective grid floor */}
        <g stroke={brand.primary} strokeOpacity={0.55} strokeWidth={2}>
          {new Array(gridLines).fill(0).map((_, i) => {
            const p = (i + scroll) / gridLines;
            const y = horizon + Math.pow(p, 2.2) * (height - horizon);
            return <line key={`h${i}`} x1={0} y1={y} x2={width} y2={y} strokeOpacity={0.15 + p * 0.6} />;
          })}
          {new Array(17).fill(0).map((_, i) => {
            const x = (i / 16) * width;
            return <line key={`v${i}`} x1={width / 2 + (x - width / 2) * 0.08} y1={horizon} x2={width / 2 + (x - width / 2) * 3} y2={height} />;
          })}
        </g>
        <Palm x={-60} y={horizon + 30} scale={1.25} sway={Math.sin(t * 1.1) * 3} color="#0A0414" />
        <Palm x={width + 70} y={horizon + 60} scale={1.45} flip sway={Math.sin(t * 0.9 + 1) * 3} color="#0A0414" />
        <Palm x={170} y={horizon + 10} scale={0.7} sway={Math.sin(t * 1.3 + 2) * 4} color="#12061F" />
        {particles.map((p, i) => (
          <circle key={i} cx={(p.x + Math.sin(t + i) * 20) % width} cy={(p.y - t * p.speed + height) % height} r={p.r} fill={i % 3 ? brand.secondary : brand.primary} opacity={p.o * 0.6} />
        ))}
      </svg>
      {/* darken so foreground graphics and captions always read */}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(7,3,15,0.55) 0%, rgba(7,3,15,0.25) 40%, rgba(7,3,15,0.55) 75%, rgba(7,3,15,0.85) 100%)" }} />
    </AbsoluteFill>
  );
};

let noiseTile: string | null = null;
/** 128×128 grayscale noise tile generated once per browser tab (cheap to composite every frame). */
function getNoise(): string {
  if (noiseTile) return noiseTile;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(random(`n${i}`) * 255);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  noiseTile = c.toDataURL("image/png");
  return noiseTile;
}

/** Film grain + vignette + gentle grade. Rendered on top of everything except captions. */
export const Finish: React.FC = () => {
  const frame = useCurrentFrame();
  const noise = useMemo(() => getNoise(), []);
  const ox = Math.floor(random(`gx${frame % 12}`) * 128);
  const oy = Math.floor(random(`gy${frame % 12}`) * 128);
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)" }} />
      <AbsoluteFill style={{ backgroundImage: `url(${noise})`, backgroundPosition: `${ox}px ${oy}px`, backgroundSize: "256px 256px", opacity: 0.05 }} />
      {/* warm/cool grade + drifting light leak (plain alpha blending: fast in software rendering) */}
      <AbsoluteFill style={{ background: "linear-gradient(160deg, rgba(31,209,249,0.05), rgba(255,106,61,0.06))" }} />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${interpolate(Math.sin(frame / 90), [-1, 1], [20, 80])}% 15%, rgba(255,46,136,0.12), rgba(0,0,0,0) 40%)`,
        }}
      />
    </AbsoluteFill>
  );
};
