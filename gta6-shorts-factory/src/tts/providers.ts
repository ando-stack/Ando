import { getConfig, getSecret } from "../core/config.ts";
import { loadPronunciations, type PronEntry } from "./pronunciation.ts";

export interface SpokenGroup {
  /** Indices into the sentence's display words. */
  words: number[];
  spoken: string;
}

export interface SynthResult {
  samples: Float32Array;
  sampleRate: number;
  /** Start time (s) of each spoken group, when the provider supports timepoints. */
  groupTimes?: number[];
}

export interface TtsProvider {
  id: "kokoro" | "google";
  voice: string;
  /** Cost estimate in USD for synthesizing `chars` characters (0 for local). */
  estimateUsd(chars: number): number;
  synth(groups: SpokenGroup[]): Promise<SynthResult>;
}

/**
 * Map display words to spoken groups using the pronunciation dictionary.
 * Multi-word terms ("GTA 6") become one group; every display word belongs to exactly one group.
 */
export function groupSpoken(displayWords: string[], entries: PronEntry[] = loadPronunciations()): SpokenGroup[] {
  const groups: SpokenGroup[] = [];
  const strip = (w: string) => w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9|']+$/g, "");
  let i = 0;
  outer: while (i < displayWords.length) {
    for (const e of entries) {
      const parts = e.term.split(/\s+/);
      if (i + parts.length > displayWords.length) continue;
      const slice = displayWords.slice(i, i + parts.length);
      const core = slice.map(strip);
      const lastRaw = slice[slice.length - 1];
      // Allow possessive/punctuation after the term: "Lucia's" -> "Loo-SEE-ah's"
      const lastCore = core[core.length - 1];
      const possessive = /'s$/i.test(lastCore) && !/'s$/i.test(parts[parts.length - 1]);
      const cmpCore = [...core.slice(0, -1), possessive ? lastCore.replace(/'s$/i, "") : lastCore];
      const eq = (a: string, b: string) => (e.caseSensitive ? a === b : a.toLowerCase() === b.toLowerCase());
      if (cmpCore.every((c, k) => eq(c, parts[k]))) {
        const lead = slice[0].match(/^[^A-Za-z0-9]*/)?.[0] ?? "";
        const trail = lastRaw.match(/[^A-Za-z0-9|']*$/)?.[0] ?? "";
        groups.push({ words: slice.map((_, k) => i + k), spoken: `${lead}${e.say}${possessive ? "'s" : ""}${trail}` });
        i += parts.length;
        continue outer;
      }
    }
    groups.push({ words: [i], spoken: displayWords[i] });
    i++;
  }
  return groups;
}

// ------------------------------------------------------------------ Kokoro (local, Apache-2.0)

let kokoroModel: Promise<import("kokoro-js").KokoroTTS> | null = null;

export const KOKORO_VOICES = [
  { id: "am_michael", name: "Michael — warm, clear (recommended)" },
  { id: "am_fenrir", name: "Fenrir — deeper, dramatic" },
  { id: "am_puck", name: "Puck — energetic, younger" },
  { id: "am_onyx", name: "Onyx — low, calm" },
  { id: "am_echo", name: "Echo — neutral" },
  { id: "am_eric", name: "Eric — bright" },
  { id: "am_liam", name: "Liam — light" },
  { id: "am_adam", name: "Adam — flat" },
];

export function kokoroProvider(voice?: string): TtsProvider {
  const cfg = getConfig().voice.kokoro;
  const v = voice ?? cfg.voice;
  return {
    id: "kokoro",
    voice: v,
    estimateUsd: () => 0,
    async synth(groups) {
      if (!kokoroModel) {
        const { KokoroTTS } = await import("kokoro-js");
        kokoroModel = KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
          dtype: cfg.dtype as "q8",
          device: "cpu",
        });
      }
      const tts = await kokoroModel;
      const text = groups.map((g) => g.spoken).join(" ");
      const audio = await tts.generate(text, { voice: v as "am_michael", speed: cfg.speed });
      return { samples: audio.audio as Float32Array, sampleRate: audio.sampling_rate };
    },
  };
}

// ------------------------------------------------------------------ Google Cloud TTS

// Prices from https://cloud.google.com/text-to-speech/pricing (checked 2026-11-15):
// Chirp 3: HD $30 / 1M chars, Neural2 $16 / 1M chars, first 1M chars/month free for each.
// The free tier is per billing account and is not tracked here, so estimates assume paid usage.
export const GOOGLE_PRICE_PER_CHAR: Record<string, number> = { chirp3hd: 30 / 1e6, neural2: 16 / 1e6, studio: 160 / 1e6, wavenet: 16 / 1e6, standard: 4 / 1e6 };

export const GOOGLE_VOICES = [
  { id: "en-US-Chirp3-HD-Charon", name: "Chirp 3 HD Charon — deep, documentary (recommended)" },
  { id: "en-US-Chirp3-HD-Fenrir", name: "Chirp 3 HD Fenrir — energetic" },
  { id: "en-US-Chirp3-HD-Orus", name: "Chirp 3 HD Orus — firm" },
  { id: "en-US-Chirp3-HD-Puck", name: "Chirp 3 HD Puck — upbeat" },
  { id: "en-US-Neural2-J", name: "Neural2-J — male, word timestamps" },
  { id: "en-US-Neural2-D", name: "Neural2-D — male, word timestamps" },
  { id: "en-US-Neural2-I", name: "Neural2-I — male, word timestamps" },
];

function googleTier(voice: string) {
  if (/Chirp3-HD/i.test(voice)) return "chirp3hd";
  if (/Neural2/i.test(voice)) return "neural2";
  if (/Studio/i.test(voice)) return "studio";
  if (/Wavenet/i.test(voice)) return "wavenet";
  return "standard";
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

async function googleAuthHeaders(): Promise<{ url: string; headers: Record<string, string> }> {
  const base = "https://texttospeech.googleapis.com/v1beta1/text:synthesize";
  const key = getSecret("GOOGLE_TTS_API_KEY");
  if (key) return { url: base, headers: { "x-goog-api-key": key } };
  const credFile = getSecret("GOOGLE_APPLICATION_CREDENTIALS");
  if (credFile) {
    const { GoogleAuth } = await import("google-auth-library");
    const auth = new GoogleAuth({ keyFile: credFile, scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    const token = await auth.getAccessToken();
    return { url: base, headers: { authorization: `Bearer ${token}` } };
  }
  throw new Error("Google TTS selected but no GOOGLE_TTS_API_KEY or GOOGLE_APPLICATION_CREDENTIALS is configured (Settings → API credentials).");
}

export function googleProvider(voice?: string): TtsProvider {
  const cfg = getConfig().voice.google;
  const v = voice ?? cfg.voice;
  const tier = googleTier(v);
  const supportsMarks = tier !== "chirp3hd";
  return {
    id: "google",
    voice: v,
    estimateUsd: (chars) => chars * GOOGLE_PRICE_PER_CHAR[tier],
    async synth(groups) {
      const { url, headers } = await googleAuthHeaders();
      const input = supportsMarks
        ? { ssml: `<speak>${groups.map((g, i) => `<mark name="g${i}"/>${xml(g.spoken)}`).join(" ")}</speak>` }
        : { text: groups.map((g) => g.spoken).join(" ") };
      const body = {
        input,
        voice: { languageCode: cfg.languageCode, name: v },
        audioConfig: {
          audioEncoding: "LINEAR16",
          sampleRateHertz: 24000,
          speakingRate: cfg.speakingRate,
          ...(tier === "chirp3hd" ? {} : { pitch: cfg.pitch }),
        },
        ...(supportsMarks ? { enableTimePointing: ["SSML_MARK"] } : {}),
      };
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error(`Google TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const json = (await res.json()) as { audioContent: string; timepoints?: { markName: string; timeSeconds: number }[] };
      const wav = Buffer.from(json.audioContent, "base64");
      // LINEAR16 responses include a WAV header.
      const dataAt = wav.indexOf("data") + 8;
      const n = Math.floor((wav.length - dataAt) / 2);
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = wav.readInt16LE(dataAt + i * 2) / 32768;
      let groupTimes: number[] | undefined;
      if (json.timepoints?.length) {
        groupTimes = groups.map(() => NaN);
        for (const tp of json.timepoints) groupTimes[Number(tp.markName.slice(1))] = tp.timeSeconds;
      }
      return { samples, sampleRate: 24000, groupTimes };
    },
  };
}

export function getProvider(id?: string, voice?: string): TtsProvider {
  const p = id ?? getConfig().voice.provider;
  return p === "google" ? googleProvider(voice) : kokoroProvider(voice);
}
