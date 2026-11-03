// Editor Chế độ C — HTML/CSS/JS thuần, không thư viện. Dữ liệu: project.json v1 (docs/CHE-DO-C-SPEC.md). Giao diện: design/ (Tahoe).
import { mountOverlay, layerGeom, videoState } from "./overlay-runtime.js";
import { alignWords } from "./words-align.js";
import { layoutFor } from "./style-presets.js";
import { createAudioEngine } from "./audio-engine.js";
import { initLibrary } from "./library.js";
import { initClips } from "./clips-ui.js";

const $ = (id) => document.getElementById(id);
const TRACK_HEAD = 224; // = --head-w của .t-tl (editor.css)
// Vùng bị giao diện nền tảng che (% canvas 9:16). Số liệu XẤP XỈ theo hướng dẫn công khai (TikTok/Reels/Shorts), không chính thức:
// top = thanh trên; bottom = caption + nút + tên kênh; right = cột icon thích/bình luận/chia sẻ.
const SAFE_ZONES = {
  tiktok: { top: 8, bottom: 25, right: 15 },
  reels: { top: 8, bottom: 22, right: 12 },
  shorts: { top: 8, bottom: 20, right: 14 },
};
const AUDIO_KINDS = ["sfx", "music"];
const GAIN_MIN = -40, GAIN_MAX = 10; // dB: đường gain trên clip
let vsel = false, vKey = false, safeOn = false, peaks = null, warnEl = null;
const HIST_MAX = 200;

let project = null;
let meta = { palette: {}, fonts: [], presets: { in: [], out: [] }, templates: [] };
let ov = null;
const sel = new Set();
let t = 0;
let playing = false;
let zoom = 80; // px / giây
let rev = 0, savedRev = 0, saveTimer = null, saving = false;
let serverRev = 0, stale = false; // revision máy chủ đã biết; stale = có bản mới hơn trên đĩa (409) → dừng lưu, không ghi đè
let cu = null, vid2 = null; // "Video gốc chỉnh được" (clips-ui.js); null = chế độ cut.mp4 như cũ
let undoStack = [], redoStack = [], lastHistKey = "", lastHistAt = 0;
let panelCtl = [];
let avoidEl = null;
let engine = null, libApi = null, libData = null;
const soloSet = new Set(); // phiên làm việc: "voice" | "trk:<id>"
let snapOn = true;

