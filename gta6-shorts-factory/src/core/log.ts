import { redact } from "./config.ts";
import { getDb, now } from "./db.ts";

type Level = "info" | "warn" | "error";

export function log(level: Level, message: string, projectId?: string) {
  const clean = redact(message);
  const line = `[${new Date().toISOString().slice(11, 19)}] ${level.toUpperCase()}${projectId ? ` ${projectId}` : ""}: ${clean}`;
  if (level === "error") console.error(line);
  else if (!process.env.FACTORY_QUIET) console.log(line);
  try {
    getDb().prepare(`INSERT INTO logs (project_id, level, message, at) VALUES (?, ?, ?, ?)`).run(projectId ?? null, level, clean, now());
  } catch {
    /* logging must never crash the pipeline */
  }
}

export const info = (m: string, p?: string) => log("info", m, p);
export const warn = (m: string, p?: string) => log("warn", m, p);
export const error = (m: string, p?: string) => log("error", m, p);
