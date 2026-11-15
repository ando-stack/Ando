import fs from "node:fs";
import path from "node:path";
import { getConfig, r } from "../core/config.ts";

/**
 * User-approved asset library.
 *
 * Drop images/videos into assets/library (or any folder listed in Settings → Asset folders).
 * Optional sidecar "<file>.json" describes the asset:
 *   { "tags": ["lucia","prison"], "license": "Rockstar press kit — editorial use",
 *     "credit": "Rockstar Games", "approved": true, "aiGenerated": false }
 * Files with "approved": false are ignored. Nothing is ever downloaded automatically.
 */

export interface LibraryAsset {
  file: string;
  type: "image" | "video";
  tags: string[];
  license?: string;
  credit?: string;
  aiGenerated?: boolean;
}

const IMG = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const VID = new Set([".mp4", ".mov", ".webm", ".m4v"]);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1);
}

export function scanLibrary(dirs = getConfig().assets.libraryDirs): LibraryAsset[] {
  const out: LibraryAsset[] = [];
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      const ext = path.extname(e.name).toLowerCase();
      if (!IMG.has(ext) && !VID.has(ext)) continue;
      let meta: Partial<LibraryAsset> & { approved?: boolean } = {};
      try {
        meta = JSON.parse(fs.readFileSync(p + ".json", "utf8"));
      } catch {
        /* no sidecar: tags come from the file and folder names */
      }
      if (meta.approved === false) continue;
      out.push({
        file: p,
        type: IMG.has(ext) ? "image" : "video",
        tags: [...new Set([...(meta.tags ?? []).flatMap(tokens), ...tokens(path.basename(e.name, ext)), ...tokens(path.relative(r(), d))])],
        license: meta.license,
        credit: meta.credit,
        aiGenerated: meta.aiGenerated,
      });
    }
  };
  for (const d of dirs) walk(path.isAbsolute(d) ? d : r(d));
  return out;
}

/** Rank library assets for a scene by keyword overlap; returns best match with score > 0. */
export function bestAsset(lib: LibraryAsset[], keywords: string[], avoid: Set<string>): LibraryAsset | null {
  const want = new Set(keywords.flatMap(tokens));
  let best: LibraryAsset | null = null;
  let bestScore = 0;
  for (const a of lib) {
    let s = a.tags.reduce((n, t) => n + (want.has(t) ? 1 : 0), 0);
    if (avoid.has(a.file)) s -= 1.5;
    if (a.type === "video") s += 0.25;
    if (s > bestScore) {
      best = a;
      bestScore = s;
    }
  }
  return bestScore >= 1 ? best : null;
}
