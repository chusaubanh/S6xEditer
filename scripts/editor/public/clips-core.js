// Phần THUẦN (không DOM) của "Video gốc chỉnh được" — videoClips (docs/CHE-DO-C-SPEC.md). Dùng ở editor và test node.
// Quy ước khung hình GIỐNG src/talking-head/clips-render.ts (clipFrames/totalFrames): số khung nguyên, timeline = cộng dồn, không khoảng hở.
// clip: { id, kind: "source"|"hold", srcIn, srcOut? | dur? } — giây trên video GỐC.

export const MIN_FRAMES = 3; // clip ngắn nhất sau khi cắt/trim
const r6 = (x) => +x.toFixed(6);
export const snapSec = (x, fps) => r6(Math.round(x * fps) / fps);

/** Số khung của một clip (đúng công thức backend). */
export function clipN(c, fps) {
  return c.kind === "hold" ? Math.max(1, Math.round(c.dur * fps)) : Math.round((c.srcOut - c.srcIn) * fps);
}
/** Bố cục tuần tự: [{c,i,n,startF,s,e}] — s/e giây timeline. */
export function layout(clips, fps) {
  let acc = 0;
  return clips.map((c, i) => {
    const n = clipN(c, fps), r = { c, i, n, startF: acc, s: acc / fps, e: (acc + n) / fps };
    acc += n;
    return r;
  });
}
export const totalFrames = (clips, fps) => clips.reduce((a, c) => a + clipN(c, fps), 0);
export const totalSec = (clips, fps) => totalFrames(clips, fps) / fps;

/** Chỉ số clip chứa t (t ≥ hết → clip cuối). -1 nếu rỗng. */
export function locate(L, t) {
  if (!L.length) return -1;
  for (let i = 0; i < L.length; i++) if (t < L[i].e - 1e-9) return i;
  return L.length - 1;
}
/** Thời điểm timeline → thời gian trên video gốc (hold = srcIn). */
export function srcTimeAt(L, t) {
  const i = locate(L, t);
  if (i < 0) return null;
  const { c, s } = L[i];
  return c.kind === "hold" ? c.srcIn : c.srcIn + Math.max(0, t - s);
}

export function nextClipId(clips) {
  let m = 0;
  for (const c of clips) { const n = /^C-(\d+)$/.exec(c.id); if (n) m = Math.max(m, +n[1]); }
  return "C-" + String(m + 1).padStart(4, "0");
}

/** Cắt tại t (giây timeline). Trả {clips, index} (index = clip bên phải mới) hoặc null nếu t sát biên / ngoài clip. Không sửa mảng vào. */
export function splitAt(clips, t, fps) {
  const L = layout(clips, fps);
  const tf = Math.round(t * fps);
  const k = L.find((x) => tf > x.startF && tf < x.startF + x.n);
  if (!k || tf - k.startF < 1 || k.startF + k.n - tf < 1) return null;
  const out = clips.map((c) => ({ ...c }));
  const a = out[k.i], offF = tf - k.startF;
  const id2 = nextClipId(out);
  let b;
  if (a.kind === "hold") { b = { id: id2, kind: "hold", srcIn: a.srcIn, dur: r6((k.n - offF) / fps) }; a.dur = r6(offF / fps); }
  else {
    const m = snapSec(a.srcIn + offF / fps, fps);
    b = { id: id2, kind: "source", srcIn: m, srcOut: a.srcOut }; a.srcOut = m;
  }
  if (a.transform) b.transform = { ...a.transform }; // nửa phải thừa hưởng khung riêng
  out.splice(k.i + 1, 0, b);
  return { clips: out, index: k.i + 1 };
}

