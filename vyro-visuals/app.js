(() => {
  "use strict";
  const data = (typeof VYRO !== "undefined" && VYRO) || { perfil: {}, gfx: {}, vfx: {}, animaciones: [] };

  // Forma de las tarjetas por categoría
  const SHAPES = {
    deportes:   { shape: "portrait", ratio: "4 / 5",  badge: "Deportes" },
    gaming:     { shape: "square",   ratio: "1 / 1",  badge: "Gaming" },
    miniaturas: { shape: "wide",     ratio: "16 / 9", badge: "Miniatura" },
    largos:     { shape: "wide",     ratio: "16 / 9", badge: "Vídeo" },
    shorts:     { shape: "portrait", ratio: "9 / 16", badge: "Short" },
    animaciones:{ shape: "wide",     ratio: "16 / 9", badge: "Animación" },
  };
  const VIDEO_CATS = new Set(["largos", "shorts", "animaciones"]);

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
    const isVideo = VIDEO_CATS.has(cat);
    if (!isVideo) return el("img", { src: item.imagen, alt: item.titulo || "", loading: "lazy" });
    if (item.portada) return el("img", { src: item.portada, alt: item.titulo || "", loading: "lazy" });
    if (item.youtube) return el("img", { src: ytThumb(item.youtube), alt: item.titulo || "", loading: "lazy" });
    if (item.video) {
      // Vista previa silenciosa que se reproduce al pasar el ratón
      const v = el("video", { src: item.video + "#t=0.1", muted: "", playsinline: "", preload: "metadata", loop: "" });
      v.muted = true;
      return v;
    }
    return el("div");
  }

  function card(item, cat, index, list) {
    const cfg = SHAPES[cat];
    const isVideo = VIDEO_CATS.has(cat);
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
    return btn;
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

  function render(grid, list, cat) {
    const cfg = SHAPES[cat];
    grid.dataset.shape = cfg.shape;
    grid.replaceChildren();
    if (!list || !list.length) {
      const n = cfg.shape === "portrait" ? 4 : 3;
      grid.append(...emptyCards(cat, n));
      return;
    }
    grid.append(...list.map((item, i) => card(item, cat, i, list)));
  }

  // ---------- Tabs ----------
  function setupTabs(group, source) {
    const tablist = $(`.tabs[data-group="${group}"]`);
    const grid = $(`#grid-${group}`);
    const tabs = [...tablist.querySelectorAll(".tab")];
    tabs.forEach(t => {
      const n = (source[t.dataset.cat] || []).length;
      if (n) t.append(el("span", { class: "count" }, String(n)));
      t.setAttribute("aria-selected", t.classList.contains("is-active"));
      t.addEventListener("click", () => {
        tabs.forEach(x => { x.classList.toggle("is-active", x === t); x.setAttribute("aria-selected", x === t); });
        render(grid, source[t.dataset.cat], t.dataset.cat);
      });
    });
    const active = tabs.find(t => t.classList.contains("is-active"));
    render(grid, source[active.dataset.cat], active.dataset.cat);
  }

  // ---------- Visor (lightbox) ----------
  const Viewer = (() => {
    const root = $("#viewer"), media = $("#viewerMedia"), cap = $("#viewerCaption");
    const prev = $("#viewerPrev"), next = $("#viewerNext");
    let list = [], idx = 0, cat = "";

    function show() {
      const item = list[idx];
      media.replaceChildren();
      if (!VIDEO_CATS.has(cat)) {
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
  function setupStats() {
    const g = data.gfx || {}, v = data.vfx || {};
    const count = o => Object.values(o).reduce((a, l) => a + (l?.length || 0), 0);
    const stats = [
      [count(g), "GFX"],
      [count(v), "Edits VFX"],
      [(data.animaciones || []).length, "Animaciones"],
    ];
    if (stats.every(([n]) => n === 0)) {
      stats.splice(0, 3, ["GFX", "Deportes · Gaming"], ["VFX", "Largos · Shorts"], ["Motion", "Animaciones"]);
    }
    $("#heroStats").append(...stats.map(([n, l]) => el("li", {}, el("b", {}, String(n)), el("small", {}, l))));
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
  setupStats();
  setupTabs("gfx", data.gfx || {});
  setupTabs("vfx", data.vfx || {});
  render($("#grid-animaciones"), data.animaciones, "animaciones");
  setupContact();
  $("#year").textContent = new Date().getFullYear();
})();
