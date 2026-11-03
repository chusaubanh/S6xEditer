import type { CutRange, Segment } from "./project-schema.js";
import { normToken } from "./align-edits.js";
import { isVoiced } from "./voicing.js";

export interface Filler {
  start: number;
  end: number;
  text: string;
  source?: string;
  voicedRatio?: number;
  f0Median?: number;
}

export const SILENCE_MIN = 0.45; // chỉ rút gọn lặng từ 0.45 s
export const PAUSE_SENTENCE = 0.2; // giữ lại ở ranh giới câu
export const PAUSE_COMMA = 0.12; // giữ lại ở dấu phẩy / giữa câu
export const TAIL_KEEP = 0.3; // giữ lại ở đuôi clip

/**
 * Lặng giữa các từ >= 0.45 s: không xoá trắng mà rút còn khoảng nghỉ tự nhiên
 * (0.2 s ở ranh giới câu, 0.12 s ở chỗ khác), cắt phần giữa. Đầu clip chừa 0.12 s, đuôi clip chừa 0.3 s.
 */
export function silenceCandidates(segments: Segment[], duration: number): CutRange[] {
  const words = segments.flatMap((s) => s.words);
  const out: CutRange[] = [];
  const add = (gapStart: number, gapEnd: number, from: number, to: number, label: string) => {
    if (gapEnd - gapStart < SILENCE_MIN || to - from < 0.05) return;
    out.push({
      start: +from.toFixed(3),
      end: +to.toFixed(3),
      reason: `lặng ${(gapEnd - gapStart).toFixed(2)}s, ${label}`,
      source: "auto",
      kind: "silence",
      confidence: 0.9,
      approved: true,
    });
  };
  if (!words.length) return out;
  add(0, words[0].start, 0, words[0].start - PAUSE_COMMA, `đầu clip, chừa ${PAUSE_COMMA}s`);
  const last = words[words.length - 1];
  add(last.end, duration, last.end + TAIL_KEEP, duration, `đuôi clip, chừa ${TAIL_KEEP}s`);
  for (let i = 1; i < words.length; i++) {
    const a = words[i - 1].end;
    const b = words[i].start;
    const keep = /[.?!…]$/.test(words[i - 1].text) ? PAUSE_SENTENCE : PAUSE_COMMA;
    add(a, b, a + keep / 2, b - keep / 2, `chừa nghỉ ${keep}s`);
  }
  return out.sort((x, y) => x.start - y.start);
}

export const VAD_FILLER_MIN = 0.25; // vùng VAD không có từ: chỉ tin khi dài ≥ 0.25 s
export const TINY_CUT = 0.15; // mẩu ngắn hơn thế giữa hai từ liền mạch thì không cắt (gây vụn)
export const MERGE_GAP = 0.2;
export const VOICED_CUT_MIN = 0.2; // filler có thanh: đề xuất cắt nếu dài ≥ 0.2 s

/**
 * Từ khớp danh sách đệm: tin cậy cao.
 * Vùng VAD không có từ: phân loại bằng âm học (voicedRatio/f0Median). Có thanh = "filler-voiced" (ừm/à/ờ), đề xuất cắt nếu ≥ 0.2 s.
 * Không thanh = "breath" (hơi thở/ngắt nghỉ tự nhiên): KHÔNG cắt. Không có số đo âm học thì để "filler-vad", không đề xuất cắt.
 */
export function fillerCandidates(fillers: Filler[], _segments: Segment[]): CutRange[] {
  const out: CutRange[] = [];
  for (const f of fillers) {
    const dur = f.end - f.start;
    if (f.source !== "vad-gap") {
      out.push({ start: f.start, end: f.end, reason: `từ đệm "${f.text}"`, source: "auto", kind: "filler-word", confidence: 0.9, approved: true });
      continue;
    }
    if (dur < TINY_CUT) continue;
    const stats = f.voicedRatio === undefined ? null : { voicedRatio: f.voicedRatio, f0Median: f.f0Median ?? 0, rms: 0 };
    const base = { start: f.start, end: f.end, source: "auto" as const, ...(stats ? { voicedRatio: stats.voicedRatio, f0Median: stats.f0Median } : {}) };
    if (!stats) out.push({ ...base, reason: `vùng tiếng không có từ ${dur.toFixed(2)}s (chưa có số đo âm học)`, kind: "filler-vad", confidence: 0.3, approved: false });
    else if (isVoiced(stats)) {
      out.push({ ...base, reason: `có thanh F0≈${stats.f0Median}Hz, ${dur.toFixed(2)}s (ừm/à/ờ)`, kind: "filler-voiced", confidence: 0.8, approved: dur >= VOICED_CUT_MIN });
    } else {
      out.push({ ...base, reason: `không thanh, ${dur.toFixed(2)}s: hơi thở/ngắt nghỉ, không cắt`, kind: "breath", confidence: 0.2, approved: false });
    }
  }
  return out;
}

