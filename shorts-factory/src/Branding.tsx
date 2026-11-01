import React from "react";
import { AbsoluteFill } from "remotion";
import { Background } from "./Background";
import { COLORS, FONT, loadFont } from "./theme";

loadFont();

/** Gold coin with a dollar sign: the channel's logo. */
export const Coin: React.FC<{ size: number }> = ({ size }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: "50%",
      background: `repeating-conic-gradient(#b8860b 0deg 3deg, #f5c542 3deg 6deg)`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: `0 ${size * 0.04}px ${size * 0.12}px #000c, 0 0 ${size * 0.35}px ${COLORS.gold}55`,
    }}
  >
    <div
      style={{
        width: size * 0.84,
        height: size * 0.84,
        borderRadius: "50%",
        background: "radial-gradient(circle at 35% 30%, #fff3b0 0%, #f5c542 35%, #c8961c 100%)",
        boxShadow: "inset 0 0 0 6px #a87810, inset 0 -12px 30px #8a5f0a88",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: FONT,
        fontWeight: 900,
        fontSize: size * 0.58,
        color: "#1a1206",
        textShadow: "0 4px 0 #fff6",
        lineHeight: 1,
        paddingBottom: size * 0.02,
      }}
    >
      $
    </div>
  </div>
);

export const Avatar: React.FC = () => (
  <AbsoluteFill>
    <Background accent={COLORS.gold} />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <Coin size={560} />
    </AbsoluteFill>
  </AbsoluteFill>
);

// YouTube banner: 2560×1440. Everything important sits inside the central
// 1546×423 safe area, which is what phones show.
export const Banner: React.FC<{ name: string; handle: string }> = ({ name, handle }) => (
  <AbsoluteFill>
    <Background accent={COLORS.gold} />
    <AbsoluteFill
      style={{ background: "radial-gradient(ellipse at 50% 50%, #0000 0%, #000a 70%), #0008" }}
    />
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 1546, height: 423, display: "flex", alignItems: "center", gap: 50, justifyContent: "center" }}>
        <Coin size={280} />
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div
            style={{
              fontFamily: FONT,
              fontWeight: 900,
              fontSize: 118,
              lineHeight: 1,
              color: "#fff",
              textTransform: "uppercase",
              WebkitTextStroke: "14px #000",
              paintOrder: "stroke fill",
              textShadow: "0 12px 0 #000",
              whiteSpace: "nowrap",
            }}
          >
            {name.split(" ")[0]} <span style={{ color: COLORS.gold }}>{name.split(" ").slice(1).join(" ")}</span>
          </div>
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 44, color: "#ffffffdd" }}>
            Real money stories in under 60 seconds
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 10 }}>
            <div
              style={{
                fontFamily: FONT,
                fontWeight: 900,
                fontSize: 36,
                background: COLORS.gold,
                color: "#000",
                padding: "10px 28px",
                borderRadius: 999,
              }}
            >
              NEW SHORT EVERY DAY
            </div>
            <div style={{ fontFamily: FONT, fontWeight: 800, fontSize: 36, color: "#ffffffaa", padding: "10px 0" }}>
              {handle}
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  </AbsoluteFill>
);
