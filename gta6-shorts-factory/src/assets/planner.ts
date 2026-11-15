import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../core/config.ts";
import type { Scene, ScenePlan, Script, Subtitles, Voiceover, VisualSpec } from "../core/types.ts";
import { factById } from "../content/factbank.ts";
import { bestAsset, scanLibrary } from "./library.ts";

const CAMERAS: Scene["camera"][] = ["push-in", "pan-left", "pull-out", "pan-right", "drift"];
const MAX_SCENE = 5.2; // seconds before a segment is split into two visual beats

function visualKeywords(v: VisualSpec): string[] {
  switch (v.kind) {
    case "character": return [v.name];
    case "map": return [v.region, ...(v.regions ?? [])];
    case "icon": return [v.icon, v.text];
    case "quote": return [v.attribution];
    case "versus": return [v.left, v.right];
    case "title": return [v.text];
    case "stat": return [v.caption];
    case "list": return v.items;
    case "keyline": return v.emphasis;
  }
}

/**
 * Turn script + voiceover timing into a scene plan.
 * - One scene per segment; long segments get a second "keyline" beat at a sentence/clause break.
 * - Each scene gets the best-matching approved library asset, else original motion graphics.
 * - Camera moves rotate; transitions vary by role; SFX are cued from the cuts.
 */
export function planScenes(projectId: string, projectDirPath: string, script: Script, vo: Voiceover, subs: Subtitles): ScenePlan {
  const cfg = getConfig();
  const lib = scanLibrary();
  const used = new Set<string>();
  const scenes: Scene[] = [];
  const total = vo.durationSec;

  script.segments.forEach((seg, si) => {
    const span = vo.segments.find((s) => s.segId === seg.id)!;
    const start = si === 0 ? 0 : span.start - 0.08; // cut just before the words start
    const nextSpan = vo.segments[si + 1];
    const end = nextSpan ? nextSpan.start - 0.08 : total;

    const words = subs.words.filter((w) => w.segId === seg.id);
    const beats: { start: number; end: number; visual: VisualSpec }[] = [];
    if (end - start > MAX_SCENE && seg.role !== "hook" && words.length > 6) {
      // Split at the punctuation break closest to the middle.
      const mid = (start + end) / 2;
      const breaks = words.filter((w, i) => w.brk && i < words.length - 2);
      const pick = (breaks.length ? breaks : words).reduce((a, b) => (Math.abs(b.end - mid) < Math.abs(a.end - mid) ? b : a));
      const cut = Math.min(end - 1.4, Math.max(start + 1.6, pick.end + 0.05));
      const second = words.filter((w) => w.start >= cut).map((w) => w.text).join(" ");
      beats.push({ start, end: cut, visual: seg.visual });
      beats.push({ start: cut, end, visual: { kind: "keyline", text: second, emphasis: seg.emphasis } });
    } else beats.push({ start, end, visual: seg.visual });

    for (const b of beats) {
      const facts = seg.factIds.map((id) => factById(id)).filter(Boolean);
      const keywords = [...visualKeywords(b.visual), ...seg.emphasis, ...facts.flatMap((f) => f!.keywords)];
      const lib1 = bestAsset(lib, keywords, used);
      let asset: Scene["asset"] = { type: "generated" };
      if (lib1) {
        used.add(lib1.file);
        // Copy into the project so the render (and later re-renders) are self-contained.
        const dest = path.join(projectDirPath, "assets", path.basename(lib1.file));
        if (!fs.existsSync(dest)) fs.copyFileSync(lib1.file, dest);
        asset = { type: lib1.type, path: `assets/${path.basename(lib1.file)}`, credit: lib1.credit, license: lib1.license, aiGenerated: lib1.aiGenerated };
      }
      const i = scenes.length;
      scenes.push({
        id: `scene-${i + 1}`,
        segId: seg.id,
        start: +b.start.toFixed(3),
        end: +b.end.toFixed(3),
        visual: b.visual,
        label: seg.label,
        onScreen: seg.onScreen,
        source: (() => {
          const src = facts.flatMap((f) => f!.sources).find((x) => x.primary) ?? facts.flatMap((f) => f!.sources)[0];
          return src ? new URL(src.url).hostname.replace(/^www\./, "") : undefined;
        })(),
        asset,
        camera: CAMERAS[i % CAMERAS.length],
        transition: i === 0 ? "cut" : seg.role === "payoff" && b === beats[0] ? "glitch" : b.visual.kind === "keyline" ? "slide" : seg.role === "main" ? "zoom" : "flash",
        index: i,
      });
    }
  });

  // SFX cue sheet
  const sfx: ScenePlan["sfx"] = [{ t: 0.0, type: "reveal" }];
  for (const s of scenes.slice(1)) {
    sfx.push({ t: Math.max(0, s.start - 0.18), type: "whoosh" });
    const seg = script.segments.find((x) => x.id === s.segId)!;
    if (seg.role === "main" && s.visual.kind !== "keyline") sfx.push({ t: s.start + 0.05, type: "impact" });
  }
  const payoff = scenes.find((s) => script.segments.find((x) => x.id === s.segId)?.role === "payoff");
  if (payoff && payoff.start > 2) sfx.push({ t: Math.max(0, payoff.start - 1.4), type: "riser" });
  sfx.sort((a, b) => a.t - b.t);

  return {
    fps: cfg.video.fps,
    width: cfg.video.width,
    height: cfg.video.height,
    durationSec: +total.toFixed(3),
    scenes,
    sfx: sfx.filter((x) => cfg.sfx.enabled),
    placeholderVisuals: scenes.every((s) => s.asset.type === "generated"),
  };
}