// ---------- tiện ích ----------
const clone = (o) => JSON.parse(JSON.stringify(o));
const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fps = () => project.fps || 30;
const isAudio = (l) => l.type === "audio";
const ico = (id, cls = "t-ico t-ico--sm") => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const escHtml = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function toast(msg) {
  const e = $("toast");
  $("toastTxt").textContent = msg;
  e.classList.remove("is-show"); void e.offsetWidth; e.classList.add("is-show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => e.classList.remove("is-show"), 2600);
}

function tc(sec) {
  const f = fps();
  const total = Math.max(0, sec);
  const m = Math.floor(total / 60), s = Math.floor(total % 60), fr = Math.floor((total - Math.floor(total)) * f + 1e-6);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(m)}:${p(s)}:${p(fr)}`;
}

function getp(o, path) {
  if (path === "draw.on") return !!o.draw; // công tắc ảo: có/không có draw
 return path.split(".").reduce((a, k) => (a == null ? a : a[k]), o); }
function setp(o, path, v) {
  const ks = path.split(".");
  let c = o;
  for (let i = 0; i < ks.length - 1; i++) { if (c[ks[i]] == null || typeof c[ks[i]] !== "object") c[ks[i]] = {}; c = c[ks[i]]; }
  c[ks[ks.length - 1]] = v;
}

function allLayers() {
  const out = [];
  for (const tr of project.tracks) for (const l of tr.layers) out.push({ tr, l });
  return out;
}
function find(id) {
  for (const tr of project.tracks) { const l = tr.layers.find((x) => x.id === id); if (l) return { tr, l }; }
  return null;
}
const selLayers = () => [...sel].map(find).filter(Boolean);

// ---------- lịch sử / lưu ----------
function pushHist(key) {
  const now = Date.now();
  if (key && key === lastHistKey && now - lastHistAt < 800) { lastHistAt = now; return; }
  undoStack.push(JSON.stringify(project));
  if (undoStack.length > HIST_MAX) undoStack.shift();
  redoStack = [];
  lastHistKey = key || ""; lastHistAt = now;
}
function setSaveState() {
  const e = $("saveState");
  if (stale) { e.className = "t-chip t-chip--err"; e.textContent = "Bản cũ"; }
  else if (saving) { e.className = "t-chip t-chip--dirty"; e.textContent = "Đang lưu…"; }
  else if (rev !== savedRev) { e.className = "t-chip t-chip--dirty"; e.textContent = "Chưa lưu"; }
  else { e.className = "t-chip t-chip--ok"; e.textContent = "Đã lưu"; }
}
// Chữ ký phần âm thanh của dự án: đổi thì (khi đang phát) phải lên lịch lại WebAudio.
let lastAudioSig = "";
function audioSig() {
  return JSON.stringify([project.audio, project.tracks.filter((x) => AUDIO_KINDS.includes(x.kind)).map((x) => [x.id, x.hidden, x.layers]), [...soloSet], project.videoClips && project.videoClips.map((c) => { const { transform, ...r } = c; return r; })]);
}
function audioChanged(force) {
  if (!engine) return;
  const s = audioSig();
  if (s === lastAudioSig && !force) return;
  lastAudioSig = s;
  engine.preload();
  if (!playing) return;
  clearTimeout(audioChanged.tm);
  audioChanged.tm = setTimeout(() => engine.schedule(mediaT()), 140);
}
const mediaT = () => (cu ? t : vid.currentTime); // thời điểm timeline đang phát
function touch() {
  rev++;
  setSaveState();
  clearTimeout(saveTimer);
  if (!stale) saveTimer = setTimeout(save, 2000);
  audioChanged();
}
function showStale() {
  let b = $("staleBar");
  if (b) return;
  b = el("div", "stale-bar"); b.id = "staleBar"; b.setAttribute("role", "alert");
  b.innerHTML = "<span>Có bản mới hơn trên máy — tải lại trang. Thay đổi chưa lưu ở tab này sẽ không ghi đè lên bản đó.</span>";
  const btn = el("button", "t-btn t-btn--primary t-btn--sm", "Tải lại");
  btn.onclick = () => { rev = savedRev; location.reload(); }; // bỏ qua hỏi "rời trang" vì người dùng chủ động tải lại
  b.appendChild(btn);
  document.body.appendChild(b);
}
function markStale() { stale = true; clearTimeout(saveTimer); setSaveState(); showStale(); }
async function save() {
  clearTimeout(saveTimer);
  if (stale) { showStale(); return; }
  if (saving || rev === savedRev) return;
  const mine = rev;
  saving = true; setSaveState();
  try {
    project.revision = serverRev; // luôn gửi revision máy chủ đã biết (bản hoàn tác / SFX mang revision cũ trong ảnh chụp)
    const r = await fetch("/api/project", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(project) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 409 && j.error === "stale") { saving = false; markStale(); return; }
    if (!r.ok) throw new Error(j.error ? j.error + (j.issues ? " — " + JSON.stringify(j.issues[0]) : "") : "HTTP " + r.status);
    if (typeof j.revision === "number") { serverRev = j.revision; project.revision = serverRev; } // máy chủ cũ không trả revision: giữ nguyên
    savedRev = mine;
  } catch (e) {
    $("saveState").className = "t-chip t-chip--err"; $("saveState").textContent = "Lỗi lưu";
    toast("Lỗi lưu: " + e.message);
    saving = false;
    return;
  }
  saving = false; setSaveState();
  if (rev !== savedRev) saveTimer = setTimeout(save, 500);
}
/** Lưu xong mọi thay đổi (dùng trước khi dựng lại video). true = đã đồng bộ với đĩa. */
async function flush() {
  clearTimeout(saveTimer);
  for (let i = 0; i < 80 && saving; i++) await new Promise((r) => setTimeout(r, 100));
  if (stale) { showStale(); return false; }
  if (rev !== savedRev) await save();
  return !stale && rev === savedRev;
}
function restore(json) {
  project = JSON.parse(json);
  project.revision = serverRev;
  for (const id of [...sel]) if (!find(id)) sel.delete(id);
  lastHistKey = "";
  refreshAll();
  touch();
}
function undo() { if (!undoStack.length) return; redoStack.push(JSON.stringify(project)); restore(undoStack.pop()); }
function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(project)); restore(redoStack.pop()); }

// ---------- reframe video nguồn ----------
const VT_MIN = 0.2, VT_MAX = 4; // khớp VideoTransformSchema
const hasCap = (c) => (meta.caps || []).includes(c); // máy chủ cũ không lưu được videoClips[].transform / camera → ẩn tính năng đó
/** Chỉ kiểm giới hạn schema; scale < 1 và dịch quá mép là hợp lệ (phần trống tô ink #0C0C0C). */
function clampVT(vt) {
  vt.scale = r2(clamp(+vt.scale || 1, VT_MIN, VT_MAX));
  vt.x = r2(clamp(+vt.x || 0, -200, 200));
  vt.y = r2(clamp(+vt.y || 0, -200, 200));
}
let lastVClip = null;
let editGlobal = false; // true: sửa khung chung thay vì khung riêng của clip dưới playhead
/** Khung đang được sửa: clip dưới playhead (khung riêng nếu có) hoặc khung chung. */
function vtView() {
  const c = !editGlobal && cu && hasCap("clipTransform") ? cu.clipAt(t) : null;
  return c ? { vt: c.transform || project.videoTransform, clip: c, own: !!c.transform } : { vt: project.videoTransform, clip: null, own: false };
}
/** Đối tượng khung để GHI (tạo khung riêng cho clip từ khung chung nếu chưa có). */
function vtWritable() {
  const v = vtView();
  if (v.clip && !v.own) { v.clip.transform = { ...project.videoTransform }; queueMicrotask(() => { if (vsel) renderProps(); }); } // inspector đổi sang "khung riêng"
  return v.clip ? v.clip.transform : v.vt;
}
/** Kích thước video hiển thị theo % canvas với hệ số phóng S (so với phủ kín). */
function vdimsPct(S) {
  const W = project.width, H = project.height, vw = vid.videoWidth || 1920, vh = vid.videoHeight || 1080;
  const cs = Math.max(W / vw, H / vh) * S;
  return { w: ((vw * cs) / W) * 100, h: ((vh * cs) / H) * 100 };
}
function selectVideo(on) {
  if (on === vsel) return;
  vsel = on;
  if (on) { sel.clear(); if (cu) cu.deselect(); }
  $("btnVideo").classList.toggle("is-on", vsel);
  $("btnVideo").setAttribute("aria-pressed", String(vsel));
  renderSel(); renderProps(); updateBlockSel();
}

// ---------- vùng an toàn ----------
function isUnsafe(l) {
  if (!safeOn || !["text", "subtitle", "lowerThird", "callout"].includes(l.type)) return false;
  if ($("safePlat").value === "title") return l.x < 5 || l.y < 5 || l.x + l.w > 95 || l.y + l.h > 95; // title safe 90%
  if (project.aspect !== "9:16") return false;
  const z = SAFE_ZONES[$("safePlat").value];
  return l.y < z.top || l.y + l.h > 100 - z.bottom || l.x + l.w > 100 - z.right;
}
function renderSafe() {
  const ui = $("safeUi");
  ui.textContent = "";
  if (!safeOn) return;
  if ($("safePlat").value === "title") { // chuẩn phát sóng: action safe 93%, title safe 90%
    const box = (inset, dash, txt) => { const d = document.createElement("div"); d.className = "safe-frame"; d.style.cssText = `inset:${inset}%;border-style:${dash}`; d.textContent = txt; ui.appendChild(d); };
    box(3.5, "dashed", "action safe 93%"); box(5, "solid", "title safe 90%");
    return;
  }
  if (project.aspect !== "9:16") return;
  const z = SAFE_ZONES[$("safePlat").value];
  const mk = (css, txt) => { const d = document.createElement("div"); d.className = "safe"; d.style.cssText = css; d.textContent = txt; ui.appendChild(d); };
  mk(`left:0;right:0;top:0;height:${z.top}%`, "thanh trên");
  mk(`left:0;right:0;bottom:0;height:${z.bottom}%`, "caption / nút");
  mk(`right:0;width:${z.right}%;top:${z.top}%;bottom:${z.bottom}%`, "icon");
}

// ---------- khung xem trước ----------
const stage = $("stage"), vid = $("vid"), aud = $("aud"), selUi = $("selUi");
let hasAudio = false;

function sizeStage() {
  const area = $("stageArea");
  const cs = getComputedStyle(area); // trừ padding thật của vùng xem trước
  const aw = area.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), ah = area.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const ar = project.width / project.height;
  let w = aw, h = aw / ar;
  if (h > ah) { h = ah; w = ah * ar; }
  stage.style.width = Math.max(50, w) + "px";
  stage.style.height = Math.max(50, h) + "px";
  layoutVideo();
  if (ov) ov.update(project);
  renderSel();
}
function layoutVideo() {
  const W = project.width, H = project.height;
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const k = sw / W;
  const vw = vid.videoWidth || 1920, vh = vid.videoHeight || 1080;
  const vs = videoState(project, t); // videoTransform tĩnh + đoạn videoMoves đang chạy (cùng công thức với render)
  const vf = $("vframe");
  let fx = 0, fy = 0, fw = sw, fh = sh, rad = 0, kk = k;
  if (vs.pip) { // pip: khung video thu nhỏ có bo góc + bóng, nội dung bên trong giữ nguyên bố cục
    const kf = vs.pip.w / 100;
    fx = (vs.pip.x / 100) * sw; fy = (vs.pip.y / 100) * sh; fw = sw * kf; fh = sh * kf; rad = vs.pip.radius * k * kf; kk = k * kf;
    vf.style.boxShadow = vs.pip.shadow ? "0 14px 40px rgba(0,0,0,.55)" : "none";
  } else vf.style.boxShadow = "none";
  vf.style.left = fx + "px"; vf.style.top = fy + "px"; vf.style.width = fw + "px"; vf.style.height = fh + "px"; vf.style.borderRadius = rad + "px";
  const cs = Math.max(W / vw, H / vh) * vs.scale;
  const dw = vw * cs * kk, dh = vh * cs * kk;
  vid.style.width = dw + "px"; vid.style.height = dh + "px";
  vid.style.left = (fw - dw) / 2 + (vs.x / 100) * fw + "px";
  vid.style.top = (fh - dh) / 2 + (vs.y / 100) * fh + "px";
  if (vid2) for (const k of ["width", "height", "left", "top"]) vid2.style[k] = vid.style[k];
}

function setTime(nt, fromVideo) {
  t = clamp(nt, 0, project.duration || nt);
  if (!fromVideo) {
    if (cu) cu.player.seek(t);
    else try { vid.currentTime = t; if (hasAudio) aud.currentTime = t; } catch (_) { /* chưa sẵn sàng */ }
    if (playing && engine) engine.schedule(t); // seek khi đang phát: lên lịch lại SFX/nhạc
  }
  ov.seek(t);
  if ((project.videoMoves && project.videoMoves.length) || (project.videoShifts && project.videoShifts.length) || (cu && project.videoClips.some((c) => c.transform))) layoutVideo();
  if (vsel && cu) { const id = (cu.clipAt(t) || {}).id; if (id !== lastVClip) { lastVClip = id; renderProps(); } } // đổi clip dưới playhead → đổi "khung riêng của clip"
  $("timecode").textContent = tc(t);
  placePlayhead();
  renderSel();
  if (libApi) libApi.onTime(t);
}
function placePlayhead() {
  const ph = $("playhead"), x = TRACK_HEAD + t * zoom;
  ph.style.left = x + "px";
  ph.style.visibility = x < $("tlScroll").scrollLeft + TRACK_HEAD ? "hidden" : "visible"; // không vẽ đè lên cột tên track khi đã cuộn qua
}
$("tlScroll").addEventListener("scroll", () => project && placePlayhead());
function setPlayIcon() { $("playUse").setAttribute("href", playing ? "#i-pause" : "#i-play"); }

function play() {
  if (t >= project.duration - 0.05) setTime(0);
  engine.ensure();
  if (cu) { cu.srcVid.pause(); cu.player.play(t); }
  else {
    if (hasAudio) { aud.currentTime = vid.currentTime; aud.play().catch(() => {}); }
    vid.play().catch((e) => toast("Không phát được video: " + e.message));
  }
  playing = true; setPlayIcon();
  engine.schedule(mediaT());
  lastDriftCheck = performance.now();
  requestAnimationFrame(tick);
}
function pause() {
  if (cu) cu.player.pause(); else { vid.pause(); if (hasAudio) aud.pause(); }
  playing = false; setPlayIcon();
  engine.stop();
}
let lastDriftCheck = 0;
function tick() {
  if (!playing) return;
  const ct = cu ? cu.player.tick() : vid.currentTime;
  if (!cu && hasAudio && Math.abs(aud.currentTime - ct) > 0.15) aud.currentTime = ct;
  if (ct >= project.duration - (cu ? 0.001 : 0)) { pause(); setTime(project.duration); return; }
  setTime(ct, true);
  // WebAudio lệch quá 120 ms so với video (tab nền, giật) thì lên lịch lại
  const now = performance.now();
  if (now - lastDriftCheck > 600) {
    lastDriftCheck = now;
    const c = engine.clock();
    if (c != null && Math.abs(c - ct) > 0.12) { console.log("[audio] lệch", (c - ct).toFixed(3), "→ lên lịch lại"); engine.schedule(ct); }
  }
  // giữ playhead trong tầm nhìn
  const sc = $("tlScroll"), x = TRACK_HEAD + ct * zoom;
  if (x > sc.scrollLeft + sc.clientWidth - 40 || x < sc.scrollLeft + TRACK_HEAD) sc.scrollLeft = x - TRACK_HEAD - 40;
  requestAnimationFrame(tick);
}

// ---------- chọn / kéo trên khung xem trước ----------
const HANDLES = { nw: [0, 0], n: [50, 0], ne: [100, 0], e: [100, 50], se: [100, 100], s: [50, 100], sw: [0, 100], w: [0, 50] };

function visibleAt(l, time) { return time >= l.start && time < l.start + l.duration; }

function renderSel() {
  selUi.textContent = "";
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const box = (l, cls) => {
    const g = layerGeom(project, l, t); // hình học hiệu dụng (phụ đề tự tránh thẻ scene)
    const b = el("div", cls);
    b.style.left = (g.x / 100) * sw + "px"; b.style.top = (g.y / 100) * sh + "px";
    b.style.width = (g.w / 100) * sw + "px"; b.style.height = (g.h / 100) * sh + "px";
    if (l.rotation) b.style.transform = `rotate(${l.rotation}deg)`;
    return b;
  };
  const items = selLayers().filter(({ tr, l }) => !isAudio(l) && !tr.hidden && visibleAt(l, t));
  for (const { l } of items) {
    const b = box(l, "t-sel" + (sel.size > 1 ? " multi" : "") + (isUnsafe(l) ? " t-sel--warn" : ""));
    if (items.length === 1) {
      for (const [name, [px, py]] of Object.entries(HANDLES)) {
        const h = el("div", "t-sel__h"); h.dataset.h = name;
        h.style.left = px + "%"; h.style.top = py + "%"; h.style.cursor = name + "-resize";
        b.appendChild(h);
      }
    }
    selUi.appendChild(b);
  }
  if (safeOn) {
    for (const tr of project.tracks) {
      if (tr.hidden) continue;
      for (const l of tr.layers) {
        if (isAudio(l) || sel.has(l.id) || !visibleAt(l, t) || !isUnsafe(l)) continue;
        selUi.appendChild(box(l, "t-sel t-sel--warn ghost"));
      }
    }
  }
  stage.classList.toggle("vsel", vsel);
  if (vsel) renderVideoBox(sw, sh);
}
/** Khung chọn của "Video gốc": viền + 4 tay nắm góc (kẹp vào trong khung xem để luôn với tới được). */
function renderVideoBox(sw, sh) {
  const vs = videoState(project, t);
  if (vs.pip) return;
  const d = vdimsPct(vs.scale), cx = 50 + vs.x, cy = 50 + vs.y;
  const L = ((cx - d.w / 2) / 100) * sw, T = ((cy - d.h / 2) / 100) * sh, w = (d.w / 100) * sw, h = (d.h / 100) * sh;
  const b = el("div", "t-sel vbox");
  b.style.left = L + "px"; b.style.top = T + "px"; b.style.width = w + "px"; b.style.height = h + "px";
  selUi.appendChild(b);
  for (const [name, [fx, fy]] of Object.entries({ nw: [0, 0], ne: [1, 0], se: [1, 1], sw: [0, 1] })) {
    const hd = el("div", "t-sel__h vh"); hd.dataset.vh = name;
    hd.style.left = clamp(L + fx * w, 6, sw - 6) + "px"; hd.style.top = clamp(T + fy * h, 6, sh - 6) + "px"; hd.style.cursor = (name === "nw" || name === "se" ? "nwse" : "nesw") + "-resize";
    selUi.appendChild(hd);
  }
}

function hitTest(px, py) {
  const W = stage.clientWidth, H = stage.clientHeight;
  const x = (px / W) * 100, y = (py / H) * 100;
  for (const tr of project.tracks) {
    if (tr.hidden || tr.locked) continue;
    for (let i = tr.layers.length - 1; i >= 0; i--) {
      const l = tr.layers[i];
      if (isAudio(l) || !visibleAt(l, t)) continue;
      if (l.type === "scene" && l.meta && l.meta.overlay && l.w >= 90 && l.h >= 90) continue; // cảnh overlay trong suốt phủ cả khung: bỏ qua khi bấm (chọn trên timeline) để bấm vào video được
      const g = layerGeom(project, l, t);
      if (x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h) return l;
    }
  }
  return null;
}

let pdrag = null;
selUi.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const rect = stage.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  const hName = e.target.dataset && e.target.dataset.h;
  const lockedOf = (id) => { const f = find(id); return !f || f.tr.locked; };
  const vh = e.target.dataset && e.target.dataset.vh;
  const startVideoDrag = () => {
    const v = vtView(), vs = videoState(project, t), base = v.vt;
    pdrag = { mode: "video", sx: e.clientX, sy: e.clientY, o: { x: base.x, y: base.y, scale: base.scale }, off: { x: vs.x - base.x, y: vs.y - base.y }, moved: false };
    selUi.setPointerCapture(e.pointerId);
  };
  if (vh) { // tay nắm góc: phóng (Shift = giữ tâm)
    const v = vtView(), vs = videoState(project, t), base = v.vt, d = vdimsPct(vs.scale);
    const sw0 = stage.clientWidth, sh0 = stage.clientHeight;
    const L = ((50 + vs.x - d.w / 2) / 100) * sw0, T = ((50 + vs.y - d.h / 2) / 100) * sh0, w = (d.w / 100) * sw0, h = (d.h / 100) * sh0;
    const cx = vh.includes("e") ? L + w : L, cy = vh.includes("s") ? T + h : T; // góc đang cầm
    pdrag = { mode: "vscale", vh, sx: e.clientX, sy: e.clientY, o: { x: base.x, y: base.y, scale: base.scale }, off: { x: vs.x - base.x, y: vs.y - base.y },
      rect: { L, T, w, h }, grab: { x: px - cx, y: py - cy }, moved: false };
    selUi.setPointerCapture(e.pointerId);
    return;
  }
  if (!hName && vKey) { startVideoDrag(); return; }
  if (hName) {
    const [{ l }] = selLayers();
    pdrag = { mode: "resize", h: hName, sx: e.clientX, sy: e.clientY, o: { x: l.x, y: l.y, w: l.w, h: l.h }, id: l.id, moved: false };
  } else {
    const hit = hitTest(px, py);
    if (!hit) { // bấm vào video (không trúng layer) → chọn "Video gốc", kéo để dời
      if (e.shiftKey) return;
      if (sel.size) { sel.clear(); selectionChanged(); }
      selectVideo(true);
      startVideoDrag();
      return;
    }
    selectVideo(false);
    if (e.shiftKey) { sel.has(hit.id) ? sel.delete(hit.id) : sel.add(hit.id); }
    else if (!sel.has(hit.id)) { sel.clear(); sel.add(hit.id); }
    selectionChanged();
    if (!sel.has(hit.id)) return;
    const origs = new Map(selLayers().filter(({ l }) => !lockedOf(l.id)).map(({ l }) => [l.id, { x: l.x, y: l.y }]));
    pdrag = { mode: "move", sx: e.clientX, sy: e.clientY, origs, ref: hit.id, moved: false };
  }
  selUi.setPointerCapture(e.pointerId);
});
selUi.addEventListener("pointermove", (e) => {
  if (!pdrag) return;
  const W = project.width, H = project.height;
  const sw = stage.clientWidth, sh = stage.clientHeight;
  const dxp = e.clientX - pdrag.sx, dyp = e.clientY - pdrag.sy;
  if (!pdrag.moved && Math.hypot(dxp, dyp) < 3) return;
  if (!pdrag.moved) { pushHist(); pdrag.moved = true; }
  if (pdrag.mode === "video" || pdrag.mode === "vscale") {
    const vt = vtWritable(), snapOn = !e.altKey;
    if (pdrag.mode === "video") {
      let nx = pdrag.o.x + (dxp / sw) * 100, ny = pdrag.o.y + (dyp / sh) * 100, gv = false, gh = false;
      if (snapOn) { // bám mép / tâm canvas khi gần (1,2 %)
        const d = vdimsPct(vt.scale);
        const snapAxis = (v, off, half) => {
          const e = v + off; let best = null;
          for (const [cand, isC] of [[half - 50, false], [50 - half, false], [0, true]]) { const dd = Math.abs(e - cand); if (dd < 1.2 && (!best || dd < best.dd)) best = { dd, cand, isC }; }
          return best ? [best.cand - off, best.isC] : [v, false];
        };
        [nx, gv] = snapAxis(nx, pdrag.off.x, d.w / 2); [ny, gh] = snapAxis(ny, pdrag.off.y, d.h / 2);
      }
      vt.x = nx; vt.y = ny;
      $("guideV").classList.toggle("show", gv); $("guideH").classList.toggle("show", gh);
    } else {
      const { L, T, w, h } = pdrag.rect, hn = pdrag.vh, px = e.clientX - stage.getBoundingClientRect().left, py = e.clientY - stage.getBoundingClientRect().top;
      const tx = px - pdrag.grab.x, ty = py - pdrag.grab.y; // vị trí mới của góc đang cầm
      const ax = hn.includes("e") ? L : L + w, ay = hn.includes("s") ? T : T + h; // góc đối diện (neo)
      const ccx = L + w / 2, ccy = T + h / 2;
      let k = e.shiftKey ? Math.max(Math.abs(tx - ccx) / (w / 2), Math.abs(ty - ccy) / (h / 2)) : Math.max(Math.abs(tx - ax) / w, Math.abs(ty - ay) / h);
      let S = clamp(pdrag.o.scale * k, VT_MIN, VT_MAX);
      if (snapOn && Math.abs(S - 1) < 0.03) S = 1; // phủ kín
      k = S / pdrag.o.scale;
      const nw = w * k, nh = h * k;
      let nL, nT;
      if (e.shiftKey) { nL = ccx - nw / 2; nT = ccy - nh / 2; }
      else { nL = hn.includes("e") ? ax : ax - nw; nT = hn.includes("s") ? ay : ay - nh; }
      vt.scale = S;
      vt.x = ((nL + nw / 2) / sw) * 100 - 50 - pdrag.off.x; // dời tâm theo % canvas
      vt.y = ((nT + nh / 2) / sh) * 100 - 50 - pdrag.off.y;
    }
    clampVT(vt); layoutVideo(); renderSel(); refreshPanelValues();
    return;
  }
  const snapOn = !e.altKey;
  let gv = false, gh = false;
  if (pdrag.mode === "move") {
    let dx = (dxp / sw) * 100, dy = (dyp / sh) * 100;
    const ref = find(pdrag.ref).l, o = pdrag.origs.get(pdrag.ref);
    if (o && snapOn) {
      const cx = o.x + dx + ref.w / 2, cy = o.y + dy + ref.h / 2;
      if (Math.abs(cx - 50) < 1.2) { dx = 50 - ref.w / 2 - o.x; gv = true; }
      if (Math.abs(cy - 50) < 1.2) { dy = 50 - ref.h / 2 - o.y; gh = true; }
    }
    for (const [id, og] of pdrag.origs) { const l = find(id).l; l.x = r2(og.x + dx); l.y = r2(og.y + dy); }
  } else {
    const { l } = find(pdrag.id), o = pdrag.o, min = 20;
    let L = (o.x / 100) * W, T = (o.y / 100) * H, R = L + (o.w / 100) * W, B = T + (o.h / 100) * H;
    const dx = (dxp / sw) * W, dy = (dyp / sh) * H, hn = pdrag.h;
    if (hn.includes("w")) L = Math.min(L + dx, R - min);
    if (hn.includes("e")) R = Math.max(R + dx, L + min);
    if (hn.includes("n")) T = Math.min(T + dy, B - min);
    if (hn.includes("s")) B = Math.max(B + dy, T + min);
    if (e.shiftKey && hn.length === 2) {
      const ratio = ((o.w / 100) * W) / ((o.h / 100) * H);
      let nw = R - L, nh = B - T;
      if (nw / ratio > nh) nh = nw / ratio; else nw = nh * ratio;
      if (hn.includes("w")) L = R - nw; else R = L + nw;
      if (hn.includes("n")) T = B - nh; else B = T + nh;
    }
    l.x = r2((L / W) * 100); l.y = r2((T / H) * 100); l.w = r2(((R - L) / W) * 100); l.h = r2(((B - T) / H) * 100);
  }
  $("guideV").classList.toggle("show", gv); $("guideH").classList.toggle("show", gh);
  ov.seek(t); renderSel(); refreshPanelValues(); // hình học/thời gian áp lại ở mỗi seek, không cần dựng lại DOM nội dung
});
const endPDrag = () => {
  if (!pdrag) return;
  if (pdrag.moved) { touch(); ov.update(project); }
  pdrag = null;
  $("guideV").classList.remove("show"); $("guideH").classList.remove("show");
};
selUi.addEventListener("pointerup", endPDrag);
selUi.addEventListener("pointercancel", endPDrag);

function selectionChanged() {
  if (sel.size) { vsel = false; if (cu) cu.deselect(); }
  $("btnVideo").classList.toggle("is-on", vsel);
  $("btnVideo").setAttribute("aria-pressed", String(vsel));
  renderSel(); renderProps(); updateBlockSel();
  if (libApi) libApi.refreshSelection();
}

// ---------- timeline ----------
function compatKind(a, b) {
  const g = ["graphics", "scene"];
  return a === b || (g.includes(a) && g.includes(b));
}
const gainY = (g) => clamp((GAIN_MAX - g) / (GAIN_MAX - GAIN_MIN), 0, 1) * 100; // % chiều cao clip
const clipName = (l) => (l.src || "").split("/").pop().replace(/\.[^.]+$/, "") || l.type;
function ensureAudioDefaults() {
  if (!project.audio) project.audio = { voice: { gainDb: 0, muted: false }, music: { duckDb: -12, attack: 0.15, release: 0.45 }, master: { lufs: -16, truePeak: -1.5 } };
  return project.audio;
}
const fmtDb = (g) => (g > 0 ? "+" : g < 0 ? "−" : "") + Math.abs(g).toFixed(1).replace(/\.0$/, "").replace(".", ",") + " dB";

/** Polygon đối xứng từ hàm get(i) → [min,max] đã chuẩn hoá -1..1 (viewBox N × H). */
function wavePoly(N, H, get) {
  const top = [], bot = [];
  for (let i = 0; i < N; i++) {
    const [mn, mx] = get(i);
    top.push(`${i},${(H / 2 - Math.max(0.03, mx) * H / 2).toFixed(1)}`);
    bot.unshift(`${i},${(H / 2 - Math.min(-0.03, mn) * H / 2).toFixed(1)}`);
  }
  return `<svg class="t-wave" viewBox="0 0 ${N} ${H}" preserveAspectRatio="none"><polygon points="${top.join(" ")} ${bot.join(" ")}"/></svg>`;
}
function voiceWaveSvg(dur, H) {
  if (!peaks) return "";
  const P = peaks.peaks, rate = peaks.rate || 100, n = P.length / 2;
  let gm = 1;
  if (cu) { // peaks từ video gốc (giọng chưa chuẩn hoá): chuẩn theo phân vị 98,5% để lời nói thường vẫn thấy rõ
    const ab = [];
    for (let i = 0; i < P.length; i += 5) ab.push(Math.abs(P[i]));
    ab.sort((x, y) => x - y);
    gm = Math.max(4, ab[Math.floor(ab.length * 0.985)] || 1);
  } else for (let i = 0; i < P.length; i++) gm = Math.max(gm, Math.abs(P[i]));
  const N = clamp(Math.round((dur * zoom) / 1.5), 60, 3500);
  return wavePoly(N, H, (i) => {
    const a = Math.floor((i / N) * dur * rate), b = Math.max(a + 1, Math.floor(((i + 1) / N) * dur * rate));
    let mn = 0, mx = 0;
    for (let k = a; k < b && k < n; k++) { mn = Math.min(mn, P[2 * k]); mx = Math.max(mx, P[2 * k + 1]); }
    return [Math.max(-1, mn / gm), Math.min(1, mx / gm)];
  });
}
function clipWaveSvg(l, H) {
  const NF = 600, pk = engine.bufferPeaks(l, NF), D = engine.duration(l);
  if (!pk || !D) return "";
  const a = Math.floor(((l.offset || 0) / D) * NF), b = Math.min(NF, Math.max(a + 2, Math.ceil((((l.offset || 0) + l.duration) / D) * NF)));
  let gm = 0.05;
  for (let i = a; i < b; i++) gm = Math.max(gm, Math.abs(pk[2 * i]), Math.abs(pk[2 * i + 1]));
  return wavePoly(b - a, H, (i) => [pk[2 * (a + i)] / gm, pk[2 * (a + i) + 1] / gm]);
}
function duckSvg(l, W, H) {
  const iv = engine.voiceIntervals();
  if (!iv.length) return "";
  const a = ensureAudioDefaults().music, g = l.gainDb || 0;
  const yg = (gainY(g) / 100) * H, yd = (gainY(g + a.duckDb) / 100) * H;
  const X = (time) => clamp((time - l.start) * zoom, 0, W);
  let d = `M0 ${yg.toFixed(1)}`;
  for (const [s, e] of iv) {
    if (e < l.start || s > l.start + l.duration) continue;
    d += ` L${X(s).toFixed(1)} ${yg.toFixed(1)} L${X(s + a.attack).toFixed(1)} ${yd.toFixed(1)} L${X(e).toFixed(1)} ${yd.toFixed(1)} L${X(e + a.release).toFixed(1)} ${yg.toFixed(1)}`;
  }
  d += ` L${W} ${yg.toFixed(1)}`;
  return `<svg class="t-duck" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="fill" d="${d} L${W} 0 L0 0Z"/><path class="line" d="${d}"/></svg>`;
}

function renameTrack(tr, nmEl) {
  let done = false;
  const inp = el("input", "t-field"); inp.value = tr.name; inp.style.height = "22px"; inp.setAttribute("aria-label", "Tên track");
  nmEl.replaceChildren(inp); inp.focus(); inp.select();
  const end = (ok) => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (ok && v && v !== tr.name) { pushHist(); tr.name = v; touch(); toast("Đã đổi tên track"); }
    renderTimeline();
  };
  inp.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") end(true); else if (e.key === "Escape") end(false); };
  inp.onblur = () => end(true);
  inp.onpointerdown = (e) => e.stopPropagation();
}
function tbtn(inner, pressed, title, onclick, cls = "") {
  const b = el("button", "t-tbtn " + cls, inner);
  b.setAttribute("aria-pressed", String(!!pressed)); b.title = title; b.setAttribute("aria-label", title);
  b.onclick = (e) => { e.stopPropagation(); onclick(); };
  return b;
}
function headEl(icon, name, sub, btns) {
  const head = el("div", "t-track__head", ico(icon, "t-ico t-ico--sm t-track__ico"));
  const nm = el("span", "t-track__name"); nm.innerHTML = escHtml(name) + (sub ? `<small>${escHtml(sub)}</small>` : "");
  nm.title = name;
  const bx = el("span", "t-track__btns"); btns.forEach((b) => bx.appendChild(b));
  head.append(nm, bx);
  return head;
}
const KIND_ICON = { graphics: "layers", subtitle: "text", scene: "film", sfx: "wave", music: "note" };

function renderTimeline() {
  const dur = project.duration || 1;
  const tl = $("tl");
  tl.style.setProperty("--pps", zoom + "px"); tl.style.setProperty("--head-w", TRACK_HEAD + "px");
  const inner = $("tlInner");
  inner.style.width = TRACK_HEAD + dur * zoom + 80 + "px";
  const rl = $("rulerLane");
  rl.style.width = dur * zoom + 80 + "px";
  rl.textContent = "";
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find((s) => s * zoom >= 70) || 300;
  for (let s = 0; s <= dur + 1e-6; s += step) {
    const d = el("div", "t-tick t-tick--major"); d.style.left = s * zoom + "px";
    d.innerHTML = `<span class="t-tick__t">${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}${step < 1 ? "." + Math.round((s % 1) * 10) : ""}</span>`;
    rl.appendChild(d);
    for (let k = 1; k < 5; k++) { const m = el("div", "t-tick"); m.style.left = (s + (step * k) / 5) * zoom + "px"; rl.appendChild(m); }
  }
  const rows = $("rows");
  rows.textContent = "";
  for (const tr of project.tracks) if (!AUDIO_KINDS.includes(tr.kind)) rows.appendChild(visualRow(tr, dur));
  rows.appendChild(cameraRow(dur));
  if (cu) rows.appendChild(cu.row(dur));
  rows.appendChild(voiceRow(dur));
  for (const kind of AUDIO_KINDS) {
    const trs = project.tracks.filter((x) => x.kind === kind);
    if (!trs.length) rows.appendChild(ghostRow(kind, dur));
    for (const tr of trs) rows.appendChild(audioRow(tr, dur));
  }
  placePlayhead();
  if (cu) cu.afterRender();
}

function visualRow(tr, dur) {
  const row = el("div", "t-track" + (tr.hidden ? " is-hidden" : "") + (tr.locked ? " is-locked" : ""));
  const btns = [
    tbtn(ico(tr.hidden ? "eyeoff" : "eye", "t-ico"), tr.hidden, tr.hidden ? "Hiện track" : "Ẩn track", () => { pushHist(); tr.hidden = !tr.hidden; touch(); refreshAll(); }),
    tbtn(ico("lock", "t-ico"), tr.locked, tr.locked ? "Mở khoá track" : "Khoá track", () => { pushHist(); tr.locked = !tr.locked; touch(); renderTimeline(); }),
  ];
  if (tr.kind === "graphics") btns.push(tbtn(ico("x", "t-ico"), false, "Xoá track (Ctrl+Z để hoàn tác)", () => {
    pushHist(); tr.layers.forEach((l) => sel.delete(l.id));
    project.tracks.splice(project.tracks.indexOf(tr), 1); touch(); refreshAll();
    toast(`Đã xoá track "${tr.name}"${tr.layers.length ? " cùng " + tr.layers.length + " layer" : ""} — Ctrl+Z để hoàn tác`);
  }));
  const head = headEl(KIND_ICON[tr.kind] || "layers", tr.name, "", btns);
  head.querySelector(".t-track__name").ondblclick = () => renameTrack(tr, head.querySelector(".t-track__name"));
  const lane = el("div", "t-track__lane"); lane.style.width = dur * zoom + 80 + "px"; lane.dataset.track = tr.id;
  for (const l of tr.layers) {
    if (isAudio(l)) continue;
    const kind = l.type === "subtitle" ? "subtitle" : l.type === "scene" ? "title" : "graphic";
    const b = el("div", `t-clip t-clip--${kind}` + (sel.has(l.id) ? " is-selected" : ""));
    b.dataset.id = l.id;
    b.innerHTML = `<span class="t-clip__label">${escHtml(l.text || l.templateId || l.type)}</span><i class="t-clip__edge t-clip__edge--l" data-edge="L"></i><i class="t-clip__edge t-clip__edge--r" data-edge="R"></i>`;
    b.title = `${l.type} · ${r2(l.start)} s → ${r2(l.start + l.duration)} s`;
    posBlock(b, l);
    lane.appendChild(b);
  }
  row.append(head, lane);
  return row;
}

function voiceRow(dur) {
  const a = ensureAudioDefaults(), v = a.voice;
  const row = el("div", "t-track t-track--voice");
  const head = headEl("mic", "Giọng", "Gốc · " + fmtDb(v.gainDb), [
    tbtn("M", v.muted, v.muted ? "Bật tiếng giọng" : "Tắt tiếng giọng", () => { pushHist(); v.muted = !v.muted; touch(); engine.applyVoice(); renderTimeline(); }, "t-tbtn--mute"),
    tbtn("S", soloSet.has("voice"), "Solo giọng (chỉ nghe thử)", () => toggleSolo("voice"), "t-tbtn--solo"),
    tbtn(ico("lock", "t-ico"), true, "Track cố định", () => {}),
  ]);
  const lane = el("div", "t-track__lane"); lane.style.width = dur * zoom + 80 + "px";
  const c = el("div", "t-clip t-clip--audio"); c.id = "voiceClip";
  c.style.left = "0px"; c.style.width = dur * zoom + "px";
  c.innerHTML = `${voiceWaveSvg(dur, 36)}<span class="t-clip__label">${escHtml(project.source.audio || project.source.video)}</span><div class="t-gain" style="--y:${gainY(v.gainDb || 0)}%"></div><span class="gainnum">${fmtDb(v.gainDb)}</span>`;
  c.querySelector(".t-wave") && (c.querySelector(".t-wave").style.padding = "16px 0 0");
  lane.appendChild(c);
  row.append(head, lane);
  return row;
}
function cameraRow(dur) {
  ensureMoveIds(); ensureShiftIds();
  const row = el("div", "t-track t-track--cam");
  const n = project.videoMoves.length, ns = project.videoShifts.length;
  const btns = [tbtn(ico("plus", "t-ico"), false, "Thêm zoom nhấn tại playhead (1,2× trong 2 s)", addZoomPunch)];
  if (hasCap("camera")) btns.unshift(tbtn(ico("sparkle", "t-ico"), aiOn(), aiOn() ? "Máy quay tự động: BẬT (bấm để tắt — bỏ qua mọi zoom/dịch do AI)" : "Máy quay tự động: TẮT (bấm để bật lại)", toggleAi, "t-tbtn--ai"));
  const head = headEl("crop", "Máy quay", n + ns ? `${n} zoom · ${ns} dịch${aiOn() ? "" : " · AI tắt"}` : "zoom / ken burns", btns);
  const lane = el("div", "t-track__lane"); lane.style.width = dur * zoom + 80 + "px"; lane.dataset.cam = "1";
  for (const m of project.videoMoves) {
    const c = el("div", "t-clip t-clip--video" + (sel.has(m.id) ? " is-selected" : "") + (m.source === "ai" ? " is-ai" + (aiOn() ? "" : " is-off") : "")); c.dataset.id = m.id; c.dataset.kind = "move";
    c.innerHTML = `<span class="t-clip__label" style="position:relative;left:0;top:0;background:none;color:inherit">${m.mode === "zoom" ? "Zoom" : m.mode === "kenburns" ? "Ken Burns" : "PiP"} ${m.mode === "pip" ? "" : (+m.scale).toFixed(2).replace(".", ",") + "×"}</span><i class="t-clip__edge t-clip__edge--l" data-edge="L"></i><i class="t-clip__edge t-clip__edge--r" data-edge="R"></i>`;
    c.title = `${m.mode} · ${r2(m.start)} → ${r2(m.end)} s`;
    c.style.left = m.start * zoom + "px"; c.style.width = Math.max(4, (m.end - m.start) * zoom) + "px";
    lane.appendChild(c);
  }
  for (const m of project.videoShifts) { // dịch ngang người nói (cộng thêm lên khung + zoom); được chồng thời gian với zoom
    const c = el("div", "t-clip t-clip--video t-clip--shift" + (sel.has(m.id) ? " is-selected" : "") + (m.source === "ai" ? " is-ai" + (aiOn() ? "" : " is-off") : "")); c.dataset.id = m.id; c.dataset.kind = "shift";
    c.innerHTML = `<span class="t-clip__label" style="position:relative;left:0;top:0;background:none;color:inherit">Dịch ${m.x >= 0 ? "→" : "←"} ${Math.abs(m.x).toFixed(1).replace(".", ",")}%</span><i class="t-clip__edge t-clip__edge--l" data-edge="L"></i><i class="t-clip__edge t-clip__edge--r" data-edge="R"></i>`;
    c.title = `dịch x ${m.x}% · ${r2(m.start)} → ${r2(m.end)} s${m.source === "ai" ? " · do AI" : ""}`;
    c.style.left = m.start * zoom + "px"; c.style.width = Math.max(4, (m.end - m.start) * zoom) + "px";
    lane.appendChild(c);
  }
  row.append(head, lane);
  return row;
}
function toggleSolo(key) {
  soloSet.has(key) ? soloSet.delete(key) : soloSet.add(key);
  engine.applyVoice(); audioChanged(true); renderTimeline();
}
function ghostRow(kind, dur) {
  const row = el("div", `t-track t-track--${kind} is-ghost`);
  row.appendChild(headEl(KIND_ICON[kind], kind === "sfx" ? "SFX" : "Nhạc", "chưa có track", []));
  const lane = el("div", "t-track__lane"); lane.style.width = dur * zoom + 80 + "px"; lane.dataset.ghost = kind;
  row.appendChild(lane);
  return row;
}
function audioRow(tr, dur) {
  const row = el("div", `t-track t-track--${tr.kind}` + (tr.hidden ? " is-hidden" : "") + (tr.locked ? " is-locked" : ""));
  const a = ensureAudioDefaults();
  const sub = tr.kind === "music" ? `Ducking ${fmtDb(a.music.duckDb)}` : `${tr.layers.length} clip`;
  const head = headEl(KIND_ICON[tr.kind], tr.name, sub, [
    tbtn("M", tr.hidden, tr.hidden ? "Bật tiếng track" : "Tắt tiếng track (ẩn khỏi bản mix)", () => { pushHist(); tr.hidden = !tr.hidden; touch(); renderTimeline(); }, "t-tbtn--mute"),
    tbtn("S", soloSet.has("trk:" + tr.id), "Solo track (chỉ nghe thử)", () => toggleSolo("trk:" + tr.id), "t-tbtn--solo"),
    tbtn(ico("lock", "t-ico"), tr.locked, tr.locked ? "Mở khoá track" : "Khoá track", () => { pushHist(); tr.locked = !tr.locked; touch(); renderTimeline(); }),
  ]);
  head.querySelector(".t-track__name").ondblclick = () => renameTrack(tr, head.querySelector(".t-track__name"));
  const lane = el("div", "t-track__lane"); lane.style.width = dur * zoom + 80 + "px"; lane.dataset.track = tr.id;
  const H = tr.kind === "music" ? 42 : 30;
  for (const l of tr.layers) {
    if (!isAudio(l)) continue;
    const c = el("div", `t-clip t-clip--audio t-clip--${tr.kind === "music" ? "music" : "sfx"}` + (sel.has(l.id) ? " is-selected" : ""));
    c.dataset.id = l.id;
    const W = Math.max(8, l.duration * zoom);
    const linked = l.meta && l.meta.linkedLayerId;
    const fi = Math.min(l.fadeIn || 0, l.duration) * zoom, fo = Math.min(l.fadeOut || 0, l.duration) * zoom;
    c.innerHTML = `${clipWaveSvg(l, H)}${tr.kind === "music" ? duckSvg(l, W, H) : ""}` +
      `<span class="t-clip__label">${linked ? ico("link", "t-ico lnk") : ""}${escHtml(clipName(l))}</span>` +
      (fi > 1 ? `<i class="t-fade-shade t-fade-shade--in" style="width:${fi}px"></i>` : "") + (fo > 1 ? `<i class="t-fade-shade t-fade-shade--out" style="width:${fo}px"></i>` : "") +
      `<i class="t-fade t-fade--in" data-fade="in"></i><i class="t-fade t-fade--out" data-fade="out"></i>` +
      `<div class="t-gain" style="--y:${gainY(l.gainDb || 0)}%"></div><span class="gainnum">${fmtDb(l.gainDb || 0)}</span>` +
      loopMarks(l) +
      `<i class="t-clip__edge t-clip__edge--l" data-edge="L"></i><i class="t-clip__edge t-clip__edge--r" data-edge="R"></i>`;
    c.title = `${clipName(l)} · ${r2(l.start)} s → ${r2(l.start + l.duration)} s · ${fmtDb(l.gainDb || 0)}${linked ? " · liên kết " + l.meta.linkedLayerId : ""}`;
    posBlock(c, l);
    lane.appendChild(c);
  }
  row.append(head, lane);
  return row;
}
/** Nhạc lặp (meta.loop): vạch ↻ tại mỗi điểm nối lặp (độ dài file nguồn đã biết). */
function loopMarks(l) {
  if (!(l.meta && l.meta.loop)) return "";
  const D = engine.duration(l);
  if (!D) return "";
  const off = l.offset || 0;
  let x = D - off, out = "";
  if (D <= 0.2) return "";
  while (x < l.duration - 0.05 && out.length < 40000) { out += `<i class="loop-mark" style="left:${x * zoom}px"></i>`; x += D; }
  return out;
}
function posBlock(b, l) {
  b.style.left = l.start * zoom + "px";
  b.style.width = Math.max(4, l.duration * zoom) + "px";
}
function updateBlockSel() {
  for (const b of document.querySelectorAll(".t-clip[data-id]")) b.classList.toggle("is-selected", sel.has(b.dataset.id));
}
function updateBlocks() {
  for (const b of document.querySelectorAll(".t-clip[data-id]")) { const f = find(b.dataset.id); if (f) posBlock(b, f.l); }
}

// ---- kéo clip ----
let tdrag = null, fdrag = null, gdrag = null, mdrag = null;
function doMoveDrag(e) {
  const d = mdrag, m = d.m;
  if (!d.moved) { if (Math.abs(e.clientX - d.sx) < 3) return; pushHist(); d.moved = true; markUser(m); }
  const dt = (e.clientX - d.sx) / zoom, len = d.orig.end - d.orig.start;
  const others = d.shift ? [] : project.videoMoves.filter((x) => x !== m);
  const prevEnd = Math.max(0, ...others.filter((x) => x.end <= d.orig.start + 1e-6).map((x) => x.end));
  const nextStart = Math.min(project.duration, ...others.filter((x) => x.start >= d.orig.end - 1e-6).map((x) => x.start));
  if (d.mode === "move") { const ns = clamp(d.orig.start + dt, prevEnd, nextStart - len); m.start = r2(ns); m.end = r2(ns + len); }
  else if (d.mode === "L") m.start = r2(clamp(d.orig.start + dt, prevEnd, d.orig.end - 0.3));
  else m.end = r2(clamp(d.orig.end + dt, d.orig.start + 0.3, nextStart));
  d.clip.style.left = m.start * zoom + "px"; d.clip.style.width = Math.max(4, (m.end - m.start) * zoom) + "px";
  layoutVideo(); refreshPanelValues();
  dragTip(`${r2(m.start)} → ${r2(m.end)} s`, e);
}
function showSnap(time) {
  let s = document.getElementById("snapLine");
  if (time == null) { if (s) s.style.display = "none"; return; }
  if (!s) { s = el("div", "t-snap"); s.id = "snapLine"; $("tlInner").appendChild(s); }
  s.style.display = "block"; s.style.left = TRACK_HEAD + time * zoom + "px";
}
function dragTip(text, e) {
  const d = $("dragTip");
  if (!text) { d.style.display = "none"; return; }
  const r = $("tlInner").getBoundingClientRect();
  d.textContent = text; d.style.display = "block";
  d.style.left = e.clientX - r.left + 12 + "px"; d.style.top = e.clientY - r.top - 28 + "px";
}
$("rows").addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const clip = e.target.closest(".t-clip");
  if (!clip) { if (e.target.closest(".t-track--voice, .t-track__lane[data-ghost]")) { if (!e.target.closest(".t-track__head")) { /* vùng trống: bỏ chọn xử lý ở tlScroll */ } } return; }
  if (clip.id === "voiceClip") {
    if (e.target.closest(".t-gain")) { gdrag = { id: "voice", clip, rect: clip.getBoundingClientRect() }; e.preventDefault(); return; }
    scrub = true; scrubTo(e.clientX); return;
  }
  if (clip.dataset.kind === "move" || clip.dataset.kind === "shift") { // đoạn máy quay: chọn + kéo dời / đổi mép (zoom không chồng nhau; dịch được chồng)
    const isShift = clip.dataset.kind === "shift";
    const m = isShift ? findShift(clip.dataset.id) : findMove(clip.dataset.id);
    if (!m) return;
    if (e.shiftKey) { sel.has(m.id) ? sel.delete(m.id) : sel.add(m.id); } else if (!sel.has(m.id)) { sel.clear(); sel.add(m.id); }
    selectionChanged();
    mdrag = { m, shift: isShift, mode: e.target.dataset.edge || "move", sx: e.clientX, orig: { start: m.start, end: m.end }, moved: false, clip };
    e.preventDefault();
    return;
  }
  const id = clip.dataset.id, f = find(id);
  if (!f) return;
  if (e.shiftKey) { sel.has(id) ? sel.delete(id) : sel.add(id); }
  else if (!sel.has(id)) { sel.clear(); sel.add(id); }
  selectionChanged();
  if (!sel.has(id) || f.tr.locked) return;
  const fadeEl = e.target.closest(".t-fade");
  if (fadeEl) { fdrag = { id, edge: fadeEl.dataset.fade, clip, rect: clip.getBoundingClientRect(), moved: false }; e.preventDefault(); return; }
  if (e.target.closest(".t-gain")) { gdrag = { id, clip, rect: clip.getBoundingClientRect(), moved: false }; e.preventDefault(); return; }
  const edge = e.target.dataset.edge || null;
  const origs = new Map(selLayers().filter(({ tr }) => !tr.locked).map(({ l }) => [l.id, { start: l.start, duration: l.duration, offset: l.offset || 0 }]));
  // SFX liên kết với layer đồ hoạ đang kéo → đi theo
  const links = [];
  for (const { l: a } of allLayers()) {
    if (!isAudio(a) || origs.has(a.id) || !a.meta || !a.meta.linkedLayerId || !origs.has(a.meta.linkedLayerId)) continue;
    links.push({ l: a, start0: a.start, edge: a.meta.linkEdge || "in", of: a.meta.linkedLayerId });
  }
  tdrag = { mode: edge || "move", sx: e.clientX, sy: e.clientY, ref: id, origs, links, moved: false, srcTrack: f.tr.id, target: null };
  e.preventDefault();
});

window.addEventListener("pointermove", (e) => {
  if (scrub) { scrubTo(e.clientX); return; }
  if (mdrag) { doMoveDrag(e); return; }
  if (fdrag) { doFade(e); return; }
  if (gdrag) { doGain(e); return; }
  if (!tdrag) return;
  let dt = (e.clientX - tdrag.sx) / zoom;
  if (!tdrag.moved && Math.hypot(e.clientX - tdrag.sx, e.clientY - tdrag.sy) < 3) return;
  if (!tdrag.moved) {
    pushHist(); tdrag.moved = true;
    // kéo tay SFX có liên kết = bỏ liên kết (người dùng đã quyết định vị trí)
    for (const id of tdrag.origs.keys()) {
      const l = find(id).l;
      if (isAudio(l) && l.meta && l.meta.linkedLayerId) { delete l.meta.linkedLayerId; delete l.meta.linkEdge; l.meta.source = "user"; }
    }
  }
  const ro = tdrag.origs.get(tdrag.ref);
  const doSnap = snapOn && !e.altKey, thr = 8 / zoom;
  let snapAt = null;
  if (doSnap && ro) {
    const pts = [t, 0, project.duration];
    for (const { l } of allLayers()) if (!tdrag.origs.has(l.id)) pts.push(l.start, l.start + l.duration);
    const cands = tdrag.mode === "move" ? [ro.start, ro.start + ro.duration] : tdrag.mode === "L" ? [ro.start] : [ro.start + ro.duration];
    let best = null;
    for (const c of cands) for (const p of pts) { const d = p - (c + dt); if (Math.abs(d) < thr && (best === null || Math.abs(d) < Math.abs(best.d))) best = { d, p }; }
    if (best) { dt += best.d; snapAt = best.p; }
  }
  showSnap(snapAt);
  const delta = new Map();
  for (const [id, o] of tdrag.origs) {
    const l = find(id).l;
    if (tdrag.mode === "move") l.start = r2(Math.max(0, o.start + dt));
    else if (tdrag.mode === "R") {
      let d = Math.max(0.05, o.duration + dt);
      if (isAudio(l)) { const D = engine.duration(l); if (D) d = Math.min(d, D - o.offset); }
      l.duration = r2(d);
    } else {
      const end = o.start + o.duration;
      let lo = 0;
      if (isAudio(l)) lo = Math.max(0, o.start - o.offset); // không kéo đầu clip lùi quá đầu file nguồn
      const ns = clamp(o.start + dt, lo, end - 0.05);
      if (isAudio(l)) l.offset = r2(o.offset + (ns - o.start));
      l.start = r2(ns); l.duration = r2(end - ns);
    }
    delta.set(id, { ds: l.start - o.start, de: l.start + l.duration - (o.start + o.duration) });
  }
  for (const lk of tdrag.links) {
    const d = delta.get(lk.of); if (!d) continue;
    const shift = lk.edge === "out" ? d.de : d.ds;
    lk.l.start = r2(Math.max(0, lk.start0 + shift));
  }
  updateBlocks(); ov.seek(t); renderSel(); refreshPanelValues();
  dragTip(`${r2(find(tdrag.ref).l.start)} → ${r2(find(tdrag.ref).l.start + find(tdrag.ref).l.duration)} s`, e);
  if (tdrag.origs.size === 1 && tdrag.mode === "move") {
    const ln = document.elementFromPoint(e.clientX, e.clientY)?.closest(".t-track__lane");
    const cand = ln && ln.dataset.track && ln.dataset.track !== tdrag.srcTrack ? project.tracks.find((x) => x.id === ln.dataset.track) : null;
    const src = project.tracks.find((x) => x.id === tdrag.srcTrack);
    tdrag.target = cand && !cand.locked && compatKind(src.kind, cand.kind) ? cand.id : null;
    document.querySelectorAll(".t-track").forEach((x) => x.classList.toggle("t-track--drop", !!tdrag.target && x.querySelector(".t-track__lane")?.dataset.track === tdrag.target));
  }
});
window.addEventListener("pointerup", () => {
  scrub = false;
  if (mdrag) { if (mdrag.moved) { project.videoMoves = sortedMoves(); project.videoShifts = sortedShifts(); touch(); renderTimeline(); } dragTip(null); mdrag = null; }
  if (fdrag) { if (fdrag.moved) touch(); fdrag = null; renderTimeline(); }
  if (gdrag) { if (gdrag.moved) touch(); gdrag = null; document.querySelectorAll(".show-gain").forEach((x) => x.classList.remove("show-gain")); renderTimeline(); }
  if (tdrag && tdrag.moved) {
    if (tdrag.target) {
      const f = find(tdrag.ref), dest = project.tracks.find((x) => x.id === tdrag.target);
      if (f && dest) { f.tr.layers.splice(f.tr.layers.indexOf(f.l), 1); dest.layers.push(f.l); }
    }
    touch();
    renderTimeline();
  }
  if (tdrag) { showSnap(null); dragTip(null); ov.update(project); }
  document.querySelectorAll(".t-track--drop").forEach((x) => x.classList.remove("t-track--drop"));
  tdrag = null;
});

function doFade(e) {
  const f = find(fdrag.id); if (!f) return;
  const l = f.l, r = fdrag.rect;
  if (!fdrag.moved) { pushHist(); fdrag.moved = true; }
  if (fdrag.edge === "in") l.fadeIn = r2(clamp((e.clientX - r.left) / zoom, 0, Math.max(0, l.duration - (l.fadeOut || 0))));
  else l.fadeOut = r2(clamp((r.right - e.clientX) / zoom, 0, Math.max(0, l.duration - (l.fadeIn || 0))));
  const shade = (k, w) => { const s = fdrag.clip.querySelector(".t-fade-shade--" + k); if (s) s.style.width = w * zoom + "px"; else if (w > 0.01) { const n = el("i", "t-fade-shade t-fade-shade--" + k); n.style.width = w * zoom + "px"; fdrag.clip.prepend(n); } };
  shade(fdrag.edge, fdrag.edge === "in" ? l.fadeIn : l.fadeOut);
  dragTip(`${fdrag.edge === "in" ? "Fade vào" : "Fade ra"} ${(fdrag.edge === "in" ? l.fadeIn : l.fadeOut).toFixed(2).replace(".", ",")} s`, e);
  refreshPanelValues();
}
function doGain(e) {
  const r = gdrag.rect;
  const g = Math.round((GAIN_MAX - clamp((e.clientY - r.top) / r.height, 0, 1) * (GAIN_MAX - GAIN_MIN)) * 2) / 2;
  if (!gdrag.moved) { pushHist(); gdrag.moved = true; }
  if (gdrag.id === "voice") ensureAudioDefaults().voice.gainDb = g;
  else { const f = find(gdrag.id); if (!f) return; f.l.gainDb = g; }
  gdrag.clip.classList.add("show-gain");
  gdrag.clip.querySelector(".t-gain").style.setProperty("--y", gainY(g) + "%");
  gdrag.clip.querySelector(".gainnum").textContent = fmtDb(g);
  dragTip(fmtDb(g), e);
  refreshPanelValues();
}

let scrub = false;
function scrubTo(clientX) {
  const rect = $("rulerLane").getBoundingClientRect();
  if (playing) pause();
  setTime((clientX - rect.left) / zoom);
}
$("rulerLane").addEventListener("pointerdown", (e) => { scrub = true; scrubTo(e.clientX); });
document.querySelector(".ph-head").style.pointerEvents = "auto";
document.querySelector(".ph-head").addEventListener("pointerdown", (e) => { scrub = true; e.preventDefault(); });

$("tlScroll").addEventListener("wheel", (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  const sc = $("tlScroll");
  const rect = sc.getBoundingClientRect();
  if (!zoomJob) zoomJob = { tAt: (e.clientX - rect.left + sc.scrollLeft - TRACK_HEAD) / zoom, off: e.clientX - rect.left, raf: 0 };
  zoomJob.off = e.clientX - rect.left;
  zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0015), 6, 800); // cộng dồn; vẽ lại một lần/khung
  if (!zoomJob.raf) zoomJob.raf = requestAnimationFrame(() => {
    const j = zoomJob; zoomJob = null;
    renderTimeline();
    sc.scrollLeft = j.tAt * zoom + TRACK_HEAD - j.off;
  });
}, { passive: false });
let zoomJob = null;

// ---------- thao tác layer ----------
function nextId(prefix = "L") {
  let m = 0;
  const re = new RegExp("^" + prefix + "-(\\d+)$");
  for (const { l } of allLayers()) { const n = re.exec(l.id); if (n) m = Math.max(m, +n[1]); }
  return prefix + "-" + String(m + 1).padStart(4, "0");
}
function baseStyle() {
  return { fontFamily: "Be Vietnam Pro", fontSize: 64, fontWeight: 800, color: "#EDEDED", accentColor: "#C5A059",
    background: "rgba(12,12,12,0.72)", align: "center", radius: 16, padding: 24, strokeColor: null, strokeWidth: 0, shadow: true };
}
function graphicsTrack() {
  const first = selLayers().find(({ l }) => !isAudio(l));
  if (first && !first.tr.locked && first.tr.kind !== "subtitle") return first.tr;
  let tr = project.tracks.find((x) => x.kind === "graphics" && !x.locked);
  if (!tr) {
    tr = { id: "t-gfx-" + Date.now().toString(36), kind: "graphics", name: "Đồ hoạ", hidden: false, locked: false, layers: [] };
    project.tracks.unshift(tr);
  }
  return tr;
}
function ensureAudioTrack(kind) {
  let tr = project.tracks.find((x) => x.kind === kind && !x.locked);
  if (!tr) {
    tr = { id: "t-" + kind + "-" + Date.now().toString(36), kind, name: kind === "sfx" ? "SFX" : "Nhạc", hidden: false, locked: false, layers: [] };
    project.tracks.push(tr);
  }
  return tr;
}
function addLayer(type, opts = {}) {
  pushHist();
  const tr = type === "scene" ? project.tracks.find((x) => x.kind === "scene" && !x.locked) || graphicsTrack() : graphicsTrack();
  const st0 = opts.start != null ? opts.start : t;
  const dur = Math.max(0.5, Math.min(3, (project.duration || 3) - st0));
  const common = { id: nextId(), type, start: r2(st0), duration: r2(dur), rotation: 0, opacity: 1, meta: { source: "user" } };
  let l;
  const ly = layoutFor(type, project.aspect);
  if (type === "text") l = { ...common, ...ly, text: "Chữ mới", style: baseStyle(), animation: { in: { kind: "rise", dur: 0.45 }, out: { kind: "fade", dur: 0.3 } } };
  else if (type === "callout") l = { ...common, ...ly, text: "Callout", style: { ...baseStyle(), fontSize: 52, background: "rgba(12,12,12,0.85)" }, animation: { in: { kind: "pop", dur: 0.45 }, out: { kind: "shrink", dur: 0.3 } } };
  else if (type === "scene") l = { ...common, ...ly, duration: r2(Math.max(0.5, Math.min(4, (project.duration || 4) - st0))), templateId: opts.templateId || meta.templates[0] || "", inputs: {}, style: { ...baseStyle(), radius: project.aspect === "16:9" ? 24 : 0 }, animation: { in: { kind: "fade", dur: 0.3 }, out: { kind: "fade", dur: 0.3 } } };
  else l = { ...common, ...ly, text: "Họ và tên", subtext: "Chức danh", style: { ...baseStyle(), fontSize: 48, align: "left", radius: 10, padding: 22 }, animation: { in: { kind: "left", dur: 0.5 }, out: { kind: "fade", dur: 0.3 } } };
  tr.layers.push(l);
  sel.clear(); sel.add(l.id);
  touch(); refreshAll();
}

/** Thư viện: thêm layer đã dựng sẵn (từ /api/preset/apply asNew) vào track phù hợp. */
function addLayers(layers) {
  pushHist();
  sel.clear();
  for (const l0 of layers) {
    const l = { ...l0, id: nextId(), meta: { ...(l0.meta || {}), source: "user" } };
    let tr;
    if (l.type === "subtitle") tr = project.tracks.find((x) => x.kind === "subtitle" && !x.locked);
    if (!tr) tr = graphicsTrack();
    tr.layers.push(l);
    sel.add(l.id);
  }
  touch(); refreshAll();
}
/** Thư viện: thay layer theo id (kết quả áp preset). Giữ thứ tự và track. */
function replaceLayers(layers) {
  pushHist();
  for (const nl of layers) {
    const f = find(nl.id);
    if (f) f.tr.layers[f.tr.layers.indexOf(f.l)] = nl;
  }
  touch(); refreshAll();
}
function addAudio(kind, item, startT) {
  pushHist();
  const tr = ensureAudioTrack(kind);
  const st0 = Math.max(0, startT || 0);
  const full = item.duration || 3;
  let src = item.src || item.file || "";
  if (kind === "music" && src && !src.startsWith("assets/")) src = "assets/music-th/" + src;
  const dur = kind === "music" ? Math.max(0.5, Math.min(full, (project.duration || full) - st0)) : full;
  const l = { id: nextId("A"), type: "audio", start: r2(st0), duration: r2(dur), x: 0, y: 0, w: 0, h: 0, rotation: 0, opacity: 1,
    src, offset: 0, gainDb: kind === "music" ? -8 : -6, fadeIn: 0, fadeOut: kind === "music" ? Math.min(1.5, dur / 2) : 0.03,
    meta: { category: item.category || item.mood, source: "user" } };
  tr.layers.push(l);
  sel.clear(); sel.add(l.id);
  touch(); refreshAll();
  toast(`Đã thêm ${kind === "music" ? "nhạc" : "SFX"} "${clipName(l)}" tại ${r2(st0)} s`);
}
function dupSel() {
  const items = selLayers().filter(({ tr }) => !tr.locked);
  if (!items.length) return;
  pushHist();
  const ns = [];
  for (const { tr, l } of items) {
    const c = clone(l);
    c.id = nextId(isAudio(l) ? "A" : "L");
    const delta = l.duration;
    c.start = r2(l.start + delta);
    if (c.meta) { delete c.meta.linkedLayerId; delete c.meta.linkEdge; }
    if (c.words) c.words = c.words.map((w) => ({ ...w, start: r2(w.start + delta), end: r2(w.end + delta) }));
    tr.layers.splice(tr.layers.indexOf(l) + 1, 0, c);
    ns.push(c.id);
  }
  sel.clear(); ns.forEach((i) => sel.add(i));
  touch(); refreshAll();
}
function delSel() {
  const shf = selShifts();
  if (shf.length) { pushHist(); project.videoShifts = project.videoShifts.filter((x) => !sel.has(x.id)); shf.forEach((m) => sel.delete(m.id)); touch(); refreshAll(); return; }
  const mv = selMoves();
  if (mv.length) { pushHist(); project.videoMoves = project.videoMoves.filter((x) => !sel.has(x.id)); mv.forEach((m) => sel.delete(m.id)); touch(); refreshAll(); return; }
  const items = selLayers().filter(({ tr }) => !tr.locked);
  if (!items.length) return;
  pushHist();
  for (const { tr, l } of items) { tr.layers.splice(tr.layers.indexOf(l), 1); sel.delete(l.id); }
  touch(); refreshAll();
}
function applyToTrack() {
  const first = selLayers().find(({ l }) => !isAudio(l));
  if (!first || first.tr.locked) return;
  const n = first.tr.layers.length - 1;
  pushHist();
  for (const l of first.tr.layers) {
    if (l === first.l) continue;
    l.style = clone(first.l.style || baseStyle());
    l.animation = clone(first.l.animation || {});
  }
  touch(); refreshAll(); toast(`Đã áp style cho ${n} layer khác trong track (Ctrl+Z để hoàn tác)`);
}

// ---------- bảng thuộc tính ----------
function parseColor(str) {
  if (!str || str === "transparent") return { hex: "#000000", a: 0 };
  let m = /^#([0-9a-f]{3})$/i.exec(str);
  if (m) return { hex: "#" + m[1].split("").map((c) => c + c).join("").toLowerCase(), a: 1 };
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(str);
  if (m) return { hex: "#" + m[1].toLowerCase(), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(str);
  if (m) return { hex: "#" + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, "0")).join(""), a: m[4] == null ? 1 : +m[4] };
  return { hex: "#000000", a: 1 };
}
function toCss(hex, a) {
  if (a >= 1) return hex;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${r2(a)})`;
}

