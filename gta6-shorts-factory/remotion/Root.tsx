import React from "react";
import { Composition, Still } from "remotion";
import { Short } from "./Short";
import { Thumbnail } from "./Thumbnail";
import type { ShortProps } from "./props";
import defaults from "../config/default.json";

const sampleProps: ShortProps = {
  title: "3 GTA 6 Details You Probably Missed",
  plan: {
    fps: 30,
    width: 1080,
    height: 1920,
    durationSec: 4,
    placeholderVisuals: true,
    sfx: [],
    scenes: [
      { id: "scene-1", segId: "s1", start: 0, end: 2, index: 0, visual: { kind: "title", text: "3 GTA 6 Details You Probably Missed" }, label: "NONE", asset: { type: "generated" }, camera: "push-in", transition: "cut" },
      { id: "scene-2", segId: "s2", start: 2, end: 4, index: 1, visual: { kind: "character", name: "Lucia Caminos", role: "Fresh out of Leonida Penitentiary" }, label: "CONFIRMED_FACT", source: "rockstargames.com", onScreen: "01", asset: { type: "generated" }, camera: "pan-left", transition: "zoom" },
    ],
  },
  subtitles: { words: [], pages: [] },
  captions: defaults.captions,
  brand: defaults.brand,
  channel: defaults.channel,
  assetBase: "",
  showPlaceholderLabel: true,
};

export const Root: React.FC = () => (
  <>
    <Composition
      id="Short"
      component={Short}
      width={1080}
      height={1920}
      fps={30}
      durationInFrames={120}
      defaultProps={sampleProps}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.ceil(props.plan.durationSec * props.plan.fps)),
        fps: props.plan.fps,
        width: props.plan.width,
        height: props.plan.height,
      })}
    />
    <Still id="Thumbnail" component={Thumbnail} width={1080} height={1920} defaultProps={sampleProps} />
  </>
);
