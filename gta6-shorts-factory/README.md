# GTA VI Shorts Factory

A local, automated YouTube Shorts generator for Grand Theft Auto VI content. It runs on your
machine and produces 1080×1920 / 30 fps / H.264 + AAC Shorts with fact-checked English
scripts, a natural American male voiceover, word-synced animated captions, original music
and sound design, motion graphics, and ready-to-paste YouTube metadata.

**It works with no paid services.** Paid providers (Claude for live web research and writing,
Google Cloud TTS) are optional, and every paid call shows a cost estimate and waits for your
approval.

## Quick start

Requirements: Node 22.13+ (uses the built-in `node:sqlite`), FFmpeg, ~2 GB free disk.

```bash
cd gta6-shorts-factory
npm install
npm run doctor          # checks ffmpeg, Chromium, whisper, credentials
npm run test-short      # builds "3 GTA 6 Details You Probably Missed" end to end
npm start               # dashboard at http://127.0.0.1:4317
```

On first use the factory downloads two open models: Kokoro-82M (TTS, Apache-2.0, ~90 MB from
Hugging Face) and whisper.cpp `base.en` (alignment, MIT, ~150 MB + a short compile). Remotion
uses an installed Chromium headless shell if it finds one, otherwise it downloads its own.

Finished videos land in `exports/` as `video-NNN-<slug>.mp4`, plus `.thumbnail.png` and
`.metadata.txt` (titles, description, hashtags, pinned comment, AI-disclosure advice).

## How a Short is made

```
idea → fact check → script → quality score/improve → voiceover → asset selection + scene plan
     → subtitle alignment → music/SFX/mix → render → QC → metadata + MP4 export
```

| Stage | What happens | Output (in `projects/video-NNN/`) |
|---|---|---|
| research | Re-fetches every cited source and checks that the stored quote is still on the page. Records Rockstar's current release status. Stale or unsupported claims stop the job. | `research.json` |
| script | Offline writer (or Claude) builds hook → context → main → payoff. A scorer rates hook, clarity, originality, accuracy, visual potential and retention, and an improvement loop raises the weakest dimension until the threshold is met. | `script.json` |
| voiceover | Sentence-by-sentence TTS with a pronunciation dictionary, silence trimming, controlled pauses, loudness normalization. Word timing comes from TTS timepoints (Google Neural2) or whisper.cpp alignment. | `voiceover.wav`, `voiceover.json`, `words.json` |
| scenes | Picks the best approved asset per scene from your library (keyword/tag match), else original motion graphics. Splits long segments into two visual beats; rotates camera moves; cues SFX on cuts. | `scenes.json` |
| subtitles | Builds 1–3-word caption pages, breaking on punctuation, pauses and section changes. | `subtitles.json` |
| audio | Music (your licensed track or an original synthesized score), original SFX, sidechain ducking under the voice, two-pass EBU R128 normalization to −14 LUFS, true-peak limit −1.5 dBTP. | `mix.wav`, `audio.json` |
| render | Remotion renders the picture; FFmpeg muxes the mix (H.264 CRF 18, AAC 192k, faststart). Also renders a vertical thumbnail. | `final.mp4`, `thumbnail.png` |
| qc | Resolution, fps, codecs, duration, frame count, black/frozen frames, loudness, clipping, speech present, missing assets, caption overflow, caption timing, an independent re-transcription of the final audio to verify speech/caption sync, spelling, unverified claims, duplicate scenes. | `qc.json`, `contact.jpg` |
| export | Metadata + copies to `exports/`. | `metadata.json` |

Every stage is checkpointed in SQLite (`data/factory.db`). A failed or interrupted job resumes at
the failed stage. You can restart from any stage (dashboard or `npm run cli resume video-001 --from scenes`).

## Accuracy rules (built in, not optional)

- `data/fact-bank.json` holds curated claims, each labelled **CONFIRMED_FACT**, **THEORY**,
  **SPECULATION** or **AI_CONCEPT**. Confirmed facts need a source URL, retrieval date and a
  verbatim quote. Theories need a hedge phrase ("widely believed", "speculation") that must
  appear in the narration. The bank is validated on load.
- The fact check re-reads sources on every production. If the quote is gone, the job stops.
- Time-sensitive facts (release date, platforms) have a `recheckAfter` date and block
  production once it passes until you update them.
- Labels are shown on screen ("CONFIRMED FACT · SOURCE: ROCKSTARGAMES.COM", "THEORY"...).
- Placeholder visuals are labelled "Original motion graphics · Not gameplay footage".
  The map is labelled "Illustrative map — not to scale".
- Character cards use monograms and generic silhouettes, never a likeness, and no Rockstar artwork.

The fact bank was checked against rockstargames.com/VI and /VI/only-in-leonida on 2026-11-15.
At that point the official page said "Coming November 19, 2026" for PS5 and Xbox Series X|S.
Run `npm run cli facts:check` any time to re-verify all entries.

## Visual assets

