import fs from "node:fs";
import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { getConfig, r, saveSettings, SECRET_KEYS, secretStatus, setSecret, type SecretKey } from "../core/config.ts";
import { getDb } from "../core/db.ts";
import { info } from "../core/log.ts";
import { getProject, listProjects, pfile, projectDir, tryReadJson, writeJson, type ProjectOptions } from "../core/project.ts";
import { CATEGORIES, type Category, type Scene, type Script } from "../core/types.ts";
import { loadFacts } from "../content/factbank.ts";
import { getIdea, listIdeas, offlineIdeas, saveIdeas } from "../content/ideas.ts";
import { claudeAvailable, claudeIdeas, estimateClaudeCost } from "../content/claude.ts";
import { estimateSeconds, scoreScript, scriptText, words } from "../content/scoring.ts";
import { factById } from "../content/factbank.ts";
import { scanLibrary } from "../assets/library.ts";
import { GOOGLE_VOICES, KOKORO_VOICES } from "../tts/providers.ts";
import { approve, createBatch, enqueue, listJobs, pendingApprovals, produceIdea, stageStatus, startWorker, type JobKind } from "../pipeline/queue.ts";
import { STAGE_IDS } from "../pipeline/stages.ts";
import { usedTopicKeys } from "../core/project.ts";

const app = express();
app.use(express.json({ limit: "2mb" }));

const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

// ---------------------------------------------------------------- static UI
app.use("/", express.static(r("web")));
app.use("/fonts/anton", express.static(r("node_modules", "@fontsource", "anton", "files")));
app.use("/fonts/inter", express.static(r("node_modules", "@fontsource", "inter", "files")));

// ---------------------------------------------------------------- overview
app.get("/api/overview", (_req, res) => {
  const projects = listProjects();
  const count = (s: string[]) => projects.filter((p) => s.includes(p.status)).length;
  res.json({
    generated: count(["done"]),
    inProgress: count(["queued", "running", "awaiting_approval", "new"]),
    failed: count(["failed"]),
    recent: projects.slice(0, 8),
    approvals: pendingApprovals(),
    jobs: listJobs(10),
    claude: claudeAvailable(),
  });
});

app.get("/api/meta", (_req, res) => {
  res.json({ categories: CATEGORIES, stages: STAGE_IDS, kokoroVoices: KOKORO_VOICES, googleVoices: GOOGLE_VOICES, claude: claudeAvailable(), claudeEstimate: estimateClaudeCost("ideas") });
});

// ---------------------------------------------------------------- ideas + facts
app.get("/api/ideas", (req, res) => {
  const facts = new Map(loadFacts().map((f) => [f.id, f]));
  const used = usedTopicKeys();
  res.json(
    listIdeas(req.query.all === "1").map((i) => ({
      ...i,
      duplicate: used.has(i.topicKey),
      facts: i.factIds.map((id) => facts.get(id)).filter(Boolean),
    })),
  );
});

app.post(
  "/api/ideas/generate",
  wrap(async (req, res) => {
    const { category = "any", count = 6, source = "offline", approve: ok = false } = req.body as { category?: Category | "any"; count?: number; source?: string; approve?: boolean };
    if (source === "claude") {
      if (!claudeAvailable()) return res.status(400).json({ error: "Claude is not configured. Add ANTHROPIC_API_KEY in Settings." });
      const est = estimateClaudeCost("ideas");
      if (!ok) return res.json({ needsApproval: true, estimate: est });
      const out = await claudeIdeas({ category, count: Math.min(10, count), avoidTopics: [...usedTopicKeys()] });
      saveIdeas(out.ideas);
      return res.json({ ideas: out.ideas, notes: out.notes });
    }
    const ideas = offlineIdeas({ category, count: Math.min(20, count) });
    saveIdeas(ideas);
    res.json({ ideas });
  }),
);

app.get("/api/facts", (_req, res) => res.json(loadFacts()));

