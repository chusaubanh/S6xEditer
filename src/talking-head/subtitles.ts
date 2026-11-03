import type { Layer } from "./project-schema.js";
import type { Word } from "./types.js";

export const MAX_CHARS = 42;
export const MAX_LINES = 2;

export interface SubChunk {
  lines: string[];
  words: Word[];
}

/** Chia từ thành khối phụ đề: ≤ 2 dòng, ≤ 42 ký tự/dòng; ngắt thêm ở dấu kết câu hoặc khi lặng > 0.8 s. */
export function splitSubtitles(words: Word[], maxChars = MAX_CHARS, maxLines = MAX_LINES): SubChunk[] {
  const chunks: SubChunk[] = [];
  let lines: string[] = [];
  let cur = "";
  let cw: Word[] = [];
  const flush = () => {
    if (cur) lines.push(cur);
    if (lines.length) chunks.push({ lines, words: cw });
    lines = [];
    cur = "";
    cw = [];
  };
  for (const w of words) {
    if (cw.length && w.start - cw[cw.length - 1].end > 0.8) flush();
    const next = cur ? `${cur} ${w.text}` : w.text;
    if (next.length > maxChars && cur) {
      lines.push(cur);
      cur = "";
      if (lines.length >= maxLines) flush();
      cur = w.text;
    } else cur = next;
    cw.push(w);
    if (/[.?!…]$/.test(w.text) && cw.length >= 3) flush();
  }
  flush();
  return chunks;
}

export interface SubGeo {
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize: number;
}

/** Layer subtitle cho một khối (toạ độ % canvas). */
export function chunkToLayer(c: SubChunk, id: string, geo: SubGeo, colors: { text: string; accent: string; ink: string }): Layer {
  const start = c.words[0].start;
  const end = c.words[c.words.length - 1].end;
  return {
    id,
    type: "subtitle",
    start,
    duration: Math.max(0.3, +(end - start).toFixed(3)),
    x: geo.x,
    y: geo.y,
    w: geo.w,
    h: geo.h,
    rotation: 0,
    opacity: 1,
    text: c.lines.join("\n"),
    words: c.words,
    style: {
      fontFamily: "Be Vietnam Pro",
      fontSize: geo.fontSize,
      fontWeight: 800,
      color: colors.text,
      accentColor: colors.accent,
      background: "rgba(12,12,12,0)",
      align: "center",
      radius: 16,
      padding: 24,
      strokeColor: colors.ink,
      strokeWidth: 6,
      shadow: true,
    },
    animation: { in: { kind: "fade", dur: 0.1 }, out: { kind: "fade", dur: 0.1 }, subtitleMode: "word" },
    meta: { source: "auto" },
  };
}
