import { getDb, now, recoverOrphans } from "../core/db.ts";
import { error, info, warn } from "../core/log.ts";
import { createProject, getProject, projectDir, updateProject, type ProjectOptions } from "../core/project.ts";
import type { Category, Idea } from "../core/types.ts";
import { offlineIdeas, saveIdeas } from "../content/ideas.ts";
import { ApprovalNeeded, STAGES, STAGE_IDS, StageError, invalidateFrom, stageDone } from "./stages.ts";

export type JobKind = "produce" | "renarrate" | "rescene" | "resubtitle" | "rerender" | "resume";

export const JOB_FROM: Record<JobKind, string | null> = {
  produce: null,
  resume: null,
  renarrate: "voiceover",
  rescene: "scenes",
  resubtitle: "subtitles",
  rerender: "render",
};

export interface JobRow {
  id: number;
  project_id: string;
  kind: JobKind;
  from_stage: string | null;
  status: string;
  attempts: number;
  max_attempts: number;
  progress: number;
  message: string | null;
  batch_id: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  owner_pid?: number | null;
}

export function enqueue(projectId: string, kind: JobKind, opts: { fromStage?: string; batchId?: string } = {}): number {
  const db = getDb();
  const active = db.prepare(`SELECT id FROM jobs WHERE project_id=? AND status IN ('queued','running')`).get(projectId) as { id: number } | undefined;
  if (active) return active.id;
  const from = opts.fromStage ?? JOB_FROM[kind];
  if (from) invalidateFrom(projectId, from);
  const res = db
    .prepare(`INSERT INTO jobs (project_id, kind, from_stage, status, batch_id, created_at) VALUES (?, ?, ?, 'queued', ?, ?)`)
    .run(projectId, kind, from ?? null, opts.batchId ?? null, now());
  updateProject(projectId, { status: "queued", error: null });
  return Number(res.lastInsertRowid);
}

export function listJobs(limit = 50): JobRow[] {
  return getDb().prepare(`SELECT * FROM jobs ORDER BY id DESC LIMIT ?`).all(limit) as unknown as JobRow[];
}

function setJob(id: number, patch: Partial<JobRow>) {
  const keys = Object.keys(patch) as (keyof JobRow)[];
  getDb()
    .prepare(`UPDATE jobs SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`)
    .run(...keys.map((k) => patch[k] as string | number | null), id);
}

/** Run one job: execute every unfinished stage in order, checkpointing each one. */
export async function runJob(job: JobRow): Promise<"done" | "failed" | "awaiting_approval" | "skipped"> {
  const db = getDb();
  const pid = job.project_id;
  // Atomically claim the job so two processes (dashboard + CLI) never run it twice.
  const claimed = db.prepare(`UPDATE jobs SET status='running', owner_pid=?, started_at=?, attempts=attempts+1 WHERE id=? AND status='queued'`).run(process.pid, now(), job.id);
  if (Number(claimed.changes) !== 1) return "skipped";
  updateProject(pid, { status: "running", error: null });
  const dir = projectDir(pid);
  for (let si = 0; si < STAGES.length; si++) {
    const stage = STAGES[si];
    if (stageDone(pid, stage)) continue;
    const base = si / STAGES.length;
    const progress = (f: number, msg?: string) => {
      setJob(job.id, { progress: Math.min(0.999, base + f / STAGES.length), message: `${stage.name}${msg ? `: ${msg}` : ""}` });
    };
    updateProject(pid, { stage: stage.id });
    progress(0);
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= stage.retries + 1; attempt++) {
      db.prepare(`INSERT OR REPLACE INTO stage_runs (project_id, stage, status, attempt, started_at) VALUES (?, ?, 'running', ?, ?)`).run(pid, stage.id, attempt, now());
      try {
        const t0 = Date.now();
        await stage.run({ id: pid, dir, progress });
        db.prepare(`UPDATE stage_runs SET status='done', finished_at=?, error=NULL WHERE project_id=? AND stage=?`).run(now(), pid, stage.id);
        info(`${stage.id} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`, pid);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (e instanceof ApprovalNeeded) {
          db.prepare(`UPDATE stage_runs SET status='failed', error=? WHERE project_id=? AND stage=?`).run(e.message, pid, stage.id);
          setJob(job.id, { status: "awaiting_approval", message: e.message });
          updateProject(pid, { status: "awaiting_approval", error: e.message });
          warn(e.message, pid);
          return "awaiting_approval";
        }
        const msg = (e as Error).message ?? String(e);
        db.prepare(`UPDATE stage_runs SET status='failed', error=?, finished_at=? WHERE project_id=? AND stage=?`).run(msg, now(), pid, stage.id);
        const retryable = !(e instanceof StageError) || e.retryable;
        if (attempt <= stage.retries && retryable) {
          warn(`${stage.id} attempt ${attempt} failed, retrying: ${msg}`, pid);
          continue;
        }
        break;
      }
    }
    if (lastErr) {
      const msg = `${stage.name} failed: ${(lastErr as Error).message ?? lastErr}`;
      error(msg, pid);
      setJob(job.id, { status: "failed", finished_at: now(), message: msg });
      updateProject(pid, { status: "failed", error: msg });
      return "failed";
    }
  }
  setJob(job.id, { status: "done", progress: 1, finished_at: now(), message: "Ready to upload" });
  updateProject(pid, { status: "done", stage: "export", error: null });
  return "done";
}

