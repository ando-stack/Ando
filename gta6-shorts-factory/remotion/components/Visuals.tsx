import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { VisualSpec } from "../../src/core/types";
import { BODY_FONT, DISPLAY_FONT, SAFE, type Brand } from "../props";

const useT = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return { frame, fps, t: frame / fps };
};

const pop = (frame: number, fps: number, delay = 0, damping = 12) =>
  spring({ frame: frame - delay, fps, config: { damping, stiffness: 180, mass: 0.6 } });

/** Big condensed headline, one word per line, words pop in with a stagger. */
export const Headline: React.FC<{ text: string; brand: Brand; size?: number; highlight?: (w: string, i: number) => boolean; y?: number }> = ({ text, brand, size = 150, highlight, y = SAFE.top + 140 }) => {
  const { frame, fps } = useT();
  const words = text.toUpperCase().split(/\s+/);
  // Pack words into lines of ~11 chars so long titles stay inside the safe area.
  const lines: string[][] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && last.join(" ").length + w.length + 1 <= 11) last.push(w);
    else lines.push([w]);
  }
  // Fit the widest line, and keep the block within ~4 lines of height so it never reaches the captions.
  const fit = Math.min(size, 900 / Math.max(...lines.map((l) => l.join(" ").length * 0.47)), (4 * size) / Math.max(4, lines.length));
  let k = 0;
  return (
    <div style={{ position: "absolute", top: y, left: SAFE.left, right: 1080 - SAFE.right, textAlign: "center" }}>
      {lines.map((line, li) => (
        <div key={li} style={{ fontFamily: DISPLAY_FONT, fontSize: fit, lineHeight: 1.02, letterSpacing: 1, whiteSpace: "nowrap" }}>
          {line.map((w) => {
            const i = k++;
            const s = pop(frame, fps, 3 + i * 3);
            const isHi = highlight ? highlight(w, i) : /\d|GTA|VI|6/.test(w);
            return (
              <span
                key={i}
                style={{
                  display: "inline-block",
                  margin: "0 12px",
                  transform: `translateY(${(1 - s) * 60}px) scale(${0.6 + 0.4 * s})`,
                  opacity: s,
                  color: isHi ? brand.accent : "#fff",
                  textShadow: `0 6px 0 ${brand.dark}, 0 0 40px ${isHi ? brand.accent : brand.primary}88`,
                }}
              >
                {w}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

const Brackets: React.FC<{ w: number; h: number; color: string }> = ({ w, h, color }) => {
  const L = 50;
  const st = { stroke: color, strokeWidth: 6, fill: "none" } as const;
  return (
    <svg width={w} height={h} style={{ position: "absolute", left: 0, top: 0 }}>
      <path d={`M0 ${L} V0 H${L}`} {...st} />
      <path d={`M${w - L} 0 H${w} V${L}`} {...st} />
      <path d={`M0 ${h - L} V${h} H${L}`} {...st} />
      <path d={`M${w - L} ${h} H${w} V${h - L}`} {...st} />
    </svg>
  );
};

/** Dossier-style character card. No likeness is used: monogram + generic silhouette. */
export const CharacterCard: React.FC<{ name: string; role: string; brand: Brand }> = ({ name, role, brand }) => {
  const { frame, fps, t } = useT();
  const W = 880, H = 740;
  const s = pop(frame, fps, 0, 14);
  const initials = name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const scan = (t * 0.7) % 1;
  return (
    <div style={{ position: "absolute", left: (1080 - W) / 2, top: SAFE.top + 120, width: W, height: H, transform: `scale(${0.85 + 0.15 * s})`, opacity: s }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(160deg, rgba(20,8,38,0.92), rgba(10,4,20,0.85))", border: `2px solid ${brand.primary}55`, boxShadow: `0 0 80px ${brand.primary}33` }} />
      <Brackets w={W} h={H} color={brand.secondary} />
      <div style={{ position: "absolute", left: 40, top: 30, fontFamily: "monospace", fontSize: 26, color: brand.secondary, letterSpacing: 4 }}>
        FILE // LEONIDA // {initials}-{String(name.length * 37).padStart(4, "0")}
      </div>
      {/* generic silhouette + monogram */}
      <svg width={380} height={420} style={{ position: "absolute", left: (W - 380) / 2, top: 90 }}>
        <defs>
          <linearGradient id="sil" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={brand.primary} stopOpacity={0.9} />
            <stop offset="100%" stopColor={brand.gradient[2]} stopOpacity={0.3} />
          </linearGradient>
        </defs>
        <circle cx={190} cy={150} r={95} fill="url(#sil)" />
        <path d="M30 420 C 40 300, 110 255, 190 255 C 270 255, 340 300, 350 420 Z" fill="url(#sil)" />
        <text x={190} y={180} textAnchor="middle" fontFamily="Anton" fontSize={96} fill="#fff">{initials}</text>
      </svg>
      <div style={{ position: "absolute", left: 0, right: 0, top: 520, textAlign: "center", fontFamily: DISPLAY_FONT, fontSize: name.length > 12 ? 92 : 112, color: "#fff", letterSpacing: 2, textShadow: `0 0 30px ${brand.primary}` }}>
        {name.toUpperCase()}
      </div>
      <div style={{ position: "absolute", left: 40, right: 40, top: 655, textAlign: "center", fontFamily: BODY_FONT, fontWeight: 800, fontSize: 38, color: brand.accent, opacity: interpolate(frame, [10, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
        {role}
      </div>
      {/* scanning line */}
      <div style={{ position: "absolute", left: 0, right: 0, top: scan * H, height: 3, background: `linear-gradient(90deg, transparent, ${brand.secondary}, transparent)`, opacity: 0.7 }} />
    </div>
  );
};

/** Illustrative, original stylized map of a fictional state. Positions are not official. */
const MAP_PINS: Record<string, [number, number]> = {
  "Vice City": [640, 610],
  "Leonida Keys": [470, 790],
  Grassrivers: [520, 560],
  "Port Gellhorn": [250, 200],
  Ambrosia: [470, 330],
  "Mount Kalaga": [330, 150],
};

export const MapView: React.FC<{ region: string; regions?: string[]; brand: Brand }> = ({ region, regions, brand }) => {
  const { frame, fps, t } = useT();
  // Always show the whole state; a single featured region is highlighted, the rest are dimmed for context.
  const list = regions?.length ? regions : Object.keys(MAP_PINS);
  const featured = !regions?.length && MAP_PINS[region] ? region : null;
  const draw = interpolate(frame, [0, 25], [2600, 0], { extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", left: 90, top: SAFE.top + 60, width: 900, height: 800 }}>
      <svg width={900} height={760} viewBox="0 0 900 900" style={{ overflow: "hidden" }}>
        <g>
          <path
            d="M120 90 L 760 70 L 780 160 L 700 230 C 690 330, 720 430, 700 520 C 690 610, 640 690, 590 740 C 560 770, 520 760, 500 720 C 470 640, 430 560, 380 500 C 330 440, 300 360, 260 300 C 220 240, 160 200, 110 180 Z"
            fill="rgba(31,209,249,0.08)"
            stroke={brand.secondary}
            strokeWidth={5}
            strokeDasharray={2600}
            strokeDashoffset={draw}
          />
          {[...Array(5)].map((_, i) => (
            <circle key={i} cx={460 + i * 22} cy={800 + (i % 2) * 18} r={9 - i} fill="none" stroke={brand.secondary} strokeWidth={3} opacity={interpolate(frame, [20, 30], [0, 0.8], { extrapolateRight: "clamp", extrapolateLeft: "clamp" })} />
          ))}
          {list.map((name, i) => {
            const p = MAP_PINS[name];
            if (!p) return null;
            const hot = featured ? name === featured : true;
            // The featured region lands first; context pins follow.
            const order = featured ? (hot ? 0 : 1 + list.filter((n) => n !== featured).indexOf(name)) : i;
            const s = pop(frame, fps, 10 + order * 5);
            const fs = featured ? (hot ? 60 : 30) : 40;
            return (
              <g key={name} transform={`translate(${p[0]} ${p[1]}) scale(${s})`}>
                <circle r={(hot ? 22 : 12) + Math.sin(t * 4 + i) * 4} fill={brand.primary} opacity={hot ? 0.45 : 0.2} />
                <circle r={hot ? 12 : 7} fill={hot ? brand.accent : "#ffffff99"} />
                <text x={p[0] > 600 ? -22 : 22} y={fs / 3} textAnchor={p[0] > 600 ? "end" : "start"} fontFamily="Anton" fontSize={fs} fill={hot ? "#fff" : "#ffffff88"} stroke="#000" strokeWidth={6} paintOrder="stroke">
                  {name.toUpperCase()}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div style={{ position: "absolute", left: 0, top: 770, fontFamily: BODY_FONT, fontWeight: 700, fontSize: 24, color: "#ffffffaa", letterSpacing: 2 }}>
        ILLUSTRATIVE MAP — NOT TO SCALE
      </div>
    </div>
  );
};

const ICONS: Record<string, (c: string) => React.ReactNode> = {
  radio: (c) => (
    <g stroke={c} strokeWidth={10} fill="none" strokeLinecap="round">
      <path d="M150 260 L 150 120" />
      <path d="M110 260 L 150 120 L 190 260" />
      <circle cx={150} cy={110} r={12} fill={c} />
      <path d="M105 70 A 60 60 0 0 0 105 150" />
      <path d="M195 70 A 60 60 0 0 1 195 150" />
      <path d="M75 40 A 100 100 0 0 0 75 180" />
      <path d="M225 40 A 100 100 0 0 1 225 180" />
    </g>
  ),
  boat: (c) => (
    <g stroke={c} strokeWidth={10} fill="none" strokeLinejoin="round" strokeLinecap="round">
      <path d="M40 190 L 260 190 L 225 240 L 75 240 Z" />
      <path d="M150 190 L 150 60 L 230 170 L 150 170" />
      <path d="M30 265 C 70 250, 100 280, 150 265 C 200 250, 230 280, 270 265" />
    </g>
  ),
  calendar: (c) => (
    <g stroke={c} strokeWidth={10} fill="none">
      <rect x={50} y={70} width={200} height={180} rx={18} />
      <path d="M50 120 H 250 M100 45 V 95 M200 45 V 95" strokeLinecap="round" />
      <path d="M95 165 h20 M140 165 h20 M185 165 h20 M95 205 h20 M140 205 h20" strokeLinecap="round" />
    </g>
  ),
  console: (c) => (
    <g stroke={c} strokeWidth={10} fill="none" strokeLinecap="round">
      <path d="M70 110 H230 C 270 110, 290 230, 255 240 C 225 248, 205 200, 185 195 H115 C 95 200, 75 248, 45 240 C 10 230, 30 110, 70 110 Z" />
      <path d="M95 150 v40 M75 170 h40" />
      <circle cx={200} cy={160} r={8} fill={c} />
      <circle cx={225} cy={185} r={8} fill={c} />
    </g>
  ),
  music: (c) => (
    <g stroke={c} strokeWidth={10} fill="none" strokeLinecap="round">
      <path d="M120 220 V 70 L 230 50 V 200" />
      <ellipse cx={95} cy={222} rx={30} ry={22} fill={c} />
      <ellipse cx={205} cy={202} rx={30} ry={22} fill={c} />
    </g>
  ),
  question: (c) => (
    <text x={150} y={250} textAnchor="middle" fontFamily="Anton" fontSize={260} fill={c}>?</text>
  ),
  eye: (c) => (
    <g stroke={c} strokeWidth={10} fill="none">
      <path d="M30 150 C 90 60, 210 60, 270 150 C 210 240, 90 240, 30 150 Z" />
      <circle cx={150} cy={150} r={45} fill={c} />
    </g>
  ),
  lock: (c) => (
    <g stroke={c} strokeWidth={10} fill="none">
      <rect x={80} y={135} width={140} height={115} rx={14} />
      <path d="M105 135 V 100 A 45 45 0 0 1 195 100 V 135" />
    </g>
  ),
  money: (c) => <text x={150} y={240} textAnchor="middle" fontFamily="Anton" fontSize={230} fill={c}>$</text>,
  pin: (c) => (
    <g stroke={c} strokeWidth={10} fill="none">
      <path d="M150 260 C 90 180, 70 140, 70 110 A 80 80 0 0 1 230 110 C 230 140, 210 180, 150 260 Z" />
      <circle cx={150} cy={110} r={28} fill={c} />
    </g>
  ),
};

export const IconCard: React.FC<{ icon: string; text: string; brand: Brand }> = ({ icon, text, brand }) => {
  const { frame, fps, t } = useT();
  const s = pop(frame, fps, 0, 10);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: SAFE.top + 70, height: 820 }}>
      <svg width={1080} height={600} style={{ position: "absolute", left: 0, top: 0 }}>
        {[0, 1, 2].map((i) => {
          const p = ((t * 0.8 + i / 3) % 1);
          return <circle key={i} cx={540} cy={320} r={170 + p * 160} fill="none" stroke={brand.primary} strokeWidth={4} opacity={(1 - p) * 0.6} />;
        })}
        <circle cx={540} cy={320} r={185} fill="rgba(10,4,20,0.85)" stroke={brand.secondary} strokeWidth={6} />
        <g transform={`translate(390 170) scale(${s})`} style={{ transformOrigin: "150px 150px" }}>
          {(ICONS[icon] ?? ICONS.question)(brand.accent)}
        </g>
      </svg>
      <div style={{ position: "absolute", top: 590, left: SAFE.left, right: 1080 - SAFE.right, textAlign: "center", fontFamily: DISPLAY_FONT, fontSize: text.length > 18 ? 76 : 96, color: "#fff", lineHeight: 1.05, textShadow: `0 0 30px ${brand.primary}`, opacity: interpolate(frame, [6, 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), transform: `translateY(${interpolate(frame, [6, 16], [30, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)` }}>
        {text}
      </div>
    </div>
  );
};

export const QuoteCard: React.FC<{ text: string; attribution: string; brand: Brand }> = ({ text, attribution, brand }) => {
  const { frame, fps } = useT();
  const { durationInFrames } = useVideoConfig();
  const words = text.split(/\s+/);
  const span = Math.max(10, durationInFrames * 0.55);
  const size = text.length > 50 ? 70 : text.length > 32 ? 84 : 100;
  return (
    <div style={{ position: "absolute", left: SAFE.left + 10, right: 1080 - SAFE.right + 10, top: SAFE.top + 90 }}>
      <div style={{ fontFamily: DISPLAY_FONT, fontSize: 260, lineHeight: 0.8, color: brand.primary, transform: `scale(${pop(frame, fps, 0)})`, transformOrigin: "left top" }}>“</div>
      <div style={{ fontFamily: DISPLAY_FONT, fontSize: size, lineHeight: 1.08, color: "#fff", marginTop: -40 }}>
        {words.map((w, i) => {
          const at = (i / words.length) * span;
          const o = interpolate(frame, [at, at + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <span key={i} style={{ opacity: o, display: "inline-block", marginRight: 18, transform: `translateY(${(1 - o) * 20}px)` }}>
              {w.toUpperCase()}
            </span>
          );
        })}
      </div>
      <div style={{ marginTop: 34, fontFamily: BODY_FONT, fontWeight: 800, fontSize: 36, color: brand.accent, letterSpacing: 2 }}>— {attribution.toUpperCase()}</div>
    </div>
  );
};

export const VersusCard: React.FC<{ left: string; right: string; leftLabel?: string; rightLabel?: string; brand: Brand }> = ({ left, right, leftLabel, rightLabel, brand }) => {
  const { frame, fps } = useT();
  const sl = pop(frame, fps, 0), sr = pop(frame, fps, 5);
  const box = (txt: string, sub: string | undefined, color: string, s: number, fromLeft: boolean) => (
    <div style={{ width: 430, height: 620, background: `linear-gradient(180deg, ${color}55, rgba(10,4,20,0.9))`, border: `4px solid ${color}`, transform: `translateX(${(1 - s) * (fromLeft ? -500 : 500)}px)`, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: DISPLAY_FONT, fontSize: 120, color: "#fff" }}>{txt}</div>
      {sub ? <div style={{ fontFamily: BODY_FONT, fontWeight: 800, fontSize: 34, color: "#fff", opacity: 0.85 }}>{sub}</div> : null}
    </div>
  );
  return (
    <div style={{ position: "absolute", top: SAFE.top + 100, left: 0, right: 0, display: "flex", justifyContent: "center", gap: 40 }}>
      {box(left, leftLabel, brand.secondary, sl, true)}
      {box(right, rightLabel, brand.primary, sr, false)}
      <div style={{ position: "absolute", top: 250, left: 480, width: 120, height: 120, borderRadius: 60, background: brand.accent, color: brand.dark, fontFamily: DISPLAY_FONT, fontSize: 64, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${pop(frame, fps, 10)})` }}>VS</div>
    </div>
  );
};

/** Kinetic emphasis beat: the key words of the line, huge, with a sweep underline. */
export const Keyline: React.FC<{ text: string; emphasis: string[]; brand: Brand }> = ({ text, emphasis, brand }) => {
  const { frame, fps } = useT();
  const clean = (w: string) => w.replace(/[^A-Za-z0-9'-]/g, "").toLowerCase();
  const em = new Set(emphasis.map(clean));
  const words = text.split(/\s+/);
  const key = words.filter((w) => em.has(clean(w)) || em.has(clean(w).replace(/'s$/, "")));
  const big = (key.length ? key : words.slice(0, 3)).slice(0, 3).map((w) => w.replace(/[.,!?;:]+$/, "").toUpperCase());
  const sweep = interpolate(frame, [8, 22], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ position: "absolute", top: SAFE.top + 170, left: SAFE.left, right: 1080 - SAFE.right, textAlign: "center" }}>
      {big.map((w, i) => {
        const s = pop(frame, fps, i * 4, 9);
        const fs = Math.min(210, 880 / Math.max(3, w.length * 0.5));
        return (
          <div key={i} style={{ fontFamily: DISPLAY_FONT, fontSize: fs, lineHeight: 1, color: i % 2 ? "#fff" : brand.accent, transform: `scale(${0.4 + 0.6 * s}) rotate(${(1 - s) * (i % 2 ? 6 : -6)}deg)`, opacity: s, textShadow: `0 8px 0 ${brand.dark}, 0 0 50px ${brand.primary}AA` }}>
            {w}
          </div>
        );
      })}
      <div style={{ margin: "26px auto 0", height: 12, width: `${sweep * 70}%`, background: `linear-gradient(90deg, ${brand.primary}, ${brand.accent})`, borderRadius: 6 }} />
    </div>
  );
};

export const ListCard: React.FC<{ items: string[]; brand: Brand }> = ({ items, brand }) => {
  const { frame, fps } = useT();
  return (
    <div style={{ position: "absolute", top: SAFE.top + 120, left: SAFE.left + 20, right: 1080 - SAFE.right }}>
      {items.map((it, i) => {
        const s = pop(frame, fps, i * 6);
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 30, transform: `translateX(${(1 - s) * -300}px)`, opacity: s }}>
            <div style={{ fontFamily: DISPLAY_FONT, fontSize: 80, color: brand.accent, width: 110 }}>{String(i + 1).padStart(2, "0")}</div>
            <div style={{ fontFamily: DISPLAY_FONT, fontSize: 64, color: "#fff" }}>{it.toUpperCase()}</div>
          </div>
        );
      })}
    </div>
  );
};

export const StatCard: React.FC<{ value: string; caption: string; brand: Brand }> = ({ value, caption, brand }) => {
  const { frame, fps } = useT();
  return (
    <div style={{ position: "absolute", top: SAFE.top + 160, left: 0, right: 0, textAlign: "center" }}>
      <div style={{ fontFamily: DISPLAY_FONT, fontSize: 300, color: brand.accent, transform: `scale(${pop(frame, fps, 0, 8)})`, textShadow: `0 0 60px ${brand.primary}` }}>{value}</div>
      <div style={{ fontFamily: DISPLAY_FONT, fontSize: 80, color: "#fff" }}>{caption.toUpperCase()}</div>
    </div>
  );
};

export const VisualView: React.FC<{ visual: VisualSpec; brand: Brand }> = ({ visual: v, brand }) => {
  switch (v.kind) {
    case "title": return <Headline text={v.text} brand={brand} />;
    case "character": return <CharacterCard name={v.name} role={v.role} brand={brand} />;
    case "map": return <MapView region={v.region} regions={v.regions} brand={brand} />;
    case "icon": return <IconCard icon={v.icon} text={v.text} brand={brand} />;
    case "quote": return <QuoteCard text={v.text} attribution={v.attribution} brand={brand} />;
    case "versus": return <VersusCard {...v} brand={brand} />;
    case "list": return <ListCard items={v.items} brand={brand} />;
    case "stat": return <StatCard value={v.value} caption={v.caption} brand={brand} />;
    case "keyline": return <Keyline text={v.text} emphasis={v.emphasis} brand={brand} />;
  }
};

export const FullBleed: React.FC<{ children: React.ReactNode }> = ({ children }) => <AbsoluteFill>{children}</AbsoluteFill>;
