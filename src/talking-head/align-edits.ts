import type { Segment, Word } from "./types.js";

/** Chuẩn hoá để so khớp token: bỏ dấu câu, chữ thường (giữ dấu tiếng Việt). */
export function normToken(s: string): string {
  return s.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "");
}

/** LCS trên hai dãy token đã chuẩn hoá -> danh sách cặp (i, j) khớp nhau. */
export function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length, m = b.length;
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs: Array<[number, number]> = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) pairs.push([i++, j++]);
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

/**
 * Căn một đoạn văn đã sửa vào các từ gốc có timestamp.
 * Từ khớp giữ nguyên mốc; từ mới (hoặc sửa) nội suy tuyến tính trong khoảng giữa hai neo.
 */
export function alignSegment(orig: Word[], edited: string, segStart: number, segEnd: number): Word[] {
  const newTokens = edited.split(/\s+/).filter(Boolean);
  if (newTokens.length === 0) return [];
  const pairs = lcsPairs(orig.map((w) => normToken(w.text)), newTokens.map(normToken));
  const out: Word[] = new Array(newTokens.length);
  for (const [i, j] of pairs) out[j] = { ...orig[i], text: newTokens[j] };

  // nội suy từng cụm từ chưa có mốc giữa hai neo
  let j = 0;
  while (j < newTokens.length) {
    if (out[j]) { j++; continue; }
    let k = j;
    while (k < newTokens.length && !out[k]) k++;
    const t0 = j > 0 ? out[j - 1].end : segStart;
    const t1 = k < newTokens.length ? out[k].start : segEnd;
    const span = Math.max(0, t1 - t0);
    const n = k - j;
    for (let x = 0; x < n; x++) {
      out[j + x] = {
        text: newTokens[j + x],
        start: +(t0 + (span * x) / n).toFixed(3),
        end: +(t0 + (span * (x + 1)) / n).toFixed(3),
      };
    }
    j = k;
  }
  return out;
}

/** Căn cả transcript: dòng i của file đã sửa ứng với segment i. */
export function alignEdits(segments: Segment[], editedLines: string[]): Segment[] {
  if (editedLines.length !== segments.length) {
    throw new Error(`transcript.edited.txt có ${editedLines.length} dòng nhưng có ${segments.length} segment — phải bằng nhau.`);
  }
  return segments.map((seg, i) => {
    const words = alignSegment(seg.words, editedLines[i], seg.start, seg.end);
    return {
      ...seg,
      text: editedLines[i].trim(),
      words,
      start: words.length ? words[0].start : seg.start,
      end: words.length ? words[words.length - 1].end : seg.end,
    };
  });
}
