// GTA VI Shorts Factory — dashboard (no build step, plain ES modules).
const $app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const api = async (url, opts = {}) => {
  const res = await fetch(url, { headers: { "content-type": "application/json" }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
};
const toast = (msg) => {
  const el = document.createElement("div");
  el.textContent = msg;
  document.getElementById("toast").appendChild(el);
  setTimeout(() => el.remove(), 5000);
};
const badge = (s) => `<span class="badge ${esc(s)}">${esc(String(s).replace(/_/g, " "))}</span>`;
const LABELS = { CONFIRMED_FACT: "CONFIRMED FACT", THEORY: "THEORY", SPECULATION: "SPECULATION", AI_CONCEPT: "AI-GENERATED CONCEPT" };
const labelBadge = (l) => `<span class="badge ${esc(l)}">${esc(LABELS[l] || l)}</span>`;
const pct = (p) => `<div class="progress"><div style="width:${Math.round((p || 0) * 100)}%"></div></div>`;
let meta = null;
let timer = null;

async function getMeta() {
  if (!meta) meta = await api("/api/meta");
  return meta;
}

function approvalsHtml(list) {
  if (!list.length) return "";
  return `<div class="panel approval mt"><h2>Waiting for your approval</h2>
    ${list.map((a) => `<div class="row" style="margin:10px 0">
      <div><b>${esc(a.project_id)}</b> — ${esc(a.provider)} · estimated <b>$${Number(a.estimate_usd).toFixed(3)}</b><div class="muted small">${esc(a.detail)}</div></div>
      <div class="spacer"></div>
      <button data-approve="${a.id}">Approve</button><button class="ghost" data-reject="${a.id}">Reject</button></div>`).join("")}</div>`;
}

function bindApprovals() {
  document.querySelectorAll("[data-approve],[data-reject]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.approve || b.dataset.reject;
      await api(`/api/approvals/${id}`, { method: "POST", body: { approve: Boolean(b.dataset.approve) } });
      toast(b.dataset.approve ? "Approved — job resumed" : "Rejected");
      route();
    }),
  );
}

