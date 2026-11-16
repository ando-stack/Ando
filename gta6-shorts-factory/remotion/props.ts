import type { ScenePlan, Subtitles } from "../src/core/types";

export interface CaptionStyle {
  style: string;
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  textColor: string;
  highlightColor: string;
  strokeColor: string;
  strokeWidth: number;
  maxWordsPerPage: number;
  maxCharsPerPage: number;
  positionY: number;
  uppercase: boolean;
}

export interface Brand {
  primary: string;
  secondary: string;
  accent: string;
  dark: string;
  gradient: string[];
}

export interface ShortProps {
  title: string;
  plan: ScenePlan;
  subtitles: Subtitles;
  captions: CaptionStyle;
  brand: Brand;
  channel: { name: string; handle: string };
  /** Base URL (http://...) for project assets, or "" when none are used. */
  assetBase: string;
  /** Optional narration for Studio preview; renders are muxed with the final mix by FFmpeg. */
  audioSrc?: string;
  showPlaceholderLabel: boolean;
  /** Show "SOURCE: domain" under claim labels (sources are always in the description). */
  showSource?: boolean;
  [key: string]: unknown;
}

export const LABEL_STYLE: Record<string, { text: string; color: string }> = {
  CONFIRMED_FACT: { text: "CONFIRMED FACT", color: "#22C55E" },
  THEORY: { text: "THEORY", color: "#F59E0B" },
  SPECULATION: { text: "SPECULATION", color: "#FB7185" },
  AI_CONCEPT: { text: "AI-GENERATED CONCEPT", color: "#A78BFA" },
};

// YouTube Shorts UI safe area (1080×1920): keep essential content inside this box.
export const SAFE = { top: 230, bottom: 1500, left: 70, right: 960 };

export const DISPLAY_FONT = "Anton, 'Inter', sans-serif";
export const BODY_FONT = "Inter, sans-serif";
