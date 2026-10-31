// Turns a batch of scripts (lotes/lote-XXX.json) into finished Shorts:
//   outputs/NNN-slug/video.mp4
//   outputs/NNN-slug/info.txt          (title, description, hashtags)
//   outputs/NNN-slug/extras/thumbnail.png
//   outputs/NNN-slug/extras/script.txt
//
// Usage:
//   npm run render                         -> every batch, skipping Shorts already rendered
//   npm run render -- lotes/lote-002.json  -> one batch
//   npm run render -- --only 7             -> just Short number 7
//   npm run render -- --force              -> render again even if video.mp4 exists
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { parseMedia } from "@remotion/media-parser";
import { nodeReader } from "@remotion/media-parser/node";
import { speak, splitForVoice, voiceMode } from "./voice.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await fs.readFile(path.join(ROOT, "config.json"), "utf8"));
const { fps, gapFrames, endFrames } = config.video;

const args = process.argv.slice(2);
const force = args.includes("--force");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? Number(args[onlyIdx + 1]) : null;
const batchArgs = args.filter((a, i) => a.endsWith(".json") && i !== onlyIdx + 1);

const batchFiles = batchArgs.length
  ? batchArgs.map((f) => path.resolve(f))
  : (await fs.readdir(path.join(ROOT, "lotes")))
      .filter((f) => /^lote-\d+\.json$/.test(f))
      .sort()
      .map((f) => path.join(ROOT, "lotes", f));

const pad = (n) => String(n).padStart(3, "0");
const folderFor = (s) => path.join(ROOT, "outputs", `${pad(s.number)}-${s.slug}`);

const mode = voiceMode(config);
const playbackRate = mode === "cloud" ? 1 : config.voice.translate.playbackRate;
console.log(
  mode === "cloud"
    ? `🎙️  Voice: Google Cloud TTS (${config.voice.cloud.name})`
    : "🎙️  Voice: free Google Translate voice (set GOOGLE_TTS_API_KEY for natural voices)",
);

// 1) Collect the Shorts to make.
const todo = [];
for (const file of batchFiles) {
  const batch = JSON.parse(await fs.readFile(file, "utf8"));
  for (const s of batch.shorts) {
    if (only !== null && s.number !== only) continue;
    if (!force && existsSync(path.join(folderFor(s), "video.mp4"))) continue;
    todo.push(s);
  }
}
if (!todo.length) {
  console.log("Nothing to render: every Short already has its video.mp4 (use --force to redo).");
  process.exit(0);
}
console.log(`🎬 ${todo.length} Short(s) to render\n`);

// 2) Voices. Long lines are split so each request stays under the voice limit.
const durationOf = async (file) => {
  const { slowDurationInSeconds } = await parseMedia({
    src: file,
    reader: nodeReader,
    fields: { slowDurationInSeconds: true },
    acknowledgeRemotionLicense: true,
  });
  return slowDurationInSeconds;
};

const prepared = [];
for (const s of todo) {
  const audioDir = path.join(ROOT, "public", "audio", pad(s.number));
  await fs.rm(audioDir, { recursive: true, force: true });
  await fs.mkdir(audioDir, { recursive: true });
  const scenes = [];
  for (const [i, scene] of s.scenes.entries()) {
    for (const [j, text] of splitForVoice(scene.text).entries()) {
      const name = `${i}-${j}.mp3`;
      const file = path.join(audioDir, name);
      await speak(text, file, config);
      const seconds = await durationOf(file);
      scenes.push({
        ...scene,
        text,
        audio: `audio/${pad(s.number)}/${name}`,
        frames: Math.ceil((seconds / playbackRate) * fps) + gapFrames,
      });
    }
  }
  scenes[scenes.length - 1].frames += endFrames;
  const total = scenes.reduce((a, sc) => a + sc.frames, 0) / fps;
  console.log(`🎙️  ${pad(s.number)} ${s.title} — ${total.toFixed(1)} s`);
  if (total > 60) console.warn(`   ⚠️  Longer than 60 s: shorten the script.`);
  prepared.push({ short: s, scenes });
}

// 3) Bundle the Remotion project once (after the audio exists, so it is included).
console.log("\n📦 Preparing Remotion…");
const serveUrl = await bundle({ entryPoint: path.join(ROOT, "src", "index.ts") });
const browserExecutable = process.env.REMOTION_BROWSER || null;

// 4) Render.
for (const { short: s, scenes } of prepared) {
  const dir = folderFor(s);
  await fs.mkdir(path.join(dir, "extras"), { recursive: true });

  const inputProps = { handle: config.channel.handle, playbackRate, scenes };
  const composition = await selectComposition({ serveUrl, id: "Short", inputProps, browserExecutable });
  let last = -1;
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    crf: 22,
    browserExecutable,
    outputLocation: path.join(dir, "video.mp4"),
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct !== last) {
        last = pct;
        process.stdout.write(`\r🎞️  ${pad(s.number)} rendering ${pct}%   `);
      }
    },
  });

  const thumbProps = { ...s.thumbnail };
  const still = await selectComposition({ serveUrl, id: "Thumbnail", inputProps: thumbProps, browserExecutable });
  await renderStill({
    serveUrl,
    composition: still,
    inputProps: thumbProps,
    browserExecutable,
    output: path.join(dir, "extras", "thumbnail.png"),
  });

  const hashtags = [...new Set([...(s.hashtags ?? []), ...config.defaultHashtags])].slice(0, 5);
  await fs.writeFile(
    path.join(dir, "info.txt"),
    [
      "TITLE",
      s.title,
      "",
      "DESCRIPTION",
      s.description,
      "",
      `Real money stories in under a minute. Follow ${config.channel.handle} for a new one every day.`,
      "",
      hashtags.join(" "),
      "",
      "HASHTAGS",
      hashtags.join(" "),
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(dir, "extras", "script.txt"),
    [
      `#${pad(s.number)} — ${s.title}`,
      "",
      "NARRATION",
      ...s.scenes.map((sc) => sc.text),
      "",
      "ON-SCREEN",
      ...s.scenes.map((sc, i) => `${i + 1}. ${sc.emoji ?? ""} ${sc.big ?? ""}`.trim()),
      "",
      "SOURCES / FACT CHECK",
      ...(s.sources ?? ["(add sources before publishing)"]),
      "",
    ].join("\n"),
  );
  console.log(`\r✅ ${pad(s.number)} → outputs/${path.basename(dir)}            `);
}

console.log("\nDone.");
