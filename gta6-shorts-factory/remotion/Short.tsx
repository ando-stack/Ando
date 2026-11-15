import React from "react";
import "@fontsource/anton/400.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/inter/900.css";
import { AbsoluteFill, Audio, Easing, Img, interpolate, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { Scene } from "../src/core/types";
import { Background, Finish } from "./components/Background";
import { Captions } from "./components/Captions";
import { CutFx, LabelBadge, Ordinal, PlaceholderLabel, ProgressBar, Watermark } from "./components/Overlays";
import { VisualView } from "./components/Visuals";
import type { Brand, ShortProps } from "./props";

const OVERLAP = 6; // frames each scene stays under the next one's entrance

function cameraTransform(cam: Scene["camera"], p: number, strength: number): string {
  const e = Easing.inOut(Easing.sin)(p);
  switch (cam) {
    case "push-in": return `scale(${1 + 0.1 * strength * e})`;
    case "pull-out": return `scale(${1 + 0.1 * strength * (1 - e)})`;
    case "pan-left": return `scale(${1 + 0.06 * strength}) translateX(${(0.5 - e) * 50 * strength}px)`;
    case "pan-right": return `scale(${1 + 0.06 * strength}) translateX(${(e - 0.5) * 50 * strength}px)`;
    case "drift": return `scale(${1 + 0.05 * strength}) translate(${Math.sin(p * 3) * 14 * strength}px, ${Math.cos(p * 2) * 10 * strength}px)`;
  }
}

function enterTransform(tr: Scene["transition"], f: number): { transform: string; filter: string; opacity: number } {
  const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
  switch (tr) {
    case "zoom": {
      const p = interpolate(f, [0, 8], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
      return { transform: `scale(${1.35 - 0.35 * p})`, filter: `blur(${(1 - p) * 14}px)`, opacity: p };
    }
    case "slide": {
      const p = interpolate(f, [0, 7], [0, 1], { ...clamp, easing: Easing.out(Easing.exp) });
      return { transform: `translateX(${(1 - p) * 1080}px) skewX(${(1 - p) * -8}deg)`, filter: `blur(${(1 - p) * 8}px)`, opacity: 1 };
    }
    case "flash": {
      const p = interpolate(f, [0, 6], [0, 1], clamp);
      return { transform: `scale(${1.08 - 0.08 * p})`, filter: "none", opacity: Math.min(1, p * 2) };
    }
    case "glitch": {
      const j = f < 8 ? ((f * 53) % 40) - 20 : 0;
      return { transform: `translateX(${j}px)`, filter: f < 8 ? `hue-rotate(${f * 40}deg)` : "none", opacity: 1 };
    }
    default:
      return { transform: "none", filter: "none", opacity: 1 };
  }
}

const SceneLayer: React.FC<{ scene: Scene; brand: Brand; assetBase: string; frames: number }> = ({ scene, brand, assetBase, frames }) => {
  const f = useCurrentFrame();
  const p = Math.min(1, f / Math.max(1, frames - OVERLAP));
  const enter = enterTransform(scene.transition, f);
  const hasMedia = scene.asset.type !== "generated" && scene.asset.path && assetBase;
  const src = hasMedia ? `${assetBase}/${scene.asset.path}` : "";
  return (
    <AbsoluteFill style={{ transform: enter.transform, filter: enter.filter, opacity: enter.opacity }}>
      {hasMedia ? (
        <AbsoluteFill style={{ transform: cameraTransform(scene.camera, p, 1.6), overflow: "hidden" }}>
          {scene.asset.type === "video" ? (
            <OffthreadVideo src={src} muted style={{ width: "100%", height: "100%", objectFit: "cover", filter: "contrast(1.08) saturate(1.15)" }} />
          ) : (
            <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "contrast(1.08) saturate(1.15)" }} />
          )}
          <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(7,3,15,0.65) 0%, rgba(7,3,15,0.1) 35%, rgba(7,3,15,0.35) 60%, rgba(7,3,15,0.9) 100%)" }} />
        </AbsoluteFill>
      ) : null}
      <AbsoluteFill style={{ transform: cameraTransform(scene.camera, p, hasMedia ? 0.4 : 0.8) }}>
        <VisualView visual={scene.visual} brand={brand} />
      </AbsoluteFill>
      {scene.onScreen && scene.visual.kind !== "keyline" ? <Ordinal text={scene.onScreen} brand={brand} /> : null}
      <LabelBadge label={scene.label} source={scene.label === "CONFIRMED_FACT" ? scene.source : undefined} aiAsset={scene.asset.aiGenerated} />
      <CutFx type={scene.transition} brand={brand} />
      {scene.asset.credit ? (
        <div style={{ position: "absolute", left: 80, top: 1440, fontFamily: "Inter", fontWeight: 700, fontSize: 22, color: "#ffffff99" }}>{scene.asset.credit}</div>
      ) : null}
    </AbsoluteFill>
  );
};

export const Short: React.FC<ShortProps> = (props) => {
  const { fps, durationInFrames } = useVideoConfig();
  const { plan, brand } = props;
  return (
    <AbsoluteFill style={{ backgroundColor: brand.dark }}>
      <Background brand={brand} intensity={plan.placeholderVisuals ? 1 : 0.9} />
      {plan.scenes.map((s, i) => {
        const from = Math.round(s.start * fps);
        const next = plan.scenes[i + 1];
        const until = next ? Math.round(next.start * fps) + OVERLAP : durationInFrames;
        const frames = Math.max(1, until - from);
        return (
          <Sequence key={s.id} from={from} durationInFrames={frames} name={`${s.id} ${s.visual.kind}`}>
            <SceneLayer scene={s} brand={brand} assetBase={props.assetBase} frames={frames} />
          </Sequence>
        );
      })}
      <Finish />
      <Captions subtitles={props.subtitles} style={props.captions} />
      <ProgressBar brand={brand} />
      {props.showPlaceholderLabel ? <PlaceholderLabel /> : null}
      <Watermark handle={props.channel.handle} />
      {props.audioSrc ? <Audio src={props.audioSrc} /> : null}
    </AbsoluteFill>
  );
};
