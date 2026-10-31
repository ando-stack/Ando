import React from "react";
import { Composition, Still } from "remotion";
import { Short } from "./Short";
import { Thumbnail } from "./Thumbnail";
import type { ShortProps, ThumbnailProps } from "./types";

const FPS = 30;

const sampleShort: ShortProps = {
  handle: "@MoneyUntold",
  playbackRate: 1,
  scenes: [
    { text: "This man could have bought Google… and said no.", emoji: "🔍", big: "$750,000", frames: 90 },
    { text: "Today Google is worth over two trillion dollars.", emoji: "📈", big: "$2 TRILLION", tone: "gain", frames: 90 },
  ],
};

const sampleThumb: ThumbnailProps = {
  top: "Google for",
  big: "$750K?",
  bottom: "He said NO",
  emoji: "🔍",
};

export const Root: React.FC = () => (
  <>
    <Composition
      id="Short"
      component={Short}
      width={1080}
      height={1920}
      fps={FPS}
      durationInFrames={180}
      defaultProps={sampleShort}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.scenes.reduce((a, s) => a + (s.frames ?? 60), 0),
      })}
    />
    <Still id="Thumbnail" component={Thumbnail} width={1080} height={1920} defaultProps={sampleThumb} />
  </>
);
