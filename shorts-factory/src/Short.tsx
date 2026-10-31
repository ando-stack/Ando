import React from "react";
import {
  AbsoluteFill,
  Html5Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Background } from "./Background";
import { COLORS, FONT, loadFont, toneColor } from "./theme";
import type { Scene, ShortProps } from "./types";

loadFont();

const WORDS_PER_CAPTION = 3;

/** Word timings spread over the scene by word length (good enough for TTS speech). */
const timeWords = (text: string, frames: number) => {
  const words = text.split(/\s+/).filter(Boolean);
  const weights = words.map((w) => w.replace(/[^\w$%]/g, "").length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  let acc = 0;
  return words.map((word, i) => {
    const start = (acc / total) * frames;
    acc += weights[i];
    return { word, start, end: (acc / total) * frames };
  });
};

/** Groups words into short captions, breaking after punctuation. */
const groupWords = <T extends { word: string }>(words: T[]) => {
  const groups: T[][] = [];
  let current: T[] = [];
  for (const w of words) {
    current.push(w);
    if (current.length >= WORDS_PER_CAPTION || /[.,!?;:…]$/.test(w.word)) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length) groups.push(current);
  return groups;
};

const Captions: React.FC<{ scene: Scene; frames: number; speechFrames: number }> = ({
  scene,
  speechFrames,
}) => {
  const frame = useCurrentFrame();
  const words = timeWords(scene.text, speechFrames);
  const groups = groupWords(words);
  const group =
    groups.find((g) => frame < g[g.length - 1].end) ?? groups[groups.length - 1];
  const accent = toneColor(scene.tone);

  return (
    <div
      style={{
        position: "absolute",
        top: 1180,
        left: 70,
        right: 70,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: "0 34px",
      }}
    >
      {group.map((w, i) => {
        const active = frame >= w.start && frame < w.end;
        const pop = spring({ frame: frame - w.start, fps: 30, config: { damping: 12 } });
        return (
          <span
            key={`${w.word}-${i}`}
            style={{
              fontFamily: FONT,
              fontWeight: 900,
              fontSize: 92,
              lineHeight: 1.15,
              textTransform: "uppercase",
              color: active ? accent : COLORS.text,
              transform: `scale(${active ? 1 + pop * 0.06 : 1})`,
              textShadow: "0 8px 0 #000, 0 0 30px #000",
              WebkitTextStroke: "10px #000", paintOrder: "stroke fill",
            }}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
};

const Visual: React.FC<{ scene: Scene; isHook: boolean }> = ({ scene, isHook }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  // The hook starts fully visible: frame 0 is what people see while scrolling.
  const enter = isHook ? 1 : spring({ frame, fps, config: { damping: 14 } });
  const float = Math.sin(frame / 12) * 10;
  const accent = toneColor(scene.tone);

  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "flex-start", paddingTop: 300 }}
    >
      {scene.emoji ? (
        <div
          style={{
            fontSize: 260,
            transform: `translateY(${float}px) scale(${enter})`,
            filter: "drop-shadow(0 20px 30px #000c)",
          }}
        >
          {scene.emoji}
        </div>
      ) : null}
      {scene.big ? (
        <div
          style={{
            marginTop: 30,
            maxWidth: 980,
            textAlign: "center",
            fontFamily: FONT,
            fontWeight: 900,
            fontSize: scene.big.length > 12 ? 110 : 150,
            lineHeight: 1.05,
            color: accent,
            textTransform: "uppercase",
            transform: `scale(${interpolate(enter, [0, 1], [0.4, 1])}) rotate(${interpolate(enter, [0, 1], [-8, -2])}deg)`,
            textShadow: `0 10px 0 #000, 0 0 60px ${accent}88`,
            WebkitTextStroke: "12px #000", paintOrder: "stroke fill",
          }}
        >
          {scene.big}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

const EndCard: React.FC<{ handle: string }> = ({ handle }) => {
  const frame = useCurrentFrame();
  const s = spring({ frame, fps: 30, config: { damping: 12 } });
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "flex-end", paddingBottom: 260 }}>
      <div
        style={{
          transform: `scale(${s})`,
          background: COLORS.gold,
          color: "#000",
          fontFamily: FONT,
          fontWeight: 900,
          fontSize: 54,
          padding: "22px 44px",
          borderRadius: 999,
          boxShadow: "0 14px 0 #000",
        }}
      >
        FOLLOW {handle.toUpperCase()}
      </div>
    </AbsoluteFill>
  );
};

export const Short: React.FC<ShortProps> = ({ handle, playbackRate, scenes }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  let from = 0;
  const lastStart = scenes.slice(0, -1).reduce((a, s) => a + (s.frames ?? 60), 0);

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg1 }}>
      <Background accent={toneColor(scenes[0]?.tone)} />
      {scenes.map((scene, i) => {
        const frames = scene.frames ?? 60;
        const start = from;
        from += frames;
        const isLast = i === scenes.length - 1;
        return (
          <Sequence
            key={i}
            from={start}
            durationInFrames={isLast ? durationInFrames - start : frames}
          >
            {scene.audio ? (
              <Html5Audio src={staticFile(scene.audio)} playbackRate={playbackRate} />
            ) : null}
            <Visual scene={scene} isHook={i === 0} />
            <Captions scene={scene} frames={frames} speechFrames={Math.max(frames - 5, 10)} />
          </Sequence>
        );
      })}
      <Sequence from={lastStart}>
        <EndCard handle={handle} />
      </Sequence>
      {/* Progress bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          height: 14,
          width: `${(frame / durationInFrames) * 100}%`,
          background: COLORS.gold,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 60,
          width: "100%",
          textAlign: "center",
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 38,
          letterSpacing: 2,
          color: "#ffffffaa",
        }}
      >
        {handle}
      </div>
    </AbsoluteFill>
  );
};