/**
 * Hợp nhất ứng viên: các khoảng giao nhau luôn gộp (lấy kind/approved/confidence của mục tin cậy cao hơn);
 * các khoảng cách nhau < 0.2 s chỉ gộp khi cùng trạng thái approved. "breath" chỉ để tham khảo, không gộp.
 */
export function mergeNearby(c: CutRange[]): CutRange[] {
  const breath = c.filter((r) => r.kind === "breath");
  const sorted = c.filter((r) => r.kind !== "breath").sort((a, b) => a.start - b.start);
  const out: CutRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    const overlap = last && r.start < last.end;
    if (last && (overlap || (last.approved === r.approved && r.start - last.end < MERGE_GAP))) {
      if ((r.confidence ?? 0) > (last.confidence ?? 0)) {
        last.kind = r.kind;
        last.confidence = r.confidence;
        last.approved = r.approved;
      }
      last.end = Math.max(last.end, r.end);
      last.reason = `${last.reason} + ${r.reason}`;
    } else out.push({ ...r });
  }
  return [...out, ...breath].sort((a, b) => a.start - b.start);
}

const T = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;

/** cuts.md: bảng dễ đọc cho người dùng/AI duyệt từng đoạn (thời điểm, loại, độ tin cậy, chữ xung quanh). */
export function renderCutsMd(ranges: CutRange[], segments: Segment[]): string {
  const words = segments.flatMap((s) => s.words);
  const ctx = (r: CutRange) => {
    const before = words.filter((w) => w.end <= r.start + 0.02).slice(-4).map((w) => w.text).join(" ");
    const inside = words.filter((w) => (w.start + w.end) / 2 >= r.start && (w.start + w.end) / 2 <= r.end).map((w) => w.text).join(" ");
    const after = words.filter((w) => w.start >= r.end - 0.02).slice(0, 4).map((w) => w.text).join(" ");
    return `…${before} **[${inside || "—"}]** ${after}…`.replace(/\|/g, "/");
  };
  const rows = ranges.map(
    (r, i) => `| ${i + 1} | ${T(r.start)}–${T(r.end)} | ${(r.end - r.start).toFixed(2)}s | ${r.kind ?? "-"} | ${r.confidence?.toFixed(2) ?? "-"} | ${r.voicedRatio === undefined ? "-" : `v${r.voicedRatio} f0=${r.f0Median}`} | ${r.approved ? "có" : "không"} | ${r.source} | ${ctx(r)} |`,
  );
  return [
    "# Kế hoạch cắt",
    "",
    'Cột "Đề xuất" là giá trị approved mặc định trong cuts.json. Sửa cuts.json rồi chạy th:approve --stage cut.',
    "",
    "| # | Thời điểm | Dài | Loại | Tin cậy | Âm học | Đề xuất | Nguồn | Chữ xung quanh |",
    "|---|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

/** Độ tương đồng token (Dice) giữa hai câu. */
export function similarity(a: string, b: string): number {
  const ta = a.split(/\s+/).map(normToken).filter(Boolean);
  const tb = b.split(/\s+/).map(normToken).filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  const count = new Map<string, number>();
  for (const t of ta) count.set(t, (count.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of tb) {
    const c = count.get(t) ?? 0;
    if (c > 0) {
      common++;
      count.set(t, c - 1);
    }
  }
  return (2 * common) / (ta.length + tb.length);
}

/** Câu lặp liền kề (tương đồng ≥ 0.75, ≥ 3 từ): cắt lần ngắn hơn; bằng nhau thì cắt lần trước, giữ lần sau. */
export function repeatCandidates(segments: Segment[], threshold = 0.75): CutRange[] {
  const out: CutRange[] = [];
  for (let i = 1; i < segments.length; i++) {
    const a = segments[i - 1];
    const b = segments[i];
    if (a.words.length < 3 || b.words.length < 3) continue;
    if (similarity(a.text, b.text) < threshold) continue;
    const dropA = a.words.length <= b.words.length;
    const drop = dropA ? a : b;
    out.push({
      start: drop.start,
      end: drop.end,
      reason: `câu lặp (giữ lần ${dropA ? "sau" : "trước, đầy đủ hơn"})`,
      source: "auto",
      kind: "retake",
      confidence: +similarity(a.text, b.text).toFixed(2),
      approved: false,
    });
  }
  return out;
}
