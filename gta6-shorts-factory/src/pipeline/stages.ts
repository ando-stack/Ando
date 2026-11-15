import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../core/config.ts";
import { getDb, now } from "../core/db.ts";
import { exportsRoot, getProject, pfile, projectDir, projectOptions, readJson, tryReadJson, writeJson } from "../core/project.ts";
import type { Idea, Metadata, QcCheck, ResearchResult, Scene, ScenePlan, Script, Subtitles, Voiceover } from "../core/types.ts";
import { factById } from "../content/factbank.ts";
import { blockingProblems, factCheck } from "../content/research.ts";
import { writeScriptOffline } from "../content/writer.ts";
import { claudeAvailable, claudeScript, estimateClaudeCost } from "../content/claude.ts";
import { markPhraseUsed } from "../content/phrases.ts";
import { scriptText } from "../content/scoring.ts";
import { narrate, spokenChars } from "../tts/narrate.ts";
import { buildPages } from "../tts/captions.ts";
import { getProvider } from "../tts/providers.ts";
import { planScenes } from "../assets/planner.ts";
import { mixAudio, prepareMusic, prepareSfx } from "../audio/mix.ts";
import { renderThumbnail, renderVideo } from "../render/render.ts";
import { contactSheet, qcPassed, runQc } from "../render/qc.ts";
import { buildMetadata } from "../metadata/metadata.ts";

export class ApprovalNeeded extends Error {
  constructor(public stage: string, public provider: string, public usd: number, public detail: string) {
    super(`Approval needed: ${provider} (~$${usd.toFixed(3)}) — ${detail}`);
  }
}

export class StageError extends Error {
  constructor(message: string, public retryable = false) {
    super(message);
  }
}

export interface StageCtx {
  id: string;
  dir: string;
  progress: (fraction: number, message?: string) => void;
}

export interface StageDef {
  id: string;
  name: string;
  /** Files whose presence proves the stage finished. */
  outputs: string[];
  retries: number;
  run: (ctx: StageCtx) => Promise<void>;
}

/** Ask once per project+stage+provider; resolves when the user has approved in the dashboard/CLI. */
export function requireApproval(projectId: string, stage: string, provider: string, usd: number, detail: string) {
  if (!getConfig().costs.requireApproval || usd <= 0) return;
  const db = getDb();
  const row = db.prepare(`SELECT status FROM approvals WHERE project_id=? AND stage=? AND provider=? ORDER BY id DESC LIMIT 1`).get(projectId, stage, provider) as { status: string } | undefined;
  if (row?.status === "approved") return;
  if (row?.status === "rejected") throw new StageError(`${provider} was rejected for this project. Switch to the free option in Settings and resume.`);
  if (!row) db.prepare(`INSERT INTO approvals (project_id, stage, provider, estimate_usd, detail, created_at) VALUES (?,?,?,?,?,?)`).run(projectId, stage, provider, usd, detail, now());
  throw new ApprovalNeeded(stage, provider, usd, detail);
}

const idea = (id: string) => readJson<Idea>(id, "idea.json");