// ---------------------------------------------------------------- projects
app.get("/api/projects", (_req, res) => {
  res.json(
    listProjects().map((p) => ({
      ...p,
      hasVideo: fs.existsSync(pfile(p.id, "final.mp4")),
      job: getDb().prepare(`SELECT id, status, progress, message FROM jobs WHERE project_id=? ORDER BY id DESC LIMIT 1`).get(p.id),
    })),
  );
});

app.post(
  "/api/projects",
  wrap((req, res) => {
    const { ideaId, ...opts } = req.body as { ideaId: string } & ProjectOptions;
    const idea = getIdea(ideaId);
    if (!idea) return res.status(404).json({ error: "idea not found" });
    if (usedTopicKeys().has(idea.topicKey) && !req.body.allowDuplicate) return res.status(409).json({ error: "A video on this exact topic already exists. Pick another idea or allow duplicates." });
    const options: ProjectOptions = {
      targetSeconds: opts.targetSeconds ? Number(opts.targetSeconds) : undefined,
      voice: opts.voice || undefined,
      voiceProvider: opts.voiceProvider || undefined,
      captionStyle: opts.captionStyle || undefined,
      music: opts.music === undefined ? undefined : Boolean(opts.music),
    };
    const out = produceIdea(idea, options);
    res.json(out);
  }),
);

app.get("/api/projects/:id", (req, res) => {
  const id = String(req.params.id);
  const p = getProject(id);
  if (!p) return res.status(404).json({ error: "not found" });
  const files = ["final.mp4", "thumbnail.png", "contact.jpg", "voiceover.wav", "mix.wav"].filter((f) => fs.existsSync(pfile(id, f)));
  res.json({
    project: p,
    stages: stageStatus(id),
    files,
    idea: tryReadJson(id, "idea.json"),
    research: tryReadJson(id, "research.json"),
    script: tryReadJson(id, "script.json"),
    voiceover: tryReadJson(id, "voiceover.json"),
    scenes: tryReadJson(id, "scenes.json"),
    audio: tryReadJson(id, "audio.json"),
    qc: tryReadJson(id, "qc.json"),
    metadata: tryReadJson(id, "metadata.json"),
    jobs: getDb().prepare(`SELECT * FROM jobs WHERE project_id=? ORDER BY id DESC LIMIT 5`).all(id),
    logs: getDb().prepare(`SELECT level, message, at FROM logs WHERE project_id=? ORDER BY id DESC LIMIT 30`).all(id),
  });
});

const FILES = new Set(["final.mp4", "thumbnail.png", "contact.jpg", "voiceover.wav", "mix.wav"]);
app.get("/api/projects/:id/file/:name", (req, res) => {
  const id = String(req.params.id);
  const name = String(req.params.name);
  if (!FILES.has(name) || !getProject(id)) return res.status(404).end();
  const f = pfile(id, name);
  if (!fs.existsSync(f)) return res.status(404).end();
  if (req.query.download) res.attachment(`${id}-${name}`);
  res.sendFile(f);
});

app.post("/api/projects/:id/jobs", (req, res) => {
  const id = String(req.params.id);
  const { kind = "resume", fromStage } = req.body as { kind?: JobKind; fromStage?: string };
  if (!getProject(id)) return res.status(404).json({ error: "not found" });
  if (fromStage && !STAGE_IDS.includes(fromStage)) return res.status(400).json({ error: "bad stage" });
  res.json({ jobId: enqueue(id, kind, { fromStage }) });
});

