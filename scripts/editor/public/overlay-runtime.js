/**
 * Overlay runtime (Chế độ C) — dùng chung cho editor và th:render.
 * Hàm thuần theo thời gian t: không dùng setTimeout/rAF/CSS animation, nên seek(t) luôn cho đúng một khung.
 * Tên preset và đường cong lấy từ scripts/scene-kit/motion.mjs (ENTER, leave, EASE, DUR).
 *
 *   const ov = mountOverlay(rootEl, project, { assetBase: "/", canvasW: 1080, canvasH: 1920 });
 *   ov.seek(12.3); ov.update(newProject); ov.destroy();
 *
 * assetBase: tiền tố URL để phân giải "assets/...", "templates/..." (editor: "/", render: "./").
 */

import { layout as clipLayout } from "./clips-core.js";
const DUR = { micro: 0.25, base: 0.45, enter: 0.6, hero: 0.8, travel: 0.9 };
const EASE = {
  out: [0.16, 1, 0.3, 1],
  heavy: [0.32, 0.72, 0, 1],
  spring: [0.34, 1.56, 0.64, 1],
  overshoot: [0.34, 1.56, 0.64, 1],
  slam: [0.5, 0, 0.75, 0],
};
// [opacity, tx, ty, scale, rotate(deg), blur(px), rotX(deg)] trạng thái BAN ĐẦU; đích là {1,0,0,1,0,0,0}
const ENTER = {
  rise: [0, 0, 40, 1, 0, 0, 0, DUR.enter, "out"],
  drop: [0, 0, -60, 1, 0, 0, 0, DUR.enter, "out"],
  left: [0, -70, 0, 1, 0, 0, 0, DUR.enter, "out"],
  right: [0, 70, 0, 1, 0, 0, 0, DUR.enter, "out"],
  pop: [0, 0, 0, 0.6, 0, 0, 0, DUR.base, "spring"],
  bounce: [0, 0, 0, 0.35, 0, 0, 0, DUR.base, "overshoot"],
  zoom: [0, 0, 0, 1.25, 0, 0, 0, DUR.hero, "heavy"],
  tilt: [0, 0, 45, 1, 0, 0, 14, DUR.hero, "heavy"],
  soft: [0, 0, 48, 1, 0, 10, 0, DUR.hero, "heavy"],
  stamp: [0, 0, 0, 2.2, -8, 0, 0, 0.32, "slam"],
  fade: [0, 0, 0, 1, 0, 0, 0, DUR.base, "out"],
};
const LEAVE = {
  fade: [0, 0, 0, 1, 0, 0, 0],
  shrink: [0, 0, 0, 0.5, 0, 0, 0],
  up: [0, 0, -50, 1, 0, 0, 0],
  down: [0, 0, 50, 1, 0, 0, 0],
};
const REST = [1, 0, 0, 1, 0, 0, 0];

export const PRESETS = {
  in: Object.keys(ENTER).concat("none"),
  out: Object.keys(LEAVE).concat("none"),
};