let running = false;
let stopRequested = false;

/** Background worker: one heavy job at a time (TTS + rendering saturate the CPU). */
export async function startWorker(pollMs = 1000) {
  if (running) return;
  running = true;
  stopRequested = false;
  while (!stopRequested) {
    recoverOrphans();
    const job = getDb().prepare(`SELECT * FROM jobs WHERE status='queued' ORDER BY id LIMIT 1`).get() as JobRow | undefined;
    if (!job) {
      await new Promise((r) => setTimeout(r, pollMs));
      continue;
    }
    try {
      await runJob(job);
    } catch (e) {
      error(`worker crashed on job ${job.id}: ${(e as Error).stack}`, job.project_id);
      setJob(job.id, { status: "failed", message: (e as Error).message });
      updateProject(job.project_id, { status: "failed", error: (e as Error).message });
    }
  }
  running = false;
}

export function stopWorker() {
  stopRequested = true;
}

export function approve(approvalId: number, ok: boolean) {
  const db = getDb();
  const a = db.prepare(`SELECT * FROM approvals WHERE id=?`).get(approvalId) as { project_id: string; stage: string } | undefined;
  if (!a) throw new Error("approval not found");
  db.prepare(`UPDATE approvals SET status=? WHERE id=?`).run(ok ? "approved" : "rejected", approvalId);
  // Re-queue the waiting job so it continues from the gated stage.
  db.prepare(`UPDATE jobs SET status='queued' WHERE project_id=? AND status='awaiting_approval'`).run(a.project_id);
  updateProject(a.project_id, { status: "queued", error: null });
}

export function pendingApprovals() {
  return getDb().prepare(`SELECT * FROM approvals WHERE status='pending' ORDER BY id`).all();
}

/** Create a project from an idea and queue its production. */
export function produceIdea(idea: Idea, options: ProjectOptions = {}, batchId?: string) {
  const p = createProject(idea, options);
  const jobId = enqueue(p.id, "produce", { batchId });
  return { project: p, jobId };
}

/** Batch: pick N distinct, unused ideas and queue them all. */
export function createBatch(count: number, category: Category | "any", options: ProjectOptions = {}) {
  const batchId = "batch-" + Date.now().toString(36);
  const ideas = offlineIdeas({ category, count: count * 3 });
  const chosen: Idea[] = [];
  const usedFacts = new Set<string>();
  // Prefer ideas that don't share facts with each other.
  for (const i of ideas) {
    if (chosen.length >= count) break;
    if (i.factIds.some((f) => usedFacts.has(f))) continue;
    chosen.push(i);
    i.factIds.forEach((f) => usedFacts.add(f));
  }
  for (const i of ideas) if (chosen.length < count && !chosen.includes(i)) chosen.push(i);
  saveIdeas(chosen);
  const results = chosen.map((i) => produceIdea(i, options, batchId));
  return { batchId, requested: count, created: results.length, projects: results.map((r) => r.project.id) };
}

export function stageStatus(projectId: string) {
  const rows = getDb().prepare(`SELECT * FROM stage_runs WHERE project_id=?`).all(projectId) as { stage: string; status: string; error: string | null; started_at: string; finished_at: string }[];
  return STAGE_IDS.map((id) => ({ id, name: STAGES.find((s) => s.id === id)!.name, ...(rows.find((r) => r.stage === id) ?? { status: "pending" }) }));
}

export { getProject };
