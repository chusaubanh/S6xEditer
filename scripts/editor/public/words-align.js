/**
 * Căn lại words[] của layer subtitle sau khi người dùng sửa `text` (hàm thuần, không DOM).
 *  - Diff token bằng LCS (so sánh không phân biệt hoa/thường, bỏ dấu câu): từ khớp giữ nguyên mốc thời gian.
 *  - Từ mới chèn: nội suy trong khoảng giữa hai từ khớp lân cận, chia theo số ký tự.
 *  - Từ bị xoá: bỏ đi. Viết lại hoàn toàn (không từ nào khớp): chia đều theo số ký tự trong toàn khoảng cũ.
 */
const norm = (s) => s.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "");

function lcsPairs(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] && a[i] !== "" ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j] && a[i] !== "") { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

const MIN_WORD = 0.12;
const r3 = (v) => Math.round(v * 1000) / 1000;

/** Chia [t0, t1] cho các token theo số ký tự. */
function spread(tokens, t0, t1) {
  const total = tokens.reduce((s, t) => s + Math.max(1, t.length), 0);
  let cur = t0;
  return tokens.map((t, k) => {
    const end = k === tokens.length - 1 ? t1 : cur + ((t1 - t0) * Math.max(1, t.length)) / total;
    const w = { text: t, start: r3(cur), end: r3(end) };
    cur = end;
    return w;
  });
}

/**
 * @param {{text:string,start:number,end:number}[]} oldWords
 * @param {string} newText
 * @returns {{text:string,start:number,end:number}[]}
 */
export function alignWords(oldWords, newText) {
  const toks = String(newText || "").split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  if (!oldWords || !oldWords.length) return [];
  const pairs = lcsPairs(oldWords.map((w) => norm(w.text)), toks.map(norm));
  const t0 = oldWords[0].start, t1 = oldWords[oldWords.length - 1].end;
  const out = new Array(toks.length);
  for (const [i, j] of pairs) out[j] = { ...oldWords[i], text: toks[j] };
  // đoạn token chưa có mốc nằm giữa hai từ khớp (hoặc đầu/cuối)
  let j = 0;
  while (j < toks.length) {
    if (out[j]) { j++; continue; }
    let k = j;
    while (k < toks.length && !out[k]) k++;
    let from = j > 0 ? out[j - 1].end : t0;
    let to = k < toks.length ? out[k].start : t1;
    // khoảng trống quá hẹp (từ cũ nằm sát nhau): mượn tối đa 35% thời lượng từ khớp lân cận, mỗi bên
    let need = MIN_WORD * (k - j) - (to - from);
    if (need > 0 && j > 0) {
      const p = out[j - 1], take = Math.min(need, 0.35 * (p.end - p.start));
      p.end = r3(p.end - take); from = p.end; need -= take;
    }
    if (need > 0 && k < toks.length) {
      const q = out[k], take = Math.min(need, 0.35 * (q.end - q.start));
      q.start = r3(q.start + take); to = q.start; need -= take;
    }
    if (to <= from) to = from + MIN_WORD * (k - j); // không còn chỗ mượn: cho phép chồng nhẹ
    spread(toks.slice(j, k), from, to).forEach((w, n) => { out[j + n] = w; });
    j = k;
  }
  return out;
}