Put images and videos you are **allowed to use** into `assets/library/` (see the README there for
the optional per-file `.json` with tags, license, credit and an `aiGenerated` flag). Nothing is
downloaded or scraped automatically, and watermarks are never touched. When a library asset matches a
scene it is used full-bleed with Ken Burns motion and grading. Otherwise the scene uses original
motion graphics (dossier cards, illustrative map, icons, quotes, kinetic type).

An AI image provider can be added behind the same approval gate (`assets.imageProvider`). None is
configured by default, so the factory never invents visuals.

## Voices

| Provider | Cost | Notes |
|---|---|---|
| **Kokoro-82M** (default) | Free, local | Apache-2.0 model weights, commercial use allowed. Male US voices: `am_michael` (default), `am_fenrir`, `am_puck`, `am_onyx`, ... Word timing via whisper.cpp. |
| **Google Cloud TTS** | First 1M chars/month free per tier, then $30/1M (Chirp 3 HD) or $16/1M (Neural2), per [Google's pricing page](https://cloud.google.com/text-to-speech/pricing) (checked 2026-11-15) | A Short is ~450 characters. Neural2 voices return exact word timepoints via SSML marks. Chirp 3 HD has no marks, so whisper aligns it. |

Google setup: create a Google Cloud project, enable "Cloud Text-to-Speech API", attach billing
(needed even for the free tier), create an API key restricted to that API, and paste it into
Settings → API credentials (or set `GOOGLE_TTS_API_KEY`). A service-account JSON path in
`GOOGLE_APPLICATION_CREDENTIALS` also works. Then pick a Google voice in Settings.

Pronunciations live in `config/pronunciation.json` and apply only to the spoken text (captions
keep the real spelling). `npm run cli pron:test` synthesizes each entry and transcribes it back
so you can hear-check by reading. Keep respellings lowercase: all-caps syllables get spelled out.

## Optional: Claude for live research and writing

Set `ANTHROPIC_API_KEY` (Settings → API credentials). The Idea Generator then offers "Claude web
research". It searches the web, extracts claims with verbatim quotes into
`data/facts-discovered.json`, and passes them through the same fact check, so a quote that isn't on
the cited page blocks production. Script writing with Claude also goes through the local scorer and
QC. Default model: `claude-opus-5-5` (change `llm.model` in config). Estimates are shown before
any call, roughly $0.25 per research run and ~$0.30 per script at most (upper bounds).

## Dashboard

`npm start` → http://127.0.0.1:4317 (local only; set `HOST`/`PORT` to change).

- **Dashboard**: counts, queue, approvals, recent projects.
- **Idea Generator**: generate ideas by category, see hooks, labels and source links.
- **Video Generator**: pick idea, duration, voice, captions, music; generate.
- **Batch Generator**: 1/3/5/10 videos with distinct topics, queued and rendered one at a time.
- **Video Library**: preview/download MP4 and thumbnail, titles/description/hashtags, QC report,
  script scores, fact-check table, per-scene edits (camera/transition), narration edits,
  regenerate narration, re-plan scenes, re-render, restart from any stage.
- **Settings**: credentials (write-only), voice, durations, brand colors, captions, music/SFX,
  folders.

API keys are stored in `data/secrets.json` (git-ignored, mode 600) or read from env vars. They are
never returned by the API and are redacted from logs.

## CLI

```bash
npm run cli doctor
npm run cli facts:check
npm run cli ideas -- --category characters --count 5
npm run cli produce -- --idea <idea-id> [--voice am_fenrir] [--provider google]
npm run cli batch -- --count 3
npm run cli status -- --stages
npm run cli resume video-001 -- --from render
npm run cli approvals | approve <id> | reject <id>
```

## Development

```bash
npm test             # unit + pipeline tests (node:test)
npm run typecheck
npm run studio       # Remotion Studio to tweak the templates
```

Layout:

```
config/         default.json (all settings), pronunciation.json, settings.json (your overrides)
data/           fact-bank.json, facts-discovered.json, factory.db, secrets.json
src/core        config/secrets, SQLite, project store, types
src/content     fact bank, ideas, fact check, writer, scoring, Claude
src/tts         providers (Kokoro, Google), pronunciation, narration, caption pages
src/align       whisper.cpp + transcript/time alignment
src/audio       procedural music/SFX, mixing + loudness
src/assets      asset library, scene planner
src/render      Remotion render, QC
src/pipeline    stages + job queue
src/server      dashboard API
remotion/       React/Remotion templates
web/            dashboard UI
```

Rendering note: headless Chromium is launched with `gl: "angle"`, which was ~7× faster than
`swangle` on a 4-core CPU (3.5 vs 0.5 fps). Override with `REMOTION_GL` if your machine
differs. A 30-second Short renders in roughly 4–5 minutes on 4 cores.

## Known limitations

- Without your own approved footage, videos use original motion graphics (clearly labelled).
  They look polished, but real gameplay or press imagery you're allowed to use will perform better.
- The offline writer only knows what is in the fact bank. Add new verified entries (with quote,
  URL, date) to grow it, or use Claude mode for discovery.
- whisper `base.en` alignment is typically within ~50–150 ms per word. QC flags anything worse.
- Not affiliated with Rockstar Games or Take-Two Interactive.