// ------------------------------------------------------------------ pages
const pages = {
  async dashboard() {
    const o = await api("/api/overview");
    $app.innerHTML = `
      <h1>Dashboard</h1>
      <div class="grid cols-3">
        <div class="panel"><h3>Videos generated</h3><div class="stat ok">${o.generated}</div></div>
        <div class="panel"><h3>In progress</h3><div class="stat run">${o.inProgress}</div></div>
        <div class="panel"><h3>Failed renders</h3><div class="stat bad">${o.failed}</div></div>
      </div>
      ${approvalsHtml(o.approvals)}
      <div class="grid cols-2 mt">
        <div class="panel"><h2>Recent projects</h2>
          <table><tr><th>Video</th><th>Status</th><th>Stage</th></tr>
          ${o.recent.map((p) => `<tr><td><a href="#/library/${p.id}">${esc(p.id)}</a><div class="small">${esc(p.title)}</div></td><td>${badge(p.status)}</td><td class="small muted">${esc(p.stage || "")}</td></tr>`).join("") || `<tr><td colspan=3 class="muted">No videos yet — start in the Idea Generator.</td></tr>`}
          </table></div>
        <div class="panel"><h2>Job queue</h2>
          ${o.jobs.map((j) => `<div style="margin:10px 0"><div class="row"><b>#${j.id}</b> ${esc(j.project_id)} ${badge(j.status)}<span class="spacer"></span><span class="small muted">${esc(j.kind)}</span></div>${pct(j.progress)}<div class="small muted">${esc((j.message || "").split("\n")[0])}</div></div>`).join("") || `<p class="muted">Queue is empty.</p>`}
        </div>
      </div>
      <p class="muted small mt">Writer: ${o.claude ? "Claude (with approval) or offline fact bank" : "offline verified fact bank (add an Anthropic key in Settings for web research)"}.</p>`;
    bindApprovals();
    timer = setTimeout(route, 3000);
  },

  async ideas() {
    const m = await getMeta();
    const ideas = await api("/api/ideas");
    $app.innerHTML = `
      <h1>Idea Generator</h1>
      <div class="panel row">
        <label>Category<select id="cat"><option value="any">Any</option>${m.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
        <label>How many<select id="cnt"><option>3</option><option selected>6</option><option>10</option></select></label>
        <label>Source<select id="src"><option value="offline">Verified fact bank (free)</option><option value="claude" ${m.claude ? "" : "disabled"}>Claude web research (paid ~$${m.claudeEstimate.usd.toFixed(2)})</option></select></label>
        <div class="spacer"></div><button id="gen">Generate ideas</button>
      </div>
      <p class="muted small">Every idea is built from claims with stored source URLs and dates. Theories and speculation are labelled and hedged in the narration.</p>
      <div class="cards mt">${ideas.map(ideaCard).join("") || `<p class="muted">No ideas yet.</p>`}</div>`;
    document.getElementById("gen").onclick = async () => {
      const body = { category: cat.value, count: Number(cnt.value), source: src.value };
      try {
        let res = await api("/api/ideas/generate", { method: "POST", body });
        if (res.needsApproval) {
          if (!confirm(`Claude web research costs about $${res.estimate.usd.toFixed(3)}.\n${res.estimate.detail}\n\nApprove this spend?`)) return;
          toast("Researching with Claude…");
          res = await api("/api/ideas/generate", { method: "POST", body: { ...body, approve: true } });
        }
        toast(`${res.ideas.length} ideas ready`);
        route();
      } catch (e) {
        toast(e.message);
      }
    };
    bindIdeaButtons();
  },

  async generate() {
    const m = await getMeta();
    const [ideas, settings] = await Promise.all([api("/api/ideas"), api("/api/settings")]);
    const pre = new URLSearchParams(location.hash.split("?")[1] || "").get("idea");
    const c = settings.config;
    $app.innerHTML = `
      <h1>Video Generator</h1>
      <div class="panel form">
        <label style="grid-column:1/-1">Idea<select id="idea">${ideas.map((i) => `<option value="${i.id}" ${i.id === pre ? "selected" : ""}>${esc(i.title)} — ${esc(i.hook)}${i.duplicate ? " (topic already produced)" : ""}</option>`).join("")}</select></label>
        <label>Target duration<select id="dur"><option value="25">~25 s</option><option value="30" selected>~30 s</option><option value="35">~35 s</option></select></label>
        <label>Voice provider<select id="prov"><option value="kokoro">Kokoro (local, free)</option><option value="google" ${settings.secrets.GOOGLE_TTS_API_KEY || settings.secrets.GOOGLE_APPLICATION_CREDENTIALS ? "" : "disabled"}>Google Cloud TTS</option></select></label>
        <label>Voice<select id="voice"></select></label>
        <label>Caption style<select id="cap"><option value="pop">Pop (yellow highlights)</option></select></label>
        <label>Music<select id="music"><option value="1" ${c.music.enabled ? "selected" : ""}>On</option><option value="0" ${c.music.enabled ? "" : "selected"}>Off</option></select></label>
      </div>
      <div id="preview" class="panel mt"></div>
      <div class="row mt"><button id="go">Generate complete video</button><span class="muted small">Runs fact check → script → voice → scenes → captions → audio → render → QC → export.</span></div>`;
    const voices = () => {
      const list = prov.value === "google" ? m.googleVoices : m.kokoroVoices;
      const cur = prov.value === "google" ? c.voice.google.voice : c.voice.kokoro.voice;
      voice.innerHTML = list.map((v) => `<option value="${v.id}" ${v.id === cur ? "selected" : ""}>${esc(v.name)}</option>`).join("");
    };
    const showIdea = () => {
      const i = ideas.find((x) => x.id === idea.value);
      preview.innerHTML = i ? ideaDetails(i) : `<p class="muted">Generate ideas first.</p>`;
    };
    prov.onchange = voices;
    idea.onchange = showIdea;
    voices();
    showIdea();
    go.onclick = async () => {
      if (!idea.value) return toast("Pick an idea first");
      try {
        const res = await api("/api/projects", { method: "POST", body: { ideaId: idea.value, targetSeconds: Number(dur.value), voiceProvider: prov.value, voice: voice.value, captionStyle: cap.value, music: music.value === "1" } });
        toast(`${res.project.id} queued`);
        location.hash = `#/library/${res.project.id}`;
      } catch (e) {
        toast(e.message);
      }
    };
  },

  async batch() {
    const m = await getMeta();
    const jobs = await api("/api/jobs");
    const batches = {};
    for (const j of jobs.filter((j) => j.batch_id)) (batches[j.batch_id] ||= []).push(j);
    $app.innerHTML = `
      <h1>Batch Generator</h1>
      <div class="panel row">
        <label>Videos<select id="n"><option>1</option><option selected>3</option><option>5</option><option>10</option></select></label>
        <label>Category<select id="cat"><option value="any">Any</option>${m.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
        <div class="spacer"></div><button id="go">Queue batch</button>
      </div>
      <p class="muted small">Picks distinct, unused topics (no duplicate topics or repeated facts where possible) and renders them one after another.</p>
      ${Object.entries(batches).map(([id, js]) => `<div class="panel mt"><h2>${esc(id)}</h2>${js.map((j) => `<div style="margin:8px 0"><div class="row"><a href="#/library/${j.project_id}">${esc(j.project_id)}</a> ${badge(j.status)}<span class="spacer"></span><span class="small muted">${esc((j.message || "").split("\n")[0])}</span></div>${pct(j.progress)}</div>`).join("")}</div>`).join("") || `<p class="muted mt">No batches yet.</p>`}`;
    go.onclick = async () => {
      try {
        const r = await api("/api/batch", { method: "POST", body: { count: Number(n.value), category: cat.value } });
        toast(`Queued ${r.created} of ${r.requested} videos`);
        route();
      } catch (e) {
        toast(e.message);
      }
    };
    timer = setTimeout(route, 3000);
  },

  async library(id) {
    if (id) return projectPage(id);
    const list = await api("/api/projects");
    $app.innerHTML = `<h1>Video Library</h1>
      <div class="cards">${list.map((p) => `
        <a class="panel" style="text-decoration:none;color:inherit" href="#/library/${p.id}">
          ${p.hasVideo ? `<img class="thumb" src="/api/projects/${p.id}/file/thumbnail.png" loading="lazy" style="aspect-ratio:9/16;object-fit:cover" onerror="this.remove()"/>` : ""}
          <div class="row mt"><b>${esc(p.id)}</b>${badge(p.status)}</div>
          <div>${esc(p.title)}</div>
          ${p.job && ["running", "queued"].includes(p.job.status) ? pct(p.job.progress) : ""}
        </a>`).join("") || `<p class="muted">No videos yet.</p>`}</div>`;
    if (list.some((p) => ["running", "queued"].includes(p.status))) timer = setTimeout(route, 4000);
  },

  async settings() {
    const s = await api("/api/settings");
    const c = s.config;
    const m = await getMeta();
    const secretRow = (k, help) => `<div class="secret-row"><b>${k}</b><input type="password" id="sec-${k}" placeholder="${s.secrets[k] ? "configured — enter a new value to replace" : "not set"}" autocomplete="off"/><button data-save="${k}">Save</button><button class="ghost" data-clear="${k}">Clear</button><div class="muted small" style="grid-column:1/-1">${help}</div></div>`;
    $app.innerHTML = `
      <h1>Settings</h1>
      <div class="panel"><h2>API credentials</h2>
        <p class="muted small">Stored locally in data/secrets.json (git-ignored) or read from environment variables. Values are never sent back to this page or written to logs.</p>
        ${secretRow("ANTHROPIC_API_KEY", "Optional. Enables live web research + Claude script writing. Each use shows a cost estimate and needs your approval.")}
        ${secretRow("GOOGLE_TTS_API_KEY", "Optional. Google Cloud Text-to-Speech API key (Chirp 3 HD / Neural2). First 1M characters/month free per voice tier, then $30/1M (Chirp 3 HD) or $16/1M (Neural2) — check cloud.google.com/text-to-speech/pricing.")}
        ${secretRow("GOOGLE_APPLICATION_CREDENTIALS", "Alternative to an API key: absolute path to a service-account JSON file.")}
      </div>
      <div class="panel mt"><h2>Voice</h2><div class="form">
        <label>Provider<select data-k="voice.provider"><option value="kokoro" ${c.voice.provider === "kokoro" ? "selected" : ""}>Kokoro (local, Apache-2.0)</option><option value="google" ${c.voice.provider === "google" ? "selected" : ""}>Google Cloud TTS</option></select></label>
        <label>Kokoro voice<select data-k="voice.kokoro.voice">${m.kokoroVoices.map((v) => `<option value="${v.id}" ${v.id === c.voice.kokoro.voice ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>
        <label>Kokoro speed<input type="number" step="0.01" data-k="voice.kokoro.speed" data-num value="${c.voice.kokoro.speed}"/></label>
        <label>Google voice<select data-k="voice.google.voice">${m.googleVoices.map((v) => `<option value="${v.id}" ${v.id === c.voice.google.voice ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></label>
        <label>Google speaking rate<input type="number" step="0.01" data-k="voice.google.speakingRate" data-num value="${c.voice.google.speakingRate}"/></label>
        <label>Google pitch (Neural2)<input type="number" step="0.5" data-k="voice.google.pitch" data-num value="${c.voice.google.pitch}"/></label>
        <label>Pause between sentences (ms)<input type="number" data-k="voice.sentencePauseMs" data-num value="${c.voice.sentencePauseMs}"/></label>
        <label>Pause between sections (ms)<input type="number" data-k="voice.segmentPauseMs" data-num value="${c.voice.segmentPauseMs}"/></label>
      </div><p class="muted small">Pronunciations: edit config/pronunciation.json (then run <code>npm run cli pron:test</code>).</p></div>
      <div class="panel mt"><h2>Video & script</h2><div class="form">
        <label>Min seconds<input type="number" data-k="video.minSeconds" data-num value="${c.video.minSeconds}"/></label>
        <label>Max seconds<input type="number" data-k="video.maxSeconds" data-num value="${c.video.maxSeconds}"/></label>
        <label>Min words<input type="number" data-k="script.minWords" data-num value="${c.script.minWords}"/></label>
        <label>Max words<input type="number" data-k="script.maxWords" data-num value="${c.script.maxWords}"/></label>
        <label>Quality threshold<input type="number" data-k="script.qualityThreshold" data-num value="${c.script.qualityThreshold}"/></label>
        <label>Channel handle<input data-k="channel.handle" value="${esc(c.channel.handle)}"/></label>
      </div></div>
      <div class="panel mt"><h2>Brand & captions</h2><div class="form">
        <label>Primary<input type="color" data-k="brand.primary" value="${c.brand.primary}"/></label>
        <label>Secondary<input type="color" data-k="brand.secondary" value="${c.brand.secondary}"/></label>
        <label>Accent<input type="color" data-k="brand.accent" value="${c.brand.accent}"/></label>
        <label>Caption text<input type="color" data-k="captions.textColor" value="${c.captions.textColor}"/></label>
        <label>Caption highlight<input type="color" data-k="captions.highlightColor" value="${c.captions.highlightColor}"/></label>
        <label>Caption size (px)<input type="number" data-k="captions.fontSize" data-num value="${c.captions.fontSize}"/></label>
        <label>Words per caption<input type="number" min="1" max="4" data-k="captions.maxWordsPerPage" data-num value="${c.captions.maxWordsPerPage}"/></label>
        <label>Caption height (0–1)<input type="number" step="0.01" data-k="captions.positionY" data-num value="${c.captions.positionY}"/></label>
      </div></div>
      <div class="panel mt"><h2>Music & SFX</h2><div class="form">
        <label>Music<select data-k="music.enabled" data-bool><option value="true" ${c.music.enabled ? "selected" : ""}>On</option><option value="false" ${c.music.enabled ? "" : "selected"}>Off</option></select></label>
        <label>Music source<select data-k="music.source"><option value="auto" ${c.music.source === "auto" ? "selected" : ""}>assets/music if present, else original score</option><option value="synth" ${c.music.source === "synth" ? "selected" : ""}>Always original synthesized score</option></select></label>
        <label>Music level (dB)<input type="number" data-k="music.volumeDb" data-num value="${c.music.volumeDb}"/></label>
        <label>Ducking (dB)<input type="number" data-k="music.duckDb" data-num value="${c.music.duckDb}"/></label>
        <label>SFX<select data-k="sfx.enabled" data-bool><option value="true" ${c.sfx.enabled ? "selected" : ""}>On</option><option value="false" ${c.sfx.enabled ? "" : "selected"}>Off</option></select></label>
        <label>SFX level (dB)<input type="number" data-k="sfx.volumeDb" data-num value="${c.sfx.volumeDb}"/></label>
      </div><p class="muted small">Only put music/SFX you are licensed to use commercially into assets/music and assets/sfx. No GTA soundtrack recordings.</p></div>
      <div class="panel mt"><h2>Folders</h2><div class="form">
        <label>Asset folders (comma separated)<input data-k="assets.libraryDirs" data-list value="${esc(c.assets.libraryDirs.join(", "))}"/></label>
        <label>Music folder<input data-k="assets.musicDir" value="${esc(c.assets.musicDir)}"/></label>
        <label>Output directory<input data-k="paths.exports" value="${esc(c.paths.exports)}"/></label>
      </div><p class="muted small">${s.libraryCount} approved assets found.</p></div>
      <div class="row mt"><button id="save">Save settings</button></div>`;
    document.querySelectorAll("[data-save]").forEach((b) => (b.onclick = async () => {
      const k = b.dataset.save;
      const v = document.getElementById(`sec-${k}`).value.trim();
      if (!v) return toast("Enter a value first");
      await api("/api/secrets", { method: "PUT", body: { key: k, value: v } });
      meta = null;
      toast(`${k} saved`);
      route();
    }));
    document.querySelectorAll("[data-clear]").forEach((b) => (b.onclick = async () => {
      await api("/api/secrets", { method: "PUT", body: { key: b.dataset.clear, value: null } });
      meta = null;
      toast("Cleared");
      route();
    }));
    save.onclick = async () => {
      const patch = {};
      document.querySelectorAll("[data-k]").forEach((el) => {
        let v = el.value;
        if (el.hasAttribute("data-num")) v = Number(v);
        if (el.hasAttribute("data-bool")) v = v === "true";
        if (el.hasAttribute("data-list")) v = v.split(",").map((x) => x.trim()).filter(Boolean);
        const keys = el.dataset.k.split(".");
        let o = patch;
        keys.slice(0, -1).forEach((k) => (o = o[k] ||= {}));
        o[keys[keys.length - 1]] = v;
      });
      await api("/api/settings", { method: "PUT", body: patch });
      toast("Settings saved");
    };
  },
};

function ideaDetails(i) {
  return `<div class="idea">
    <div class="row">${badge(i.category)} ${i.labels.map(labelBadge).join(" ")}<span class="spacer"></span><span class="small muted">${esc(i.format)}</span></div>
    <div class="hook">“${esc(i.hook)}”</div>
    <div><b>${esc(i.title)}</b></div>
    <div class="muted small">${esc(i.angle)}</div>
    <ul>${(i.facts || []).map((f) => `<li>${labelBadge(f.label)} ${esc(f.claim)}${f.sources.map((s) => ` <a href="${esc(s.url)}" target="_blank" rel="noopener">source</a> <span class="small muted">(${esc(s.retrievedAt)})</span>`).join("")}</li>`).join("")}</ul>
  </div>`;
}

function ideaCard(i) {
  return `<div class="panel">${ideaDetails(i)}
    <div class="row mt">${i.duplicate ? `<span class="badge warning">TOPIC ALREADY PRODUCED</span>` : ""}<span class="spacer"></span><a class="btn" href="#/generate?idea=${i.id}">Produce</a></div></div>`;
}
function bindIdeaButtons() {}

async function projectPage(id) {
  const d = await api(`/api/projects/${id}`);
  const p = d.project;
  const job = d.jobs[0];
  const script = d.script;
  const meta = d.metadata;
  const qc = d.qc;
  const running = ["running", "queued"].includes(p.status);
  const scoreRow = (k) => `<div>${k}</div><div class="progress"><div style="width:${script.score[k]}%"></div></div><div>${script.score[k]}</div>`;
  $app.innerHTML = `
    <div class="row"><h1 style="margin:0">${esc(p.title)}</h1><span class="spacer"></span>${badge(p.status)}</div>
    <p class="muted">${esc(p.id)} · ${esc(p.category)} · created ${esc(p.created_at.slice(0, 16).replace("T", " "))}</p>
    ${approvalsHtml((await api("/api/approvals")).filter((a) => a.project_id === id))}
    ${p.error ? `<pre style="border-color:var(--red)">${esc(p.error)}</pre>` : ""}
    ${job && running ? `<div class="panel">${pct(job.progress)}<div class="small muted mt">${esc(job.message || "")}</div></div>` : ""}
    <div class="panel mt"><h3>Pipeline</h3><div class="stages">${d.stages.map((s) => `<span class="stage ${esc(s.status)}" title="${esc(s.error || "")}">${esc(s.name)}</span>`).join("")}</div>
      <div class="row mt">
        <button class="ghost" data-job="resume">Resume / retry</button>
        <button class="ghost" data-job="renarrate">Regenerate narration</button>
        <button class="ghost" data-job="rescene">Re-plan scenes</button>
        <button class="ghost" data-job="rerender">Re-render video</button>
        <label style="flex-direction:row;align-items:center">from stage <select id="fromStage">${d.stages.map((s) => `<option>${s.id}</option>`).join("")}</select></label><button class="ghost" id="fromBtn">Restart from stage</button>
      </div></div>
    <div class="video-card mt">
      <div>${d.files.includes("final.mp4") ? `<video class="short" src="/api/projects/${id}/file/final.mp4?t=${Date.now()}" controls playsinline></video>
        <div class="row mt"><a class="btn" href="/api/projects/${id}/file/final.mp4?download=1">Download MP4</a><a class="btn ghost" href="/api/projects/${id}/file/thumbnail.png?download=1">Thumbnail</a></div>` : `<div class="panel muted">No video yet.</div>`}</div>
      <div class="grid">
        ${meta ? `<div class="panel"><h2>YouTube metadata</h2>
          <h3>Titles</h3><ol>${meta.titles.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>
          <h3>Description</h3><pre>${esc(meta.description)}</pre>
          <h3>Hashtags</h3><p>${meta.hashtags.map(esc).join(" ")}</p>
          <h3>Pinned comment</h3><p>${esc(meta.pinnedComment)}</p>
          <h3>AI disclosure</h3><p>${meta.aiDisclosure.youtubeAlteredContentToggle ? badge("warning") + " Turn ON YouTube's altered/synthetic content setting." : badge("ok") + " Altered-content toggle not required."} <span class="muted small">${esc(meta.aiDisclosure.reason)}</span></p>
        </div>` : ""}
        ${qc ? `<div class="panel"><h2>Quality checks ${qc.passed ? badge("ok") : badge("failed")}</h2>${qc.checks.map((c) => `<div class="check"><span class="icon">${c.ok ? "✅" : c.severity === "warning" ? "⚠️" : "❌"}</span><b style="width:220px">${esc(c.name)}</b><span class="muted small">${esc(c.detail)}</span></div>`).join("")}</div>` : ""}
      </div>
    </div>
    ${d.files.includes("contact.jpg") ? `<div class="panel mt"><h3>Contact sheet</h3><img class="thumb" src="/api/projects/${id}/file/contact.jpg"/></div>` : ""}
    ${script ? `<div class="panel mt"><div class="row"><h2 style="margin:0">Script</h2><span class="spacer"></span><span class="muted small">${script.wordCount} words · ~${script.estSeconds.toFixed(1)} s · writer: ${esc(script.writer)}</span></div>
      <div class="grid cols-2 mt"><div>${script.segments.map((s) => `<div class="seg ${s.role}"><div class="row small"><b>${s.role.toUpperCase()}</b>${s.label !== "NONE" ? labelBadge(s.label) : ""}<span class="spacer"></span><button class="ghost" data-edit="${s.id}" style="padding:4px 10px">Edit</button></div><div id="txt-${s.id}">${esc(s.text)}</div></div>`).join("")}</div>
      <div><div class="score-bars">${["hook", "clarity", "originality", "accuracy", "visual", "retention"].map(scoreRow).join("")}<div><b>Total</b></div><div class="progress"><div style="width:${script.score.total}%"></div></div><div><b>${script.score.total}</b></div></div>
      ${script.score.issues.length ? `<ul class="small muted">${script.score.issues.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <div class="small muted mt">${script.revisions.map((r) => `round ${r.round}: ${r.total} — ${esc(r.note)}`).join("<br/>")}</div></div></div></div>` : ""}
    ${d.scenes ? `<div class="panel mt"><h2>Scenes</h2><table><tr><th>#</th><th>Time</th><th>Visual</th><th>Label</th><th>Asset</th><th>Edit</th></tr>
      ${d.scenes.scenes.map((s) => `<tr><td>${s.index + 1}</td><td class="small">${s.start.toFixed(2)}–${s.end.toFixed(2)}s</td><td>${esc(s.visual.kind)} <span class="small muted">${esc(s.visual.name || s.visual.text || s.visual.region || "")}</span></td><td>${s.label !== "NONE" ? labelBadge(s.label) : ""}</td><td class="small">${esc(s.asset.path || "original graphics")}</td>
      <td><select data-scene="${s.id}"><option value="">—</option><option value="camera:push-in">camera: push-in</option><option value="camera:pull-out">camera: pull-out</option><option value="camera:pan-left">camera: pan-left</option><option value="transition:flash">transition: flash</option><option value="transition:zoom">transition: zoom</option><option value="transition:slide">transition: slide</option><option value="transition:glitch">transition: glitch</option></select></td></tr>`).join("")}
      </table><p class="muted small">Changing a scene re-plans and re-renders only from scene planning onward (narration is kept).</p></div>` : ""}
    ${d.research ? `<div class="panel mt"><h2>Fact check</h2><p class="small muted">Checked ${esc(d.research.checkedAt.slice(0, 16).replace("T", " "))} · ${esc(d.research.notes.join(" "))}</p>
      <table>${d.research.facts.map((f) => `<tr><td>${labelBadge(f.label)}</td><td>${esc(f.claim)}<div class="small muted">${esc(f.notes || "")}</div></td><td>${badge(f.verdict === "verified" ? "ok" : f.verdict === "source-unreachable" ? "warning" : "failed")}<div class="small">${f.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.publisher)}</a>`).join(", ")}</div></td></tr>`).join("")}</table></div>` : ""}
    ${d.audio ? `<div class="panel mt"><h3>Audio</h3><p class="small">Music: ${esc(d.audio.music?.source || "off")} — ${esc(d.audio.music?.license || "")}<br/>SFX: ${esc(d.audio.sfx?.source || "off")}<br/>Voice: ${esc(d.voiceover?.provider)} / ${esc(d.voiceover?.voice)} · alignment: ${esc(d.voiceover?.alignment)}</p></div>` : ""}
    <div class="panel mt"><h3>Log</h3><pre>${d.logs.map((l) => `${l.at.slice(11, 19)} ${l.level.toUpperCase()} ${l.message}`).map(esc).join("\n")}</pre></div>`;
  bindApprovals();
  document.querySelectorAll("[data-job]").forEach((b) => (b.onclick = async () => {
    await api(`/api/projects/${id}/jobs`, { method: "POST", body: { kind: b.dataset.job } });
    toast("Job queued");
    route();
  }));
  fromBtn.onclick = async () => {
    await api(`/api/projects/${id}/jobs`, { method: "POST", body: { kind: "resume", fromStage: fromStage.value } });
    toast(`Restarting from ${fromStage.value}`);
    route();
  };
  document.querySelectorAll("[data-scene]").forEach((sel) => (sel.onchange = async () => {
    if (!sel.value) return;
    const [k, v] = sel.value.split(":");
    await api(`/api/projects/${id}/scenes/${sel.dataset.scene}`, { method: "PATCH", body: { [k]: v } });
    toast("Scene updated — re-rendering");
    route();
  }));
  document.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = async () => {
    const seg = script.segments.find((s) => s.id === b.dataset.edit);
    const text = prompt("Edit narration (claims must stay accurate — fact labels are kept):", seg.text);
    if (!text || text === seg.text) return;
    const r = await api(`/api/projects/${id}/script/${seg.id}`, { method: "PATCH", body: { text } });
    toast(`Re-scored ${r.score.total}. Regenerating narration…`);
    route();
  }));
  if (running || p.status === "awaiting_approval") timer = setTimeout(route, 3000);
}

// ------------------------------------------------------------------ router
async function route() {
  clearTimeout(timer);
  const [page, arg] = (location.hash.replace(/^#\//, "").split("?")[0] || "dashboard").split("/");
  document.querySelectorAll("nav a").forEach((a) => a.classList.toggle("active", a.dataset.page === page));
  try {
    await (pages[page] || pages.dashboard)(arg);
  } catch (e) {
    $app.innerHTML = `<h1>Error</h1><pre>${esc(e.message)}</pre>`;
  }
}
window.addEventListener("hashchange", route);
route();
