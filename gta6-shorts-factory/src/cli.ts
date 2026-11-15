import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { getConfig, r, secretStatus } from "./core/config.ts";
import { getDb, now } from "./core/db.ts";
import { listProjects } from "./core/project.ts";
import type { Category, Idea } from "./core/types.ts";
import { loadFacts } from "./content/factbank.ts";
import { offlineIdeas, saveIdeas, getIdea } from "./content/ideas.ts";
import { factCheck } from "./content/research.ts";
import { claudeAvailable } from "./content/claude.ts";
import { approve, createBatch, enqueue, pendingApprovals, produceIdea, runJob, stageStatus, type JobRow } from "./pipeline/queue.ts";
import { STAGE_IDS } from "./pipeline/stages.ts";
import { browserExecutable } from "./render/render.ts";
import { whisperAvailable } from "./align/whisper.ts";

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string, def?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const has = (name: string) => args.includes(`--${name}`);

async function drain() {
  // Run queued jobs in this process (CLI mode) until the queue is empty.
  for (;;) {
    const job = getDb().prepare(`SELECT * FROM jobs WHERE status='queued' ORDER BY id LIMIT 1`).get() as JobRow | undefined;
    if (!job) break;
    console.log(`\n▶ job ${job.id} (${job.kind}) for ${job.project_id}`);
    let last = "";
    const timer = setInterval(() => {
      const j = getDb().prepare(`SELECT progress, message FROM jobs WHERE id=?`).get(job.id) as { progress: number; message: string };
      const line = `  ${(j.progress * 100).toFixed(0).padStart(3)}%  ${j.message ?? ""}`;
      if (line !== last) console.log(line);
      last = line;
    }, 1500);
    const res = await runJob(job);
    clearInterval(timer);
    if (res === "skipped") {
      console.log(`  job ${job.id} was claimed by another process (e.g. the dashboard worker).`);
      break;
    }
    const p = getDb().prepare(`SELECT status, error, export_path FROM projects WHERE id=?`).get(job.project_id) as { status: string; error: string; export_path: string };
    console.log(`■ ${job.project_id}: ${res}${p.error ? `\n  ${p.error}` : ""}${p.export_path ? `\n  → ${p.export_path}` : ""}`);
  }
}

const TEST_IDEA = (): Idea => ({
  id: "idea-first-test",
  title: "3 GTA 6 Details You Probably Missed",
  category: "secrets",
  format: "listicle",
  hook: "3 GTA 6 details hiding in plain sight.",
  angle: "Three lesser-known details from Rockstar's official character bios: Jason & Brian, Cal, Lucia.",
  factIds: ["jason-rent-free", "cal-coast-guard", "lucia-father"],
  labels: ["CONFIRMED_FACT"],
  topicKey: "listicle:cal-coast-guard+jason-rent-free+lucia-father",
  writer: "offline",
  createdAt: now(),
});