/** Bộ giải cubic-bezier (giống CSS). */
function bezier(p, x) {
  const [x1, y1, x2, y2] = p;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (s) => ((ax * s + bx) * s + cx) * s;
  const sy = (s) => ((ay * s + by) * s + cy) * s;
  const dx = (s) => (3 * ax * s + 2 * bx) * s + cx;
  let s = x;
  for (let i = 0; i < 8; i++) {
    const e = sx(s) - x;
    if (Math.abs(e) < 1e-6) return sy(s);
    const d = dx(s);
    if (Math.abs(d) < 1e-6) break;
    s -= e / d;
  }
  let lo = 0, hi = 1;
  s = x;
  for (let i = 0; i < 40; i++) {
    const e = sx(s) - x;
    if (Math.abs(e) < 1e-6) break;
    if (e > 0) hi = s; else lo = s;
    s = (lo + hi) / 2;
  }
  return sy(s);
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Trạng thái animation [o,tx,ty,s,r,blur,rx] tại thời điểm cục bộ lt trong layer (0..duration). */
function animState(layer, lt) {
  const dur = layer.duration;
  const a = layer.animation || {};
  let st = REST;
  const inK = a.in && a.in.kind;
  if (inK && inK !== "none" && ENTER[inK]) {
    const k = ENTER[inK];
    const d = a.in.dur > 0 ? a.in.dur : k[7];
    if (lt < d) st = mix(k, REST, bezier(EASE[k[8]], clamp01(lt / d)));
  }
  const outK = a.out && a.out.kind;
  if (outK && outK !== "none" && LEAVE[outK]) {
    const d = Math.min(a.out.dur > 0 ? a.out.dur : DUR.micro + 0.1, dur);
    const u = (lt - (dur - d)) / d;
    if (u > 0) st = mix(REST, LEAVE[outK], bezier(EASE.slam, clamp01(u)));
  }
  return st;
}
function mix(a, b, u) {
  const r = [];
  for (let i = 0; i < 7; i++) r.push(a[i] + (b[i] - a[i]) * u);
  return r;
}

const FONT_FILES = [
  ["Be Vietnam Pro", "BeVietnamPro-Regular.ttf", "400"],
  ["Be Vietnam Pro", "BeVietnamPro-SemiBold.ttf", "600"],
  ["Be Vietnam Pro", "BeVietnamPro-Bold.ttf", "700"],
  ["Be Vietnam Pro", "BeVietnamPro-ExtraBold.ttf", "800"],
  ["Be Vietnam Pro", "BeVietnamPro-Black.ttf", "900"],
  ["Lexend", "Lexend.ttf", "100 900"],
  ["Nunito", "Nunito.ttf", "200 1000"],
];

function injectFonts(doc, assetBase) {
  const id = "s6x-overlay-fonts";
  if (doc.getElementById(id)) return;
  const st = doc.createElement("style");
  st.id = id;
  st.textContent = FONT_FILES.map(([fam, file, w]) =>
    `@font-face{font-family:'${fam}';font-weight:${w};font-style:normal;font-display:block;` +
    `src:url('${assetBase}assets/fonts/${file}') format('truetype');}`).join("\n");
  doc.head.appendChild(st);
}

function sceneEntry(templateId, aspect) {
  // Cùng quy tắc với resolveTemplateEntry (src/studio/render/template-composer.ts), nhưng không kiểm tra file tồn tại:
  // thử composition theo tỷ lệ, iframe lỗi thì rơi về index.html (xem onerror bên dưới).
  const c = aspect === "9:16" ? ["compositions/portrait.html", "compositions/feed.html"]
    : aspect === "4:5" ? ["compositions/feed.html", "compositions/portrait.html"]
    : aspect === "1:1" ? ["compositions/square.html", "compositions/feed.html", "compositions/portrait.html"]
    : [];
  return { dir: `templates/${templateId}/`, tries: c.concat("index.html") };
}

/** pass: "under" = track belowVideo (vẽ DƯỚI video), "over" = các track còn lại, "all" = tất cả. */
export function trackIn(tr, pass) {
  if (tr.hidden) return false;
  if (!pass || pass === "all") return true;
  return (pass === "under") === !!tr.belowVideo;
}

/**
 * Trạng thái video gốc tại t (thuần, tất định): phóng/dịch theo videoTransform + đoạn videoMoves đang chạy.
 *  - zoom: w(t) = min(smooth(vào), smooth(ra)); scale = vt.scale·(1 + (m.scale−1)·w); x,y = vt + m·w
 *  - kenburns: trôi tuyến tính p từ 0 → 1 trong đoạn, nhân smooth(ra) để cuối đoạn êm về trạng thái tĩnh
 *  - pip: khung video nội suy từ toàn canvas (0,0,100%) tới pip{x,y,w}, bo góc theo w; nội dung bên trong giữ videoTransform
 * dims {vw,vh} (kích thước video nguồn) để kẹp không lộ viền đen khi phóng.
 */
/** Khung gốc tại t: khung riêng của clip đang dưới t (videoClips[].transform) hoặc videoTransform toàn cục. */
export function baseTransform(project, t) {
  const g = project.videoTransform || { scale: 1, x: 0, y: 0 };
  const cl = project.videoClips;
  if (!cl || !cl.some((c) => c.transform)) return g;
  for (const k of clipLayout(cl, project.fps || 30)) if (t >= k.s && t < k.e) return k.c.transform || g;
  return g;
}
/** Tắt máy quay tự động: bỏ qua mọi move/shift có source "ai". */
export const camOn = (project, m) => !(project.camera && project.camera.aiEnabled === false && m.source === "ai");

export function videoState(project, t, dims) {
  const vt = baseTransform(project, t);
  const st = { scale: vt.scale || 1, x: vt.x || 0, y: vt.y || 0, pip: null, mode: null, w: 0 };
  for (const m of project.videoMoves || []) {
    if (!(t >= m.start && t < m.end) || !camOn(project, m)) continue;
    const ein = m.ease && m.ease.in != null ? m.ease.in : 0.35, eout = m.ease && m.ease.out != null ? m.ease.out : 0.35;
    const ri = ein > 0 ? smooth((t - m.start) / ein) : 1, ro = eout > 0 ? smooth((m.end - t) / eout) : 1;
    const w = Math.min(ri, ro);
    if (m.mode === "kenburns") {
      const pr = (t - m.start) / (m.end - m.start);
      st.scale = vt.scale * (1 + ((m.scale || 1) - 1) * pr * ro); st.x = vt.x + (m.x || 0) * pr * ro; st.y = vt.y + (m.y || 0) * pr * ro;
    } else if (m.mode === "zoom") {
      st.scale = vt.scale * (1 + ((m.scale || 1) - 1) * w); st.x = vt.x + (m.x || 0) * w; st.y = vt.y + (m.y || 0) * w;
    } else {
      const P = m.pip || { x: 62, y: 58, w: 34, radius: 24, shadow: true };
      st.pip = { x: P.x * w, y: P.y * w, w: 100 + (P.w - 100) * w, radius: (P.radius || 0) * w, shadow: !!P.shadow, blend: w };
    }
    st.mode = m.mode; st.w = w;
    break;
  }
  if (!st.pip && st.mode) {
    // kẹp để cửa sổ phóng không vượt khung tĩnh (không lộ viền đen): |Δ| <= (z-1)/2 · 100 % canvas, z = hệ số phóng tương đối
    const z = st.scale / (vt.scale || 1), lim = Math.max(0, (z - 1) / 2) * 100;
    st.x = (vt.x || 0) + Math.max(-lim, Math.min(lim, st.x - (vt.x || 0)));
    st.y = (vt.y || 0) + Math.max(-lim, Math.min(lim, st.y - (vt.y || 0)));
  }
  // videoShifts: dịch ngang cộng dồn, SAU bước kẹp của videoMoves (cùng công thức với video-moves.ts)
  for (const s of project.videoShifts || []) {
    if (!(t >= s.start && t < s.end) || !camOn(project, s)) continue;
    const ein = s.ease && s.ease.in != null ? s.ease.in : 0.5, eout = s.ease && s.ease.out != null ? s.ease.out : 0.5;
    st.x += s.x * Math.min(ein > 0 ? smooth((t - s.start) / ein) : 1, eout > 0 ? smooth((s.end - t) / eout) : 1);
  }
  return st;
}

const smooth = (u) => { u = u < 0 ? 0 : u > 1 ? 1 : u; return u * u * (3 - 2 * u); };
const AVOID_GUTTER = 2, AVOID_LEFT = 5, AVOID_RAMP = 0.25;

/**
 * Hình học hiệu dụng (% canvas) của layer tại t. Phụ đề tự tránh thẻ scene bên phải (x >= 50) đang hiển thị:
 * co vào vùng trái [5, x_scene - 2] một cách tất định (nội suy mượt trong 0,25 s đầu/cuối của scene).
 * Tắt bằng meta.autoAvoid === false. Dùng chung editor + render (parity).
 */
export function layerGeom(project, l, t) {
  const g = { x: l.x, y: l.y, w: l.w, h: l.h };
  if (l.type !== "subtitle" || (l.meta && l.meta.autoAvoid === false)) return g;
  let avoid = 0, sx = 100;
  for (const tr of project.tracks || []) {
    if (tr.hidden) continue;
    for (const s of tr.layers || []) {
      if (s.type !== "scene" || s.x < 50 || !(t >= s.start && t < s.start + s.duration)) continue;
      const a = smooth((t - s.start) / AVOID_RAMP) * smooth((s.start + s.duration - t) / AVOID_RAMP);
      if (a > avoid || (a === avoid && s.x < sx)) { avoid = a; sx = s.x; }
    }
  }
  if (avoid <= 0) return g;
  const tx = AVOID_LEFT, tw = Math.max(10, sx - AVOID_GUTTER - AVOID_LEFT);
  if (g.x + g.w <= tx + tw) return g; // đã nằm trọn bên trái
  return { x: g.x + (tx - g.x) * avoid, y: g.y, w: g.w + (tw - g.w) * avoid, h: g.h };
}

/** Từ đang nói tại t (-1 nếu không có). Khoảng lặng giữa hai từ: giữ từ vừa nói thêm 0.15 s rồi tắt. */
export function activeWord(ws, t) {
  let active = -1;
  for (let i = 0; i < ws.length; i++) if (t >= ws[i].start) active = i;
  if (active >= 0 && t >= ws[active].end && t - ws[active].end > 0.15) active = -1;
  return active;
}

/**
 * Chữ ký thuần (không cần DOM) của khung hình overlay tại t: hai thời điểm cùng chữ ký cho ra cùng ảnh.
 * th:render dùng để chỉ render các khung khác nhau và cache theo chữ ký.
 */
export function frameKey(project, t, fps = 30, pass = "all") {
  const parts = [];
  const tracks = (project.tracks || []).filter((tr) => trackIn(tr, pass));
  for (let ti = tracks.length - 1; ti >= 0; ti--) {
    for (const l of tracks[ti].layers || []) {
      if (l.type === "audio" || !(t >= l.start && t < l.start + l.duration)) continue;
      const lt = t - l.start;
      const st = animState(l, lt).map((v) => Math.round(v * 1000) / 1000);
      const word = l.type === "subtitle" && l.words && l.words.length && l.animation && l.animation.subtitleMode === "word";
      const g = layerGeom(project, l, t);
      parts.push([l.type, Math.round(g.x * 1000) / 1000, g.y, Math.round(g.w * 1000) / 1000, g.h, l.rotation || 0, l.opacity, l.text, l.subtext, l.style, l.templateId, l.inputs, l.src,
        word ? l.words.map((w) => w.text) : null, word ? activeWord(l.words, t) : null, st,
        l.type === "scene" ? [Math.round(lt * fps), l.duration, !!(l.meta && l.meta.overlay)] : null,
        l.type === "asset" ? [l.tint, l.draw, l.animation && l.animation.loop, (l.animation && l.animation.loop && l.animation.loop.kind !== "none") || (l.draw && lt < l.draw.dur + 0.02) ? Math.round(lt * fps) : null] : null,
        l.type === "transition" ? [l.transition, l.kind, l.color, l.dir, l.duration, Math.round(lt * fps)] : null]);
    }
  }
  return parts.length ? JSON.stringify(parts) : "";
}

/**
 * Hộp bao (px canvas) của mọi layer đang hiện tại t, đã nới theo hoạt ảnh (phóng/dịch/mờ), viền, bóng.
 * Trả [x0,y0,x1,y1] hoặc null nếu không có gì; scene luôn là toàn khung. th:render chỉ chụp vùng này cho nhanh.
 */
export function frameBox(project, t, pass = "all") {
  const W = project.width, H = project.height;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, any = false;
  for (const tr of project.tracks || []) {
    if (!trackIn(tr, pass)) continue;
    for (const l of tr.layers || []) {
      if (l.type === "audio" || !(t >= l.start && t < l.start + l.duration)) continue;
      if (l.type === "scene" || l.type === "transition") return [0, 0, W, H];
      any = true;
      const st = animState(l, t - l.start);
      const g = layerGeom(project, l, t);
      const lw = (g.w / 100) * W, lh = (g.h / 100) * H;
      const cx = (g.x / 100) * W + lw / 2 + st[1], cy = (g.y / 100) * H + lh / 2 + st[2];
      let hw = (lw * st[3]) / 2, hh = (lh * st[3]) / 2;
      if (l.rotation || st[4] || st[6]) { hw = hh = Math.hypot(hw, hh) * 1.2; }
      const sw = (l.style && l.style.strokeWidth) || 0;
      const pad = 48 + st[5] * 3 + sw + 0.1 * lh; // bóng chữ, viền, chữ tràn hộp
      x0 = Math.min(x0, cx - hw - pad); x1 = Math.max(x1, cx + hw + pad);
      y0 = Math.min(y0, cy - hh - pad); y1 = Math.max(y1, cy + hh + pad);
    }
  }
  if (!any) return null;
  return [Math.max(0, x0), Math.max(0, y0), Math.min(W, x1), Math.min(H, y1)];
}

function esc(s) {
  return String(s == null ? "" : s);
}

function boxCss(layer, canvasW) {
  const s = layer.style || {};
  const css = {
    "font-family": `'${s.fontFamily || "Be Vietnam Pro"}', system-ui, sans-serif`,
    "font-size": (s.fontSize || 64) + "px",
    "font-weight": String(s.fontWeight || 800),
    color: s.color || "#EDEDED",
    "text-align": s.align || "center",
    "line-height": "1.3",
    "white-space": "pre-wrap",
    "overflow-wrap": "break-word",
    "text-wrap": "balance", // cân độ dài các dòng, tránh từ mồ côi (tất định, cùng engine Chrome ở editor và render)
    padding: (s.padding == null ? 24 : s.padding) + "px",
    "border-radius": (s.radius == null ? 16 : s.radius) + "px",
    background: s.background || "transparent",
    "-webkit-font-smoothing": "antialiased",
  };
  // Viền chữ: vòng text-shadow 24 hướng (bo tròn, nằm DƯỚI chữ nên không đè dấu tiếng Việt; -webkit-text-stroke cho góc nhọn xấu).
  const shadows = [];
  if (s.strokeColor && s.strokeWidth > 0) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      shadows.push(`${(Math.cos(a) * s.strokeWidth).toFixed(2)}px ${(Math.sin(a) * s.strokeWidth).toFixed(2)}px 0 ${s.strokeColor}`);
    }
  }
  if (s.shadow) shadows.push("0 2px 10px rgba(0,0,0,0.55)", "0 1px 2px rgba(0,0,0,0.6)");
  if (shadows.length) css["text-shadow"] = shadows.join(",");
  css.__ring = shadows.slice(0, shadows.length - (s.shadow ? 2 : 0)).join(",");
  css.__soft = s.shadow ? "0 2px 10px rgba(0,0,0,0.55),0 1px 2px rgba(0,0,0,0.6)" : "";
  return css;
}

