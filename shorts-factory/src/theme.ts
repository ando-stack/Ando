import { continueRender, delayRender, staticFile } from "remotion";
import type { Tone } from "./types";

export const FONT = "Montserrat, 'Noto Color Emoji', sans-serif";

export const COLORS = {
  bg1: "#07070a",
  bg2: "#1b1406",
  text: "#ffffff",
  gold: "#f5c542",
  gain: "#22c55e",
  loss: "#ef4444",
};

export const toneColor = (tone?: Tone) =>
  tone === "gain" ? COLORS.gain : tone === "loss" ? COLORS.loss : COLORS.gold;

let loaded = false;
export const loadFont = () => {
  if (loaded || typeof document === "undefined") return;
  loaded = true;
  const handle = delayRender("Loading font");
  const face = new FontFace("Montserrat", `url(${staticFile("fonts/Montserrat.ttf")})`, {
    weight: "100 900",
  });
  face
    .load()
    .then(() => {
      document.fonts.add(face);
      continueRender(handle);
    })
    .catch((err) => {
      console.error(err);
      continueRender(handle);
    });
};
