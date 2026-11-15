import fs from "node:fs";
import path from "node:path";
import { getConfig, r } from "./config.ts";
import { getDb, now } from "./db.ts";
import type { Category, Idea } from "./types.ts";

export interface ProjectOptions {
  targetSeconds?: number;
  voice?: string;
  voiceProvider?: "kokoro" | "google";
  captionStyle?: string;
  music?: boolean;
}

export interface ProjectRow {
  id: string;
  seq: number;
  title: string;
  category: Category;
  topic_key: string;
  status: string;
  stage: string | null;
  error: string | null;
  options_json: string;
  export_path: string | null;
  created_at: string;
  updated_at: string;
}

export function projectsRoot() {
  return r(getConfig().paths.projects);
}
export function exportsRoot() {
  return r(getConfig().paths.exports);
}

export function projectDir(id: string) {
  if (!/^video-\d{3,}$/.test(id)) throw new Error(`invalid project id: ${id}`);
  return path.join(projectsRoot(), id);
}

export function pfile(id: string, name: string) {
  return path.join(projectDir(id), name);
}

export function readJson<T>(id: string, name: string): T {
  return JSON.parse(fs.readFileSync(pfile(id, name), "utf8")) as T;
}

export function tryReadJson<T>(id: string, name: string): T | null {
  try {
    return readJson<T>(id, name);
  } catch {
    return null;
  }
}

/** Atomic write (tmp + rename) so a crash never leaves a half-written stage file. */
export function writeJson(id: string, name: string, data: unknown) {
  const f = pfile(id, name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f);
}

export function createProject(idea: Idea, options: ProjectOptions = {}): ProjectRow {
  const db = getDb();
  const row = db.prepare(`SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM projects`).get() as { next: number };
  const seq = row.next;
  const id = `video-${String(seq).padStart(3, "0")}`;
  fs.mkdirSync(path.join(projectsRoot(), id, "assets"), { recursive: true });
  writeJson(id, "idea.json", idea);
  const t = now();
  db.prepare(
    `INSERT INTO projects (id, seq, title, category, topic_key, status, options_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?)`,
  ).run(id, seq, idea.title, idea.category, idea.topicKey, JSON.stringify(options), t, t);
  db.prepare(`UPDATE ideas SET used = 1 WHERE id = ?`).run(idea.id);
  return getProject(id)!;
}

export function getProject(id: string): ProjectRow | null {
  return (getDb().prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as unknown as ProjectRow) ?? null;
}

export function listProjects(): ProjectRow[] {
  return getDb().prepare(`SELECT * FROM projects ORDER BY seq DESC`).all() as unknown as ProjectRow[];
}

export function updateProject(id: string, patch: Partial<Pick<ProjectRow, "status" | "stage" | "error" | "export_path" | "title">>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  getDb()
    .prepare(`UPDATE projects SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...keys.map((k) => (patch[k] ?? null) as string | null), now(), id);
}

export function projectOptions(id: string): ProjectOptions {
  const p = getProject(id);
  return p ? (JSON.parse(p.options_json) as ProjectOptions) : {};
}

/** Topic keys already produced (or in production) — used to avoid duplicate videos. */
export function usedTopicKeys(): Set<string> {
  const rows = getDb().prepare(`SELECT topic_key FROM projects WHERE status != 'failed'`).all() as { topic_key: string }[];
  return new Set(rows.map((x) => x.topic_key));
}
