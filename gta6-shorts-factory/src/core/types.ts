// Shared data model for every project file under projects/<id>/.

export type ClaimLabel = "CONFIRMED_FACT" | "THEORY" | "SPECULATION" | "AI_CONCEPT";

export const LABEL_TEXT: Record<ClaimLabel, string> = {
  CONFIRMED_FACT: "CONFIRMED FACT",
  THEORY: "THEORY",
  SPECULATION: "SPECULATION",
  AI_CONCEPT: "AI-GENERATED CONCEPT",
};

export type Category =
  | "secrets"
  | "facts"
  | "theories"
  | "comparisons"
  | "mysteries"
  | "ai-concepts"
  | "news"
  | "characters";

export const CATEGORIES: { id: Category; name: string }[] = [
  { id: "secrets", name: "Secrets & hidden details" },
  { id: "facts", name: "Facts & discoveries" },
  { id: "theories", name: "Theories" },
  { id: "comparisons", name: "GTA VI vs GTA V" },
  { id: "mysteries", name: "Mysteries" },
  { id: "ai-concepts", name: "AI-generated concepts" },
  { id: "news", name: "News & updates" },
  { id: "characters", name: "Characters & story" },
];

export interface Source {
  url: string;
  title: string;
  publisher: string;
  /** Date shown on the source, if any (ISO). */
  publishedAt?: string;
  /** When we last read/verified it (ISO). */
  retrievedAt: string;
  /** Short supporting quote or paraphrase of what the source says. */
  quote?: string;
  primary: boolean;
}

/** Visual hint used by the scene planner. */
export type VisualSpec =
  | { kind: "title"; text: string }
  | { kind: "character"; name: string; role: string }
  | { kind: "map"; region: string; regions?: string[] }
  | { kind: "stat"; value: string; caption: string }
  | { kind: "quote"; text: string; attribution: string }
  | { kind: "versus"; left: string; right: string; leftLabel?: string; rightLabel?: string }
  | { kind: "icon"; icon: "radio" | "boat" | "lock" | "calendar" | "console" | "money" | "music" | "eye" | "question" | "pin"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "keyline"; text: string; emphasis: string[] };

export interface Fact {
  id: string;
  category: Category;
  label: ClaimLabel;
  /** Plain-language claim (for research / fact check). */
  claim: string;
  /** Ready-to-speak narration line for this beat. */
  line: string;
  /** Words to highlight in captions. */
  emphasis: string[];
  visual: VisualSpec;
  keywords: string[];
  /** Topic key used to avoid duplicate videos. */
  topic: string;
  sources: Source[];
  /** Facts that may go stale (dates, platforms) must be re-verified after this date. */
  recheckAfter?: string;
  /** If the label is THEORY/SPECULATION, a phrase hedging it in narration is required. */
  hedge?: string;
}

export interface Idea {
  id: string;
  title: string;
  category: Category;
  format: "listicle" | "deep-dive" | "theory" | "versus" | "news";
  hook: string;
  angle: string;
  factIds: string[];
  labels: ClaimLabel[];
  topicKey: string;
  writer: "offline" | "claude";
  createdAt: string;
}

export interface ResearchResult {
  checkedAt: string;
  online: boolean;
  facts: {
    id: string;
    claim: string;
    label: ClaimLabel;
    verdict: "verified" | "source-unreachable" | "stale" | "unsupported";
    sources: (Source & { reachable?: boolean; httpStatus?: number })[];
    notes?: string;
  }[];
  /** Notes such as release-date status. */
  notes: string[];
}

export type SegmentRole = "hook" | "context" | "main" | "payoff";

export interface ScriptSegment {
  id: string;
  role: SegmentRole;
  text: string;
  /** Spoken label prefix like "Number one." is part of text; this is what to show on screen. */
  onScreen?: string;
  label: ClaimLabel | "NONE";
  factIds: string[];
  emphasis: string[];
  visual: VisualSpec;
}

export interface ScriptScore {
  hook: number;
  clarity: number;
  originality: number;
  accuracy: number;
  visual: number;
  retention: number;
  total: number;
  issues: string[];
}

export interface Script {
  title: string;
  segments: ScriptSegment[];
  wordCount: number;
  estSeconds: number;
  score: ScriptScore;
  revisions: { round: number; total: number; note: string }[];
  writer: "offline" | "claude";
}

export interface WordTiming {
  text: string;
  start: number;
  end: number;
  segId: string;
  highlight: boolean;
  /** Word ended with punctuation (caption page break hint). */
  brk?: boolean;
}

export interface Voiceover {
  file: string;
  provider: string;
  voice: string;
  durationSec: number;
  segments: { segId: string; start: number; end: number }[];
  alignment: "tts-marks" | "whisper" | "proportional";
}

export interface CaptionPage {
  start: number;
  end: number;
  words: WordTiming[];
}

export interface Subtitles {
  words: WordTiming[];
  pages: CaptionPage[];
}

export interface PlannedAsset {
  type: "image" | "video" | "generated";
  path?: string;
  credit?: string;
  license?: string;
  aiGenerated?: boolean;
}

export interface Scene {
  id: string;
  segId: string;
  start: number;
  end: number;
  visual: VisualSpec;
  label: ClaimLabel | "NONE";
  onScreen?: string;
  /** Domain of the primary source, shown under the claim label. */
  source?: string;
  asset: PlannedAsset;
  camera: "push-in" | "pull-out" | "pan-left" | "pan-right" | "drift";
  transition: "cut" | "flash" | "slide" | "zoom" | "glitch";
  index: number;
}

export interface ScenePlan {
  fps: number;
  width: number;
  height: number;
  durationSec: number;
  scenes: Scene[];
  sfx: { t: number; type: "whoosh" | "impact" | "riser" | "reveal" | "tick" }[];
  placeholderVisuals: boolean;
}

export interface Metadata {
  titles: string[];
  description: string;
  hashtags: string[];
  pinnedComment: string;
  category: string;
  youtubeCategoryId: number;
  sources: { url: string; title: string; retrievedAt: string }[];
  aiDisclosure: { recommended: boolean; youtubeAlteredContentToggle: boolean; reason: string; descriptionLine: string };
  labelsUsed: string[];
}

export interface QcCheck {
  name: string;
  ok: boolean;
  detail: string;
  severity: "error" | "warning";
}
