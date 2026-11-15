import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "factory-pipe-"));
process.env.FACTORY_DB = path.join(tmp, "test.db");
process.env.FACTORY_QUIET = "1";

const { getDb } = await import("../src/core/db.ts");
const { saveSettings, getConfig } = await import("../src/core/config.ts");
const { createProject, getProject, usedTopicKeys } = await import("../src/core/project.ts");
const { STAGES, invalidateFrom, stageDone, requireApproval, ApprovalNeeded } = await import("../src/pipeline/stages.ts");
const { runJob, enqueue, approve, createBatch } = await import("../src/pipeline/queue.ts");
const { offlineIdeas, saveIdeas } = await import("../src/content/ideas.ts");
import type { JobRow } from "../src/pipeline/queue.ts";

// Point projects/exports at a temp dir without touching the real settings file permanently.
const settingsFile = path.resolve(import.meta.dirname, "..", "config", "settings.json");
const hadSettings = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, "utf8") : null;
saveSettings({ paths: { projects: path.join(tmp, "projects"), exports: path.join(tmp, "exports") } });
process.on("exit", () => {
  if (hadSettings === null) fs.rmSync(settingsFile, { force: true });
  else fs.writeFileSync(settingsFile, hadSettings);
});

test("stages run in order, checkpoint, and resume after a failure without redoing work", async () => {
  const idea = offlineIdeas({ count: 1 })[0];
  saveIdeas([idea]);
  const p = createProject(idea);
  // Replace real stage bodies with fast fakes that write their declared outputs.
  const calls: string[] = [];
  let failOnce = true;
  const originals = STAGES.map((s) => s.run);
  STAGES.forEach((s) => {
    s.run = async ({ dir }) => {
      calls.push(s.id);
      if (s.id === "audio" && failOnce) {
        failOnce = false;
        throw new Error("simulated crash");
      }
      for (const o of s.outputs) fs.writeFileSync(path.join(dir, o), "x");
    };
    s.retries = 0;
  });
  try {
    const job = () => getDb().prepare(`SELECT * FROM jobs WHERE project_id=? ORDER BY id DESC LIMIT 1`).get(p.id) as unknown as JobRow;
    enqueue(p.id, "produce");
    assert.equal(await runJob(job()), "failed");
    assert.equal(getProject(p.id)!.status, "failed");
    assert.deepEqual(calls, ["research", "script", "voiceover", "scenes", "subtitles", "audio"]);
    calls.length = 0;
    enqueue(p.id, "resume");
    assert.equal(await runJob(job()), "done");
    assert.deepEqual(calls, ["audio", "render", "qc", "export"], "resumed at the failed stage only");
    // Re-render invalidates render and later stages only.
    calls.length = 0;
    enqueue(p.id, "rerender");
    assert.equal(await runJob(job()), "done");
    assert.deepEqual(calls, ["render", "qc", "export"]);
    invalidateFrom(p.id, "voiceover");
    assert.equal(stageDone(p.id, STAGES.find((s) => s.id === "script")!), true);
    assert.equal(stageDone(p.id, STAGES.find((s) => s.id === "voiceover")!), false);
  } finally {
    STAGES.forEach((s, i) => (s.run = originals[i]));
  }
});

test("paid steps wait for approval and resume once approved", async () => {
  const idea = offlineIdeas({ count: 3 })[2];
  saveIdeas([idea]);
  const p = createProject(idea);
  assert.throws(() => requireApproval(p.id, "voiceover", "Google TTS", 0.02, "test"), ApprovalNeeded);
  const a = getDb().prepare(`SELECT id FROM approvals WHERE project_id=?`).get(p.id) as { id: number };
  approve(a.id, true);
  assert.doesNotThrow(() => requireApproval(p.id, "voiceover", "Google TTS", 0.02, "test"));
  // Free steps never ask.
  assert.doesNotThrow(() => requireApproval(p.id, "voiceover", "Kokoro", 0, "free"));
  assert.ok(getConfig().costs.requireApproval);
});

test("batch picks distinct topics and never repeats an existing topic", () => {
  const before = usedTopicKeys();
  const res = createBatch(3, "any");
  assert.equal(res.created, 3);
  const keys = res.projects.map((id) => getProject(id)!.topic_key);
  assert.equal(new Set(keys).size, 3);
  for (const k of keys) assert.ok(!before.has(k));
});
