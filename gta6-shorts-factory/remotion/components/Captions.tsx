import React from "react";
import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fitText } from "@remotion/layout-utils";
import type { Subtitles } from "../../src/core/types";
import { SAFE, type CaptionStyle } from "../props";

/**
 * Word-synced captions. Words appear exactly when spoken and pop in; emphasis
 * words are yellow; the active word is slightly larger. Text auto-shrinks if a
 * page would overflow the safe width, so captions never clip.
 */
export const Captions: React.FC<{ subtitles: Subtitles; style: CaptionStyle }> = ({ subtitles, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const page = subtitles.pages.find((p) => t >= p.start - 0.02 && t < p.end);
  if (!page) return null;

  const maxWidth = SAFE.right - SAFE.left - 40;
  const text = page.words.map((w) => (style.uppercase ? w.text.toUpperCase() : w.text)).join(" ");
  let fontSize = style.fontSize;
  try {
    const fitted = fitText({ text, withinWidth: maxWidth * 2, fontFamily: style.fontFamily, fontWeight: String(style.fontWeight) }).fontSize;
    // Allow wrapping onto two lines; only shrink when even two lines would overflow.
    fontSize = Math.min(style.fontSize, fitted);
  } catch {
    /* measuring unavailable (e.g. during SSR) — keep configured size */
  }

  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.left + 20,
        width: maxWidth,
        top: style.positionY * 1920,
        transform: "translateY(-50%)",
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignContent: "center",
        columnGap: fontSize * 0.34,
        rowGap: 0,
      }}
    >
      {page.words.map((w, i) => {
        const shown = t >= w.start - 0.03;
        const active = t >= w.start && t < w.end + 0.05;
        const s = spring({ frame: frame - Math.round(w.start * fps), fps, config: { damping: 11, stiffness: 260, mass: 0.5 } });
        const scale = shown ? (0.7 + 0.3 * s) * (active ? 1.08 : 1) : 0.7;
        return (
          <span
            key={`${page.start}-${i}`}
            style={{
              fontFamily: style.fontFamily,
              fontWeight: style.fontWeight,
              fontSize,
              lineHeight: 1.12,
              color: w.highlight ? style.highlightColor : style.textColor,
              WebkitTextStroke: `${style.strokeWidth}px ${style.strokeColor}`,
              paintOrder: "stroke fill",
              textShadow: `0 6px 18px rgba(0,0,0,0.65)`,
              opacity: shown ? 1 : 0,
              transform: `scale(${scale}) rotate(${active && w.highlight ? -2 : 0}deg)`,
              display: "inline-block",
              padding: `0 ${fontSize * 0.06}px`,
              transformOrigin: "50% 60%",
              letterSpacing: 0.5,
            }}
          >
            {style.uppercase ? w.text.toUpperCase() : w.text}
          </span>
        );
      })}
    </div>
  );
};
