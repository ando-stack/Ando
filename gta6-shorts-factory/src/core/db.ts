import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { r } from "./config.ts";

// node:sqlite is built into Node 22 (no native build step). It prints one
// ExperimentalWarning on load; silence only that warning.
const origEmit = process.emitWarning;
process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
  const msg = typeof w === "string" ? w : w?.message;
  if (msg && msg.includes("SQLite")) return;
  return (origEmit as (...a: unknown[]) => void).call(process, w, ...rest);
}) as typeof process.emitWarning;

let db: DatabaseSync | null = null;

export function getDb(file = process.env.FACTORY_DB ?? r("data", "factory.db")): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(r("data"), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      seq INTEGER NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      topic_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',      -- new | running | awaiting_approval | done | failed
      stage TEXT,
      error TEXT,
      options_json TEXT NOT NULL DEFAULT '{}',
      export_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stage_runs (
      project_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,                   -- running | done | failed | skipped
      attempt INTEGER NOT NULL DEFAULT 1,
      started_at TEXT,
      finished_at TEXT,
      error TEXT,
      PRIMARY KEY (project_id, stage)
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,                     -- produce | rerender | renarrate | rescene | resume
      from_stage TEXT,
      status TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | failed | awaiting_approval | cancelled
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 2,
      progress REAL NOT NULL DEFAULT 0,
      message TEXT,
      batch_id TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      stage TEXT NOT NULL,
      provider TEXT NOT NULL,
      estimate_usd REAL NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS phrases (
      kind TEXT NOT NULL,                     -- hook | payoff | context
      text TEXT NOT NULL,
      project_id TEXT NOT NULL,
      PRIMARY KEY (kind, text, project_id)
    );
    CREATE TABLE IF NOT EXISTS logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      at TEXT NOT NULL
    );
  `);
  const cols = db.prepare(`PRAGMA table_info(jobs)`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "owner_pid")) db.exec(`ALTER TABLE jobs ADD COLUMN owner_pid INTEGER`);
  recoverOrphans(db);
  return db;
}

function alive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Crash recovery: a job marked "running" whose owner process is gone goes back to
 * the queue, and its half-finished stage is marked failed so it re-runs. Jobs owned
 * by a live process (e.g. the CLI while the dashboard starts) are left alone.
 */
export function recoverOrphans(d: DatabaseSync = getDb()) {
  const running = d.prepare(`SELECT id, project_id, owner_pid FROM jobs WHERE status='running'`).all() as { id: number; project_id: string; owner_pid: number | null }[];
  for (const j of running) {
    if (alive(j.owner_pid)) continue;
    d.prepare(`UPDATE jobs SET status='queued', owner_pid=NULL WHERE id=?`).run(j.id);
    d.prepare(`UPDATE stage_runs SET status='failed', error='interrupted' WHERE project_id=? AND status='running'`).run(j.project_id);
    d.prepare(`UPDATE projects SET status='queued' WHERE id=? AND status='running'`).run(j.project_id);
  }
}

export const now = () => new Date().toISOString();

export function closeDb() {
  db?.close();
  db = null;
}
