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

export function whisperAvailable(): boolean {
  return fs.existsSync(path.join(WHISPER_DIR, `ggml-${WHISPER_MODEL}.bin`));
}

/** Install whisper.cpp + model on first use (one-time ~150 MB download + build). */
export async function ensureWhisper() {
  if (whisperAvailable()) return;
  const { installWhisperCpp, downloadWhisperModel } = await import("@remotion/install-whisper-cpp");
  await installWhisperCpp({ to: WHISPER_DIR, version: WHISPER_VERSION, printOutput: false });
  await downloadWhisperModel({ model: WHISPER_MODEL, folder: WHISPER_DIR, printOutput: false });
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
