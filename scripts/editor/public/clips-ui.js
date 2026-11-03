// Giao diện "Video gốc chỉnh được": track Video gốc (cắt S / trim / xoá / đổi thứ tự), phát theo clips, tab Nguồn (I/O, chèn), nút Dựng lại video.
// Toàn bộ thao tác sửa project.videoClips; layer ĐỨNG YÊN theo giây (không ripple layer). Logic thuần ở clips-core.js, phát ở clip-player.js.
import * as C from "./clips-core.js";
import { createClipPlayer } from "./clip-player.js";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (s) => { s = Math.max(0, s); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`; };
const fmtLen = (s) => s.toFixed(1).replace(".", ",") + " s";
const TH = 46; // chiều cao thumbnail trên timeline (px) = --h của .t-track--vclip

/** Trả null nếu project không có videoClips/proxy hoặc server cũ chưa có /api/source (editor chạy chế độ cut.mp4 như cũ). */
export async function initClips(h) {
  const p0 = h.project();
  if (!(p0.videoClips && p0.videoClips.length && p0.source && p0.source.proxy)) return null;
  let info;
  try { const r = await fetch("/api/source"); if (!r.ok) return null; info = await r.json(); } catch (_) { return null; }
  const getJson = (u) => (u ? fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null));
  const [thumbs, srcPeaks] = await Promise.all([getJson(info.thumbsIndex), getJson(info.peaksUrl)]);
  let tdata = null; // transcript.edited.json: tải lười khi mở tab Nguồn

  const $ = (id) => document.getElementById(id);
  const clips = () => h.project().videoClips;
  // chữ ký clip KHÔNG gồm transform: reframe không được làm dựng lại peaks / seek lại player
  const sigOf = (cl) => JSON.stringify(cl.map((c) => { const { transform, ...r } = c; return r; }));
  const fps = () => h.fps();
  let csel = null, lastSig = "", warned = false, cd = null;
  let I = null, O = null; // điểm vào/ra trên video gốc (giây)
  const player = createClipPlayer({ clips, fps, elA: h.vid, elB: h.vid2, engine: h.engine });
  for (const v of [h.vid, h.vid2]) { v.src = info.proxyUrl; v.preload = "auto"; v.muted = false; }
  h.vid2.style.zIndex = 1; h.vid.style.zIndex = 2;

  // ---------- thumbnail từ sprite ----------
  const tileCss = (sec, hh) => {
    if (!thumbs) return "";
    const n = thumbs.count, idx = clamp(Math.floor(sec * (thumbs.fps || 1)), 0, n - 1), per = thumbs.perSheet || 100;
    const sh = thumbs.sheets[Math.floor(idx / per)], pos = idx % per, col = pos % thumbs.cols, row = Math.floor(pos / thumbs.cols), sc = hh / thumbs.tileH;
    return `background-image:url(/job/thumbs/${sh});background-size:${thumbs.cols * thumbs.tileW * sc}px ${thumbs.rows * thumbs.tileH * sc}px;background-position:-${col * thumbs.tileW * sc}px -${row * thumbs.tileH * sc}px;`;
  };
  const tileW = () => (thumbs ? Math.round((TH * thumbs.tileW) / thumbs.tileH) : 82);

  /** Chỉ vẽ thumbnail trong vùng đang nhìn thấy (+ lề) nên zoom lớn vẫn nhẹ. */
  function paintThumbs() {
    const sc = $("tlScroll");
    if (!sc || !thumbs) return;
    const z = h.zoom(), v0 = sc.scrollLeft - h.TRACK_HEAD - 240, v1 = sc.scrollLeft + sc.clientWidth - h.TRACK_HEAD + 240, tw = tileW();
    for (const ce of document.querySelectorAll(".t-clip--vclip")) {
      const k = clipById(ce.dataset.cid);
      if (!k) continue;
      const L0 = parseFloat(ce.style.left), W = parseFloat(ce.style.width), box = ce.querySelector(".vc-thumbs");
      const x0 = Math.max(L0, v0), x1 = Math.min(L0 + W, v1);
      if (x1 <= x0) { if (box.dataset.sig !== "-") { box.textContent = ""; box.dataset.sig = "-"; } continue; }
      const j0 = Math.floor((x0 - L0) / tw), j1 = Math.ceil((x1 - L0) / tw), sig = `${j0}|${j1}|${z}|${k.c.srcIn}|${k.c.kind}|${W | 0}`;
      if (box.dataset.sig === sig) continue;
      box.dataset.sig = sig;
      let html = "";
      for (let j = j0; j < j1; j++) {
        const sec = k.c.kind === "hold" ? k.c.srcIn : k.c.srcIn + Math.min(((j + 0.5) * tw) / z, k.n / fps() - 0.001);
        html += `<i style="left:${j * tw}px;width:${Math.min(tw, W - j * tw).toFixed(1)}px;${tileCss(sec, TH)}"></i>`;
      }
      box.innerHTML = html;
    }
  }
  const clipById = (id) => C.layout(clips(), fps()).find((k) => k.c.id === id);

  // ---------- dữ liệu dẫn xuất ----------
  function changed() {
    const p = h.project();
    p.duration = C.totalSec(p.videoClips, fps());
    player.refresh();
    if (srcPeaks) h.setPeaks(C.mapPeaks(p.videoClips, srcPeaks, fps()));
    lastSig = sigOf(p.videoClips);
    h.updateTotal();
    paintSource();
  }
  /** Gọi sau undo/redo/thay dự án: nếu videoClips đổi thì dựng lại dữ liệu dẫn xuất. */
  function sync() {
    if (sigOf(clips()) === lastSig) return;
    changed();
    if (csel && !clips().some((c) => c.id === csel)) csel = null;
    const tt = Math.min(h.t(), h.project().duration);
    player.seek(tt);
  }
  function warnOnce() {
    if (warned) return;
    warned = true;
    h.toast("Cắt video không dời phụ đề/minh hoạ — kéo lại nếu lệch lời.");
  }
  /** Áp danh sách clip mới (một bước hoàn tác). */
  function edit(next, o = {}) {
    if (!o.keepPlay) h.pausePlay();
    h.pushHist();
    h.project().videoClips = next;
    changed();
    if (o.select !== undefined) csel = o.select;
    h.touch();
    h.renderTimeline();
    const tt = Math.min(h.t(), h.project().duration);
    player.seek(tt);
    h.setTime(tt, true);
    warnOnce();
  }

  // ---------- thao tác ----------
  function cut() {
    const sp = C.splitAt(clips(), h.t(), fps());
    if (!sp) { h.toast("Playhead đang ở biên clip — dời playhead rồi cắt (S)."); return false; }
    edit(sp.clips, { select: sp.clips[sp.index].id, keepPlay: true });
    h.toast("Đã cắt tại playhead (Ctrl+Z để hoàn tác)");
    return true;
  }
  function del() {
    const i = clips().findIndex((c) => c.id === csel);
    if (i < 0) return false;
    if (clips().length <= 1) { h.toast("Không xoá được clip cuối cùng."); return true; }
    const nx = clips()[i + 1] || clips()[i - 1];
    edit(C.removeClip(clips(), i), { select: nx ? nx.id : null });
    h.toast("Đã xoá clip — video phía sau tự dồn lên (Ctrl+Z để hoàn tác)");
    return true;
  }
  const hasSel = () => !!csel && clips().some((c) => c.id === csel);
  function deselect() { if (csel) { csel = null; markSel(); } }
  function markSel() { for (const e of document.querySelectorAll(".t-clip--vclip")) e.classList.toggle("is-selected", e.dataset.cid === csel); }

  // ---------- track "Video gốc" ----------
  function row(dur) {
    const z = h.zoom(), f = fps();
    const rowEl = h.el("div", "t-track t-track--vclip");
    const n = clips().length;
    const head = h.headEl("film", "Video gốc", `${n} clip · ${fmt(dur)}`, [
      h.tbtn(h.ico("scissors", "t-ico"), false, "Cắt tại playhead (S)", cut),
    ]);
    const lane = h.el("div", "t-track__lane"); lane.style.width = dur * z + 80 + "px"; lane.dataset.vclips = "1";
    for (const k of C.layout(clips(), f)) {
      const c = k.c, ce = h.el("div", "t-clip t-clip--vclip" + (c.kind === "hold" ? " is-hold" : "") + (c.id === csel ? " is-selected" : ""));
      ce.dataset.cid = c.id; ce.dataset.kind = "vclip";
      const len = k.n / f;
      ce.innerHTML = `<span class="vc-thumbs" data-sig=""></span><span class="vc-label">${c.kind === "hold" ? "Giữ khung · " : ""}${fmtLen(len)}</span>` +
        `<i class="t-clip__edge t-clip__edge--l" data-edge="L"></i><i class="t-clip__edge t-clip__edge--r" data-edge="R"></i>`;
      ce.title = c.kind === "hold" ? `${c.id} · giữ khung tại ${fmt(c.srcIn)} · ${fmtLen(len)}` : `${c.id} · nguồn ${fmt(c.srcIn)} → ${fmt(c.srcOut)} · ${fmtLen(len)}`;
      ce.style.left = k.s * z + "px"; ce.style.width = Math.max(4, len * z) + "px";
      lane.appendChild(ce);
    }
    rowEl.append(head, lane);
    return rowEl;
  }
  const afterRender = () => paintThumbs();
  let scRaf = 0;
  $("tlScroll").addEventListener("scroll", () => { if (!scRaf) scRaf = requestAnimationFrame(() => { scRaf = 0; paintThumbs(); }); });

  // ---------- kéo trên track ----------
  const laneEl = () => document.querySelector("[data-vclips]");
  function layoutDom(next) {
    const z = h.zoom();
    for (const k of C.layout(next, fps())) {
      const ce = document.querySelector(`.t-clip--vclip[data-cid="${k.c.id}"]`);
      if (!ce || (cd && cd.mode === "move" && k.c.id === cd.id)) continue;
      ce.style.left = k.s * z + "px"; ce.style.width = Math.max(4, ((k.n / fps()) * z)) + "px";
      const lb = ce.querySelector(".vc-label"); if (lb) lb.textContent = (k.c.kind === "hold" ? "Giữ khung · " : "") + fmtLen(k.n / fps());
    }
  }
  $("rows").addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const ce = e.target.closest(".t-clip--vclip");
    if (!ce) return;
    const idx = clips().findIndex((c) => c.id === ce.dataset.cid);
    if (idx < 0) return;
    h.clearSel(); csel = ce.dataset.cid; markSel();
    const orig = JSON.parse(JSON.stringify(clips()));
    cd = { mode: e.target.dataset.edge || "move", sx: e.clientX, id: csel, idx, orig, L: C.layout(orig, fps()), ce, moved: false, to: idx };
    e.preventDefault();
  });
  $("tlScroll").addEventListener("pointerdown", (e) => { if (csel && !e.target.closest(".t-clip--vclip, .t-track__head, .t-ruler, button")) deselect(); });
  window.addEventListener("pointermove", (e) => {
    if (!cd) return;
    const dx = e.clientX - cd.sx, z = h.zoom(), f = fps();
    if (!cd.moved) { if (Math.abs(dx) < 3) return; cd.moved = true; h.pausePlay(); if (cd.mode !== "move") h.pushHist(); cd.ce.classList.add("is-dragging"); }
    if (cd.mode === "move") {
      // vị trí thả = số clip khác có tâm nằm trước con trỏ (bố cục thu gọn); các clip khác dồn theo thời gian thực
      const lane = laneEl().getBoundingClientRect(), tp = (e.clientX - lane.left) / z;
      let cum = 0, to = 0;
      for (const k of cd.L) { if (k.i === cd.idx) continue; const len = k.e - k.s; if (cum + len / 2 < tp) to++; cum += len; }
      cd.to = to;
      layoutDom(C.moveClip(cd.orig, cd.idx, to));
      const k0 = cd.L[cd.idx];
      cd.ce.style.left = Math.max(0, k0.s * z + dx) + "px";
      h.dragTip(`vị trí ${to + 1}/${cd.orig.length}`, e);
      return;
    }
    const k = cd.L[cd.idx], c = cd.orig[cd.idx], edge = cd.mode;
    const [lo, hi] = C.trimRange(c, edge, f, info.duration);
    let d = dx / z;
    const pos0 = edge === "L" ? k.s : k.e;
    if (h.snapOn() && !e.altKey && Math.abs(pos0 + d - h.t()) < 8 / z) d = h.t() - pos0; // bám playhead
    d = clamp(d, lo, hi);
    const next = C.trimClip(cd.orig, cd.idx, edge, d, f, info.duration);
    h.project().videoClips = next;
    h.project().duration = C.totalSec(next, f);
    layoutDom(next);
    cd.next = next;
    const nc = next[cd.idx];
    if (nc.kind === "source") { // xem khung ở mép đang trim
      const tt = edge === "L" ? nc.srcIn : Math.max(nc.srcIn, nc.srcOut - 1 / f);
      try { player.active.currentTime = tt; } catch (_) { /* chưa sẵn sàng */ }
      h.dragTip(`${edge === "L" ? "vào" : "ra"} ${fmt(edge === "L" ? nc.srcIn : nc.srcOut)} · dài ${fmtLen(C.layout(next, f)[cd.idx].n / f)}`, e);
    } else h.dragTip(`giữ ${fmtLen(nc.dur)}`, e);
    paintThumbs();
  });
  window.addEventListener("pointerup", (e) => {
    if (!cd) return;
    const d = cd; cd = null; h.dragTip(null); h.showSnap(null);
    d.ce.classList.remove("is-dragging");
    if (!d.moved) { h.setTime(h.timeAtClientX(e.clientX)); return; } // nhấp = chọn + đặt playhead
    if (d.mode === "move") {
      if (d.to === d.idx) { h.project().videoClips = d.orig; h.renderTimeline(); return; }
      h.pushHist(); // đổi thứ tự: chỉ ghi bước hoàn tác khi thật sự đổi
      h.project().videoClips = C.moveClip(d.orig, d.idx, d.to);
    }
    changed(); h.touch(); h.renderTimeline();
    const tt = Math.min(h.t(), h.project().duration);
    player.seek(tt); h.setTime(tt, true);
    warnOnce();
  });

  // ---------- tab Nguồn ----------
  const pane = $("pane-source");
  pane.innerHTML = `<div class="t-panel__scroll side-scroll src-scroll">
    <div class="src-view"><video id="srcVid" playsinline preload="metadata"></video></div>
    <div class="src-ctl">
      <button class="t-btn t-btn--primary t-btn--icon t-btn--sm" id="srcPlay" aria-label="Phát / dừng video gốc"><svg class="t-ico t-ico--sm"><use href="#i-play" id="srcPlayUse"/></svg></button>
      <span class="src-time"><b id="srcTime">0:00.0</b><small id="srcTotal"></small></span>
      <span class="grow"></span>
      <button class="t-btn t-btn--sm" id="srcSetI" data-tip="Đặt điểm vào (I)">I</button>
      <button class="t-btn t-btn--sm" id="srcSetO" data-tip="Đặt điểm ra (O)">O</button>
    </div>
    <div class="src-bar" id="srcBar" aria-label="Thanh tua video gốc"><div class="src-film" id="srcFilm"></div><div class="src-used" id="srcUsed"></div><div class="src-io" id="srcIO"></div><div class="src-ph" id="srcPh"></div></div>
    <div class="src-tip" id="srcTip"><span class="src-tip__img" id="srcTipImg"></span><span id="srcTipT"></span></div>
    <div class="src-io-read" id="srcRead"></div>
    <div class="src-act">
      <button class="t-btn t-btn--primary t-btn--sm" id="srcIns" data-tip="Tách clip tại playhead timeline rồi chèn đoạn I–O">Chèn tại playhead</button>
      <button class="t-btn t-btn--sm" id="srcApp" data-tip="Thêm đoạn I–O vào cuối video">Nối cuối</button>
    </div>
    <div class="t-caption src-cap">Lời nói trong vùng này</div>
    <div class="src-text" id="srcText"></div>
    <div class="src-foot"><button class="t-btn t-btn--sm" data-build="1" data-tip="Dựng lại cut.mp4 / audio.wav từ videoClips (chạy nền)"><svg class="t-ico t-ico--sm"><use href="#i-film"/></svg><span>Dựng lại video</span></button></div>
  </div>`;
  const sv = $("srcVid");
  sv.src = info.proxyUrl;
  $("srcTotal").textContent = " / " + fmt(info.duration);
  let srcHot = false;
  $("sideTabs").parentElement.addEventListener("pointerenter", () => { srcHot = true; });
  $("sideTabs").parentElement.addEventListener("pointerleave", () => { srcHot = false; });
  const paneActive = () => pane.classList.contains("is-active");
  const snapF = (x) => C.snapSec(x, fps());

  // thanh tua: nền filmstrip (mỗi ô một khung từ sprite), vùng đã dùng, vùng I–O, playhead
  function paintBar() {
    const bar = $("srcBar"), W = bar.clientWidth;
    if (!W) return;
    const hh = 40, tw = Math.round((hh * (thumbs ? thumbs.tileW : 160)) / (thumbs ? thumbs.tileH : 90)), n = Math.max(1, Math.ceil(W / tw));
    let html = "";
    if (thumbs) for (let j = 0; j < n; j++) html += `<i style="left:${j * tw}px;width:${tw}px;${tileCss(((j + 0.5) / n) * info.duration, hh)}"></i>`;
    $("srcFilm").innerHTML = html;
    $("srcBar").dataset.w = W;
  }
  function paintSource() {
    const bar = $("srcBar"), W = bar.clientWidth || 1, D = info.duration || 1;
    if (!+bar.dataset.w) paintBar();
    $("srcUsed").innerHTML = C.usedRanges(clips()).map(([a, b]) => `<i style="left:${(a / D) * 100}%;width:${Math.max(0.15, ((b - a) / D) * 100)}%"></i>`).join("");
    const io = $("srcIO");
    if (I != null || O != null) {
      const a = I != null ? I : O, b = O != null ? O : I;
      io.style.display = "block"; io.style.left = (Math.min(a, b) / D) * 100 + "%"; io.style.width = Math.max(0.3, (Math.abs(b - a) / D) * 100) + "%";
    } else io.style.display = "none";
    const ok = I != null && O != null && O > I;
    $("srcRead").innerHTML = `<span>Vào <b>${I != null ? fmt(I) : "—"}</b></span><span>Ra <b>${O != null ? fmt(O) : "—"}</b></span><span>Dài <b>${ok ? fmtLen(O - I) : "—"}</b></span>`;
    $("srcIns").disabled = !ok; $("srcApp").disabled = !ok;
    void W;
  }
  function phUpdate() {
    const D = info.duration || 1;
    $("srcPh").style.left = (sv.currentTime / D) * 100 + "%";
    $("srcTime").textContent = fmt(sv.currentTime);
  }
  let scrubSrc = false;
  const seekSrc = (x) => { const r = $("srcBar").getBoundingClientRect(); sv.currentTime = clamp(((x - r.left) / r.width) * info.duration, 0, info.duration); phUpdate(); updateText(); };
  $("srcBar").addEventListener("pointerdown", (e) => { scrubSrc = true; $("srcBar").setPointerCapture(e.pointerId); seekSrc(e.clientX); });
  $("srcBar").addEventListener("pointermove", (e) => {
    const r = $("srcBar").getBoundingClientRect(), tt = clamp(((e.clientX - r.left) / r.width) * info.duration, 0, info.duration), tip = $("srcTip");
    tip.style.display = "flex"; tip.style.left = clamp(e.clientX - r.left, 40, r.width - 40) + "px";
    $("srcTipImg").style.cssText = tileCss(tt, 60) + `width:${Math.round(60 * (thumbs ? thumbs.tileW / thumbs.tileH : 1.78))}px;height:60px`;
    $("srcTipT").textContent = fmt(tt);
    if (scrubSrc) seekSrc(e.clientX);
  });
  $("srcBar").addEventListener("pointerup", () => { scrubSrc = false; });
  $("srcBar").addEventListener("pointerleave", () => { $("srcTip").style.display = "none"; });
  const setPlayIco = () => $("srcPlayUse").setAttribute("href", sv.paused ? "#i-play" : "#i-pause");
  const toggleSrc = () => { if (sv.paused) { h.pausePlay(); sv.play().catch(() => {}); } else sv.pause(); };
  $("srcPlay").onclick = toggleSrc;
  sv.addEventListener("play", () => { h.pausePlay(); setPlayIco(); });
  sv.addEventListener("pause", setPlayIco);
  sv.addEventListener("timeupdate", () => { phUpdate(); });
  sv.addEventListener("seeked", () => { phUpdate(); updateText(); });
  function mark(k) {
    const tt = snapF(sv.currentTime);
    if (k === "i") { I = tt; if (O != null && O <= I) O = null; } else { O = tt; if (I != null && I >= O) I = null; }
    paintSource(); updateText();
  }
  $("srcSetI").onclick = () => mark("i"); $("srcSetO").onclick = () => mark("o");
  function insertIO(append) {
    if (!(I != null && O != null && O > I)) return;
    h.pausePlay(); sv.pause();
    const r = C.insertSource(clips(), append ? Infinity : h.t(), I, O, fps());
    if (!r) { h.toast("Đoạn I–O quá ngắn."); return; }
    edit(r.clips, { select: r.clips[r.index].id });
    const ln = O - I;
    h.toast(`${append ? "Đã nối cuối" : "Đã chèn tại playhead"} đoạn ${fmtLen(ln)} (Ctrl+Z để hoàn tác)`);
    const ph = C.layout(r.clips, fps())[r.index];
    h.revealTime(ph.s);
  }
  $("srcIns").onclick = () => insertIO(false); $("srcApp").onclick = () => insertIO(true);

  // phiên âm của vùng I–O (hoặc quanh vị trí đang xem nếu chưa đặt I/O)
  async function updateText() {
    if (!paneActive() && !updateText.force) return;
    if (!tdata) {
      if (!info.transcriptUrl) { $("srcText").innerHTML = `<div class="lib-empty">Chưa có transcript.edited.json.</div>`; return; }
      tdata = (await getJson(info.transcriptUrl)) || { segments: [] };
    }
    const box = $("srcText"), cur = sv.currentTime, ok = I != null && O != null && O > I;
    const a = ok ? I : cur - 8, b = ok ? O : cur + 22;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const segs = (tdata.segments || []).filter((s) => s.end > a && s.start < b).slice(0, 40);
    box.innerHTML = segs.map((s) => {
      const words = (s.words && s.words.length ? s.words : [{ text: s.text, start: s.start, end: s.end }]).map((w) => {
        const inside = ok && w.end > I && w.start < O, now = !ok && cur >= w.start && cur < w.end;
        return `<span class="src-w${inside ? " in" : ""}${now ? " now" : ""}" data-s="${w.start}" data-e="${w.end}">${esc(w.text)}</span>`;
      }).join(" ");
      return `<div class="src-seg" data-s="${s.start}" data-e="${s.end}"><time>${fmt(s.start)}</time><p>${words}</p></div>`;
    }).join("") || `<div class="lib-empty">Không có lời nói trong vùng này.</div>`;
  }
  $("srcText").addEventListener("click", (e) => {
    const w = e.target.closest(".src-w"), seg = e.target.closest(".src-seg");
    if (!seg) return;
    if (w && (e.ctrlKey || e.metaKey)) { I = snapF(+w.dataset.s); if (O != null && O <= I) O = null; }
    else if (w && e.shiftKey) { O = snapF(+w.dataset.e); if (I != null && I >= O) I = null; }
    else if (w) { sv.currentTime = +w.dataset.s; return; }
    else { I = snapF(+seg.dataset.s); O = snapF(+seg.dataset.e); sv.currentTime = I; }
    paintSource(); updateText();
  });
  // chuyển sang tab Nguồn: vẽ lại thanh tua + lời
  for (const b of document.querySelectorAll("#sideTabs [role=tab]")) b.addEventListener("click", () => { if (b.dataset.pane === "source") requestAnimationFrame(() => { paintBar(); paintSource(); phUpdate(); updateText.force = false; updateText(); }); else sv.pause(); });
  new ResizeObserver(() => { if (paneActive()) { paintBar(); paintSource(); } }).observe($("srcBar"));

  // ---------- dựng lại video (th:clips-build qua API) ----------
  const buildBtns = [...document.querySelectorAll("[data-build]")];
  let building = false;
  const setBuildLabel = (txt, busy) => buildBtns.forEach((b) => { b.querySelector("span").textContent = txt; b.disabled = !!busy; });
  async function build() {
    if (building) return;
    building = true; setBuildLabel("Đang lưu…", true);
    try {
      if (!(await h.flush())) { h.toast("Chưa lưu được dự án nên không dựng lại."); return; }
      let r = await fetch("/api/clips/build", { method: "POST" });
      if (!r.ok && r.status !== 409) throw new Error("HTTP " + r.status);
      for (;;) {
        await sleep(1500);
        const s = await (await fetch("/api/clips/build")).json();
        if (s.state === "running") { setBuildLabel(`Đang dựng… ${Math.round(s.seconds)} s`, true); continue; }
        if (s.state === "done") { h.toast(`Đã dựng lại video (${Math.round(s.seconds)} s): cut.mp4, audio.wav, transcript.cut.json.`); break; }
        throw new Error((s.log && s.log[s.log.length - 1]) || "dựng lỗi (mã " + s.code + ")");
      }
    } catch (e) { h.toast("Dựng lại video lỗi: " + e.message); }
    finally { building = false; setBuildLabel("Dựng lại video", false); }
  }
  buildBtns.forEach((b) => (b.onclick = build));
  const tlBtn = document.createElement("button");
  tlBtn.className = "t-btn t-btn--sm"; tlBtn.dataset.build = "1"; tlBtn.dataset.tip = "Dựng lại cut.mp4 / audio.wav từ videoClips (chạy nền)";
  tlBtn.innerHTML = `<svg class="t-ico t-ico--sm"><use href="#i-film"/></svg><span>Dựng lại video</span>`;
  tlBtn.onclick = build; buildBtns.push(tlBtn);
  $("btnHelp").parentElement.insertBefore(tlBtn, $("btnHelp"));

  $("tabSource").hidden = false;
  changed();
  h.setTime(h.t(), true);
  const api = {
    player, info, thumbs, row, afterRender, sync, cut, del, hasSel, deselect, mark, toggleSrc, build,
    srcHot: () => srcHot && paneActive(), paneActive, srcVid: sv,
    clipAt: (tm) => { const L = C.layout(clips(), fps()), i = C.locate(L, tm); return i >= 0 ? L[i].c : null; },
    stepSrc: (d) => { sv.pause(); sv.currentTime = clamp(sv.currentTime + d, 0, info.duration); },
    get csel() { return csel; }, get io() { return [I, O]; }, setIO: (a, b) => { I = a; O = b; paintSource(); updateText(); },
    select: (id) => { csel = id; markSel(); },
  };
  return api;
}
