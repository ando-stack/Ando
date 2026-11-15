import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { getConfig, r } from "../core/config.ts";
import type { ScenePlan, Subtitles } from "../core/types.ts";

/** Prefer the system's pre-installed headless shell; Remotion downloads its own otherwise. */
export function browserExecutable(): string | undefined {
  const candidates = [
    process.env.REMOTION_BROWSER,
    "/opt/pw-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
  ];
  const fromGlob = (() => {
    try {
      const base = "/opt/pw-browsers";
      for (const d of fs.readdirSync(base)) {
        if (!d.startsWith("chromium_headless_shell")) continue;
        for (const sub of fs.readdirSync(path.join(base, d))) {
          const p = path.join(base, d, sub, "chrome-headless-shell");
          if (fs.existsSync(p)) return p;
        }
      }
    } catch { /* not present */ }
    return undefined;
  })();
  return [...candidates, fromGlob].find((p) => p && fs.existsSync(p));
}

/** OpenGL backend for headless Chromium. "angle" is ~7x faster than "swangle" here; override with REMOTION_GL. */
export function renderGl(): "angle" | "swangle" | "swiftshader" | "egl" | "vulkan" | "angle-egl" {
  return (process.env.REMOTION_GL as "angle") || "angle";
}

function dirHash(dir: string): string {
  const h = crypto.createHash("sha1");
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(p + fs.statSync(p).mtimeMs);
    }
  };
  walk(dir);
  h.update(fs.statSync(r("src", "core", "types.ts")).mtimeMs.toString());
  h.update(fs.statSync(r("config", "default.json")).mtimeMs.toString());
  return h.digest("hex").slice(0, 12);
}

let bundlePromise: Promise<string> | null = null;

/** Webpack-bundle the Remotion project once; reused until remotion/ changes. */
export async function getBundle(): Promise<string> {
  if (bundlePromise) return bundlePromise;
  bundlePromise = (async () => {
    const hash = dirHash(r("remotion"));
    const root = r(".remotion-bundle");
    const out = path.join(root, hash);
    if (fs.existsSync(path.join(out, "index.html"))) return out;
    const { bundle } = await import("@remotion/bundler");
    // Build into a private temp dir, then rename: concurrent processes never see a half-written bundle.
    const tmp = path.join(root, `.tmp-${process.pid}-${Date.now()}`);
    fs.mkdirSync(root, { recursive: true });
    await bundle({ entryPoint: r("remotion", "index.ts"), outDir: tmp, onProgress: () => undefined });
    try {
      fs.renameSync(tmp, out);
    } catch {
      fs.rmSync(tmp, { recursive: true, force: true }); // another process won the race
    }
    // Remove bundles of older template versions that nobody has touched for an hour.
    for (const d of fs.readdirSync(root)) {
      const p = path.join(root, d);
      if (d !== hash && Date.now() - fs.statSync(p).mtimeMs > 3600_000) fs.rmSync(p, { recursive: true, force: true });
    }
    return out;
  })();
  return bundlePromise.catch((e) => {
    bundlePromise = null;
    throw e;
  });
}

const MIME: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".wav": "audio/wav" };

/** Tiny static server (with Range support) so the renderer can load project assets. */
export function serveDir(dir: string): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "");
    const file = path.resolve(dir, rel);
    if (!file.startsWith(path.resolve(dir)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    const size = fs.statSync(file).size;
    const type = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    res.setHeader("access-control-allow-origin", "*");
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, { "content-type": type, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "content-length": end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes" });
      fs.createReadStream(file).pipe(res);
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${addr.port}`, close: () => server.close() });
    });
  });
}

export function buildProps(title: string, plan: ScenePlan, subtitles: Subtitles, assetBase: string) {
  const cfg = getConfig();
  return {
    title,
    plan,
    subtitles,
    captions: cfg.captions,
    brand: cfg.brand,
    channel: { name: cfg.channel.name, handle: cfg.channel.handle },
    assetBase,
    showPlaceholderLabel: plan.placeholderVisuals,
  };
}

/** Render the silent picture track with Remotion, then mux the final audio mix with FFmpeg. */
export async function renderVideo(opts: {
  projectDir: string;
  title: string;
  plan: ScenePlan;
  subtitles: Subtitles;
  audio: string;
  out: string;
  onProgress?: (p: number) => void;
}) {
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await getBundle();
  const server = await serveDir(opts.projectDir);
  const silent = opts.out.replace(/\.mp4$/, ".video.mp4");
  try {
    const inputProps = buildProps(opts.title, opts.plan, opts.subtitles, server.url);
    const browser = browserExecutable();
    const composition = await selectComposition({ serveUrl, id: "Short", inputProps, browserExecutable: browser, logLevel: "error" });
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: silent,
      inputProps,
      muted: true,
      crf: getConfig().video.crf,
      pixelFormat: "yuv420p",
      // BT.709 + TV range: the standard YouTube expects (JPEG frames would otherwise yield full-range yuvj420p).
      colorSpace: "bt709",
      x264Preset: "medium",
      concurrency: Math.max(1, Math.min(8, os.cpus().length)),
      browserExecutable: browser,
      chromiumOptions: { gl: renderGl() },
      logLevel: "error",
      onProgress: ({ progress }) => opts.onProgress?.(progress),
    });
  } finally {
    server.close();
  }
  // The picture defines the length: pad audio with silence if needed, then cut at the last video frame.
  const vdur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", silent]).toString().trim());
  execFileSync("ffmpeg", [
    "-hide_banner", "-y", "-loglevel", "error",
    "-i", silent, "-i", opts.audio,
    "-map", "0:v:0", "-map", "1:a:0",
    "-c:v", "copy", "-af", "apad", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-t", vdur.toFixed(3), "-movflags", "+faststart",
    "-metadata", `title=${opts.title}`,
    opts.out,
  ]);
  fs.rmSync(silent, { force: true });
}

export async function renderThumbnail(opts: { projectDir: string; title: string; plan: ScenePlan; subtitles: Subtitles; out: string }) {
  const { renderStill, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await getBundle();
  const inputProps = buildProps(opts.title, opts.plan, opts.subtitles, "");
  const browser = browserExecutable();
  const composition = await selectComposition({ serveUrl, id: "Thumbnail", inputProps, browserExecutable: browser, logLevel: "error" });
  await renderStill({ composition, serveUrl, output: opts.out, inputProps, browserExecutable: browser, imageFormat: "png", chromiumOptions: { gl: renderGl() }, logLevel: "error" });
}

/** Render specific frames as PNGs (used for QC contact sheets and scene previews). */
export async function renderFrames(opts: { projectDir: string; title: string; plan: ScenePlan; subtitles: Subtitles; frames: number[]; outDir: string }) {
  const { renderStill, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await getBundle();
  const server = await serveDir(opts.projectDir);
  try {
    const inputProps = buildProps(opts.title, opts.plan, opts.subtitles, server.url);
    const browser = browserExecutable();
    const composition = await selectComposition({ serveUrl, id: "Short", inputProps, browserExecutable: browser, logLevel: "error" });
    fs.mkdirSync(opts.outDir, { recursive: true });
    const files: string[] = [];
    for (const frame of opts.frames) {
      const f = path.join(opts.outDir, `frame-${String(frame).padStart(5, "0")}.png`);
      await renderStill({ composition, serveUrl, output: f, inputProps, frame, browserExecutable: browser, chromiumOptions: { gl: renderGl() }, logLevel: "error" });
      files.push(f);
    }
    return files;
  } finally {
    server.close();
  }
}