async function main() {
  switch (cmd) {
    case "doctor": {
      const ok = (b: boolean) => (b ? "✔" : "✘");
      const v = (c: string, a: string[]) => {
        try {
          return execFileSync(c, a).toString().split("\n")[0];
        } catch {
          return null;
        }
      };
      console.log(`${ok(true)} Node ${process.version}`);
      console.log(`${ok(Boolean(v("ffmpeg", ["-version"])))} ${v("ffmpeg", ["-version"]) ?? "ffmpeg missing"}`);
      console.log(`${ok(Boolean(browserExecutable()))} Chromium for Remotion: ${browserExecutable() ?? "will be downloaded by Remotion on first render"}`);
      console.log(`${ok(whisperAvailable())} whisper.cpp alignment: ${whisperAvailable() ? "installed" : "installs on first use (~150 MB)"}`);
      console.log(`${ok(true)} Fact bank: ${loadFacts().length} entries`);
      const s = secretStatus();
      console.log(`  Claude API: ${s.ANTHROPIC_API_KEY ? "configured" : "not configured (offline writer is used)"}`);
      console.log(`  Google TTS: ${s.GOOGLE_TTS_API_KEY || s.GOOGLE_APPLICATION_CREDENTIALS ? "configured" : "not configured (Kokoro local TTS is used)"}`);
      console.log(`  Voice provider: ${getConfig().voice.provider}`);
      break;
    }
    case "facts:check": {
      const res = await factCheck(loadFacts());
      for (const f of res.facts) console.log(`${f.verdict.padEnd(19)} ${f.label.padEnd(15)} ${f.id}`);
      console.log(res.notes.join("\n"));
      break;
    }
    case "ideas": {
      const ideas = offlineIdeas({ category: (flag("category", "any") as Category | "any"), count: Number(flag("count", "10")) });
      saveIdeas(ideas);
      for (const i of ideas) console.log(`${i.id}  [${i.category}/${i.format}] ${i.title}\n    hook: ${i.hook}\n    facts: ${i.factIds.join(", ")}`);
      if (has("claude")) console.log(claudeAvailable() ? "Use the dashboard Idea Generator to run (paid) web research with Claude." : "Claude is not configured.");
      break;
    }
    case "produce": {
      const id = flag("idea");
      const idea = id ? getIdea(id) : null;
      if (!idea) throw new Error("usage: produce --idea <idea-id>   (see `npm run cli ideas`)");
      const { project } = produceIdea(idea, { voice: flag("voice"), voiceProvider: flag("provider") as "kokoro" | "google" | undefined });
      console.log(`created ${project.id}`);
      await drain();
      break;
    }
    case "test-short": {
      const idea = TEST_IDEA();
      const existing = listProjects().find((p) => p.topic_key === idea.topicKey && p.status !== "failed");
      if (existing && !has("new")) {
        console.log(`${existing.id} already exists (${existing.status}); resuming. Use --new for a fresh copy.`);
        enqueue(existing.id, "resume");
      } else {
        if (existing) idea.topicKey += ":" + Date.now();
        saveIdeas([idea]);
        const { project } = produceIdea(idea, {});
        console.log(`created ${project.id} — "${idea.title}"`);
      }
      await drain();
      break;
    }
    case "batch": {
      const res = createBatch(Number(flag("count", "3")), (flag("category", "any") as Category | "any"));
      console.log(res);
      if (!has("queue-only")) await drain();
      break;
    }
    case "resume": {
      const pid = args[1];
      const from = flag("from");
      if (from && !STAGE_IDS.includes(from)) throw new Error(`--from must be one of ${STAGE_IDS.join(", ")}`);
      enqueue(pid, "resume", { fromStage: from });
      await drain();
      break;
    }
    case "approvals": {
      console.table(pendingApprovals());
      break;
    }
    case "approve":
    case "reject": {
      approve(Number(args[1]), cmd === "approve");
      await drain();
      break;
    }
    case "status": {
      for (const p of listProjects()) {
        console.log(`${p.id} ${p.status.padEnd(18)} ${p.title}${p.error ? `\n   ${p.error.split("\n")[0]}` : ""}`);
        if (has("stages")) for (const s of stageStatus(p.id)) console.log(`     ${s.status.padEnd(8)} ${s.id}`);
      }
      break;
    }
    case "pron:test": {
      const { kokoroProvider } = await import("./tts/providers.ts");
      const { writeWav } = await import("./audio/wav.ts");
      const { transcribeWords } = await import("./align/whisper.ts");
      const { loadPronunciations } = await import("./tts/pronunciation.ts");
      const p = kokoroProvider(flag("voice"));
      const tmp = r(".tools", "pron.wav");
      for (const e of loadPronunciations()) {
        const res = await p.synth([{ words: [0], spoken: `Say ${e.say}.` }]);
        writeWav(tmp, [res.samples], res.sampleRate);
        console.log(`${e.term.padEnd(22)} → "${e.say}" heard as: ${(await transcribeWords(tmp)).map((w) => w.text).join(" ")}`);
      }
      fs.rmSync(tmp, { force: true });
      break;
    }
    default:
      console.log(`GTA VI Shorts Factory CLI
  doctor                       check tools, models and credentials
  facts:check                  re-verify every fact-bank claim against its source
  ideas [--category c] [--count n]
  produce --idea <id> [--voice am_michael] [--provider kokoro|google]
  test-short [--new]           build "3 GTA 6 Details You Probably Missed"
  batch --count 1|3|5|10 [--category c] [--queue-only]
  resume <video-id> [--from ${STAGE_IDS.join("|")}]
  approvals | approve <id> | reject <id>
  status [--stages]
  pron:test                    synthesize + transcribe each pronunciation entry`);
  }
}

main().catch((e) => {
  console.error("✘", e.message ?? e);
  process.exit(1);
});