/** Trim mép: edge "L"|"R", d = độ dời NỘI DUNG (giây, dương = co lại ở mép trái / giãn ra ở mép phải). srcDur = độ dài video gốc. */
export function trimClip(clips, idx, edge, d, fps, srcDur) {
  const out = clips.map((c) => ({ ...c })), c = out[idx];
  const minLen = MIN_FRAMES / fps;
  if (c.kind === "hold") {
    const len = Math.max(minLen, c.dur + (edge === "R" ? d : -d));
    c.dur = snapSec(len, fps);
    return out;
  }
  if (edge === "L") c.srcIn = snapSec(Math.min(Math.max(0, c.srcIn + d), c.srcOut - minLen), fps);
  else c.srcOut = snapSec(Math.max(Math.min(srcDur || Infinity, c.srcOut + d), c.srcIn + minLen), fps);
  return out;
}
/** Giới hạn d để trim không vượt nguồn. */
export function trimRange(c, edge, fps, srcDur) {
  const minLen = MIN_FRAMES / fps;
  if (c.kind === "hold") return edge === "R" ? [minLen - c.dur, 600] : [-600, c.dur - minLen];
  return edge === "L" ? [-c.srcIn, c.srcOut - c.srcIn - minLen] : [c.srcIn + minLen - c.srcOut, (srcDur || Infinity) - c.srcOut];
}

export function removeClip(clips, idx) { return clips.filter((_, i) => i !== idx).map((c) => ({ ...c })); }
export function moveClip(clips, from, to) {
  const out = clips.map((c) => ({ ...c }));
  const [c] = out.splice(from, 1);
  out.splice(to, 0, c);
  return out;
}

/** Chèn clip nguồn [srcIn,srcOut] tại t: tách clip chứa t rồi chèn giữa; t ≥ tổng → nối cuối. Trả {clips, index}. */
export function insertSource(clips, t, srcIn, srcOut, fps) {
  const nc = { kind: "source", srcIn: snapSec(srcIn, fps), srcOut: snapSec(srcOut, fps) };
  if (!(nc.srcOut - nc.srcIn >= 1 / fps)) return null;
  let base = clips.map((c) => ({ ...c })), at;
  const L = layout(base, fps), tf = Math.round(t * fps);
  if (tf >= totalFrames(base, fps)) at = base.length;
  else {
    const sp = splitAt(base, t, fps);
    if (sp) { base = sp.clips; at = sp.index; }
    else { const k = L.find((x) => tf >= x.startF && tf < x.startF + x.n); at = k ? k.i : base.length; }
  }
  nc.id = nextClipId(base);
  base.splice(at, 0, nc);
  return { clips: base, index: at };
}

/** Peaks giọng trên timeline từ source-peaks (cặp [min,max] mỗi 1/rate giây): hold = im lặng. */
export function mapPeaks(clips, src, fps) {
  const rate = src.rate || 100, P = src.peaks, L = layout(clips, fps);
  const total = totalFrames(clips, fps) / fps, N = Math.round(total * rate);
  const out = new Array(N * 2).fill(0);
  for (const k of L) {
    if (k.c.kind === "hold") continue;
    const o0 = Math.round(k.s * rate), s0 = Math.round(k.c.srcIn * rate), cnt = Math.round((k.n / fps) * rate);
    for (let j = 0; j < cnt && o0 + j < N; j++) {
      const si = (s0 + j) * 2;
      if (si + 1 >= P.length) break;
      out[(o0 + j) * 2] = P[si]; out[(o0 + j) * 2 + 1] = P[si + 1];
    }
  }
  return { rate, duration: total, peaks: out };
}

/** Các đoạn nguồn đã dùng (gộp chồng lấn) để tô màu trên thanh tua của tab Nguồn. */
export function usedRanges(clips) {
  const iv = clips.filter((c) => c.kind === "source").map((c) => [c.srcIn, c.srcOut]).sort((a, b) => a[0] - b[0]);
  const m = [];
  for (const v of iv) { if (m.length && v[0] <= m[m.length - 1][1] + 1e-6) m[m.length - 1][1] = Math.max(m[m.length - 1][1], v[1]); else m.push([...v]); }
  return m;
}
