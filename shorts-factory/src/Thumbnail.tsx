import React from "react";
import { AbsoluteFill } from "remotion";
import { Background } from "./Background";
import { COLORS, FONT, loadFont, toneColor } from "./theme";
import type { ThumbnailProps } from "./types";

loadFont();

const line: React.CSSProperties = {
  fontFamily: FONT,
  fontWeight: 900,
  textAlign: "center",
  textTransform: "uppercase",
  WebkitTextStroke: "14px #000", paintOrder: "stroke fill",
  textShadow: "0 12px 0 #000",
  lineHeight: 1.05,
  maxWidth: 1000,
};

export const Thumbnail: React.FC<ThumbnailProps> = ({ top, big, bottom, emoji, tone }) => {
  const accent = toneColor(tone);
  return (
    <AbsoluteFill>
      <Background accent={accent} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40 }}>
        <div style={{ ...line, fontSize: 96, color: COLORS.text }}>{top}</div>
        <div style={{ fontSize: 340, filter: "drop-shadow(0 25px 30px #000c)" }}>{emoji}</div>
        <div
          style={{
            ...line,
            fontSize: big.length > 10 ? 150 : 200,
            color: accent,
            transform: "rotate(-3deg)",
            textShadow: `0 14px 0 #000, 0 0 80px ${accent}99`,
          }}
        >
          {big}
        </div>
        <div
          style={{
            ...line,
            fontSize: 80,
            color: "#fff",
            background: COLORS.loss,
            padding: "14px 36px",
            borderRadius: 18,
            WebkitTextStroke: "0",
            textShadow: "none",
            boxShadow: "0 12px 0 #000",
          }}
        >
          {bottom}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
