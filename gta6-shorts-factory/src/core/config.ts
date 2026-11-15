import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const r = (...p: string[]) => path.resolve(ROOT, ...p);

const DEFAULT_FILE = r("config", "default.json");
const SETTINGS_FILE = r("config", "settings.json");
const SECRETS_FILE = r("data", "secrets.json");

export type Config = typeof import("../../config/default.json");

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function deepMerge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : (over as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) {
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

/** Effective config = defaults + user overrides (config/settings.json). Read fresh every call so dashboard edits apply immediately. */
export function getConfig(): Config {
  return deepMerge(readJson(DEFAULT_FILE) as Config, readJson(SETTINGS_FILE));
}

export function saveSettings(patch: unknown): Config {
  const current = readJson(SETTINGS_FILE);
  const next = deepMerge(current, patch);
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2));
  return getConfig();
}

// ---------------------------------------------------------------- secrets
// Secrets live in env vars or data/secrets.json (git-ignored, chmod 600).
// They are never returned by the API; the dashboard only sees "configured: true/false".

export const SECRET_KEYS = [
  "ANTHROPIC_API_KEY",
  "GOOGLE_TTS_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "OPENAI_API_KEY",
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

export function getSecret(key: SecretKey): string | undefined {
  const env = process.env[key];
  if (env && env.trim()) return env.trim();
  const file = readJson(SECRETS_FILE) as Record<string, string>;
  const v = file[key];
  return v && v.trim() ? v.trim() : undefined;
}

export function setSecret(key: SecretKey, value: string | null) {
  const file = readJson(SECRETS_FILE) as Record<string, string>;
  if (value === null || value === "") delete file[key];
  else file[key] = value;
  fs.mkdirSync(path.dirname(SECRETS_FILE), { recursive: true });
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(file, null, 2), { mode: 0o600 });
}

export function secretStatus(): Record<SecretKey, boolean> {
  return Object.fromEntries(SECRET_KEYS.map((k) => [k, Boolean(getSecret(k))])) as Record<SecretKey, boolean>;
}

/** Remove any known secret values from a string before it is logged or stored. */
export function redact(text: string): string {
  let out = text;
  for (const k of SECRET_KEYS) {
    const v = getSecret(k);
    if (v && v.length >= 6) out = out.split(v).join(`[${k}]`);
  }
  return out.replace(/sk-ant-[A-Za-z0-9_-]{10,}/g, "[REDACTED]").replace(/AIza[0-9A-Za-z_-]{30,}/g, "[REDACTED]");
}