export const STAGES: StageDef[] = [
  {
    id: "research",
    name: "Fact checking",
    outputs: ["research.json"],
    retries: 1,
    async run({ id, progress }) {
      const i = idea(id);
      const facts = [...i.factIds, "release-date"].map((f) => factById(f)).filter((f): f is NonNullable<typeof f> => Boolean(f));
      if (facts.length < i.factIds.length) throw new StageError(`Idea references facts that no longer exist: ${i.factIds.filter((f) => !factById(f)).join(", ")}`);
      progress(0.2, `checking ${facts.length} claims against their sources`);
      const research = await factCheck(facts);
      writeJson(id, "research.json", research);
      const blocking = blockingProblems(research).filter((p) => i.factIds.some((f) => p.startsWith(f + ":")));
      if (blocking.length) throw new StageError(`Fact check failed:\n${blocking.join("\n")}`);
    },
  },
  {
    id: "script",
    name: "Script writing + quality check",
    outputs: ["script.json"],
    retries: 1,
    async run({ id, progress }) {
      const i = idea(id);
      const cfg = getConfig();
      const research = readJson<ResearchResult>(id, "research.json");
      const useClaude = i.writer === "claude" || (cfg.script.writer === "claude" && claudeAvailable());
      let script: Script;
      if (useClaude) {
        const est = estimateClaudeCost("script");
        requireApproval(id, "script", "Claude script writing", est.usd, est.detail);
        progress(0.2, "writing with Claude");
        const facts = i.factIds.map((f) => factById(f)!).filter(Boolean);
        script = await claudeScript(i, facts, id);
      } else {
        progress(0.2, "assembling script from verified facts");
        script = writeScriptOffline(i, id);
      }
      // Drop the release-date line if the live check says the date changed.
      const status = research.notes.join(" ");
      if (script.segments.some((s) => s.factIds.includes("release-date")) && !/november 19, 2026/i.test(status) && research.online)
        throw new StageError(`Release status changed (${status}). Update the release-date fact before producing.`);
      writeJson(id, "script.json", script);
      if (script.score.total < cfg.script.qualityThreshold)
        throw new StageError(`Script scored ${script.score.total} (< ${cfg.script.qualityThreshold}) after ${script.revisions.length} rounds:\n${script.score.issues.join("\n")}`);
      markPhraseUsed("hook", script.segments[0].text, id);
      markPhraseUsed("payoff", script.segments[script.segments.length - 1].text.replace(/^.*?([^.]*\?)$/, "$1").trim(), id);
      getDb().prepare(`DELETE FROM phrases WHERE kind='script' AND project_id=?`).run(id);
      markPhraseUsed("script", scriptText(script.segments), id);
    },
  },
  {
    id: "voiceover",
    name: "Voiceover",
    outputs: ["voiceover.wav", "voiceover.json", "words.json"],
    retries: 2,
    async run({ id, dir, progress }) {
      const opts = projectOptions(id);
      const script = readJson<Script>(id, "script.json");
      const provider = getProvider(opts.voiceProvider, opts.voice);
      const usd = provider.estimateUsd(spokenChars(script));
      requireApproval(id, "voiceover", `Google TTS (${provider.voice})`, usd, `${spokenChars(script)} characters. Google's first 1M characters/month are free; the estimate assumes you are past that.`);
      progress(0.05, `synthesizing with ${provider.id} (${provider.voice})`);
      const { voiceover, subtitles } = await narrate(script, provider, path.join(dir, "voiceover.wav"), (f) => progress(0.05 + f * 0.75, "synthesizing"));
      progress(0.9, `aligned words via ${voiceover.alignment}`);
      writeJson(id, "voiceover.json", voiceover);
      writeJson(id, "words.json", subtitles.words);
    },
  },
  {
    id: "scenes",
    name: "Asset selection + scene planning",
    outputs: ["scenes.json"],
    retries: 1,
    async run({ id, dir }) {
      const script = readJson<Script>(id, "script.json");
      const vo = readJson<Voiceover>(id, "voiceover.json");
      const words = readJson<Subtitles["words"]>(id, "words.json");
      const plan = planScenes(id, dir, script, vo, { words, pages: buildPages(words) });
      // Manual per-scene edits from the Video Library survive re-planning.
      const overrides = tryReadJson<Record<string, Partial<Scene>>>(id, "scene-overrides.json") ?? {};
      for (const s of plan.scenes) if (overrides[s.id]) Object.assign(s, overrides[s.id]);
      plan.placeholderVisuals = plan.scenes.every((s) => s.asset.type === "generated");
      writeJson(id, "scenes.json", plan);
    },
  },
  {
    id: "subtitles",
    name: "Subtitle alignment",
    outputs: ["subtitles.json"],
    retries: 0,
    async run({ id }) {
      const words = readJson<Subtitles["words"]>(id, "words.json");
      const vo = readJson<Voiceover>(id, "voiceover.json");
      const bad = words.filter((w) => w.end > vo.durationSec + 0.05 || w.start < 0);
      if (bad.length) throw new StageError(`${bad.length} caption words fall outside the narration.`);
      writeJson(id, "subtitles.json", { words, pages: buildPages(words) } satisfies Subtitles);
    },
  },
  {
    id: "audio",
    name: "Music, SFX + audio mix",
    outputs: ["mix.wav", "audio.json"],
    retries: 1,
    async run({ id, dir, progress }) {
      const cfg = getConfig();
      const opts = projectOptions(id);
      const plan = readJson<ScenePlan>(id, "scenes.json");
      const seq = getProject(id)!.seq;
      const musicOn = opts.music ?? cfg.music.enabled;
      progress(0.1, "music");
      const music = musicOn ? prepareMusic(path.join(dir, "assets", "music.wav"), plan.durationSec, seq) : null;
      progress(0.4, "sound effects");
      const sfx = cfg.sfx.enabled ? prepareSfx(path.join(dir, "assets", "sfx.wav"), plan) : null;
      progress(0.6, "mixing + loudness normalization");
      const res = mixAudio({
        voice: path.join(dir, "voiceover.wav"),
        music: music ? path.join(dir, "assets", "music.wav") : undefined,
        sfx: sfx ? path.join(dir, "assets", "sfx.wav") : undefined,
        out: path.join(dir, "mix.wav"),
        durationSec: plan.durationSec,
      });
      writeJson(id, "audio.json", { music, sfx, measuredInput: res.measuredInput, targetLufs: cfg.audio.targetLufs });
    },
  },
  {
    id: "render",
    name: "Video assembly + final render",
    outputs: ["final.mp4", "thumbnail.png"],
    retries: 1,
    async run({ id, dir, progress }) {
      const plan = readJson<ScenePlan>(id, "scenes.json");
      const subtitles = readJson<Subtitles>(id, "subtitles.json");
      const title = idea(id).title;
      progress(0.02, "bundling templates");
      await renderVideo({ projectDir: dir, title, plan, subtitles, audio: path.join(dir, "mix.wav"), out: path.join(dir, "final.mp4"), onProgress: (p) => progress(0.02 + p * 0.9, `rendering frames ${(p * 100).toFixed(0)}%`) });
      progress(0.94, "thumbnail");
      await renderThumbnail({ projectDir: dir, title, plan, subtitles, out: path.join(dir, "thumbnail.png") });
    },
  },
  {
    id: "qc",
    name: "Quality validation",
    outputs: ["qc.json"],
    retries: 0,
    async run({ id, dir, progress }) {
      progress(0.1, "checking video, audio, captions and claims");
      const checks: QcCheck[] = await runQc({
        projectDir: dir,
        video: path.join(dir, "final.mp4"),
        script: readJson<Script>(id, "script.json"),
        plan: readJson<ScenePlan>(id, "scenes.json"),
        subtitles: readJson<Subtitles>(id, "subtitles.json"),
        research: readJson<ResearchResult>(id, "research.json"),
      });
      writeJson(id, "qc.json", { checkedAt: now(), passed: qcPassed(checks), checks });
      contactSheet(path.join(dir, "final.mp4"), path.join(dir, "contact.jpg"), readJson<ScenePlan>(id, "scenes.json").durationSec);
      if (!qcPassed(checks)) {
        const failed = checks.filter((c) => !c.ok && c.severity === "error");
        throw new StageError(`Quality check failed:\n${failed.map((c) => `${c.name}: ${c.detail}`).join("\n")}`);
      }
    },
  },
  {
    id: "export",
    name: "Metadata + MP4 export",
    outputs: ["metadata.json"],
    retries: 0,
    async run({ id, dir }) {
      const i = idea(id);
      const meta: Metadata = buildMetadata(i, readJson<Script>(id, "script.json"), readJson<ResearchResult>(id, "research.json"), readJson<ScenePlan>(id, "scenes.json"));
      writeJson(id, "metadata.json", meta);
      const slug = i.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
      const outDir = exportsRoot();
      fs.mkdirSync(outDir, { recursive: true });
      const base = path.join(outDir, `${id}-${slug}`);
      fs.copyFileSync(path.join(dir, "final.mp4"), `${base}.mp4`);
      fs.copyFileSync(path.join(dir, "thumbnail.png"), `${base}.thumbnail.png`);
      const txt = [
        `TITLE OPTIONS:\n${meta.titles.map((t, k) => `${k + 1}. ${t}`).join("\n")}`,
        `\nDESCRIPTION:\n${meta.description}`,
        `\nPINNED COMMENT:\n${meta.pinnedComment}`,
        `\nCATEGORY: ${meta.category} (YouTube category ${meta.youtubeCategoryId})`,
        `\nAI DISCLOSURE: ${meta.aiDisclosure.youtubeAlteredContentToggle ? "Turn ON" : "Not required:"} ${meta.aiDisclosure.reason}`,
      ].join("\n");
      fs.writeFileSync(`${base}.metadata.txt`, txt);
      getDb().prepare(`UPDATE projects SET export_path=? WHERE id=?`).run(`${base}.mp4`, id);
    },
  },
];

export const STAGE_IDS = STAGES.map((s) => s.id);

export function stageDone(projectId: string, stage: StageDef): boolean {
  const row = getDb().prepare(`SELECT status FROM stage_runs WHERE project_id=? AND stage=?`).get(projectId, stage.id) as { status: string } | undefined;
  return row?.status === "done" && stage.outputs.every((o) => fs.existsSync(pfile(projectId, o)));
}

/** Forget a stage and everything after it so the next run regenerates them. */
export function invalidateFrom(projectId: string, fromStage: string) {
  const idx = STAGE_IDS.indexOf(fromStage);
  if (idx < 0) throw new Error(`unknown stage ${fromStage}`);
  const later = STAGE_IDS.slice(idx);
  const db = getDb();
  for (const s of later) db.prepare(`DELETE FROM stage_runs WHERE project_id=? AND stage=?`).run(projectId, s);
  if (later.includes("voiceover") || later.includes("script")) db.prepare(`DELETE FROM approvals WHERE project_id=? AND status='pending'`).run(projectId);
  void projectDir;
}