/** Edit one scene (visual / camera / transition / library asset) and re-render from scene planning. */
app.patch("/api/projects/:id/scenes/:sceneId", (req, res) => {
  const id = String(req.params.id);
  if (!getProject(id)) return res.status(404).json({ error: "not found" });
  const allowed = ["visual", "camera", "transition", "asset"] as const;
  const patch: Partial<Scene> = {};
  for (const k of allowed) if (k in req.body) (patch as Record<string, unknown>)[k] = req.body[k];
  if (patch.asset && patch.asset.path) {
    // Only files already inside the project's assets folder or the approved library may be used.
    const lib = scanLibrary();
    const src = lib.find((a) => a.file === patch.asset!.path || path.basename(a.file) === path.basename(patch.asset!.path!));
    if (!src) return res.status(400).json({ error: "asset must come from the approved library" });
    fs.copyFileSync(src.file, path.join(projectDir(id), "assets", path.basename(src.file)));
    patch.asset = { type: src.type, path: `assets/${path.basename(src.file)}`, credit: src.credit, license: src.license, aiGenerated: src.aiGenerated };
  }
  const overrides = tryReadJson<Record<string, Partial<Scene>>>(id, "scene-overrides.json") ?? {};
  overrides[String(req.params.sceneId)] = { ...(overrides[String(req.params.sceneId)] ?? {}), ...patch };
  writeJson(id, "scene-overrides.json", overrides);
  res.json({ jobId: enqueue(id, "rescene") });
});

/** Edit narration text of a segment, re-score it, and regenerate the voiceover. */
app.patch("/api/projects/:id/script/:segId", (req, res) => {
  const id = String(req.params.id);
  const script = tryReadJson<Script>(id, "script.json");
  if (!script) return res.status(404).json({ error: "no script yet" });
  const seg = script.segments.find((s) => s.id === req.params.segId);
  if (!seg) return res.status(404).json({ error: "segment not found" });
  seg.text = String(req.body.text ?? seg.text).trim();
  const facts = [...new Set(script.segments.flatMap((s) => s.factIds))].map((f) => factById(f)!).filter(Boolean);
  script.score = scoreScript(script.segments, facts, { projectId: id });
  script.wordCount = words(scriptText(script.segments)).length;
  script.estSeconds = estimateSeconds(script.segments);
  script.revisions.push({ round: script.revisions.length, total: script.score.total, note: `manual edit of ${seg.id}` });
  writeJson(id, "script.json", script);
  res.json({ score: script.score, jobId: enqueue(id, "renarrate") });
});

// ---------------------------------------------------------------- batch, jobs, approvals
app.post("/api/batch", (req, res) => {
  const { count = 3, category = "any", ...opts } = req.body as { count?: number; category?: Category | "any" } & ProjectOptions;
  if (![1, 3, 5, 10].includes(Number(count))) return res.status(400).json({ error: "count must be 1, 3, 5 or 10" });
  res.json(createBatch(Number(count), category, opts));
});

app.get("/api/jobs", (_req, res) => res.json(listJobs(100)));
app.get("/api/approvals", (_req, res) => res.json(pendingApprovals()));
app.post("/api/approvals/:id", (req, res) => {
  approve(Number(req.params.id), Boolean(req.body.approve));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- settings (secrets are write-only)
app.get("/api/settings", (_req, res) => {
  const cfg = getConfig();
  res.json({ config: cfg, secrets: secretStatus(), libraryCount: scanLibrary().length });
});
app.put("/api/settings", (req, res) => {
  const body = req.body as Record<string, unknown>;
  delete body.secrets;
  res.json({ config: saveSettings(body) });
});
app.put("/api/secrets", (req, res) => {
  const { key, value } = req.body as { key: SecretKey; value: string | null };
  if (!SECRET_KEYS.includes(key)) return res.status(400).json({ error: "unknown key" });
  setSecret(key, value);
  info(`secret ${key} ${value ? "updated" : "cleared"}`);
  res.json({ secrets: secretStatus() });
});
app.get("/api/library", (_req, res) => res.json(scanLibrary().map((a) => ({ ...a, file: path.relative(r(), a.file) }))));

// ---------------------------------------------------------------- errors
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: err.message });
});

const port = Number(process.env.PORT ?? 4317);
const host = process.env.HOST ?? "127.0.0.1";
app.listen(port, host, () => {
  console.log(`GTA VI Shorts Factory dashboard → http://${host}:${port}`);
  if (process.env.FACTORY_NO_WORKER !== "1") void startWorker();
});
