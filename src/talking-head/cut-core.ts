import type { CutRange, Cuts, Segment, Transcript } from "./project-schema.js";

export interface Range {
  start: number;
  end: number;
}

/** Gộp các khoảng chồng/liền nhau, kẹp vào [0, duration]. */
export function mergeRanges(ranges: Range[], duration: number): Range[] {
  const sorted = ranges
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(duration, r.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 1e-6) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** Từ cuts.json (chỉ các đoạn đã approved) suy ra danh sách đoạn GIỮ lại. Bỏ đoạn giữ < minKeep giây. */
export function keepRangesFromCuts(cuts: Cuts, duration: number, minKeep = 0.05): Range[] {
  const approved = cuts.ranges.filter((r: CutRange) => r.approved);
  const marked = mergeRanges(approved, duration);
  let keeps: Range[];
  if (cuts.mode === "keep") keeps = marked;
  else {
    keeps = [];
    let pos = 0;
    for (const r of marked) {
      if (r.start > pos) keeps.push({ start: pos, end: r.start });
      pos = r.end;
    }
    if (pos < duration) keeps.push({ start: pos, end: duration });
  }
  return keeps.filter((k) => k.end - k.start >= minKeep);
}

/** Ánh xạ mốc thời gian gốc -> timeline đã cắt. Mốc rơi vào vùng bị cắt thì dính vào mép đoạn giữ kế tiếp (đầu ra: offset hiện tại). */
export function mapTime(t: number, keeps: Range[]): number {
  let offset = 0;
  for (const k of keeps) {
    if (t < k.start) return offset;
    if (t <= k.end) return offset + (t - k.start);
    offset += k.end - k.start;
  }
  return offset;
}

export function totalDuration(keeps: Range[]): number {
  return keeps.reduce((s, k) => s + k.end - k.start, 0);
}

/** Từ nằm trong đoạn giữ khi điểm giữa của nó thuộc một đoạn giữ. */
function isKept(mid: number, keeps: Range[]): boolean {
  return keeps.some((k) => mid >= k.start && mid <= k.end);
}

/** Dựng transcript.cut: bỏ các từ bị cắt, đổi mốc từng từ sang timeline mới, bỏ segment rỗng. */
export function remapTranscript(tr: Transcript, keeps: Range[]): Transcript {
  const segments: Segment[] = [];
  for (const seg of tr.segments) {
    const words = seg.words
      .filter((w) => isKept((w.start + w.end) / 2, keeps))
      .map((w) => ({
        ...w,
        start: +mapTime(w.start, keeps).toFixed(3),
        end: +mapTime(w.end, keeps).toFixed(3),
      }));
    if (!words.length) continue;
    segments.push({
      id: segments.length,
      start: words[0].start,
      end: words[words.length - 1].end,
      text: words.map((w) => w.text).join(" "),
      words,
    });
  }
  return { ...tr, duration: totalDuration(keeps), segments };
}
