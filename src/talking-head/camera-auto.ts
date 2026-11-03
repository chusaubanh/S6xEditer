export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface CameraOptions {
  auto: boolean;
  minGap: number;
  maxGap: number;
  scaleRange: [number, number];
  punch: number;
}
export const CAMERA_DEFAULTS: CameraOptions = { auto: false, minGap: 3, maxGap: 6, scaleRange: [1.0, 1.1], punch: 1.2 };
export interface Move {
  start: number;
  end: number;
  mode: "zoom";
  scale: number;
  x: number;
  y: number;
  ease: { in: number; out: number };
  source: "ai";
  beatId: string;
}

export const CUTAWAY_MARGIN = 0.5; // không auto-zoom trong và ±0.5 s quanh cutaway
export const WORD_GAP = 0.08; // ranh giới từ: khoảng hở giữa 2 từ ≥ 0.08 s

/** Dịch (x,y % canvas) để phóng `scale` mà tâm mặt đứng yên, kẹp để video vẫn phủ kín khung. Không có mặt: dịch nhẹ lên. */
export function faceShift(face: Box | undefined, scale: number): { x: number; y: number } {
  const lim = (scale - 1) * 50;
  if (!face) return { x: 0, y: -Math.min(lim, (scale - 1) * 30) };
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h / 2;
  const clamp = (v: number) => +Math.max(-lim, Math.min(lim, v)).toFixed(2);
  return { x: clamp(-(cx - 50) * (scale - 1)), y: clamp(-(cy - 50) * (scale - 1)) };
}

/** Điểm ranh giới: giữa hai segment liền nhau (bất kể hở bao nhiêu) + chỗ hở giữa hai từ ≥ WORD_GAP (nếu có words). Đã sắp, không trùng. */
export function sentenceBoundaries(segments: Array<{ start: number; end: number }>, words: Array<{ start: number; end: number }> = []): number[] {
  const out: number[] = [];
  for (let i = 1; i < segments.length; i++) out.push(+((segments[i - 1].end + segments[i].start) / 2).toFixed(3));
  for (let i = 1; i < words.length; i++) if (words[i].start - words[i - 1].end >= WORD_GAP) out.push(+((words[i - 1].end + words[i].start) / 2).toFixed(3));
  return [...new Set(out)].sort((x, y) => x - y);
}

/**
 * Máy quay tự động: các cửa sổ zoom nhẹ xen kẽ (hi / giữa), mỗi cửa sổ 3–6 s, đầu cuối đặt ở ranh giới câu,
 * ease 0.4–0.8 s. Né `blocked` (cutaway ± 0.5 s, zoom/kenburns do plan chỉ định).
 */
export function autoCameraMoves(opts: {
  boundaries: number[];
  duration: number;
  blocked: Array<{ start: number; end: number }>;
  camera: CameraOptions;
  face?: Box;
}): { moves: Move[]; warnings: string[] } {
  const { boundaries, duration, blocked, camera, face } = opts;
  const warnings: string[] = [];
  const moves: Move[] = [];
  const hit = (a: number, b: number) => blocked.some((r) => a < r.end && r.start < b);
  const [lo, hi] = camera.scaleRange;
  const target = (camera.minGap + camera.maxGap) / 2;
  let t = boundaries.find((b) => b >= 0.8) ?? 0;
  let k = 0;
  while (t < duration - camera.minGap) {
    const cands = boundaries.filter((b) => b - t >= camera.minGap && b - t <= camera.maxGap && b <= duration);
    if (!cands.length) {
      const next = boundaries.find((b) => b > t + camera.maxGap);
      if (next === undefined) break;
      warnings.push(`Camera auto: không có ranh giới câu cách ${t.toFixed(1)}s trong ${camera.minGap}–${camera.maxGap}s; nhảy tới ${next.toFixed(1)}s.`);
      t = next;
      continue;
    }
    const end = cands.reduce((a, b) => (Math.abs(b - t - target) < Math.abs(a - t - target) ? b : a));
    if (hit(t, end)) {
      // đẩy t qua vùng bị chặn rồi tìm lại từ ranh giới câu kế tiếp
      const clear = Math.max(...blocked.filter((r) => t < r.end && r.start < end).map((r) => r.end));
      t = boundaries.find((b) => b >= clear) ?? duration;
      continue;
    }
    const scale = +(k % 2 === 0 ? hi : lo + (hi - lo) / 2).toFixed(3);
    k++;
    if (scale > 1.001) {
      const ease = +Math.min(0.8, Math.max(0.4, (end - t) / 6)).toFixed(2);
      moves.push({ start: t, end, mode: "zoom", scale, ...faceShift(face, scale), ease: { in: ease, out: ease }, source: "ai", beatId: `auto-${moves.length + 1}` });
    }
    t = end;
  }
  return { moves, warnings };
}
