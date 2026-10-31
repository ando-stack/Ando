import React from "react";
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONT } from "./theme";

// Dark background with a slow gold glow and dollar signs drifting up.
export const Background: React.FC<{ accent: string }> = ({ accent }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const glowX = 50 + Math.sin(frame / 90) * 18;
  const glowY = 40 + Math.cos(frame / 110) * 10;

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at ${glowX}% ${glowY}%, ${accent}33 0%, ${COLORS.bg2} 35%, ${COLORS.bg1} 75%)`,
      }}
    >
      {new Array(18).fill(0).map((_, i) => {
        const speed = 0.6 + random(`s${i}`) * 1.2;
        const size = 40 + random(`z${i}`) * 90;
        const x = random(`x${i}`) * width;
        const y = height + 200 - ((frame * speed + random(`y${i}`) * (height + 400)) % (height + 400));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x,
              top: y,
              fontFamily: FONT,
              fontWeight: 900,
              fontSize: size,
              color: COLORS.gold,
              opacity: 0.05 + random(`o${i}`) * 0.07,
              transform: `rotate(${Math.sin((frame + i * 20) / 40) * 15}deg)`,
            }}
          >
            $
          </div>
        );
      })}
      <AbsoluteFill
        style={{ background: "linear-gradient(180deg, #0000 55%, #000a 100%)" }}
      />
    </AbsoluteFill>
  );
};
