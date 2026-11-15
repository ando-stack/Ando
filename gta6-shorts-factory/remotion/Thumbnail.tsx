import React from "react";
import "@fontsource/anton/400.css";
import "@fontsource/inter/900.css";
import { AbsoluteFill } from "remotion";
import { Background, Finish } from "./components/Background";
import { DISPLAY_FONT } from "./props";
import type { ShortProps } from "./props";

/** Vertical cover frame for the Short (1080×1920). Static: every animation settled. */
export const Thumbnail: React.FC<ShortProps> = ({ title, brand, showPlaceholderLabel }) => {
  const words = title.toUpperCase().split(/\s+/);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && (last + " " + w).length <= 10) lines[lines.length - 1] = last + " " + w;
    else lines.push(w);
  }
  return (
    <AbsoluteFill>
      <Background brand={brand} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 80 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ fontFamily: DISPLAY_FONT, fontSize: Math.min(210, 980 / Math.max(4, l.length * 0.5)), lineHeight: 1, color: /\d|GTA|6|VI|MISSED|SECRET/.test(l) ? brand.accent : "#fff", textShadow: `0 10px 0 ${brand.dark}, 0 0 60px ${brand.primary}`, transform: `rotate(${i % 2 ? 1.5 : -1.5}deg)` }}>
            {l}
          </div>
        ))}
      </AbsoluteFill>
      <Finish />
      {showPlaceholderLabel ? (
        <div style={{ position: "absolute", bottom: 440, width: "100%", textAlign: "center", fontFamily: "Inter", fontWeight: 900, fontSize: 26, color: "#ffffffaa", letterSpacing: 3 }}>ORIGINAL GRAPHICS • NOT GAMEPLAY</div>
      ) : null}
    </AbsoluteFill>
  );
};
