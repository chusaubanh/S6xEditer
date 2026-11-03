// Kiểm tương phản của mọi preset trong assets/th-presets (không sửa preset): `node scripts/editor/preset-contrast.mjs [--json]`
// Quy tắc (WCAG): chữ thường >= 4.5:1, chữ lớn (>= 48 px và đậm >= 700) >= 3:1.
//  - Có nền hộp (alpha >= 0.35): so màu chữ với nền; nền trong suốt một phần được xét ở trường hợp XẤU NHẤT (đặt trên đen và trên trắng).
//  - Không nền: BẮT BUỘC có viền dày >= max(3 px, 5% cỡ chữ) và màu chữ so với màu viền đạt ngưỡng; chỉ có bóng thì không đạt
//    (bóng mềm không bảo đảm đọc được trên cảnh sáng).
//  - Subtitle chế độ "word": kiểm cả màu từ đang nói (accentColor). lowerThird: subtext dùng accentColor, cỡ 55% → coi là chữ thường.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(REPO, "assets", "th-presets");

function parse(c) {
  if (!c || c === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) { const [r, g, b] = m[1].split("").map((x) => parseInt(x + x, 16)); return { r, g, b, a: 1 }; }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: m[2] ? parseInt(m[2], 16) / 255 : 1 };
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(c);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
  return { r: 0, g: 0, b: 0, a: 1 };
}
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
const BLACK = { r: 0, g: 0, b: 0, a: 1 }, WHITE = { r: 255, g: 255, b: 255, a: 1 };

const rows = [];
for (const type of ["subtitle", "lowerThird", "callout", "text"]) {
  const j = JSON.parse(readFileSync(join(DIR, type + ".json"), "utf8"));
  for (const p of j.presets) for (const v of p.variants) {
    const st = v.style;
    const sizes = [st.fontSize, ...Object.values(v.layout || {}).map((l) => l.fontSize).filter(Boolean)];
    const size = Math.min(...sizes.filter(Boolean));
    const big = size >= 48 && (st.fontWeight || 400) >= 700;
    const need = big ? 3 : 4.5;
    const bg = parse(st.background);
    const hasBox = bg.a >= 0.35;
    const issues = [];
    const texts = [["chữ", st.color]];
    if (type === "subtitle" && v.animation && v.animation.subtitleMode === "word") texts.push(["từ đang nói", st.accentColor]);
    let worst = Infinity;
    for (const [label, col] of texts) {
      const fg = parse(col);
      let r;
      if (hasBox) r = Math.min(ratio(fg, over(bg, BLACK)), ratio(fg, over(bg, WHITE)));
      else {
        const sc = parse(st.strokeColor);
        const thick = (st.strokeWidth || 0) >= Math.max(3, 0.05 * size);
        if (!(sc.a > 0 && thick)) { r = 0; issues.push(`${label}: không nền và thiếu viền dày (cần >= ${Math.max(3, Math.round(0.05 * size))} px)${st.shadow ? ", chỉ có bóng" : ""}`); }
        else r = ratio(fg, sc);
      }
      worst = Math.min(worst, r);
      if (r > 0 && r < need) issues.push(`${label} ${col}: ${r.toFixed(2)}:1 < ${need}:1`);
    }
    if (type === "lowerThird" && hasBox) {
      const r = Math.min(ratio(parse(st.accentColor), over(bg, BLACK)), ratio(parse(st.accentColor), over(bg, WHITE)));
      worst = Math.min(worst, r);
      if (r < 4.5) issues.push(`subtext ${st.accentColor}: ${r.toFixed(2)}:1 < 4.5:1`);
    }
    rows.push({ type, id: p.id, variant: v.id, size, big, need, hasBox, color: st.color, accent: st.accentColor, bg: st.background, stroke: st.strokeColor ? `${st.strokeColor}/${st.strokeWidth}` : "—", worst: worst === Infinity ? 0 : +worst.toFixed(2), pass: issues.length === 0, issues });
  }
}

if (process.argv.includes("--json")) console.log(JSON.stringify(rows, null, 2));
else {
  console.log("loại        preset/biến thể                              cỡ  nền   chữ       ratio(min)  cần   kết quả");
  for (const r of rows) {
    console.log(`${r.type.padEnd(11)} ${(r.id + "/" + r.variant).padEnd(44)} ${String(r.size).padStart(3)} ${r.hasBox ? "hộp " : "trần"} ${r.color.padEnd(9)} ${String(r.worst).padStart(6)}      ${r.need}   ${r.pass ? "ĐẠT" : "KHÔNG ĐẠT"}`);
  }
  const bad = rows.filter((r) => !r.pass);
  console.log(`\nTổng ${rows.length} biến thể: ${rows.length - bad.length} đạt, ${bad.length} không đạt.`);
  if (bad.length) {
    console.log("\nDanh sách cần chuyển Sonnet preset (sửa generator scripts/th-presets/build-presets.mjs rồi `npm run th:presets`):");
    for (const r of bad) console.log(`- ${r.type} ${r.id}/${r.variant}: ${r.issues.join("; ")}`);
  }
}
