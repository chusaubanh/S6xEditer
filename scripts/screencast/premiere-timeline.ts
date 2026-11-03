/**
 * Lõi thuần (không I/O) của premiere-package: từ các đoạn editor đã cắt + các mảnh nguồn → danh sách clip V1.
 * Mọi đơn vị là KHUNG (30 fps) trên video sạch CFR.
 */

/** Mảnh nguồn: [a, b) trên video sạch; base = khung trên video sạch ứng với khung 0 của `file`. */
export interface Piece { id: string; file: string; a: number; b: number; base: number; kind: "scene" | "screen" }
/** Một clip V1: lấy [inF, outF) của file mảnh, đặt tại khung `tl` trên timeline. */
export interface Item { piece: Piece; inF: number; outF: number; tl: number }
/** Đoạn editor (videoClips) đã đổi sang khung trên video sạch. */
export interface Span { a: number; b: number }

/**
 * Tách từng đoạn editor theo ranh giới mảnh, rồi gộp các clip liền nhau trên cùng file
 * (đoạn quay màn hình đều lấy từ một video → không để lại mảnh 1 khung ở chỗ ranh giới đoạn editor lệch ranh giới mảnh).
 * Clip 1 khung của file KHÁC (vd. khung cuối một cảnh) vẫn giữ — đó là nội dung thật của video editor.
 */
export function buildItems(spans: Span[], pieces: Piece[]): Item[] {
  const sorted = [...pieces].sort((x, y) => x.a - y.a);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].a !== sorted[i - 1].b) throw new Error(`mảnh không liền: ${sorted[i - 1].id} kết thúc ${sorted[i - 1].b}, ${sorted[i].id} bắt đầu ${sorted[i].a}`);
  const items: Item[] = [];
  let tl = 0;
  for (const s of spans) {
    let a = s.a;
    while (a < s.b) {
      const p = sorted.find((x) => a >= x.a && a < x.b);
      if (!p) throw new Error(`khung ${a} không thuộc mảnh nào`);
      const e = Math.min(s.b, p.b);
      items.push({ piece: p, inF: a - p.base, outF: e - p.base, tl });
      tl += e - a;
      a = e;
    }
  }
  for (let i = items.length - 1; i > 0; i--) {
    const p = items[i - 1], q = items[i];
    if (p.piece.file === q.piece.file && p.outF === q.inF && p.tl + (p.outF - p.inF) === q.tl) {
      p.outF = q.outF;
      const first = p.piece.id.split("–")[0], last = q.piece.id.split("–").pop()!;
      p.piece = { ...p.piece, id: first === last ? first : `${first}–${last}` };
      items.splice(i, 1);
    }
  }
  return items;
}

/** Cắt danh sách clip tại khung `totalF` của timeline (bản thử ngắn). */
export function clipToLength(items: Item[], totalF: number): Item[] {
  return items.filter((x) => x.tl < totalF).map((x) => (x.tl + (x.outF - x.inF) > totalF ? { ...x, outF: x.inF + totalF - x.tl } : x));
}

/**
 * Chia một khoảng quay màn hình [a, b) thành các đoạn m01… theo độ dài dự kiến (khung) từng đoạn;
 * đoạn cuối ăn hết phần dư (lệch vài khung do làm tròn/PTS chỉ ảnh hưởng tên, không ảnh hưởng nội dung).
 */
export function nameScreenSpan(a: number, b: number, ids: string[], lens: number[], file: string): Piece[] {
  const out: Piece[] = [];
  let x = a;
  ids.forEach((id, k) => {
    const end = k === ids.length - 1 ? b : Math.min(b, x + lens[k]);
    if (end > x) out.push({ id, file, a: x, b: end, base: 0, kind: "screen" });
    x = end;
  });
  return out;
}

/** Xếp các tiếng (start, dur — giây) vào làn sao cho trong một làn không chồng nhau; trả số làn của từng tiếng. */
export function assignLanes(events: { start: number; dur: number }[], gap = 1 / 30): { lanes: number[]; count: number } {
  const order = events.map((e, i) => ({ ...e, i })).sort((x, y) => x.start - y.start);
  const ends: number[] = [];
  const lanes = new Array<number>(events.length);
  for (const e of order) {
    let lane = ends.findIndex((t) => t <= e.start);
    if (lane < 0) { lane = ends.length; ends.push(0); }
    ends[lane] = e.start + e.dur + gap;
    lanes[e.i] = lane;
  }
  return { lanes, count: ends.length };
}