function applyField(path, val) {
  pushHist("f:" + path);
  for (const { l } of selLayers()) {
    if (find(l.id).tr.locked) continue;
    if (path === "draw.on") { if (val) l.draw = l.draw || { dur: 0.8 }; else delete l.draw; continue; }
    if (path === "draw.dur") { l.draw = { dur: Math.max(0.1, +val || 0.8) }; continue; }
    if (path === "animation.loop.kind" && !(l.animation && l.animation.loop)) { l.animation = l.animation || {}; l.animation.loop = { kind: val, period: 2.4, amp: 1 }; continue; }
    setp(l, path, val);
    if (path === "text" && l.type === "subtitle" && l.words && l.words.length) l.words = alignWords(l.words, val);
  }
  touch();
  ov.update(project); renderSel();
  const p = path.split(".")[0];
  if (["start", "duration", "offset"].includes(p)) updateBlocks();
  if (path === "text") { for (const b of document.querySelectorAll(".t-clip[data-id]")) { const f = find(b.dataset.id); const lb = b.querySelector(".t-clip__label"); if (f && lb && !isAudio(f.l)) lb.textContent = f.l.text || f.l.templateId || f.l.type; } }
  if (["gainDb", "fadeIn", "fadeOut"].includes(p)) renderTimeline();
  refreshPanelValues();
}

