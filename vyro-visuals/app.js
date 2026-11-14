(() => {
  "use strict";
  const data = (typeof VYRO !== "undefined" && VYRO) || { perfil: {}, gfx: {}, vfx: {}, animaciones: [] };

  // Forma de las tarjetas por categoría
  const SHAPES = {
    deportes:   { shape: "portrait", ratio: "4 / 5",  badge: "Deportes",   label: "Deportes" },
    gaming:     { shape: "square",   ratio: "1 / 1",  badge: "Gaming",     label: "Gaming" },
    miniaturas: { shape: "wide",     ratio: "16 / 9", badge: "Miniatura",  label: "Miniaturas" },
    largos:     { shape: "wide",     ratio: "16 / 9", badge: "Vídeo",      label: "Vídeos largos" },
    shorts:     { shape: "portrait", ratio: "9 / 16", badge: "Short",      label: "Shorts" },
    animaciones:{ shape: "wide",     ratio: "16 / 9", badge: "Animación",  label: "Animaciones" },
  };
  const VIDEO_CATS = new Set(["largos", "shorts", "animaciones"]);
  const MAX_BYTES = 20 * 1024 * 1024;

  // Trabajos fijos (contenido.js) + trabajos subidos arrastrando (solo en la vista de Claude)
  const STATIC = {
    deportes: data.gfx?.deportes || [], gaming: data.gfx?.gaming || [], miniaturas: data.gfx?.miniaturas || [],
    largos: data.vfx?.largos || [], shorts: data.vfx?.shorts || [], animaciones: data.animaciones || [],
  };
  const uploaded = Object.fromEntries(Object.keys(SHAPES).map(k => [k, []]));
  const pending = Object.fromEntries(Object.keys(SHAPES).map(k => [k, []]));
  const listFor = cat => [...uploaded[cat], ...STATIC[cat]];

  const active = { gfx: "deportes", vfx: "largos", animaciones: "animaciones" };
  let editor = null; // { db, assets, col } cuando quien mira puede editar

  const $ = (s, el = document) => el.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k === "style") n.style.cssText = v;
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v);
    }
    kids.flat().forEach(c => c != null && n.append(c));
    return n;
  };

  const ytThumb = id => `https://i.ytimg.com/vi/${encodeURIComponent(id)}/hqdefault.jpg`;
  const ytEmbed = id => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`;

  // ---------- Tarjetas ----------
  function mediaFor(item, cat) {
    const alt = item.titulo || "";
    if (item.imagen) return el("img", { src: item.imagen, alt, loading: "lazy" });
    if (item.portada) return el("img", { src: item.portada, alt, loading: "lazy" });
    if (item.youtube) return el("img", { src: ytThumb(item.youtube), alt, loading: "lazy" });
    if (item.video) {
      const v = el("video", { src: item.video + "#t=0.1", muted: "", playsinline: "", preload: "metadata", loop: "" });
      v.muted = true;
      return v;
    }
    return el("div");
  }

  function card(item, cat, index, list) {
    const cfg = SHAPES[cat];
    const isVideo = !item.imagen;
    const meta = item.cliente || item.fecha || "";
    const btn = el("button", { class: "card", style: `--ratio:${cfg.ratio}; animation-delay:${Math.min(index, 8) * 50}ms`, "aria-label": `Ver ${item.titulo || cfg.badge}` },
      el("div", { class: "card__media" },
        mediaFor(item, cat),
        el("span", { class: "card__badge" }, cfg.badge),
        isVideo ? el("span", { class: "card__play", "aria-hidden": "true" }) : null
      ),
      el("div", { class: "card__info" },
        el("span", { class: "card__title" }, item.titulo || "Sin título"),
        meta ? el("span", { class: "card__meta" }, meta) : null
      )
    );
    btn.addEventListener("click", () => Viewer.open(list, index, cat));
    const vid = btn.querySelector("video");
    if (vid) {
      btn.addEventListener("mouseenter", () => vid.play().catch(() => {}));
      btn.addEventListener("mouseleave", () => { vid.pause(); });
    }
    if (!(editor && item._id)) return btn;

    // Controles del editor: renombrar y borrar
    const wrap = el("div", { class: "card-wrap" }, btn);
    const tools = el("div", { class: "card-tools" },
      el("button", { class: "tool", type: "button", title: "Cambiar título", "aria-label": "Cambiar título" }, "✎"),
      el("button", { class: "tool tool--danger", type: "button", title: "Borrar", "aria-label": "Borrar" }, "✕")
    );
    const [renameBtn, delBtn] = tools.children;
    renameBtn.addEventListener("click", () => startRename(wrap, item));
    delBtn.addEventListener("click", () => confirmDelete(wrap, item));
    wrap.append(tools);
    return wrap;
  }

  function startRename(wrap, item) {
    if (wrap.querySelector(".rename")) return;
    const input = el("input", { class: "rename__input", type: "text", id: "rename-" + item._id, value: item.titulo || "", "aria-label": "Título", maxlength: "80" });
    const client = el("input", { class: "rename__input", type: "text", id: "client-" + item._id, value: item.cliente || "", placeholder: "Cliente (opcional)", "aria-label": "Cliente", maxlength: "60" });
    const save = el("button", { class: "btn btn--small", type: "submit" }, "Guardar");
    const cancel = el("button", { class: "btn btn--small btn--ghost", type: "button" }, "Cancelar");
    const form = el("form", { class: "rename" }, input, client, el("div", { class: "rename__row" }, cancel, save));
    form.addEventListener("submit", async e => {
      e.preventDefault();
      save.disabled = true;
      try {
        await editor.col.doc(item._id).update({ titulo: input.value.trim(), cliente: client.value.trim() });
        toast("Guardado");
      } catch (err) { toast("No se pudo guardar. Inténtalo otra vez.", true); save.disabled = false; return; }
      form.remove();
    });
    cancel.addEventListener("click", () => form.remove());
    wrap.append(form);
    input.focus(); input.select();
  }

  function confirmDelete(wrap, item) {
    if (wrap.querySelector(".rename")) return;
    const yes = el("button", { class: "btn btn--small btn--danger", type: "button" }, "Sí, borrar");
    const no = el("button", { class: "btn btn--small btn--ghost", type: "button" }, "Cancelar");
    const box = el("div", { class: "rename rename--confirm" }, el("p", {}, "¿Borrar este trabajo de la web?"), el("div", { class: "rename__row" }, no, yes));
    no.addEventListener("click", () => box.remove());
    yes.addEventListener("click", async () => {
      yes.disabled = true;
      try {
        await editor.col.doc(item._id).delete();
        if (item._asset) editor.assets.delete(item._asset).catch(() => {});
        toast("Borrado");
      } catch (err) { toast("No se pudo borrar. Inténtalo otra vez.", true); box.remove(); }
    });
    wrap.append(box);
  }

  function pendingCard(p) {
    const cfg = SHAPES[p.cat];
    return el("div", { class: "card card--empty card--pending", style: `--ratio:${cfg.ratio}` },
      el("div", { class: "card__media" }, p.preview ? el("img", { src: p.preview, alt: "" }) : null, el("span", { class: "empty-label" }, "Subiendo…")),
      el("div", { class: "card__info" }, el("span", { class: "card__title" }, p.name))
    );
  }

  function emptyCards(cat, n) {
    const cfg = SHAPES[cat];
    return Array.from({ length: n }, (_, i) =>
      el("div", { class: "card card--empty", style: `--ratio:${cfg.ratio}; --d:${i * 60}ms` },
        el("div", { class: "card__media" }, el("span", { class: "empty-label" }, "Próximamente")),
        el("div", { class: "card__info" }, el("span", { class: "card__title" }, `${cfg.badge} · nuevo trabajo`))
      )
    );
  }

  function render(group) {
    const cat = active[group];
    const grid = $(`#grid-${group}`);
    const cfg = SHAPES[cat];
    const list = listFor(cat);
    grid.dataset.shape = cfg.shape;
    grid.replaceChildren(...pending[cat].map(pendingCard));
    if (!list.length && !pending[cat].length) {
      grid.append(...emptyCards(cat, cfg.shape === "portrait" ? 4 : 3));
    } else {
      grid.append(...list.map((item, i) => card(item, cat, i, list)));
    }
    const drop = $(`.drop[data-group="${group}"]`);
    if (drop) drop.querySelector(".drop__cat").textContent = cfg.label;
  }

  function renderAll() {
    ["gfx", "vfx", "animaciones"].forEach(render);
    document.querySelectorAll(".tab").forEach(t => {
      const n = listFor(t.dataset.cat).length;
      let c = t.querySelector(".count");
      if (!n) { c && c.remove(); return; }
      if (!c) { c = el("span", { class: "count" }); t.append(c); }
      c.textContent = String(n);
    });
    renderStats();
  }

  // ---------- Tabs ----------
  function setupTabs(group) {
    const tabs = [...document.querySelectorAll(`.tabs[data-group="${group}"] .tab`)];
    tabs.forEach(t => {
      t.setAttribute("aria-selected", t.classList.contains("is-active"));
      t.addEventListener("click", () => {
        tabs.forEach(x => { x.classList.toggle("is-active", x === t); x.setAttribute("aria-selected", x === t); });
        active[group] = t.dataset.cat;
        render(group);
      });
    });
  }

  // ---------- Visor (lightbox) ----------
  const Viewer = (() => {
    const root = $("#viewer"), media = $("#viewerMedia"), cap = $("#viewerCaption");
    const prev = $("#viewerPrev"), next = $("#viewerNext");
    let list = [], idx = 0, cat = "";

    function show() {
      const item = list[idx];
      media.replaceChildren();
      if (item.imagen) {
        media.append(el("img", { src: item.imagen, alt: item.titulo || "" }));
      } else if (item.youtube) {
        media.append(el("iframe", {
          class: cat === "shorts" ? "frame-tall" : "frame-wide",
          src: ytEmbed(item.youtube), title: item.titulo || "Vídeo",
          allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: ""
        }));
      } else if (item.video) {
        media.append(el("video", { src: item.video, controls: "", autoplay: "", playsinline: "", poster: item.portada }));
      }
      cap.replaceChildren(
        el("b", {}, item.titulo || ""),
        item.cliente ? ` · ${item.cliente}` : "",
        list.length > 1 ? `  —  ${idx + 1} / ${list.length}` : ""
      );
      prev.hidden = next.hidden = list.length < 2;
    }
    function open(l, i, c) {
      list = l; idx = i; cat = c;
      root.hidden = false; document.body.style.overflow = "hidden";
      show(); $("#viewerClose").focus();
    }
    function close() {
      root.hidden = true; media.replaceChildren(); document.body.style.overflow = "";
    }
    const go = d => { idx = (idx + d + list.length) % list.length; show(); };

    $("#viewerClose").addEventListener("click", close);
    prev.addEventListener("click", () => go(-1));
    next.addEventListener("click", () => go(1));
    root.addEventListener("click", e => { if (e.target === root) close(); });
    document.addEventListener("keydown", e => {
      if (root.hidden) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft" && list.length > 1) go(-1);
      if (e.key === "ArrowRight" && list.length > 1) go(1);
    });
    let x0 = null;
    root.addEventListener("touchstart", e => { x0 = e.touches[0].clientX; }, { passive: true });
    root.addEventListener("touchend", e => {
      if (x0 === null || list.length < 2) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      x0 = null;
    });
    return { open };
  })();

  // ---------- Avisos ----------
  let toastTimer;
  function toast(msg, isError) {
    let t = $("#toast");
    if (!t) { t = el("div", { id: "toast", class: "toast", role: "status" }); document.body.append(t); }
    t.textContent = msg;
    t.classList.toggle("toast--error", !!isError);
    t.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("is-on"), isError ? 5000 : 2200);
  }

  // ---------- Subir arrastrando (solo para quien puede editar) ----------
  function titleFromName(name) {
    return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  }

  async function uploadFiles(files, cat) {
    const wantsVideo = VIDEO_CATS.has(cat);
    for (const file of files) {
      const isImg = file.type.startsWith("image/");
      const isVid = file.type.startsWith("video/");
      if (!isImg && !isVid) { toast(`"${file.name}" no es una imagen ni un vídeo.`, true); continue; }
      if (!wantsVideo && !isImg) { toast(`En ${SHAPES[cat].label} solo van imágenes. Suelta los vídeos en VFX o Animaciones.`, true); continue; }
      if (file.size > MAX_BYTES) { toast(`"${file.name}" pesa más de 20 MB. Comprímelo o súbelo a YouTube.`, true); continue; }

      const p = { cat, name: file.name, preview: isImg ? URL.createObjectURL(file) : null };
      pending[cat].push(p); renderAll();
      try {
        const res = await editor.assets.upload(file);
        await editor.col.add({
          cat, kind: isImg ? "image" : "video", asset: res.id,
          titulo: titleFromName(file.name), cliente: "", createdAt: Date.now(),
        });
        toast(`Subido a ${SHAPES[cat].label}`);
      } catch (err) {
        const code = err && err.code;
        toast(code === "quota_exceeded" ? "Se ha llenado el espacio de la web. Borra algún trabajo antiguo."
          : code === "unsupported_type" ? `Ese formato no se admite: ${file.name}`
          : `No se pudo subir "${file.name}". Inténtalo otra vez.`, true);
      } finally {
        pending[cat] = pending[cat].filter(x => x !== p);
        if (p.preview) URL.revokeObjectURL(p.preview);
        renderAll();
      }
    }
  }

  function setupDropzones() {
    document.body.classList.add("is-editor");
    const zones = [["gfx", "#grid-gfx", "image/*"], ["vfx", "#grid-vfx", "video/*"], ["animaciones", "#grid-animaciones", "video/*,image/gif"]];
    zones.forEach(([group, gridSel, accept]) => {
      const input = el("input", { type: "file", id: "file-" + group, multiple: "", accept, hidden: "" });
      const zone = el("label", { class: "drop", "data-group": group, for: "file-" + group },
        el("span", { class: "drop__icon", "aria-hidden": "true" }, "+"),
        el("span", { class: "drop__text" },
          el("b", {}, "Suelta aquí tus archivos de ", el("span", { class: "drop__cat" }, SHAPES[active[group]].label)),
          el("small", {}, group === "gfx" ? "Imágenes JPG, PNG, WEBP o GIF · máx. 20 MB · o pulsa para elegirlas" : "Vídeos MP4 o WEBM · máx. 20 MB · o pulsa para elegirlos")
        ),
        input
      );
      input.addEventListener("change", () => { uploadFiles([...input.files], active[group]); input.value = ""; });
      // Toda la sección acepta archivos, no solo la caja
      const section = $(gridSel).closest(".section");
      let depth = 0;
      section.addEventListener("dragenter", e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; zone.classList.add("is-over"); });
      section.addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
      section.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove("is-over"); });
      section.addEventListener("drop", e => {
        if (!hasFiles(e)) return;
        e.preventDefault(); depth = 0; zone.classList.remove("is-over");
        uploadFiles([...e.dataTransfer.files], active[group]);
      });
      $(gridSel).before(zone);
    });
    // Evita que el navegador abra el archivo si se suelta fuera de una sección
    addEventListener("dragover", e => { if (hasFiles(e)) e.preventDefault(); });
    addEventListener("drop", e => { if (hasFiles(e)) { e.preventDefault(); toast("Suéltalo dentro de GFX, VFX o Animaciones."); } });
    $("#editorBar").hidden = false;
  }
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes("Files");

  async function setupEditor() {
    if (!window.claude || typeof window.claude.use !== "function") return;
    const db = await window.claude.use("db");
    if (!db) return;
    const col = db.collection("trabajos");
    col.orderBy("createdAt", "desc").onSnapshot(snap => {
      Object.keys(uploaded).forEach(k => { uploaded[k] = []; });
      snap.docs.forEach(d => {
        const v = d.data();
        if (!v || !uploaded[v.cat] || typeof v.asset !== "string") return;
        const src = "/_blob/" + v.asset;
        uploaded[v.cat].push({
          _id: d.id, _asset: v.asset, titulo: String(v.titulo || ""), cliente: String(v.cliente || ""),
          ...(v.kind === "video" ? { video: src } : { imagen: src }),
        });
      });
      renderAll();
    }, () => {});
    const assets = await window.claude.use("assets");
    if (!assets) return; // visitantes: solo ven el portfolio
    editor = { db, assets, col };
    setupDropzones();
    renderAll();
  }

  // ---------- Contacto ----------
  function setupContact() {
    const p = data.perfil || {};
    const box = $("#contactLinks");
    const links = [
      ["email", p.email && `mailto:${p.email}`, "Email"],
      ["instagram", p.instagram, "Instagram"],
      ["twitter", p.twitter, "X / Twitter"],
      ["youtube", p.youtube, "YouTube"],
      ["tiktok", p.tiktok, "TikTok"],
      ["discord", p.discord, "Discord"],
    ].filter(([, href]) => href);
    if (!links.length) {
      box.append(el("span", { class: "btn btn--ghost", style: "cursor:default" }, "Redes próximamente"));
      return;
    }
    links.forEach(([k, href, label], i) => box.append(
      el("a", { class: i === 0 ? "btn" : "btn btn--ghost", href, target: k === "email" ? null : "_blank", rel: "noopener" }, label)
    ));
  }

  // ---------- Stats del hero ----------
  function renderStats() {
    const n = cats => cats.reduce((a, c) => a + listFor(c).length, 0);
    let stats = [
      [n(["deportes", "gaming", "miniaturas"]), "GFX"],
      [n(["largos", "shorts"]), "Edits VFX"],
      [n(["animaciones"]), "Animaciones"],
    ];
    if (stats.every(([x]) => x === 0)) {
      stats = [["GFX", "Deportes · Gaming"], ["VFX", "Largos · Shorts"], ["Motion", "Animaciones"]];
    }
    $("#heroStats").replaceChildren(...stats.map(([v, l]) => el("li", {}, el("b", {}, String(v)), el("small", {}, l))));
  }

  // ---------- Nav ----------
  function setupNav() {
    const nav = $("#nav"), toggle = $("#navToggle"), links = $("#navLinks");
    const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 30);
    addEventListener("scroll", onScroll, { passive: true }); onScroll();
    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open);
    });
    links.addEventListener("click", e => {
      if (e.target.closest("a")) { links.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false"); }
    });
    const anchors = [...links.querySelectorAll('a[href^="#"]:not(.btn)')];
    const io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (en.isIntersecting) anchors.forEach(a => a.classList.toggle("is-current", a.getAttribute("href") === "#" + en.target.id));
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    ["gfx", "vfx", "animaciones", "contacto", "inicio"].forEach(id => { const s = document.getElementById(id); s && io.observe(s); });
  }

  setupNav();
  setupTabs("gfx");
  setupTabs("vfx");
  renderAll();
  setupContact();
  $("#year").textContent = new Date().getFullYear();
  setupEditor();
})();
