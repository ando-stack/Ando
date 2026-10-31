// Google voices.
// - With GOOGLE_TTS_API_KEY set: Google Cloud Text-to-Speech (natural Neural2/Studio voices).
// - Without it: the free Google Translate voice (more robotic, no account needed).
import fs from "node:fs/promises";

const MAX_CHARS = 190; // Google Translate voice limit is ~200 characters per request

export function voiceMode(config) {
  return process.env.GOOGLE_TTS_API_KEY ? "cloud" : "translate";
}

async function cloudTts(text, config) {
  const v = config.voice.cloud;
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_TTS_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: v.languageCode, name: v.name },
        audioConfig: { audioEncoding: "MP3", speakingRate: v.speakingRate, pitch: v.pitch },
      }),
    },
  );
  if (!res.ok) throw new Error(`Google Cloud TTS ${res.status}: ${await res.text()}`);
  const { audioContent } = await res.json();
  return Buffer.from(audioContent, "base64");
}

async function translateTts(text, config) {
  const { lang, tld } = config.voice.translate;
  const url =
    `https://translate.google.${tld}/translate_tts?ie=UTF-8&client=tw-ob` +
    `&tl=${lang}&q=${encodeURIComponent(text)}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (attempt >= 4) throw new Error(`Google Translate voice ${res.status}`);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

/** Splits a long line into pieces short enough for one voice request. */
export function splitForVoice(text) {
  if (text.length <= MAX_CHARS) return [text];
  const parts = [];
  let current = "";
  for (const piece of text.split(/(?<=[,;:.!?])\s+/)) {
    if (current && (current + " " + piece).length > MAX_CHARS) {
      parts.push(current);
      current = piece;
    } else {
      current = current ? current + " " + piece : piece;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Writes an MP3 for `text` at `file`. The text must fit in one request (see splitForVoice). */
export async function speak(text, file, config) {
  const audio =
    voiceMode(config) === "cloud" ? await cloudTts(text, config) : await translateTts(text, config);
  await fs.writeFile(file, audio);
}
