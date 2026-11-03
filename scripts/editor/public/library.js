// Sidebar thư viện: Preset / SFX / Nhạc / Cảnh + tab Dàn ý. Dữ liệu từ /api/library, /api/outline, /api/run.
import { mountOverlay } from "./overlay-runtime.js";

const $ = (id) => document.getElementById(id);
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}` : `${(+s).toFixed(1).replace(".", ",")} s`);
const KINDS = [["subtitle", "Phụ đề"], ["lowerThird", "Lower third"], ["callout", "Callout"], ["text", "Chữ"]];
const SAMPLE = { subtitle: "Hãy nhớ quy tắc", lowerThird: "Họ và tên", callout: "Điểm nhấn", text: "Tiêu đề" };

export function initLibrary(host) {
  const st = { lib: null, kind: "subtitle", variant: {}, track: true, sfxCat: "", sfxQ: "", moodSel: "", ranked: null, thumbs: [] };

  // ---------- tabs ----------
  for (const b of document.querySelectorAll("#sideTabs [role=tab]")) b.onclick = () => {
    document.querySelectorAll("#sideTabs [role=tab]").forEach((x) => x.setAttribute("aria-selected", x === b));
    document.querySelectorAll(".t-panel--side > .t-pane").forEach((p) => p.classList.toggle("is-active", p.id === "pane-" + b.dataset.pane));
  };
  for (const b of document.querySelectorAll("#libTabs [role=tab]")) b.onclick = () => {
    document.querySelectorAll("#libTabs [role=tab]").forEach((x) => x.setAttribute("aria-selected", x === b));
    document.querySelectorAll("[data-sub-pane]").forEach((p) => { p.hidden = p.dataset.subPane !== b.dataset.sub; });
    if (b.dataset.sub !== "sfx" && b.dataset.sub !== "music") host.engine.stopPreview();
  };

  // ---------- kéo thả bằng con trỏ ----------
  function startDrag(e, label, onDrop) {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    let ghost = null, active = false;
    const move = (ev) => {
      if (!active && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) { active = true; ghost = h("div", "dragghost", esc(label)); document.body.appendChild(ghost); }
      if (ghost) { ghost.style.left = ev.clientX + "px"; ghost.style.top = ev.clientY + "px"; }
    };
    const up = (ev) => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      if (ghost) ghost.remove();
      if (active) { const el = document.elementFromPoint(ev.clientX, ev.clientY); onDrop(el, ev.clientX, ev.clientY); suppressClick(); }
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }
  let suppress = false;
  const suppressClick = () => { suppress = true; setTimeout(() => (suppress = false), 0); };
  const dropTime = (el, x) => (el && el.closest(".t-track__lane") ? host.timeAtClientX(x) : host.playheadT());

  // ---------- API ----------
  async function api(path, body) {
    const r = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "HTTP " + r.status);
    return j;
  }

  // ---------- Preset ----------
  function variantOf(p) { return p.variants.find((v) => v.id === st.variant[p.id]) || p.variants[0]; }

  function buildThumb(box, kind, v) {
    // Chuẩn hoá: chữ mẫu luôn cao như nhau; padding/bo góc/viền co theo cùng tỉ lệ.
    const base = v.style.fontSize || 60, f = 84 / base;
    const sty = { ...v.style, fontSize: 84, padding: Math.round((v.style.padding || 0) * f), radius: Math.round((v.style.radius || 0) * f), strokeWidth: Math.round((v.style.strokeWidth || 0) * f) };
    const words = SAMPLE[kind].split(" ").map((w, i) => ({ text: w, start: 1 + i * 0.3, end: 1.3 + i * 0.3 }));
    const layer = { id: "pv", type: kind, start: 0, duration: 99, x: 6, y: kind === "lowerThird" ? 30 : 32, w: 88, h: 40, rotation: 0, opacity: 1,
      text: SAMPLE[kind], subtext: kind === "lowerThird" ? "Chức danh" : undefined, style: sty,
      animation: { ...v.animation, in: { kind: "none", dur: 0 }, out: { kind: "none", dur: 0 } } };
    if (kind === "subtitle") { layer.words = words; layer.animation.subtitleMode = "word"; }
    const proj = { version: 1, job: "pv", fps: 30, width: 640, height: 400, aspect: "16:10", duration: 99, source: { video: "" }, tracks: [{ id: "t", kind: "graphics", name: "", hidden: false, locked: false, layers: [layer] }] };
    const root = h("div", "pv"); box.appendChild(root);
    root.style.width = box.clientWidth + "px"; root.style.height = box.clientHeight + "px";
    root.style.position = "absolute"; root.style.left = "0"; root.style.top = "0";
    try { const ov = mountOverlay(root, proj, { assetBase: "/", canvasW: 640, canvasH: 400 }); ov.seek(1.0); ov.ready().then(() => ov.seek(1.0)); st.thumbs.push(ov); } catch (_) { /* thumbnail không bắt buộc */ }
  }

  function renderPresets() {
    const root = $("libPreset");
    root.textContent = "";
    for (const o of st.thumbs) { try { o.destroy(); } catch (_) {} }
    st.thumbs = [];
    if (!st.lib) { root.appendChild(h("div", "lib-empty", "Đang tải thư viện…")); return; }
    const seg = h("div", "t-seg t-seg--block lib-seg");
    for (const [k, name] of KINDS) {
      const b = h("button", "", esc(name)); b.setAttribute("aria-pressed", String(st.kind === k));
      b.onclick = () => { st.kind = k; st.track = k === "subtitle"; renderPresets(); };
      seg.appendChild(b);
    }
    root.appendChild(seg);
    const grid = h("div", "t-presets");
    const list = (st.lib.presets && st.lib.presets[st.kind]) || [];
    if (!list.length) grid.appendChild(h("div", "lib-empty", "Chưa có preset loại này."));
    const afterMount = [];
    for (const p of list) {
      const v = variantOf(p);
      const card = h("button", "t-preset");
      const sel = host.selectedLayers().some(({ l }) => l.meta && l.meta.presetId === p.id);
      card.setAttribute("aria-selected", String(sel));
      const thumb = h("span", "t-preset__thumb"); card.appendChild(thumb);
      card.appendChild(h("span", "t-preset__name", esc(p.name)));
      const dots = h("span", "t-dots");
      for (const vv of p.variants) {
        const i = h("i", vv.id === v.id ? "is-active" : ""); i.style.setProperty("--c", dotColor(vv)); i.title = vv.name;
        i.onclick = (ev) => { ev.stopPropagation(); st.variant[p.id] = vv.id; const nowSel = host.selectedLayers().some(({ l }) => l.meta && l.meta.presetId === p.id); if (nowSel) applyTo(p, vv); renderPresets(); };
        dots.appendChild(i);
      }
      dots.appendChild(h("small", "", `${p.variants.length} kiểu`));
      card.appendChild(dots);
      card.onclick = () => { if (suppress) return; applyTo(p, v); };
      card.addEventListener("pointerdown", (e) => startDrag(e, p.name, (el, x) => dropNew(p, v, el, x)));
      card.dataset.pid = p.id;
      grid.appendChild(card);
      afterMount.push([thumb, v]);
    }
    root.appendChild(grid);
    const tg = h("label", "t-prop", `<label style="grid-column:1/-1;display:flex;gap:8px;align-items:center"><span class="t-switch"><input type="checkbox" role="switch" ${st.track ? "checked" : ""} aria-label="Áp cho cả track"><i></i></span><span style="font-size:var(--fs-12);color:var(--label-2)">Áp cho cả track</span></label>`);
    tg.querySelector("input").onchange = (e) => { st.track = e.target.checked; };
    root.appendChild(tg);
    root.appendChild(h("div", "t-notice t-notice--info", `<svg class="t-ico t-ico--sm"><use href="#i-sparkle"/></svg><span>Bấm thẻ để áp cho layer đang chọn, kéo thẻ vào khung hình hoặc timeline để tạo layer mới. Đổi chấm màu = đổi biến thể, giữ chữ/thời gian/vị trí.</span>`));
    requestAnimationFrame(() => afterMount.forEach(([box, v]) => buildThumb(box, st.kind, v)));
  }
  function dotColor(v) {
    const bg = v.style.background || "";
    const m = /rgba?\(([^)]+)\)/.exec(bg);
    const opaque = bg && bg !== "transparent" && !(m && m[1].split(",").length === 4 && parseFloat(m[1].split(",")[3]) < 0.4);
    return opaque ? bg : v.style.accentColor || v.style.color || "#C5A059";
  }

  async function applyTo(p, v) {
    try {
      let targets = host.selectedLayers().filter(({ l }) => l.type !== "audio" && l.type !== "scene" && l.type !== "image" && l.type !== "shape");
      if (targets.length && st.track) {
        const trs = new Set(targets.map((x) => x.tr));
        targets = [...trs].flatMap((tr) => tr.layers.filter((l) => l.type === st.kind).map((l) => ({ tr, l })));
      } else targets = targets.filter(({ l }) => l.type === st.kind || (st.kind === "text" && l.type === "text"));
      if (!targets.length) { host.toast(`Chọn một layer ${KINDS.find((k) => k[0] === st.kind)[1].toLowerCase()} để áp preset (hoặc kéo thẻ vào khung)`); return; }
      const r = await api("/api/preset/apply", { layers: targets.map((x) => x.l), presetId: p.id, variantId: v.id, aspect: host.aspect() });
      host.replaceLayers(r.layers);
      host.toast(`Đã áp "${p.name} · ${v.name}" cho ${r.layers.length} layer`);
    } catch (e) { host.toast("Lỗi áp preset: " + e.message); }
  }

  async function dropNew(p, v, el, x) {
    if (!el || !(el.closest("#stage") || el.closest("#timeline"))) return;
    try {
      const t = dropTime(el, x), kind = st.kind;
      const base = { id: host.nextId("L"), type: kind, start: Math.round(t * 100) / 100, duration: 3, text: SAMPLE[kind], ...(kind === "lowerThird" ? { subtext: "Chức danh" } : {}), meta: { source: "user" } };
      const r = await api("/api/preset/apply", { layers: [base], presetId: p.id, variantId: v.id, aspect: host.aspect(), asNew: true });
      host.addLayers(r.layers);
      host.toast(`Đã tạo layer "${p.name}" tại ${t.toFixed(1)} s`);
    } catch (e) { host.toast("Lỗi tạo layer: " + e.message); }
  }

  // ---------- SFX ----------
  function renderSfx() {
    const root = $("libSfx");
    root.textContent = "";
    if (!st.lib) return;
    const items = st.lib.sfx || [];
    const cats = [...new Set(items.map((i) => i.category))].sort();
    const q = h("label", "t-search", `<svg class="t-ico t-ico--sm"><use href="#i-search"/></svg><input class="t-field" placeholder="Tìm âm thanh" aria-label="Tìm âm thanh" value="${esc(st.sfxQ)}">`);
    q.querySelector("input").oninput = (e) => { st.sfxQ = e.target.value; fillSfx(); };
    root.appendChild(q);
    const chips = h("div", "mood-chips");
    for (const c of ["", ...cats]) {
      const b = h("button", "", esc(c || "Tất cả")); b.setAttribute("aria-pressed", String(st.sfxCat === c));
      b.onclick = () => { st.sfxCat = c; renderSfx(); };
      chips.appendChild(b);
    }
    root.appendChild(chips);
    const list = h("div", "t-list"); list.id = "sfxList"; root.appendChild(list);
    fillSfx();
  }
  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => { for (const en of es) if (en.isIntersecting) { io.unobserve(en.target); drawRowWave(en.target); } }, { rootMargin: "80px" }) : null;
  async function drawRowWave(row) {
    const url = row.dataset.url, wv = row.querySelector(".t-sfx__wave");
    const buf = await host.engine.load(url);
    if (!buf) return;
    const n = 36, ch = buf.getChannelData(0), step = Math.max(1, Math.floor(ch.length / n)), top = [], bot = [];
    for (let i = 0; i < n; i++) { let mx = 0; for (let k = i * step; k < Math.min(ch.length, (i + 1) * step); k += Math.max(1, step >> 5)) mx = Math.max(mx, Math.abs(ch[k])); const a = Math.max(0.6, mx * 10); top.push(`${(i * 60 / n).toFixed(1)},${(11 - a).toFixed(1)}`); bot.unshift(`${(i * 60 / n).toFixed(1)},${(11 + a).toFixed(1)}`); }
    wv.innerHTML = `<svg class="t-wave" viewBox="0 0 60 22" preserveAspectRatio="none"><polygon points="${top.join(" ")} ${bot.join(" ")}"/></svg>`;
  }
  function fillSfx() {
    const list = $("sfxList");
    if (!list) return;
    list.textContent = "";
    const q = st.sfxQ.trim().toLowerCase();
    const items = (st.lib.sfx || []).filter((i) => (!st.sfxCat || i.category === st.sfxCat) && (!q || `${i.id} ${i.category} ${(i.tags || []).join(" ")}`.toLowerCase().includes(q)));
    let cur = "";
    for (const it of items) {
      if (it.category !== cur) { cur = it.category; list.appendChild(h("div", "t-list__head", `<span class="t-caption">${esc(cur)}</span>`)); }
      const playing = host.engine.previewing() === it.url;
      const row = h("div", "t-sfx" + (playing ? " is-playing" : ""));
      row.dataset.url = it.url;
      row.innerHTML = `<button class="t-sfx__play" aria-label="Nghe thử"><svg class="t-ico t-ico--sm"><use href="#i-${playing ? "pause" : "play"}"/></svg></button><div class="t-sfx__name">${esc(it.id)}<small>${esc((it.tags || []).slice(0, 3).join(" · ") || it.category)}</small></div><div class="t-sfx__wave"></div><div class="t-sfx__dur">${fmtDur(it.duration)}</div>`;
      row.querySelector(".t-sfx__play").onclick = (e) => { e.stopPropagation(); togglePreview(it.url); };
      row.addEventListener("pointerdown", (e) => { if (e.target.closest(".t-sfx__play")) return; startDrag(e, it.id, (el, x) => dropAudio("sfx", it, el, x)); });
      row.ondblclick = () => host.addAudio("sfx", it, host.playheadT());
      list.appendChild(row);
      if (io) io.observe(row);
    }
    if (!items.length) list.appendChild(h("div", "lib-empty", "Không có âm thanh khớp."));
  }
  function togglePreview(url) {
    if (host.engine.previewing() === url) host.engine.stopPreview(); else host.engine.preview(url, () => { fillSfx(); fillMusic(); });
    fillSfx(); fillMusic();
  }
  function dropAudio(kind, it, el, x) {
    if (!el || !(el.closest("#timeline") || el.closest("#stage"))) return;
    const t = kind === "music" ? 0 : dropTime(el, x);
    host.addAudio(kind, it, t);
  }

  // ---------- Nhạc ----------
  function renderMusic() {
    const root = $("libMusic");
    root.textContent = "";
    if (!st.lib) return;
    const items = st.lib.music || [];
    const moods = [...new Set(items.map((i) => i.mood).filter(Boolean))].sort();
    const bar = h("div", "", "");
    bar.style.cssText = "display:flex;gap:6px;align-items:center";
    const sug = h("button", "t-btn t-btn--primary t-btn--sm", `<svg class="t-ico t-ico--sm"><use href="#i-sparkle"/></svg>Gợi ý`);
    sug.title = "Xếp hạng bài nhạc phù hợp với video này"; sug.onclick = suggest;
    bar.appendChild(sug);
    if (st.ranked) { const c = h("button", "t-btn t-btn--sm", "Bỏ gợi ý"); c.onclick = () => { st.ranked = null; renderMusic(); }; bar.appendChild(c); }
    root.appendChild(bar);
    const chips = h("div", "mood-chips");
    for (const m of ["", ...moods]) {
      const b = h("button", "", esc(m || "Tất cả")); b.setAttribute("aria-pressed", String(st.moodSel === m));
      b.onclick = () => { st.moodSel = m; renderMusic(); };
      chips.appendChild(b);
    }
    root.appendChild(chips);
    const list = h("div", "t-list"); list.id = "musicList"; root.appendChild(list);
    fillMusic();
  }
  function fillMusic() {
    const list = $("musicList");
    if (!list) return;
    list.textContent = "";
    let items = (st.lib.music || []).filter((i) => !st.moodSel || i.mood === st.moodSel);
    const rank = new Map();
    if (st.ranked) { st.ranked.forEach((r, i) => rank.set(r.id || (r.track && r.track.id), { i, r })); items = [...items].sort((a, b) => (rank.has(a.id) ? rank.get(a.id).i : 1e9) - (rank.has(b.id) ? rank.get(b.id).i : 1e9)); }
    for (const it of items) {
      const playing = host.engine.previewing() === it.url;
      const row = h("div", "music-row");
      const warn = [];
      if (it.hasVocals) warn.push('<span class="t-sfx__tag" title="Có giọng hát: dễ chồng lên lời nói">Có lời</span>');
      if (it.peaks && it.peaks.length) warn.push('<span class="t-sfx__tag" title="Có đoạn vượt đỉnh âm lượng">Vượt đỉnh</span>');
      const rk = rank.get(it.id);
      row.innerHTML = `<button class="t-sfx__play${playing ? "" : ""}" aria-label="Nghe thử" style="${playing ? "background:var(--accent-fill);color:var(--accent-on)" : ""}"><svg class="t-ico t-ico--sm"><use href="#i-${playing ? "pause" : "play"}"/></svg></button>
        <div class="t-sfx__name">${rk ? `<span class="rk">#${rk.i + 1}</span> ` : ""}${esc(it.title || it.id)}${warn.join("")}<small>${esc(it.mood || "")} · ${fmtDur(it.duration)}${it.energy ? " · " + esc(it.energy) : ""}${rk && rk.r.reason ? " · " + esc(rk.r.reason) : ""}</small></div>
        <button class="t-btn t-btn--sm">Thêm</button>`;
      row.querySelector(".t-sfx__play").onclick = (e) => { e.stopPropagation(); togglePreview(it.url); };
      row.querySelector(".t-btn").onclick = (e) => { e.stopPropagation(); host.addAudio("music", it, 0); };
      row.addEventListener("pointerdown", (e) => { if (e.target.closest("button")) return; startDrag(e, it.title || it.id, (el, x) => dropAudio("music", it, el, x)); });
      list.appendChild(row);
    }
    if (!items.length) list.appendChild(h("div", "lib-empty", "Không có bài nhạc khớp."));
  }
  async function suggest() {
    try {
      host.toast("Đang xếp hạng nhạc…");
      const r = await api("/api/music/suggest", { project: host.project(), mood: st.moodSel || undefined });
      st.ranked = r.ranked || [];
      renderMusic();
      host.toast(`Đã xếp hạng ${st.ranked.length} bài`);
    } catch (e) { host.toast("Lỗi gợi ý nhạc: " + e.message); }
  }

  // ---------- Cảnh ----------
  function renderScenes() {
    const root = $("libScene");
    root.textContent = "";
    if (!st.lib) return;
    const ar = host.aspect();
    const items = st.lib.templates || [];
    if (ar === "16:9") root.appendChild(h("div", "t-notice t-notice--info", `<svg class="t-ico t-ico--sm"><use href="#i-film"/></svg><span>Cảnh 4:5 sẽ hiện thành thẻ bên phải người nói trong khung 16:9; phụ đề tự co về bên trái.</span>`));
    const grid = h("div", "t-presets");
    for (const tp of items) {
      const c = h("button", "t-preset");
      c.innerHTML = `<span class="t-preset__thumb scene-thumb"><span class="t-mini" style="font-size:11px;color:#C5A059;padding:4px;text-align:center">${esc(tp.id.replace(/^frame-/, ""))}</span></span><span class="t-preset__name">${esc(tp.id.replace(/^frame-/, "").replace(/-/g, " "))}</span>`;
      c.onclick = () => { if (!suppress) host.addScene(tp.id, host.playheadT()); };
      c.addEventListener("pointerdown", (e) => startDrag(e, tp.id, (el, x) => { if (el && (el.closest("#stage") || el.closest("#timeline"))) host.addScene(tp.id, dropTime(el, x)); }));
      grid.appendChild(c);
    }
    root.appendChild(grid);
    if (!items.length) root.appendChild(h("div", "lib-empty", "Chưa có cảnh."));
  }

  // ---------- Asset (SVG động; ưu tiên thấp, ẩn nếu chưa có manifest) ----------
  async function renderAssets() {
    const root = $("libAsset");
    root.textContent = "";
    let items = [];
    try {
      const r = await fetch("/assets/th-assets/manifest.json");
      if (r.ok) { const j = await r.json(); items = Array.isArray(j) ? j : j.assets || []; }
    } catch (_) { /* không có manifest */ }
    if (!items.length) { root.appendChild(h("div", "outline-empty", `<svg class="t-ico"><use href="#i-sparkle"/></svg><strong style="color:var(--label)">Chưa có thư viện asset</strong><span>Minh hoạ vẽ riêng từng bài bằng scene-kit. Layer asset (SVG) vẫn dùng được: đặt file SVG vào assets/th-assets/ kèm manifest.json.</span>`)); return; }
    const q = h("label", "t-search", `<svg class="t-ico t-ico--sm"><use href="#i-search"/></svg><input class="t-field" placeholder="Tìm asset (tiếng Việt)" aria-label="Tìm asset">`);
    root.appendChild(q);
    const grid = h("div", "t-presets"); grid.style.marginTop = "var(--s-2)"; root.appendChild(grid);
    const draw = () => {
      grid.textContent = "";
      const term = q.querySelector("input").value.trim().toLowerCase();
      for (const a of items) {
        const file = a.file || a.src || a.path || "", name = a.name || a.id || file.split("/").pop();
        if (term && !(`${name} ${(a.tags || []).join(" ")}`.toLowerCase().includes(term))) continue;
        const src = file.startsWith("assets/") ? file : "assets/th-assets/" + file;
        const c = h("button", "t-preset", `<span class="t-preset__thumb scene-thumb"><img src="/${esc(src)}" alt="" style="max-width:80%;max-height:80%;pointer-events:none"></span><span class="t-preset__name">${esc(name)}</span>`);
        c.onclick = () => { if (!suppress) host.addAsset(src, host.playheadT()); };
        c.addEventListener("pointerdown", (e) => startDrag(e, name, (el, x) => { if (el && (el.closest("#stage") || el.closest("#timeline"))) host.addAsset(src, dropTime(el, x)); }));
        grid.appendChild(c);
      }
    };
    q.querySelector("input").oninput = draw; draw();
  }

  // ---------- Dàn ý ----------
  let outlineItems = [];
  async function loadOutline() {
    const root = $("outlineTree");
    root.textContent = "";
    try {
      const run = await api("/api/run").catch(() => null);
      if (run && run.stale && run.stale.length) root.appendChild(h("div", "t-notice", `<svg class="t-ico t-ico--sm"><use href="#i-warn"/></svg><span>Cần chạy lại: ${esc(run.stale.join(", "))}</span>`));
      const o = await api("/api/outline");
      if (!o || !Array.isArray(o.items)) throw new Error("no outline");
      const flat = [];
      const walk = (items, lvl) => { for (const it of items || []) { flat.push({ ...it, lvl: it.level || lvl }); if (it.children) walk(it.children, lvl + 1); } };
      walk(o.items || [], 1);
      outlineItems = flat;
      if (o.summary) root.appendChild(h("div", "t-notice t-notice--info", `<svg class="t-ico t-ico--sm"><use href="#i-list"/></svg><span>${esc(o.summary)}</span>`));
      const tree = h("div", "t-outline");
      for (const it of flat) {
        const r = h("div", "t-outline__item" + (it.lvl > 1 ? " t-outline__item--sub" : ""), `<span class="t-outline__id">${esc(it.id)}</span><span>${esc(it.title)}</span><span class="t-outline__time">${fmtDur(it.start)}</span>`);
        r.dataset.start = it.start; r.dataset.end = it.end;
        r.onclick = () => host.seek(it.start);
        tree.appendChild(r);
      }
      root.appendChild(tree);
      if (!flat.length) root.appendChild(h("div", "lib-empty", "outline.json chưa có mục nào."));
    } catch (e) {
      root.appendChild(h("div", "outline-empty", `<svg class="t-ico"><use href="#i-list"/></svg><strong style="color:var(--label)">Chưa có dàn ý</strong><span>Job này chưa có outline.json. Dàn ý (bước 02c) do AI viết sau khi phiên âm và hiệu đính; có file là hiện ở đây để bấm nhảy tới từng mục.</span><code>output/${esc(host.project().job)}/outline.json</code>`));
    }
  }
  function onTime(t) {
    for (const r of document.querySelectorAll("#outlineTree .t-outline__item")) r.classList.toggle("is-active", t >= +r.dataset.start && t < +r.dataset.end);
  }

  // ---------- khởi động ----------
  renderPresets();
  (async () => {
    try {
      st.lib = await api("/api/library");
      renderPresets(); renderSfx(); renderMusic(); renderScenes();
      host.onLibrary(st.lib);
    } catch (e) {
      for (const id of ["libPreset", "libSfx", "libMusic", "libScene"]) { const r = $(id); r.textContent = ""; r.appendChild(h("div", "lib-empty", "Thư viện chưa sẵn sàng: " + esc(e.message))); }
    }
  })();
  loadOutline();
  renderAssets();
  return { refreshSelection: () => { for (const c of document.querySelectorAll("#libPreset .t-preset[data-pid]")) c.setAttribute("aria-selected", String(host.selectedLayers().some(({ l }) => l.meta && l.meta.presetId === c.dataset.pid))); }, onTime, get lib() { return st.lib; } };
}