function setCss(el, css) {
  for (const k in css) if (k.slice(0, 2) !== "__") el.style.setProperty(k, css[k]);
}

function contentSig(l) {
  // Mọi thứ ảnh hưởng tới DOM nội dung; hình học/thời gian/animation áp lại ở mỗi seek.
  return JSON.stringify([l.type, l.text, l.subtext, l.words, l.style, l.templateId, l.inputs, l.src,
    l.animation && l.animation.subtitleMode, l.tint, !!l.draw, l.transition, l.kind, l.color, l.dir, l.meta && l.meta.overlay]);
}

export function mountOverlay(rootEl, project, opts = {}) {
  const doc = rootEl.ownerDocument;
  const assetBase = opts.assetBase == null ? "/" : opts.assetBase;
  let CW = opts.canvasW || project.width;
  let CH = opts.canvasH || project.height;
  let proj = project;
  let lastT = 0;
  injectFonts(doc, assetBase);

  if (doc.defaultView.getComputedStyle(rootEl).position === "static") rootEl.style.position = "relative";
  rootEl.style.overflow = "hidden";
  const stage = doc.createElement("div");
  stage.style.cssText = `position:absolute;left:0;top:0;transform-origin:0 0;width:${CW}px;height:${CH}px;overflow:hidden;`;
  rootEl.appendChild(stage);

  const recs = new Map(); // id -> record
  const pending = []; // Promise các cảnh scene đang nạp
  let k = 1;
  const fit = () => {
    const w = rootEl.offsetWidth || rootEl.clientWidth || CW;
    k = w / CW;
    stage.style.transform = `scale(${k})`;
  };
  fit();
  let ro = null;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => { fit(); });
    ro.observe(rootEl);
  }

  function buildLayer(l) {
    const wrap = doc.createElement("div");
    wrap.style.cssText = "position:absolute;display:none;";
    wrap.dataset.layerId = l.id; wrap.dataset.type = l.type; // dùng cho kiểm tra tự động (parity.html)
    const anim = doc.createElement("div");
    anim.style.cssText = "position:absolute;inset:0;transform-origin:50% 50%;";
    wrap.appendChild(anim);
    const rec = { wrap, anim, wordEls: [], wordElsBack: [], iframe: null, iframeReady: false, sig: contentSig(l), layer: l };
    const css = boxCss(l, CW);
    const box = doc.createElement("div");
    box.style.cssText = "position:absolute;inset:0;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center;";
    const st = l.style || {};
    switch (l.type) {
      case "text":
      case "subtitle":
      case "callout": {
        setCss(box, css);
        box.style.alignItems = "stretch";
        if (l.type === "callout") {
          box.style.border = `${Math.max(3, st.strokeWidth || 0)}px solid ${st.accentColor || "#C5A059"}`;
          box.style.boxShadow = "0 10px 30px rgba(0,0,0,0.45)";
        }
        const asWords = l.type === "subtitle" && l.words && l.words.length && l.animation && l.animation.subtitleMode === "word";
        const mkInner = (els) => {
          const inner = doc.createElement("div");
          if (asWords) {
            l.words.forEach((w, i) => {
              const sp = doc.createElement("span");
              sp.style.display = "inline-block"; // để phóng 1.06 từ đang nói mà không làm dòng chữ nhảy
              sp.textContent = w.text;
              els.push(sp);
              inner.appendChild(sp);
              if (i < l.words.length - 1) inner.appendChild(doc.createTextNode(" "));
            });
          } else inner.textContent = esc(l.text);
          return inner;
        };
        const inner = mkInner(rec.wordEls);
        if (css.__ring) {
          // viền chữ: bản sao chữ nằm DƯỚI (màu viền + vòng bóng) xếp chồng bằng grid; chữ thật phía trên nên viền của từ sau không đè từ trước
          const stack = doc.createElement("div");
          stack.style.display = "grid";
          // viền 2 phía ăn mất khoảng trắng: bù thêm (tối đa 0,12 em) để mắt vẫn thấy khe giữa các từ
          stack.style.wordSpacing = Math.min(0.6 * st.strokeWidth, 0.12 * (st.fontSize || 64)).toFixed(1) + "px"; // chỉ bù vừa đủ: khe từ ≈ 0,25–0,32 em kể cả viền dày
          const back = mkInner(rec.wordElsBack);
          back.style.cssText = "grid-area:1/1;color:" + st.strokeColor + ";text-shadow:" + css.__ring + (css.__soft ? "," + css.__soft : "");
          back.setAttribute("aria-hidden", "true");
          inner.style.gridArea = "1/1";
          inner.style.textShadow = css.__soft || "none";
          stack.append(back, inner);
          box.appendChild(stack);
        } else box.appendChild(inner);
        break;
      }
      case "lowerThird": {
        // thanh nền + vạch nhấn vàng bên trái + chữ chính + subtext
        setCss(box, css);
        box.style.paddingLeft = (css.padding ? parseFloat(css.padding) : 24) + (st.fontSize || 64) * 0.35 + "px";
        const bar = doc.createElement("div");
        bar.style.cssText = `position:absolute;left:0;top:0;bottom:0;width:${Math.max(6, (st.fontSize || 64) * 0.1)}px;` +
          `background:${st.accentColor || "#C5A059"};border-radius:${css["border-radius"]} 0 0 ${css["border-radius"]};`;
        box.appendChild(bar);
        const main = doc.createElement("div");
        main.textContent = esc(l.text);
        box.appendChild(main);
        if (l.subtext) {
          const sub = doc.createElement("div");
          sub.textContent = l.subtext;
          sub.style.cssText = `font-size:${Math.round((st.fontSize || 64) * 0.55)}px;font-weight:500;color:${st.accentColor || "#C5A059"};margin-top:${Math.round((st.fontSize || 64) * 0.12)}px;`;
          box.appendChild(sub);
        }
        break;
      }
      case "asset": {
        // SVG inline (nạp text) để tint/draw được. loop/draw tính theo t trong seek, không dùng CSS animation.
        box.style.cssText = "position:absolute;inset:0;";
        const holder = doc.createElement("div");
        holder.style.cssText = "position:absolute;inset:0;transform-origin:50% 50%;";
        box.appendChild(holder);
        rec.loopEl = holder; rec.svgEls = [];
        const src = l.src || "", url = /^(https?:|data:|\/)/.test(src) ? src : assetBase + src;
        rec.loaded = fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error("HTTP " + r.status)))).then((txt) => {
          holder.innerHTML = txt;
          const svg = holder.querySelector("svg");
          if (!svg) throw new Error("không phải SVG");
          if (!svg.getAttribute("viewBox")) {
            const w = parseFloat(svg.getAttribute("width")), h = parseFloat(svg.getAttribute("height"));
            if (w && h) svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
          }
          svg.removeAttribute("width"); svg.removeAttribute("height");
          svg.style.cssText = "width:100%;height:100%;display:block;overflow:visible";
          if (l.tint) {
            // màu chính = màu fill/stroke (không phải none) xuất hiện nhiều nhất; chỉ thay màu đó, giữ màu phụ (vd dấu tích trên nền)
            const norm = (v) => String(v || "").trim().toLowerCase();
            const counts = new Map(), all = [svg, ...svg.querySelectorAll("*")];
            for (const e of all) for (const prop of ["fill", "stroke"]) for (const v of [e.getAttribute(prop), e.style.getPropertyValue(prop)]) {
              const c = norm(v); if (c && c !== "none" && c !== "transparent" && c !== "currentcolor" && !c.startsWith("url(")) counts.set(c, (counts.get(c) || 0) + 1);
            }
            let main = null, best = 0;
            for (const [c, n] of counts) if (n > best) { best = n; main = c; }
            svg.style.color = l.tint;
            for (const e of all) for (const prop of ["fill", "stroke"]) {
              if (norm(e.getAttribute(prop)) === main) e.setAttribute(prop, l.tint);
              if (norm(e.style.getPropertyValue(prop)) === main) e.style.setProperty(prop, l.tint);
              if (norm(e.getAttribute(prop)) === "currentcolor") e.setAttribute(prop, l.tint);
            }
          }
          if (l.draw) {
            for (const e of svg.querySelectorAll("path,line,polyline,polygon,rect,circle,ellipse")) {
              const cs = doc.defaultView.getComputedStyle(e);
              const hasStroke = cs.stroke && cs.stroke !== "none", hasFill = cs.fill && cs.fill !== "none";
              e.setAttribute("pathLength", "1");
              if (hasStroke) { e.style.strokeDasharray = "1"; e.style.strokeDashoffset = "1"; e.style.strokeLinecap = "round"; }
              rec.svgEls.push({ e, hasStroke, hasFill });
            }
          }
          rec.svgReady = true;
          seekAsset(rec, rec.lastLocal || 0);
        }).catch((err) => { holder.style.cssText += ";border:2px dashed #E05A4B"; holder.title = "Asset lỗi: " + err.message; });
        pending.push(rec.loaded);
        break;
      }
      case "transition": {
        const T = l.transition || { kind: l.kind || "flash", dur: l.duration, color: l.color || "#C5A059", dir: l.dir || "left" };
        box.style.cssText = "position:absolute;inset:0;overflow:hidden;";
        rec.T = T; rec.tEls = [];
        const mk = (css) => { const d = doc.createElement("div"); d.style.cssText = "position:absolute;background:" + (T.color || "#C5A059") + ";" + css; box.appendChild(d); rec.tEls.push(d); return d; };
        if (T.kind === "flash" || T.kind === "wipe" || T.kind === "iris") mk("inset:0;");
        else if (T.kind === "panel") { const vert = T.dir === "up" || T.dir === "down"; vert ? (mk("left:0;right:0;top:0;height:50%;"), mk("left:0;right:0;bottom:0;height:50%;")) : (mk("top:0;bottom:0;left:0;width:50%;"), mk("top:0;bottom:0;right:0;width:50%;")); }
        else if (T.kind === "shutter") for (let i = 0; i < 6; i++) mk(`left:0;right:0;top:${(i * 100) / 6}%;height:${100 / 6 + 0.2}%;transform-origin:50% 50%;`);
        break;
      }
      case "shape": {
        box.style.background = st.background || st.accentColor || "#C5A059";
        box.style.borderRadius = (st.radius || 0) + "px";
        if (st.strokeColor && st.strokeWidth > 0) box.style.border = `${st.strokeWidth}px solid ${st.strokeColor}`;
        break;
      }
      case "image": {
        const img = doc.createElement("img");
        const src = l.src || "";
        img.src = /^(https?:|data:|\/)/.test(src) ? src : assetBase + src;
        img.style.cssText = `width:100%;height:100%;object-fit:contain;border-radius:${st.radius || 0}px;`;
        box.appendChild(img);
        break;
      }
      case "scene": {
        // Cảnh scene-kit: tải HTML template, chèn biến (inputs + sceneDuration) theo cơ chế HyperFrames
        // (window.__HYPERFRAMES_VARIABLES__ / __hyperframes.getVariables) rồi nạp bằng srcdoc.
        const ovl = !!(l.meta && l.meta.overlay); // scene overlay: nền trong suốt chồng lên video
        box.style.cssText = "position:absolute;inset:0;overflow:hidden;" + (ovl ? "" : "background:#0C0C0C;");
        box.style.borderRadius = (st.radius || 0) + "px"; // thẻ 4:5 trong khung 16:9 có góc bo
        const f = doc.createElement("iframe");
        f.style.cssText = `position:absolute;left:0;top:0;width:${CW}px;height:${CH}px;border:0;transform-origin:0 0;${ovl ? "background:transparent;" : "background:#0C0C0C;"}`;
        if (ovl) { f.setAttribute("allowtransparency", "true"); f.style.colorScheme = "normal"; } // color-scheme khác tài liệu nhúng (Tahoe = dark) làm Chrome tô nền đục sau iframe
        f.setAttribute("scrolling", "no");
        rec.nat = { w: CW, h: CH };
        rec.iframe = f;
        rec.loaded = new Promise((resolve) => {
          f.addEventListener("load", () => {
            if (!f.srcdoc) return; // bỏ qua sự kiện load của about:blank lúc iframe vừa được thêm vào DOM
            try {
              const r = f.contentDocument.getElementById("root");
              const w = r && +r.getAttribute("data-width"), h = r && +r.getAttribute("data-height");
              if (w && h) { rec.nat = { w, h }; f.style.width = w + "px"; f.style.height = h + "px"; }
            } catch (_) {}
            // Template tạo animation trong document.fonts.ready.then(run) (sau sự kiện load): chờ cùng promise đó —
            // phản ứng của ta xếp sau phản ứng của template nên khi chạy thì animation đã có. Không dùng timer
            // (trình chụp của HyperFrames có thể không chạy timer theo thời gian thực).
            const done = () => { rec.iframeReady = true; seekScene(rec, rec.lastLocal || 0); resolve(); };
            try { f.contentDocument.fonts.ready.then(() => Promise.resolve()).then(done, done); } catch (_) { done(); }
          });
          loadScene(f, l).then((ok) => { if (!ok) resolve(); });
        });
        pending.push(rec.loaded);
        box.appendChild(f);
        break;
      }
    }
    anim.appendChild(box);
    rec.box = box;
    stage.appendChild(wrap);
    return rec;
  }

  async function loadScene(f, l) {
    const e = sceneEntry(l.templateId || "", proj.aspect);
    for (const entry of e.tries) {
      let html = null;
      try { const r = await fetch(assetBase + e.dir + entry); if (r.ok) html = await r.text(); } catch (_) {}
      if (html == null) continue;
      const vars = Object.assign({ sceneDuration: l.duration }, l.inputs || {});
      const base = new URL(assetBase + e.dir + entry, doc.baseURI).href;
      const inject = (l.meta && l.meta.overlay ? "<style>html,body,#root{background:transparent!important}</style>" : "") + `<base href="${base}"><script>window.__HYPERFRAMES_VARIABLES__=${JSON.stringify(vars).replace(/</g, "\\u003c")};` +
        `window.__hyperframes={getVariables:function(){return window.__HYPERFRAMES_VARIABLES__;}};<` + `/script>`;
      f.srcdoc = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + inject) : inject + html;
      return true;
    }
    return false;
  }

  function seekScene(rec, local) {
    rec.lastLocal = local;
    const f = rec.iframe;
    if (!f || !rec.iframeReady) return;
    try {
      const d = f.contentDocument;
      const ms = Math.max(0, local) * 1000;
      for (const a of d.getAnimations()) { a.pause(); a.currentTime = ms; }
    } catch (_) { /* iframe khác origin: bỏ qua */ }
  }

  function sync(p) {
    proj = p;
    CW = opts.canvasW || p.width;
    CH = opts.canvasH || p.height;
    stage.style.width = CW + "px";
    stage.style.height = CH + "px";
    fit();
    const seen = new Set();
    let z = 0;
    const tracks = (p.tracks || []).filter((t) => trackIn(t, opts.pass));
    // track đầu mảng = trên cùng: duyệt ngược để z-index tăng dần
    for (let ti = tracks.length - 1; ti >= 0; ti--) {
      for (const l of tracks[ti].layers || []) {
        if (l.type === "audio") continue;
        seen.add(l.id);
        let rec = recs.get(l.id);
        const sig = contentSig(l);
        if (!rec || rec.sig !== sig) {
          if (rec) rec.wrap.remove();
          rec = buildLayer(l);
          recs.set(l.id, rec);
        }
        rec.layer = l;
        rec.wrap.style.zIndex = String(++z);
      }
    }
    for (const [id, rec] of recs) {
      if (!seen.has(id)) { rec.wrap.remove(); recs.delete(id); }
    }
  }

  function seekAsset(rec, lt) {
    rec.lastLocal = lt;
    const l = rec.layer;
    if (l.draw && rec.svgReady) {
      const pr = smooth(lt / l.draw.dur);
      for (const x of rec.svgEls) {
        if (x.hasStroke) { x.e.style.strokeDashoffset = String(1 - pr); if (x.hasFill) x.e.style.fillOpacity = String(Math.max(0, Math.min(1, (pr - 0.6) / 0.4))); }
        else x.e.style.opacity = String(pr);
      }
    }
  }
  function loopXf(loop, lt, bh) {
    if (!loop || loop.kind === "none") return "";
    const P = loop.period || 2.4, A = loop.amp == null ? 1 : loop.amp, ph = (2 * Math.PI * lt) / P;
    switch (loop.kind) {
      case "float": return `translateY(${(-Math.sin(ph) * A * 0.04 * bh).toFixed(3)}px)`;
      case "bob": return `translateY(${(-Math.abs(Math.sin(ph / 2)) * A * 0.06 * bh).toFixed(3)}px)`;
      case "pulse": return `scale(${(1 + 0.06 * A * Math.sin(ph)).toFixed(5)})`;
      case "wiggle": return `rotate(${(A * 4 * Math.sin(ph * 2)).toFixed(3)}deg)`;
      case "spin": return `rotate(${((360 * lt) / P).toFixed(3)}deg)`;
      default: return "";
    }
  }
  function seekTransition(rec, lt) {
    const T = rec.T, u = Math.max(0, Math.min(1, lt / (T.dur || rec.layer.duration))), f = smooth(1 - Math.abs(2 * u - 1)), v = smooth(u);
    const els = rec.tEls, dir = T.dir || "left";
    switch (T.kind) {
      case "flash": els[0].style.opacity = String(f); break;
      case "wipe": {
        const a = dir === "left" ? `translateX(${(1 - 2 * v) * 100}%)` : dir === "right" ? `translateX(${(2 * v - 1) * 100}%)` : dir === "up" ? `translateY(${(1 - 2 * v) * 100}%)` : `translateY(${(2 * v - 1) * 100}%)`;
        els[0].style.transform = a; break;
      }
      case "panel": {
        const vert = dir === "up" || dir === "down", ax = vert ? "Y" : "X";
        els[0].style.transform = `translate${ax}(${-100 + 100 * f}%)`; els[1].style.transform = `translate${ax}(${100 - 100 * f}%)`; break;
      }
      case "iris": els[0].style.clipPath = `circle(${(f * 74).toFixed(3)}% at 50% 50%)`; break;
      case "shutter": for (const e of els) e.style.transform = `scaleY(${f})`; break;
    }
  }

  function seek(t) {
    lastT = t;
    for (const rec of recs.values()) {
      const l = rec.layer;
      const visible = t >= l.start && t < l.start + l.duration;
      const w = rec.wrap;
      if (!visible) { if (w.style.display !== "none") w.style.display = "none"; continue; }
      w.style.display = "block";
      if (l.type === "transition") { // phủ toàn khung, không có hoạt ảnh vào/ra riêng
        w.style.left = "0px"; w.style.top = "0px"; w.style.width = CW + "px"; w.style.height = CH + "px"; w.style.transform = "";
        rec.anim.style.opacity = "1"; rec.anim.style.transform = ""; rec.anim.style.filter = "";
        seekTransition(rec, t - l.start);
        continue;
      }
      const g = layerGeom(proj, l, t);
      w.style.left = (g.x / 100) * CW + "px";
      w.style.top = (g.y / 100) * CH + "px";
      w.style.width = (g.w / 100) * CW + "px";
      w.style.height = (g.h / 100) * CH + "px";
      w.style.transform = l.rotation ? `rotate(${l.rotation}deg)` : "";
      const lt = t - l.start;
      const s = animState(l, lt);
      const op = (l.opacity == null ? 1 : l.opacity) * s[0];
      rec.anim.style.opacity = String(op);
      rec.anim.style.transform =
        (s[6] ? `perspective(1000px) rotateX(${s[6]}deg) ` : "") +
        `translate(${s[1]}px,${s[2]}px) scale(${s[3]}) rotate(${s[4]}deg)`;
      rec.anim.style.filter = s[5] > 0.01 ? `blur(${s[5]}px)` : "";
      if (rec.loopEl) {
        const lp = l.animation && l.animation.loop;
        rec.loopEl.style.transform = loopXf(lp, lt, (g.h / 100) * CH);
        seekAsset(rec, lt);
      }
      if (rec.wordEls.length) {
        const ws = l.words;
        const accent = (l.style && l.style.accentColor) || "#C5A059";
        const active = activeWord(ws, t);
        for (let i = 0; i < rec.wordEls.length; i++) {
          rec.wordEls[i].style.color = i === active ? accent : "";
          rec.wordEls[i].style.transform = i === active ? "scale(1.06)" : "";
          if (rec.wordElsBack[i]) rec.wordElsBack[i].style.transform = i === active ? "scale(1.06)" : "";
        }
      }
      if (rec.iframe) {
        // template có khung gốc riêng (vd 1080x1350): thu phóng đều vào hộp layer, căn giữa, nền ink
        const bw = (l.w / 100) * CW, bh = (l.h / 100) * CH, n = rec.nat;
        const sc = Math.min(bw / n.w, bh / n.h);
        rec.iframe.style.transform = `translate(${(bw - n.w * sc) / 2}px,${(bh - n.h * sc) / 2}px) scale(${sc})`;
        seekScene(rec, lt);
      }
    }
  }

  sync(project);
  const api = {
    seek,
    update(p) { sync(p); seek(lastT); },
    /** Promise: font đã nạp (render đợi trước khi chụp khung). */
    ready() {
      const scenes = Promise.all(pending);
      const fams = ["400", "600", "700", "800", "900"].map((w) => doc.fonts.load(`${w} 40px 'Be Vietnam Pro'`, "Việt Nam ắ ề ộ"));
      return Promise.all(fams).then(() => doc.fonts.ready).then(() => scenes);
    },
    destroy() {
      if (ro) ro.disconnect();
      stage.remove();
      recs.clear();
    },
  };
  return api;
}
