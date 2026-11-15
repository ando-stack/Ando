import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Scene } from "../../src/core/types";
import { BODY_FONT, DISPLAY_FONT, LABEL_STYLE, SAFE, type Brand } from "../props";

/** Claim label (CONFIRMED FACT / THEORY / ...) + source hint. Shown for every claim scene. */
export const LabelBadge: React.FC<{ label: Scene["label"]; source?: string; aiAsset?: boolean }> = ({ label, source, aiAsset }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const items: { text: string; color: string }[] = [];
  if (label !== "NONE" && LABEL_STYLE[label]) items.push(LABEL_STYLE[label]);
  if (aiAsset && label !== "AI_CONCEPT") items.push(LABEL_STYLE.AI_CONCEPT);
  if (!items.length) return null;
  const s = spring({ frame: frame - 4, fps, config: { damping: 14 } });
  return (
    <div style={{ position: "absolute", left: SAFE.left, top: SAFE.top - 20, transform: `translateX(${(1 - s) * -400}px)` }}>
      {items.map((it) => (
        <div key={it.text} style={{ display: "inline-flex", alignItems: "center", gap: 14, padding: "12px 24px", marginRight: 12, borderRadius: 40, background: "rgba(5,2,12,0.82)", border: `3px solid ${it.color}`, fontFamily: BODY_FONT, fontWeight: 900, fontSize: 30, color: it.color, letterSpacing: 2 }}>
          <span style={{ width: 16, height: 16, borderRadius: 8, background: it.color, boxShadow: `0 0 14px ${it.color}` }} />
          {it.text}
        </div>
      ))}
      {source ? (
        <div style={{ marginTop: 10, marginLeft: 8, fontFamily: BODY_FONT, fontWeight: 700, fontSize: 24, color: "#ffffffcc", letterSpacing: 1 }}>SOURCE: {source.toUpperCase()}</div>
      ) : null}
    </div>
  );
};

/** Ghost ordinal "01" for list items. */
export const Ordinal: React.FC<{ text: string; brand: Brand }> = ({ text, brand }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 9, stiffness: 200 } });
  return (
    <div style={{ position: "absolute", right: 1080 - SAFE.right - 10, top: SAFE.top - 40, fontFamily: DISPLAY_FONT, fontSize: 190, color: "transparent", WebkitTextStroke: `4px ${brand.accent}`, opacity: 0.9 * s, transform: `scale(${1.6 - 0.6 * s})`, transformOrigin: "right top" }}>
      {text}
    </div>
  );
};

export const ProgressBar: React.FC<{ brand: Brand }> = ({ brand }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div style={{ position: "absolute", left: 0, top: 0, height: 10, width: `${(frame / durationInFrames) * 100}%`, background: `linear-gradient(90deg, ${brand.primary}, ${brand.accent})`, boxShadow: `0 0 18px ${brand.primary}` }} />
  );
};

export const Watermark: React.FC<{ handle: string }> = ({ handle }) => (
  <div style={{ position: "absolute", left: 0, right: 0, top: SAFE.bottom - 90, textAlign: "center", fontFamily: BODY_FONT, fontWeight: 800, fontSize: 28, color: "#ffffff88", letterSpacing: 3 }}>{handle}</div>
);

export const PlaceholderLabel: React.FC = () => (
  <div style={{ position: "absolute", right: 1080 - SAFE.right, top: SAFE.top - 120, fontFamily: BODY_FONT, fontWeight: 800, fontSize: 22, color: "#ffffffb0", letterSpacing: 2, textAlign: "right" }}>
    ORIGINAL MOTION GRAPHICS
    <br />
    NOT GAMEPLAY FOOTAGE
  </div>
);

/** One-shot flash / glitch overlay at a cut. */
export const CutFx: React.FC<{ type: Scene["transition"]; brand: Brand }> = ({ type, brand }) => {
  const frame = useCurrentFrame();
  if (type === "flash") {
    const o = interpolate(frame, [0, 6], [0.75, 0], { extrapolateRight: "clamp" });
    return <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: o }} />;
  }
  if (type === "glitch" && frame < 9) {
    const bars = [0.12, 0.33, 0.57, 0.81];
    return (
      <>
        {bars.map((y, i) => (
          <div key={i} style={{ position: "absolute", left: ((frame * 37 + i * 91) % 120) - 60, top: `${y * 100}%`, width: "100%", height: 40 + i * 12, background: i % 2 ? brand.secondary : brand.primary, opacity: 0.45 }} />
        ))}
      </>
    );
  }
  return null;
};
