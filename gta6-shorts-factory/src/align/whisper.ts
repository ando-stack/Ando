import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { r } from "../core/config.ts";

export const WHISPER_DIR = r(".tools", "whisper.cpp");
export const WHISPER_VERSION = "1.7.6";
export const WHISPER_MODEL = "base.en";

export interface WhisperWord {
  text: string;
  start: number;
  end: number;
}

const IS_WIN = process.platform === "win32";

/** Where @remotion/install-whisper-cpp expects the CLI for whisper.cpp >= 1.7.4. */
export function whisperExe(): string {
  return path.join(WHISPER_DIR, "build", "bin", IS_WIN ? "whisper-cli.exe" : "whisper-cli");
}

const modelFile = () => path.join(WHISPER_DIR, `ggml-${WHISPER_MODEL}.bin`);

export function whisperAvailable(): boolean {
  return fs.existsSync(modelFile()) && fs.existsSync(whisperExe());
}

/**
 * The official Windows release zip unpacks to "Release/whisper-cli.exe" (+ DLLs), but
 * Remotion looks in "build/bin". Copy the whole folder there so the DLLs sit next to the exe.
 */
function fixWindowsLayout() {
  if (!IS_WIN || fs.existsSync(whisperExe()) || !fs.existsSync(WHISPER_DIR)) return;
  const find = (dir: string, depth = 0): string | null => {
    if (depth > 3) return null;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === "whisper-cli.exe") return p;
      if (e.isDirectory()) {
        const hit = find(p, depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  const exe = find(WHISPER_DIR);
  if (!exe) return;
  const from = path.dirname(exe);
  const to = path.dirname(whisperExe());
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const src = path.join(from, f);
    if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(to, f));
  }
}

/** Install whisper.cpp + model on first use (one-time ~150 MB download). */
export async function ensureWhisper() {
  if (whisperAvailable()) return;
  const { installWhisperCpp, downloadWhisperModel } = await import("@remotion/install-whisper-cpp");
  fixWindowsLayout();
  if (!fs.existsSync(whisperExe())) {
    // A folder without a usable binary (e.g. an interrupted install) blocks reinstalling: start clean.
    if (fs.existsSync(WHISPER_DIR) && !fs.existsSync(modelFile())) fs.rmSync(WHISPER_DIR, { recursive: true, force: true });
    if (!fs.existsSync(WHISPER_DIR)) await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION, printOutput: false });
    fixWindowsLayout();
  }
  if (!fs.existsSync(modelFile())) await downloadWhisperModel({ model: WHISPER_MODEL, folder: WHISPER_DIR, printOutput: false });
  if (!fs.existsSync(whisperExe())) throw new Error(`whisper.cpp executable not found at ${whisperExe()} after install`);
}

/** Transcribe with word-level timestamps. Input can be any audio ffmpeg reads. */
export async function transcribeWords(audioFile: string, prompt?: string): Promise<WhisperWord[]> {
  await ensureWhisper();
  const { transcribe } = await import("@remotion/install-whisper-cpp");
  const tmp = audioFile.replace(/\.\w+$/, "") + ".16k.wav";
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", audioFile, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", tmp]);
  try {
    const out = await transcribe({
      inputPath: tmp,
      whisperPath: WHISPER_DIR,
      whisperCppVersion: WHISPER_VERSION,
      model: WHISPER_MODEL,
      tokenLevelTimestamps: true,
      splitOnWord: true,
      printOutput: false,
      ...(prompt ? { additionalArgs: [["--prompt", prompt]] } : {}),
    });
    const words: WhisperWord[] = [];
    for (const seg of out.transcription) {
      for (const t of seg.tokens) {
        const text = t.text.trim();
        if (!text || /^\[_.*_\]$|^\[.*\]$/.test(text)) continue;
        // Punctuation tokens attach to the previous word.
        if (/^[^A-Za-z0-9]+$/.test(text) && words.length) {
          words[words.length - 1].text += text;
          continue;
        }
        words.push({ text, start: t.offsets.from / 1000, end: t.offsets.to / 1000 });
      }
    }
    return words;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