// ---- khối điều khiển (Tahoe) ----
function group(parent, title, icon, open) {
  const d = el("details", "t-group");
  if (open) d.open = true;
  d.innerHTML = `<summary>${ico(icon, "t-ico")}${escHtml(title)}${ico("chev", "t-ico t-chev")}</summary><div class="t-group__body"></div>`;
  parent.appendChild(d);
  return d.querySelector(".t-group__body");
}
function propRow(g, label, ...els) {
  const row = el("div", "t-prop");
  const lb = el("label"); lb.textContent = label;
  const box = el("div", "t-prop__ctl");
  els.forEach((c) => box.appendChild(c));
  row.append(lb, box); g.appendChild(row);
  return box;
}
function firstVal(path) { const f = selLayers()[0]; return f ? getp(f.l, path) : undefined; }
const fillP = (r) => r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min)) * 100 + "%");

function numCtl(g, label, path, o = {}) {
  const inp = el("input", "t-field"); inp.type = "number"; inp.step = o.step || "any";
  if (o.min != null) inp.min = o.min; if (o.max != null) inp.max = o.max;
  inp.oninput = () => { const v = parseFloat(inp.value); if (!Number.isNaN(v)) applyField(path, o.int ? Math.round(v) : v); };
  propRow(g, label, inp);
  panelCtl.push({ el: inp, refresh: () => { const v = firstVal(path); inp.value = v == null ? (o.def ?? "") : r2(v); } });
}
function selCtl(g, label, path, options, o = {}) {
  const s = el("select", "t-field");
  for (const op of options) { const e = document.createElement("option"); e.value = String(op.v ?? op); e.textContent = op.t ?? op; s.appendChild(e); }
  s.onchange = () => applyField(path, o.num ? +s.value : s.value);
  const w = el("div", "t-select grow"); w.appendChild(s);
  propRow(g, label, w);
  panelCtl.push({ el: s, refresh: () => { const v = firstVal(path); s.value = v == null ? "" : String(v); } });
}
function txtCtl(g, label, path, multi) {
  const inp = el(multi ? "textarea" : "input", "t-field");
  if (!multi) inp.type = "text";
  inp.oninput = () => applyField(path, inp.value);
  if (multi) { const row = el("div", "t-prop t-prop--top"); const lb = el("label"); lb.textContent = label; row.append(lb, inp); g.appendChild(row); }
  else propRow(g, label, inp);
  panelCtl.push({ el: inp, refresh: () => { inp.value = firstVal(path) ?? ""; } });
}
function colorCtl(g, label, path, o = {}) {
  const cp = el("input", "colorpick"); cp.type = "color";
  const cur = () => firstVal(path);
  let tx = null, al = null, lab = null;
  const ctls = [cp];
  if (o.alpha) { // nền: ô màu + thanh trượt độ đục 0–100 %, lưu dạng rgba()
    al = el("input", "t-slider"); al.type = "range"; al.min = 0; al.max = 100; al.step = 1; al.title = "Độ đục nền (%)";
    lab = el("span", "t-num"); lab.style.cssText = "width:38px;text-align:right;color:var(--label-2);font-size:var(--fs-12)";
    ctls.push(al, lab);
  } else { tx = el("input", "t-field"); tx.type = "text"; ctls.push(tx); }
  cp.oninput = () => {
    const pc = parseColor(cur());
    const v = toCss(cp.value, o.alpha && cur() ? pc.a : 1);
    if (tx) tx.value = v;
    if (al) { al.value = Math.round(parseColor(v).a * 100); lab.textContent = al.value + "%"; fillP(al); }
    applyField(path, v);
  };
  if (tx) tx.oninput = () => { const v = tx.value.trim(); if (!v && o.nullable) { applyField(path, null); return; } if (v && /^(#|rgb|transparent)/i.test(v)) { cp.value = parseColor(v).hex; applyField(path, v); } };
  if (al) al.oninput = () => { const pc = parseColor(cur()); lab.textContent = al.value + "%"; fillP(al); applyField(path, toCss(pc.hex, clamp((parseFloat(al.value) || 0) / 100, 0, 1))); };
  const box = propRow(g, label, ...ctls);
  const sw = el("div", "t-swatches row");
  const pal = meta.palette || {};
  const colors = [pal.accent, pal.accentLight, pal.text, pal.ink, pal.surface, pal.textSecondary, "#E05A4B", "#FFFFFF"].filter(Boolean);
  for (const c of colors) {
    const i = el("span", "t-swatch"); i.style.setProperty("--c", c); i.title = c;
    i.onclick = () => { const v = o.alpha && cur() ? toCss(parseColor(c).hex, parseColor(cur()).a || 1) : c; applyField(path, v); sync(); };
    sw.appendChild(i);
  }
  g.appendChild(sw);
  function sync() {
    const v = cur();
    const pc = parseColor(v); cp.value = pc.hex;
    if (tx) tx.value = v ?? "";
    if (al) { al.value = Math.round(pc.a * 100); lab.textContent = al.value + "%"; fillP(al); }
  }
  panelCtl.push({ el: box, refresh: sync });
}
function rangeCtl(g, label, path, min, max, step, fmt) {
  const r = el("input", "t-slider"); r.type = "range"; r.min = min; r.max = max; r.step = step;
  const n = el("span", "t-num"); n.style.cssText = "width:54px;text-align:right;color:var(--label-2);font-size:var(--fs-12)";
  r.oninput = () => { fillP(r); n.textContent = fmt ? fmt(+r.value) : r2(+r.value); applyField(path, +r.value); };
  propRow(g, label, r, n);
  panelCtl.push({ el: r, refresh: () => { const v = firstVal(path) ?? (min <= 0 && max >= 0 && path.includes("gain") ? 0 : 1); r.value = v; fillP(r); n.textContent = fmt ? fmt(v) : r2(v); } });
}
function chkCtl(g, label, path, def = false, hint = "") {
  const w = el("label", "t-switch");
  const c = el("input"); c.type = "checkbox"; c.setAttribute("role", "switch"); c.setAttribute("aria-label", label);
  w.append(c, el("i"));
  c.onchange = () => applyField(path, c.checked);
  const row = propRow(g, label, w);
  if (hint) { const h = el("span"); h.style.cssText = "color:var(--label-2);font-size:var(--fs-12)"; h.textContent = hint; row.appendChild(h); }
  panelCtl.push({ el: c, refresh: () => { const v = firstVal(path); c.checked = v == null ? def : !!v; } });
}
// điều khiển gắn vào project (không phải layer): path kiểu "audio.voice.gainDb"
function projCtl(g, label, path, min, max, step, fmt, extra) {
  const r = el("input", "t-slider"); r.type = "range"; r.min = min; r.max = max; r.step = step;
  const n = el("span", "t-num"); n.style.cssText = "width:58px;text-align:right;color:var(--label-2);font-size:var(--fs-12)";
  r.oninput = () => {
    ensureAudioDefaults(); pushHist("p:" + path);
    setp(project, path, +r.value); fillP(r); n.textContent = fmt(+r.value);
    touch(); if (extra) extra(); renderTimeline();
  };
  propRow(g, label, r, n);
  panelCtl.push({ el: r, refresh: () => { const v = getp(ensureAudioDefaults() && project, path); r.value = v; fillP(r); n.textContent = fmt(v); } });
}
function projSwitch(g, label, path, hint, extra) {
  const w = el("label", "t-switch"); const c = el("input"); c.type = "checkbox"; c.setAttribute("role", "switch"); c.setAttribute("aria-label", label); w.append(c, el("i"));
  c.onchange = () => { ensureAudioDefaults(); pushHist("p:" + path); setp(project, path, c.checked); touch(); if (extra) extra(); renderTimeline(); };
  const row = propRow(g, label, w);
  if (hint) { const h = el("span"); h.style.cssText = "color:var(--label-2);font-size:var(--fs-12)"; h.textContent = hint; row.appendChild(h); }
  panelCtl.push({ el: c, refresh: () => { c.checked = !!getp(ensureAudioDefaults() && project, path); } });
}

function vtNum(g, label, key, o = {}) {
  const inp = el("input", "t-field"); inp.type = "number"; inp.step = o.step || 0.1;
  const rg = o.range ? el("input", "t-slider") : null;
  if (rg) { rg.type = "range"; rg.min = o.range[0]; rg.max = o.range[1]; rg.step = 0.01; }
  const set = (v) => {
    if (Number.isNaN(v)) return;
    pushHist("vt:" + key);
    const vt = vtWritable(); vt[key] = v; clampVT(vt); layoutVideo(); renderSel(); touch(); refreshPanelValues();
  };
  inp.oninput = () => set(parseFloat(inp.value));
  if (rg) rg.oninput = () => set(parseFloat(rg.value));
  propRow(g, label, ...(rg ? [inp, rg] : [inp]));
  panelCtl.push({ el: inp, refresh: () => { const v = vtView().vt[key]; inp.value = r2(v); if (rg) { rg.value = v; fillP(rg); } } });
}
function insHead(body, icon, title, sub) {
  const h = el("div", "t-insp-head", `<span class="t-insp-head__ico">${ico(icon, "t-ico")}</span><div class="grow"><div class="t-insp-head__t">${escHtml(title)}</div><div class="t-insp-head__s">${escHtml(sub)}</div></div>`);
  body.appendChild(h);
}
function renderVideoProps() {
  const body = $("propsBody"), v = vtView();
  const sub = v.clip ? (v.own ? `Khung riêng của clip ${v.clip.id}` : `Clip ${v.clip.id} đang theo khung chung — sửa sẽ tạo khung riêng`) : (cu ? "Khung chung (mọi clip)" : "Khung chung");
  insHead(body, "crop", "Video gốc", sub);
  const g = group(body, "Khung hình", "crop", true);
  vtNum(g, "x (%)", "x"); vtNum(g, "y (%)", "y"); vtNum(g, "Scale", "scale", { step: 0.01, range: [0.2, 3] });
  const mk = (txt, fn, cls = "") => { const b = el("button", "t-btn t-btn--block " + cls, txt); b.style.marginTop = "6px"; b.onclick = fn; g.appendChild(b); return b; };
  mk("Đặt lại (phủ kín)", () => {
    pushHist(); const vt = vtWritable(); vt.scale = 1; vt.x = 0; vt.y = 0; layoutVideo(); renderSel(); touch(); renderProps();
  });
  if (cu && hasCap("clipTransform")) {
    const cb = el("label", "t-prop__lbl", "");
    cb.style.cssText = "display:flex;gap:8px;align-items:center;margin-top:10px;font-size:12px";
    const ck = el("input"); ck.type = "checkbox"; ck.checked = editGlobal; ck.onchange = () => { editGlobal = ck.checked; layoutVideo(); renderSel(); renderProps(); };
    cb.append(ck, document.createTextNode("Sửa khung chung (mọi clip) thay vì clip này"));
    g.appendChild(cb);
    if (v.clip && v.own) {
      mk("Áp cho mọi clip", () => {
        pushHist(); project.videoTransform = { ...v.clip.transform }; for (const c of project.videoClips) delete c.transform;
        layoutVideo(); renderSel(); touch(); renderProps(); toast("Đã áp khung này cho mọi clip (xoá các khung riêng)");
      });
      mk("Về khung chung", () => { pushHist(); delete v.clip.transform; layoutVideo(); renderSel(); touch(); renderProps(); toast("Clip " + v.clip.id + " theo khung chung"); });
    }
    const n = project.videoClips.filter((c) => c.transform).length;
    if (n) g.appendChild(el("div", "t-kbd", `${n} clip có khung riêng.`));
  }
  g.appendChild(el("div", "t-kbd", "Kéo = dời · tay nắm góc = phóng (Shift giữ tâm) · cuộn = phóng quanh con trỏ · nhấp đúp = đặt lại · Alt tắt bám dính. Cho phép phóng nhỏ hơn 1 và kéo quá mép: phần trống tô ink #0C0C0C."));
  refreshPanelValues();
}

const TYPE_NAME = { text: "Chữ", subtitle: "Phụ đề", lowerThird: "Lower third", callout: "Callout", scene: "Cảnh", image: "Ảnh", shape: "Hình", audio: "Âm thanh" };
const TYPE_ICON = { text: "text", subtitle: "text", lowerThird: "lower", callout: "bubble", scene: "film", image: "box", shape: "box", audio: "wave" };

function renderProjectAudioProps(body) {
  insHead(body, "volume", "Âm thanh dự án", "Chọn một layer hoặc clip để chỉnh riêng");
  const gv = group(body, "Giọng", "mic", true);
  projCtl(gv, "Âm lượng", "audio.voice.gainDb", GAIN_MIN, GAIN_MAX, 0.5, fmtDb, () => engine.applyVoice());
  projSwitch(gv, "Tắt tiếng", "audio.voice.muted", "Không đưa giọng vào bản mix", () => engine.applyVoice());
  const gd = group(body, "Ducking nhạc", "sliders", true);
  projCtl(gd, "Hạ nhạc", "audio.music.duckDb", -30, 0, 0.5, fmtDb);
  projCtl(gd, "Attack", "audio.music.attack", 0.01, 1, 0.01, (v) => v.toFixed(2).replace(".", ",") + " s");
  projCtl(gd, "Release", "audio.music.release", 0.05, 2, 0.01, (v) => v.toFixed(2).replace(".", ",") + " s");
  const gm = group(body, "Master", "speaker", false);
  projCtl(gm, "LUFS", "audio.master.lufs", -24, -9, 0.5, (v) => v.toFixed(1).replace(".", ",") + " LUFS");
  projCtl(gm, "True peak", "audio.master.truePeak", -6, 0, 0.1, (v) => v.toFixed(1).replace(".", ",") + " dBTP");
  refreshPanelValues();
}
function renderAudioProps(body, items) {
  const first = items[0].l;
  insHead(body, "wave", items.length > 1 ? `${items.length} clip âm thanh` : clipName(first), `${first.id} · ${r2(first.start)} s → ${r2(first.start + first.duration)} s`);
  const g = group(body, "Âm thanh", "volume", true);
  const prv = el("button", "t-btn t-btn--sm", ico("play") + "Nghe thử");
  prv.onclick = () => { engine.ensure(); engine.previewing() ? engine.stopPreview() : engine.preview(engine.urlFor(first)); };
  propRow(g, "Tệp", el("span", "grow", escHtml((first.src || "").split("/").pop())), prv);
  rangeCtl(g, "Âm lượng", "gainDb", GAIN_MIN, GAIN_MAX, 0.5, fmtDb);
  numCtl(g, "Fade vào (s)", "fadeIn", { min: 0, step: 0.05, def: 0 });
  numCtl(g, "Fade ra (s)", "fadeOut", { min: 0, step: 0.05, def: 0 });
  if (items[0].tr.kind === "music") chkCtl(g, "Lặp lại", "meta.loop", false, "phát vòng tới hết clip");
  const gt = group(body, "Thời gian", "clock", true);
  numCtl(gt, "Bắt đầu (s)", "start", { min: 0, step: 0.05 });
  numCtl(gt, "Thời lượng (s)", "duration", { min: 0.05, step: 0.05 });
  numCtl(gt, "Cắt đầu (s)", "offset", { min: 0, step: 0.05, def: 0 });
  const gl = group(body, "Liên kết", "link", true);
  const lk = first.meta && first.meta.linkedLayerId;
  if (lk) {
    const ln = find(lk);
    const b = el("button", "t-btn t-btn--sm", "Bỏ liên kết");
    b.onclick = () => { pushHist(); for (const { l } of items) if (l.meta) { delete l.meta.linkedLayerId; delete l.meta.linkEdge; l.meta.source = "user"; } touch(); renderTimeline(); renderProps(); };
    propRow(gl, "Gắn với", el("span", "grow", escHtml(`${ln ? (ln.l.text || ln.l.type) : lk} · lúc ${first.meta.linkEdge === "out" ? "ra" : "vào"}`)), b);
    gl.appendChild(el("div", "t-notice t-notice--info", `${ico("link")}<span>Kéo layer đồ hoạ thì SFX đi theo. Kéo tay SFX sẽ bỏ liên kết.</span>`));
  } else gl.appendChild(el("div", "t-kbd", "Không liên kết. SFX tự đặt sẽ gắn với lúc vào/ra của layer đồ hoạ."));
  refreshPanelValues();
}

// ---- videoMoves (máy quay) ----
const sortedMoves = () => [...project.videoMoves].sort((a, b) => a.start - b.start);
const findMove = (id) => (project.videoMoves || []).find((m) => m.id === id);
const selMoves = () => [...sel].map(findMove).filter(Boolean);
const sortedShifts = () => [...project.videoShifts].sort((a, b) => a.start - b.start);
const findShift = (id) => (project.videoShifts || []).find((m) => m.id === id);
const selShifts = () => [...sel].map(findShift).filter(Boolean);
const aiOn = () => !(project.camera && project.camera.aiEnabled === false);
/** Chỉnh tay move/shift do AI dựng → chuyển source "user" để th:broll chạy lại không xoá (giống quy tắc SFX). */
const markUser = (m) => { if (m.source && m.source !== "user") m.source = "user"; };
function ensureShiftIds() {
  project.videoShifts = project.videoShifts || [];
  let n = 0; for (const m of project.videoShifts) { const x = /^S-(\d+)$/.exec(m.id || ""); if (x) n = Math.max(n, +x[1]); }
  for (const m of project.videoShifts) if (!m.id) m.id = "S-" + String(++n).padStart(4, "0");
}
function toggleAi() {
  pushHist(); project.camera = { ...(project.camera || {}), aiEnabled: !aiOn() };
  touch(); layoutVideo(); renderSel(); renderTimeline();
  toast(aiOn() ? "Máy quay tự động: BẬT" : "Máy quay tự động: TẮT — bỏ qua mọi zoom/dịch do AI (preview và render)");
}
function ensureMoveIds() {
  project.videoMoves = project.videoMoves || [];
  let n = 0; for (const m of project.videoMoves) { const x = /^V-(\d+)$/.exec(m.id || ""); if (x) n = Math.max(n, +x[1]); }
  for (const m of project.videoMoves) if (!m.id) m.id = "V-" + String(++n).padStart(4, "0");
}
function nextMoveId() { ensureMoveIds(); let n = 0; for (const m of project.videoMoves) n = Math.max(n, +(/^V-(\d+)$/.exec(m.id)?.[1] || 0)); return "V-" + String(n + 1).padStart(4, "0"); }
function addZoomPunch() {
  ensureMoveIds();
  const arr = sortedMoves(), s0 = r2(t);
  if (arr.some((m) => s0 >= m.start && s0 < m.end)) { toast("Playhead đang nằm trong một chuyển động máy quay"); return; }
  const next = arr.find((m) => m.start > s0);
  const e = Math.min(s0 + 2, project.duration, next ? next.start : 1e9);
  if (e - s0 < 0.8) { toast("Không đủ chỗ trống (cần ≥ 0,8 s) sau playhead"); return; }
  pushHist();
  const m = { id: nextMoveId(), start: s0, end: r2(e), mode: "zoom", scale: 1.2, x: 0, y: -3, ease: { in: 0.35, out: 0.35 } };
  project.videoMoves.push(m); project.videoMoves = sortedMoves();
  sel.clear(); sel.add(m.id);
  touch(); refreshAll(); toast("Đã thêm zoom nhấn 1,2× (2 s)");
}
function addTransition(kind) {
  pushHist();
  let tr = project.tracks.find((x) => x.name === "Chuyển cảnh" && x.kind === "graphics" && !x.locked);
  if (!tr) { tr = { id: "t-trans-" + Date.now().toString(36), kind: "graphics", name: "Chuyển cảnh", hidden: false, locked: false, layers: [] }; project.tracks.unshift(tr); }
  const l = { id: nextId(), type: "transition", start: r2(Math.max(0, t - 0.25)), duration: 0.5, x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1,
    transition: { kind, dur: 0.5, color: "#C5A059", dir: "left" }, meta: { source: "user" } };
  tr.layers.push(l); sel.clear(); sel.add(l.id);
  touch(); refreshAll(); toast("Đã thêm chuyển cảnh " + kind);
}
function addAssetLayer(src, st0) {
  pushHist();
  const tr = graphicsTrack();
  const l = { id: nextId(), type: "asset", src, start: r2(st0), duration: 3, x: 38, y: 30, w: 24, h: 20, rotation: 0, opacity: 1,
    animation: { in: { kind: "pop", dur: 0.45 }, out: { kind: "shrink", dur: 0.3 } }, meta: { source: "user" } };
  tr.layers.push(l); sel.clear(); sel.add(l.id);
  touch(); refreshAll(); toast("Đã thêm asset " + src.split("/").pop());
}
function mvCtl(g, label, path, o = {}) {
  const inp = el("input", "t-field"); inp.type = "number"; inp.step = o.step || "any";
  if (o.min != null) inp.min = o.min; if (o.max != null) inp.max = o.max;
  inp.oninput = () => {
    const v = parseFloat(inp.value); const m = selMoves()[0];
    if (Number.isNaN(v) || !m) return;
    pushHist("mv:" + path); setp(m, path, v); markUser(m);
    fixMoveBounds(m); touch(); layoutVideo(); renderTimeline(); refreshPanelValues();
  };
  propRow(g, label, inp);
  panelCtl.push({ el: inp, refresh: () => { const m = selMoves()[0]; const v = m && getp(m, path); inp.value = v == null ? (o.def ?? "") : r2(v); } });
}
/** Giữ videoMoves không chồng nhau và end > start (kẹp theo láng giềng). */
function fixMoveBounds(m) {
  const arr = sortedMoves().filter((x) => x !== m);
  const prevEnd = Math.max(0, ...arr.filter((x) => x.end <= m.start + 1e-6).map((x) => x.end));
  const nextStart = Math.min(project.duration, ...arr.filter((x) => x.start >= m.end - 1e-6).map((x) => x.start));
  m.start = r2(Math.max(m.start, prevEnd)); m.end = r2(Math.min(Math.max(m.end, m.start + 0.3), nextStart));
}
function renderMoveProps(body, m) {
  insHead(body, "crop", "Máy quay: " + (m.mode === "zoom" ? "Zoom" : m.mode === "kenburns" ? "Ken Burns" : "PiP"), `${m.id} · ${r2(m.start)} s → ${r2(m.end)} s`);
  const g = group(body, "Chuyển động", "motion", true);
  const s = el("select", "t-field");
  for (const [v, tx] of [["zoom", "Zoom (vào rồi ra)"], ["kenburns", "Ken Burns (trôi chậm)"], ["pip", "PiP (chưa hỗ trợ khi render)"]]) { const o = document.createElement("option"); o.value = v; o.textContent = tx; s.appendChild(o); }
  s.value = m.mode;
  s.onchange = () => { pushHist(); markUser(m); m.mode = s.value; if (m.mode === "pip" && !m.pip) m.pip = { x: 62, y: 58, w: 34, radius: 24, shadow: true }; touch(); layoutVideo(); renderTimeline(); renderProps(); };
  const w = el("div", "t-select grow"); w.appendChild(s); propRow(g, "Kiểu", w);
  mvCtl(g, "Bắt đầu (s)", "start", { min: 0, step: 0.05 }); mvCtl(g, "Kết thúc (s)", "end", { min: 0.1, step: 0.05 });
  if (m.mode !== "pip") { mvCtl(g, "Phóng (×)", "scale", { min: 1, max: 3, step: 0.01 }); mvCtl(g, "Dịch x (%)", "x", { step: 0.5 }); mvCtl(g, "Dịch y (%)", "y", { step: 0.5 }); }
  mvCtl(g, "Ease vào (s)", "ease.in", { min: 0, step: 0.05, def: 0.35 }); mvCtl(g, "Ease ra (s)", "ease.out", { min: 0, step: 0.05, def: 0.35 });
  if (m.mode === "pip") {
    const gp = group(body, "PiP", "box", true);
    mvCtl(gp, "x (%)", "pip.x"); mvCtl(gp, "y (%)", "pip.y"); mvCtl(gp, "Rộng (%)", "pip.w", { min: 10, max: 90 }); mvCtl(gp, "Bo góc (px)", "pip.radius", { min: 0 });
    gp.appendChild(el("div", "t-notice", `${ico("warn")}<span>PiP chỉ xem trước trong editor; render hiện chưa hỗ trợ (đoạn này xuất video tĩnh).</span>`));
  }
  const b = el("button", "t-btn t-btn--block t-btn--destructive", "Xoá chuyển động");
  b.onclick = () => { pushHist(); project.videoMoves = project.videoMoves.filter((x) => x !== m); sel.delete(m.id); touch(); refreshAll(); };
  body.appendChild(b);
  refreshPanelValues();
}
function shCtl(g, label, path, o = {}) {
  const inp = el("input", "t-field"); inp.type = "number"; inp.step = o.step || "any";
  if (o.min != null) inp.min = o.min;
  inp.oninput = () => {
    const v = parseFloat(inp.value); const m = selShifts()[0];
    if (Number.isNaN(v) || !m) return;
    pushHist("sh:" + path); setp(m, path, v); markUser(m);
    if (m.end <= m.start) m.end = r2(m.start + 0.3);
    touch(); layoutVideo(); renderTimeline(); refreshPanelValues();
  };
  propRow(g, label, inp);
  panelCtl.push({ el: inp, refresh: () => { const m = selShifts()[0]; const v = m && getp(m, path); inp.value = v == null ? (o.def ?? "") : r2(v); } });
}
function renderShiftProps(body, m) {
  insHead(body, "crop", "Dịch ngang người nói", `${m.id} · ${r2(m.start)} s → ${r2(m.end)} s${m.source === "ai" ? " · do AI" : ""}`);
  const g = group(body, "Dịch", "motion", true);
  shCtl(g, "Bắt đầu (s)", "start", { min: 0, step: 0.05 }); shCtl(g, "Kết thúc (s)", "end", { min: 0.1, step: 0.05 });
  shCtl(g, "Dịch x (%)", "x", { step: 0.5 });
  shCtl(g, "Ease vào (s)", "ease.in", { min: 0, step: 0.05, def: 0.5 }); shCtl(g, "Ease ra (s)", "ease.out", { min: 0, step: 0.05, def: 0.5 });
  if (m.source === "ai") g.appendChild(el("div", "t-notice", `${ico("warn")}<span>Do AI dựng. Chỉnh tay sẽ chuyển sang "user" để th:broll chạy lại không xoá.</span>`));
  const b = el("button", "t-btn t-btn--block t-btn--destructive", "Xoá dịch");
  b.onclick = () => { pushHist(); project.videoShifts = project.videoShifts.filter((x) => x !== m); sel.delete(m.id); touch(); refreshAll(); };
  body.appendChild(b);
  refreshPanelValues();
}
function renderProps() {
  const body = $("propsBody");
  body.textContent = ""; panelCtl = []; warnEl = null; avoidEl = null;
  if (vsel) { renderVideoProps(); return; }
  const mv = selMoves();
  if (mv.length) { renderMoveProps(body, mv[0]); return; }
  const shf = selShifts();
  if (shf.length) { renderShiftProps(body, shf[0]); return; }
  const items = selLayers();
  if (!items.length) { renderProjectAudioProps(body); return; }
  const first = items[0].l;
  if (isAudio(first)) { renderAudioProps(body, items.filter((x) => isAudio(x.l))); return; }
  const ty = first.type;
  insHead(body, TYPE_ICON[ty] || "box", items.length > 1 ? `${items.length} layer được chọn` : TYPE_NAME[ty] || ty,
    items.length > 1 ? "Sửa áp cho tất cả" : `${first.id} · ${r2(first.start)} s → ${r2(first.start + first.duration)} s · track “${items[0].tr.name}”`);
  warnEl = el("div", "t-notice"); warnEl.style.display = "none";
  body.appendChild(warnEl);
  const hasText = ["text", "subtitle", "lowerThird", "callout"].includes(ty);
  if (hasText) {
    const gc = group(body, "Nội dung", "text", true);
    txtCtl(gc, "Chữ", "text", true);
    if (ty === "lowerThird") txtCtl(gc, "Phụ đề nhỏ", "subtext", true);
    if (ty === "subtitle") selCtl(gc, "Chế độ", "animation.subtitleMode", [{ v: "line", t: "Theo dòng" }, { v: "word", t: "Tô từng từ" }]);
    const gs = group(body, "Kiểu chữ", "sliders", true);
    selCtl(gs, "Font", "style.fontFamily", meta.fonts.length ? meta.fonts : ["Be Vietnam Pro"]);
    numCtl(gs, "Cỡ chữ (px)", "style.fontSize", { min: 8, max: 400 });
    selCtl(gs, "Độ đậm", "style.fontWeight", [400, 600, 700, 800, 900], { num: true });
    selCtl(gs, "Căn lề", "style.align", [{ v: "left", t: "Trái" }, { v: "center", t: "Giữa" }, { v: "right", t: "Phải" }]);
    colorCtl(gs, "Màu chữ", "style.color");
    colorCtl(gs, "Màu nhấn", "style.accentColor");
  }
  const gb = group(body, "Hộp", "box", false);
  if (hasText || ty === "shape") colorCtl(gb, "Nền", "style.background", { alpha: true });
  if (hasText || ty === "shape" || ty === "image" || ty === "scene") numCtl(gb, "Bo góc", "style.radius", { min: 0 });
  if (hasText) numCtl(gb, "Padding", "style.padding", { min: 0 });
  if (hasText || ty === "shape") { colorCtl(gb, "Viền", "style.strokeColor", { nullable: true }); numCtl(gb, "Dày viền", "style.strokeWidth", { min: 0 }); }
  if (hasText) chkCtl(gb, "Bóng chữ", "style.shadow");
  rangeCtl(gb, "Opacity", "opacity", 0, 1, 0.01);
  if (ty === "scene") {
    const g2 = group(body, "Cảnh", "film", true);
    selCtl(g2, "Cảnh", "templateId", meta.templates);
    chkCtl(g2, "Overlay", "meta.overlay", false, "nền trong suốt, chồng lên video");
  }
  if (ty === "asset") {
    const g2 = group(body, "Asset (SVG)", "sparkle", true);
    txtCtl(g2, "Tệp SVG", "src", false);
    colorCtl(g2, "Màu (tint)", "tint", { nullable: true });
    chkCtl(g2, "Vẽ nét dần", "draw.on", false);
    numCtl(g2, "Vẽ (giây)", "draw.dur", { min: 0.1, step: 0.1, def: 0.8 });
    selCtl(g2, "Chuyển động lặp", "animation.loop.kind", ["none", "float", "bob", "pulse", "wiggle", "spin"]);
    numCtl(g2, "Chu kỳ (s)", "animation.loop.period", { min: 0.3, step: 0.1, def: 2.4 });
    numCtl(g2, "Biên độ", "animation.loop.amp", { min: 0, step: 0.1, def: 1 });
  }
  if (ty === "transition") {
    const g2 = group(body, "Chuyển cảnh", "scissors", true);
    selCtl(g2, "Kiểu", "transition.kind", ["flash", "wipe", "panel", "iris", "shutter"]);
    selCtl(g2, "Hướng", "transition.dir", [{ v: "left", t: "Sang trái" }, { v: "right", t: "Sang phải" }, { v: "up", t: "Lên" }, { v: "down", t: "Xuống" }]);
    colorCtl(g2, "Màu", "transition.color");
    numCtl(g2, "Thời lượng (s)", "transition.dur", { min: 0.1, step: 0.05 });
  }
  if (ty === "image") { const g2 = group(body, "Ảnh", "box", true); txtCtl(g2, "Ảnh (src)", "src", false); }
  const gp = group(body, "Vị trí & kích thước (% canvas)", "move", true);
  numCtl(gp, "x", "x"); numCtl(gp, "y", "y"); numCtl(gp, "w", "w", { min: 1 }); numCtl(gp, "h", "h", { min: 1 }); numCtl(gp, "Xoay (°)", "rotation");
  if (ty === "subtitle") {
    chkCtl(gp, "Tự tránh thẻ", "meta.autoAvoid", true, "co về trái khi có cảnh thẻ bên phải");
    avoidEl = el("div", "t-notice t-notice--info"); avoidEl.style.display = "none"; gp.appendChild(avoidEl);
  }
  const gt = group(body, "Thời gian (giây)", "clock", false);
  numCtl(gt, "Bắt đầu", "start", { min: 0, step: 0.05 });
  numCtl(gt, "Thời lượng", "duration", { min: 0.1, step: 0.05 });
  const ga = group(body, "Hoạt ảnh", "motion", false);
  selCtl(ga, "Vào", "animation.in.kind", meta.presets.in);
  numCtl(ga, "Vào (giây)", "animation.in.dur", { min: 0, step: 0.05 });
  selCtl(ga, "Ra", "animation.out.kind", meta.presets.out);
  numCtl(ga, "Ra (giây)", "animation.out.dur", { min: 0, step: 0.05 });
  const b = el("button", "t-btn t-btn--block", "Áp style cho cả track");
  b.title = "Chép style + animation của layer này sang mọi layer cùng track";
  b.onclick = applyToTrack;
  body.appendChild(b);
  refreshPanelValues();
}
function refreshPanelValues() {
  if (avoidEl) {
    const one = selLayers()[0];
    const g = one && layerGeom(project, one.l, t);
    const on = g && (Math.abs(g.x - one.l.x) > 0.05 || Math.abs(g.w - one.l.w) > 0.05);
    avoidEl.style.display = on ? "flex" : "none";
    avoidEl.innerHTML = on ? `${ico("film")}<span>Đang tự tránh thẻ cảnh: khung hình hiện hiển thị x ${r2(g.x)}%, rộng ${r2(g.w)}%. Các ô x/y/w/h bên dưới là vị trí GỐC và sửa đúng vị trí gốc.</span>` : "";
  }
  if (warnEl) {
    const bad = selLayers().filter(({ l }) => isUnsafe(l));
    warnEl.style.display = bad.length ? "flex" : "none";
    warnEl.innerHTML = bad.length ? `${ico("warn")}<span>Cảnh báo: ${bad.length > 1 ? bad.length + " layer" : "layer"} nằm ngoài vùng an toàn (${$("safePlat").selectedOptions[0].textContent}).</span>` : "";
  }
  for (const c of panelCtl) { if (c.el.contains && c.el.contains(document.activeElement)) continue; c.refresh(); }
}

function refreshAll() {
  if (cu) cu.sync();
  layoutVideo();
  ov.update(project);
  renderTimeline(); renderSafe(); renderSel(); renderProps();
  setTime(t, true);
  audioChanged();
  if (libApi) libApi.refreshSelection();
}

// ---------- phím tắt & nút ----------
function inField(e) { return /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !(e.target.type === "range" || e.target.type === "checkbox" || e.target.type === "color"); }
window.addEventListener("keydown", (e) => {
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (ctrl && k === "s") { e.preventDefault(); save(); return; }
  if (ctrl && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (ctrl && k === "y") { e.preventDefault(); redo(); return; }
  if (inField(e)) return;
  if (e.key === "?") { e.preventDefault(); const d = $("helpDlg"); d.open ? d.close() : d.showModal(); return; }
  if (k === "v" && !ctrl) { vKey = true; return; }
  if (ctrl && k === "d") { e.preventDefault(); dupSel(); return; }
  if (cu && !ctrl && !e.altKey && (k === "s" || ((k === "i" || k === "o") && cu.paneActive()))) { e.preventDefault(); if (k === "s") cu.cut(); else cu.mark(k); return; }
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); if (cu && cu.hasSel() && !sel.size) cu.del(); else delSel(); return; }
  if (e.key === " ") { e.preventDefault(); if (cu && cu.srcHot()) cu.toggleSrc(); else playing ? pause() : play(); return; }
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    if (cu && cu.srcHot()) { cu.stepSrc((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 1 / fps())); return; }
    if (playing) pause();
    const step = e.shiftKey ? 1 : 1 / fps();
    setTime(t + (e.key === "ArrowLeft" ? -step : step));
    return;
  }
  if (e.key === "Escape") { sel.clear(); selectVideo(false); selectionChanged(); closePops(); }
});
window.addEventListener("keyup", (e) => { if (e.key.toLowerCase() === "v") vKey = false; });
window.addEventListener("blur", () => { vKey = false; });
$("btnVideo").onclick = () => selectVideo(!vsel);
$("btnSafe").onclick = () => { safeOn = !safeOn; $("btnSafe").classList.toggle("is-on", safeOn); $("btnSafe").setAttribute("aria-pressed", String(safeOn)); renderSafe(); renderSel(); refreshPanelValues(); };
$("safePlat").onchange = () => { renderSafe(); renderSel(); refreshPanelValues(); };
$("btnSnap").onclick = () => { snapOn = !snapOn; $("btnSnap").classList.toggle("is-on", snapOn); $("btnSnap").setAttribute("aria-pressed", String(snapOn)); };
$("btnAddTrack").onclick = () => {
  pushHist();
  const n = project.tracks.filter((x) => x.kind === "graphics").length + 1;
  project.tracks.unshift({ id: "t-gfx-" + Date.now().toString(36), kind: "graphics", name: "Đồ hoạ " + n, hidden: false, locked: false, layers: [] });
  touch(); renderTimeline();
};
stage.addEventListener("wheel", (e) => {
  if (!(vsel || vKey)) return;
  e.preventDefault();
  pushHist("vt:wheel");
  const vt = vtWritable(), r = stage.getBoundingClientRect();
  const px = ((e.clientX - r.left) / r.width) * 100 - 50, py = ((e.clientY - r.top) / r.height) * 100 - 50; // con trỏ so với tâm canvas (%)
  const S0 = vt.scale; let S = clamp(S0 * Math.exp(-e.deltaY * 0.0015), VT_MIN, VT_MAX);
  if (!e.altKey && Math.abs(S - 1) < 0.02) S = 1;
  const k = S / S0, off = videoState(project, t); // điểm ảnh dưới con trỏ đứng yên: tâm' = p − (p − tâm)·k
  const ox = off.x - vt.x, oy = off.y - vt.y;
  vt.scale = S; vt.x = px - (px - (vt.x + ox)) * k - ox; vt.y = py - (py - (vt.y + oy)) * k - oy;
  clampVT(vt); layoutVideo(); renderSel(); touch(); refreshPanelValues();
}, { passive: false });
stage.addEventListener("dblclick", (e) => { // nhấp đúp lên video (không trúng layer) = đặt lại khung
  if (!vsel || e.target.dataset.vh) return;
  const r = stage.getBoundingClientRect();
  if (hitTest(e.clientX - r.left, e.clientY - r.top)) return;
  pushHist(); const vt = vtWritable(); vt.scale = 1; vt.x = 0; vt.y = 0; layoutVideo(); renderSel(); touch(); renderProps();
});
$("stageArea").addEventListener("pointerdown", (e) => { if (e.target === $("stageArea")) { if (sel.size) { sel.clear(); selectionChanged(); } selectVideo(false); } });
$("tlScroll").addEventListener("pointerdown", (e) => {
  const tg = e.target;
  if (sel.size && !e.shiftKey && !tg.closest(".t-clip, .t-track__head, .t-ruler, button, #voiceClip")) { sel.clear(); selectionChanged(); }
});
window.addEventListener("beforeunload", (e) => { if (rev !== savedRev) { e.preventDefault(); e.returnValue = ""; } });
window.addEventListener("resize", () => project && sizeStage());

$("btnPlay").onclick = () => (playing ? pause() : play());
$("btnHome").onclick = () => { if (playing) pause(); setTime(0); $("tlScroll").scrollLeft = 0; };
$("btnSave").onclick = save;
$("btnUndo").onclick = undo; $("btnRedo").onclick = redo;
$("btnDup").onclick = dupSel; $("btnDel").onclick = delSel;
$("btnAddText").onclick = () => addLayer("text");
$("btnAddCallout").onclick = () => addLayer("callout");
$("btnAddLower").onclick = () => addLayer("lowerThird");
$("btnAddScene").onclick = () => addLayer("scene");
$("btnZoom").onclick = addZoomPunch;
$("btnTrans").onclick = (e) => { e.stopPropagation(); $("transPop").classList.toggle("is-open"); document.body.classList.toggle("pop-open", $("transPop").classList.contains("is-open")); };
$("transPop").addEventListener("click", (e) => { const it = e.target.closest("[data-tk]"); if (it) { addTransition(it.dataset.tk); closePops(); } e.stopPropagation(); });
$("btnExport").onclick = () => {
  const cmd = `npm run th:render -- ${project.job}`;
  $("exportCmd").textContent = cmd;
  $("exportDlg").showModal();
};
$("btnCopyCmd").onclick = () => navigator.clipboard.writeText($("exportCmd").textContent).then(() => toast("Đã sao chép lệnh"));
$("btnCloseDlg").onclick = () => $("exportDlg").close();
$("btnHelp").onclick = () => $("helpDlg").showModal();
$("btnCloseHelp").onclick = () => $("helpDlg").close();

// ---- giao diện sáng/tối + màu nhấn (nhớ bằng localStorage, có thể bị chặn) ----
function remember(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* chế độ riêng tư */ } }
function applyTheme(v) {
  document.documentElement.dataset.theme = v; remember("s6x.theme", v);
  document.querySelectorAll("[data-theme-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === v)));
}
function applyAccent(v) {
  document.documentElement.dataset.accent = v; remember("s6x.accent", v);
  document.querySelectorAll("[data-accent-set]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.accentSet === v)));
}
document.querySelectorAll("[data-theme-set]").forEach((b) => (b.onclick = () => applyTheme(b.dataset.themeSet)));
document.querySelectorAll("[data-accent-set]").forEach((b) => (b.onclick = () => applyAccent(b.dataset.accentSet)));
applyTheme(document.documentElement.dataset.theme || "dark");
applyAccent(document.documentElement.dataset.accent || "blue");

// ---- Tự đặt SFX ----
function closePops() { $("transPop").classList.remove("is-open"); $("sfxPop").classList.remove("is-open"); document.body.classList.remove("pop-open"); }
$("btnSfxAuto").onclick = (e) => { e.stopPropagation(); $("sfxPop").classList.toggle("is-open"); document.body.classList.toggle("pop-open", $("sfxPop").classList.contains("is-open")); };
$("sfxPop").addEventListener("click", (e) => e.stopPropagation());
document.addEventListener("click", closePops);
$("sfxDensity").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  $("sfxDensity").querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
});
$("sfxRun").onclick = async () => {
  const btn = $("sfxRun");
  try {
    btn.disabled = true; btn.textContent = "Đang đặt…";
    const pack = $("sfxPack").value, density = $("sfxDensity").querySelector("[aria-pressed=true]").dataset.d;
    const r = await fetch("/api/sfx/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project, pack, density }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.project) throw new Error(j.error || "HTTP " + r.status);
    pushHist();
    const before = project.tracks.reduce((n, x) => n + (AUDIO_KINDS.includes(x.kind) && x.kind === "sfx" ? x.layers.length : 0), 0);
    project = j.project;
    project.videoTransform = project.videoTransform || { scale: 1, x: 0, y: 0 };
    for (const id of [...sel]) if (!find(id)) sel.delete(id);
    const after = project.tracks.reduce((n, x) => n + (x.kind === "sfx" ? x.layers.length : 0), 0);
    refreshAll(); touch(); closePops();
    toast(`Đã đặt SFX: ${after} clip (trước đó ${before}). Hoàn tác bằng Ctrl+Z`);
  } catch (e) { toast("Lỗi đặt SFX: " + e.message); }
  finally { btn.disabled = false; btn.textContent = "Đặt SFX"; }
};

// ---------- khởi động ----------
async function init() {
  const [pr, mr] = await Promise.all([fetch("/api/project"), fetch("/api/meta")]);
  if (!pr.ok) { document.body.textContent = "Không đọc được project.json: HTTP " + pr.status; return; }
  project = await pr.json();
  meta = await mr.json();
  project.videoTransform = project.videoTransform || { scale: 1, x: 0, y: 0 };
  $("jobName").textContent = `Talking head · ${project.job}`;
  $("arLabel").textContent = project.aspect; // tỉ lệ khung chỉ hiển thị, không đổi trong editor
  document.title = `Editor S6X — ${project.job}`;
serverRev = project.revision || 0;
  const useCutVideo = () => {
    vid.src = `/job/${project.source.video}`;
    vid.muted = !!project.source.audio;
    hasAudio = !!project.source.audio;
    if (hasAudio) aud.src = `/job/${project.source.audio}`;
  };
  const wantClips = !!(project.videoClips && project.videoClips.length && project.source.proxy);
  if (!wantClips) useCutVideo();
  { const vf = el("div"); vf.id = "vframe"; vf.style.cssText = "position:absolute;overflow:hidden;left:0;top:0;width:100%;height:100%"; vid.parentNode.insertBefore(vf, vid); vf.appendChild(vid);
    if (wantClips) { vid2 = document.createElement("video"); vid2.id = "vid2"; vid2.playsInline = true; vid2.preload = "auto"; vf.appendChild(vid2); } }
  ensureMoveIds();
  vid.addEventListener("loadedmetadata", () => { clampVT(project.videoTransform); layoutVideo(); });
  vid.addEventListener("error", () => toast("Không tải được video nguồn: " + project.source.video));
  $("totalcode").textContent = " / " + tc(project.duration);

  let rtimer = null;
  engine = createAudioEngine({
    project: () => project, voiceEl: () => (hasAudio ? aud : vid), voiceEls: () => (vid2 ? [vid, vid2] : null), soloSet,
    onBufferLoaded: () => { clearTimeout(rtimer); rtimer = setTimeout(() => project && renderTimeline(), 120); },
  });
  lastAudioSig = audioSig();
  if (!wantClips) fetch("/api/peaks").then((r) => (r.ok ? r.json() : null)).then((j) => { if (j && j.peaks) { peaks = j; engine.setVoicePeaks(j); renderTimeline(); } }).catch(() => {});
  engine.preload();

  ov = mountOverlay($("ovRoot"), project, { assetBase: "/", canvasW: project.width, canvasH: project.height });
  sizeStage();
  if (wantClips) {
    cu = await initClips({
      project: () => project, fps, t: () => t, zoom: () => zoom, TRACK_HEAD, vid, vid2, engine: () => engine,
      setTime, pushHist: () => pushHist(), touch, toast, el, ico, tbtn, headEl, renderTimeline,
      setPeaks: (mp) => { peaks = mp; engine.setVoicePeaks(mp); },
      updateTotal: () => { $("totalcode").textContent = " / " + tc(project.duration); },
      clearSel: () => { if (sel.size) { sel.clear(); selectionChanged(); } },
      pausePlay: () => { if (playing) pause(); },
      snapOn: () => snapOn, dragTip, showSnap, flush,
      timeAtClientX: (x) => clamp((x - $("rulerLane").getBoundingClientRect().left) / zoom, 0, project.duration),
      revealTime: (tm) => { const sc = $("tlScroll"), x = TRACK_HEAD + tm * zoom; if (x < sc.scrollLeft + TRACK_HEAD || x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = Math.max(0, x - TRACK_HEAD - 80); },
    });
    if (!cu) { vid2.remove(); vid2 = null; useCutVideo(); } // máy chủ cũ chưa có /api/source → chế độ cut.mp4
  }
  renderTimeline();
  setTime(0, true);
  renderProps();
  ov.ready().then(() => ov.seek(t));
  new ResizeObserver(() => sizeStage()).observe($("stageArea"));
  setSaveState();
  performance.mark("ed-ui-ready"); // đo thời gian tải trang
  autoLite();

  libApi = initLibrary({
    project: () => project, aspect: () => project.aspect, engine,
    selectedLayers: () => selLayers(), replaceLayers, addLayers, addAudio,
    addScene: (id, tm) => addLayer("scene", { templateId: id, start: tm }),
    playheadT: () => t, timeAtClientX: (x) => clamp((x - $("rulerLane").getBoundingClientRect().left) / zoom, 0, project.duration),
    seek: (tm) => { setTime(tm); const sc = $("tlScroll"), x = TRACK_HEAD + tm * zoom; if (x < sc.scrollLeft + TRACK_HEAD || x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = Math.max(0, x - TRACK_HEAD - 80); },
    toast, nextId, addAsset: addAssetLayer,
    onLibrary: (lib) => {
      libData = lib;
      const sel2 = $("sfxPack"); sel2.textContent = "";
      for (const p of lib.sfxPacks || []) { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name || p.id; sel2.appendChild(o); }
    },
  });
}
/** Không có GPU tăng tốc: kính mờ (backdrop-filter) chậm ~130 ms/khung → thử 24 khung rAF, trung vị > 40 ms thì bật chế độ nhẹ. */
function autoLite() {
  const root = document.documentElement;
  if (root.dataset.fx === "lite" || new URLSearchParams(location.search).get("fx") === "full" || document.visibilityState !== "visible") return;
  const d = []; let last = performance.now();
  const f = () => {
    const n = performance.now(); d.push(n - last); last = n;
    if (d.length < 26) { requestAnimationFrame(f); return; }
    const s = d.slice(2).sort((x, y) => x - y), med = s[s.length >> 1];
    if (med > 40) { root.dataset.fx = "lite"; toast("Máy không có GPU tăng tốc: đã bật chế độ nhẹ (không kính mờ). Thêm ?fx=full vào địa chỉ để ép bật lại."); }
  };
  requestAnimationFrame(f);
}
// dùng cho kiểm thử tự động trong trình duyệt
window.__ed = { vstate: () => videoState(project, t), get meta() { return meta; }, get vsel() { return vsel; }, vtView, get cu() { return cu; }, get vid2() { return vid2; }, get stale() { return stale; }, get serverRev() { return serverRev; }, flush, get ov() { return ov; }, get sel() { return sel; }, renderTimeline, renderSel, get project() { return project; }, get engine() { return engine; }, get t() { return t; }, setTime: (x) => setTime(x), select: (ids) => { sel.clear(); ids.forEach((i) => sel.add(i)); selectionChanged(); }, undo, redo, save, play, pause, refreshAll, touch, get zoom() { return zoom; } };
init();
