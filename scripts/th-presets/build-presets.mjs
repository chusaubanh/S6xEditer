// Sinh lại assets/th-presets/*.json (npm run th:presets). Sửa preset ở đây rồi chạy lại, đừng sửa tay JSON.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "th-presets") + "/";
const BASE = { fontFamily: "Be Vietnam Pro", fontSize: 64, fontWeight: 800, color: "#EDEDED", accentColor: "#C5A059", background: "rgba(12,12,12,0.72)", align: "center", radius: 16, padding: 24, strokeColor: null, strokeWidth: 0, shadow: true };
const GOLD = "#C5A059", INK = "#0C0C0C", TXT = "#EDEDED", RED = "#EF4444";
const A = (i, d, o = { kind: "fade", dur: 0.3 }, extra = {}) => ({ in: { kind: i, dur: d }, out: o, ...extra });
const S = (i, o) => ({ in: i, out: o });
const NS = S(null, null);
// layout mặc định theo tỷ lệ (x,y,w,h theo % canvas). fontSize: 4:5 = style.fontSize (canvas rộng 1080), 16:9 = 0.85x
const L = (a, b) => ({ "16:9": a, "4:5": b });
const P = (id, name, style, lay, vs) => ({
  id, name,
  variants: vs.map(([vid, vname, so, animation, sfx]) => {
    const st = { ...BASE, ...style, ...so };
    const layout = {
      "16:9": { ...lay["16:9"], fontSize: Math.round(st.fontSize * 0.85) },
      "4:5": { ...lay["4:5"], fontSize: st.fontSize },
    };
    return { id: vid, name: vname, style: st, animation, sfx, layout };
  }),
});
const file = (type, presets) => writeFileSync(OUT + type + ".json", JSON.stringify({ type, presets }, null, 2), "utf8");

const subLay = L({ x: 15, y: 80, w: 70, h: 12 }, { x: 6, y: 74, w: 88, h: 14 });
file("subtitle", [
  P("sub-s6x-box", "S6X hộp tối", { fontSize: 54, fontWeight: 700, background: "rgba(12,12,12,0.82)", radius: 14, padding: 20 }, subLay, [
    ["gold", "Nhấn vàng", { accentColor: GOLD }, A("pop", 0.25, { kind: "fade", dur: 0.1 }, { subtitleMode: "word" }), NS],
    ["line", "Cả dòng", {}, A("fade", 0.2, { kind: "fade", dur: 0.1 }, { subtitleMode: "line" }), NS],
    ["solid", "Nền đặc", { background: "rgba(12,12,12,0.96)", shadow: false }, A("rise", 0.3, { kind: "fade", dur: 0.12 }, { subtitleMode: "word" }), NS],
  ]),
  P("sub-minimal", "Tối giản", { fontFamily: "Lexend", fontSize: 48, fontWeight: 600, background: "rgba(0,0,0,0)", padding: 6, radius: 0, strokeColor: INK, strokeWidth: 4 }, subLay, [
    ["clean", "Sạch", {}, A("fade", 0.2, { kind: "fade", dur: 0.15 }, { subtitleMode: "line" }), NS],
    ["gold", "Từ nhấn vàng", {}, A("soft", 0.25, { kind: "fade", dur: 0.15 }, { subtitleMode: "word" }), NS],
    ["dim", "Mờ nhẹ", { color: "#8A8D93", accentColor: TXT }, A("fade", 0.25, { kind: "fade", dur: 0.2 }, { subtitleMode: "word" }), NS],
  ]),
  P("sub-glass", "Kính mờ (glass)", { fontSize: 52, fontWeight: 600, background: "rgba(24,25,29,0.88)", radius: 28, padding: 22, strokeColor: "rgba(255,255,255,0.15)", strokeWidth: 2 }, subLay, [
    ["frost", "Mờ trắng", {}, A("soft", 0.3, { kind: "fade", dur: 0.15 }, { subtitleMode: "line" }), NS],
    ["gold", "Nhấn vàng", {}, A("rise", 0.3, { kind: "fade", dur: 0.15 }, { subtitleMode: "word" }), NS],
    ["dark", "Kính tối", { background: "rgba(12,12,12,0.92)" }, A("fade", 0.25, { kind: "fade", dur: 0.15 }, { subtitleMode: "word" }), NS],
  ]),
  P("sub-karaoke-gold", "Karaoke vàng", { fontSize: 60, fontWeight: 800, color: "#C9CCD1", accentColor: "#E0C286", background: "rgba(12,12,12,0.9)", radius: 20, padding: 22 }, subLay, [
    ["word", "Tô từng từ", {}, A("rise", 0.3, { kind: "fade", dur: 0.12 }, { subtitleMode: "word" }), NS],
    ["bright", "Chữ sáng", { color: TXT, accentColor: "#E0C286" }, A("pop", 0.25, { kind: "fade", dur: 0.12 }, { subtitleMode: "word" }), NS],
    ["outline", "Có viền", { strokeColor: INK, strokeWidth: 6, background: "rgba(0,0,0,0)" }, A("soft", 0.25, { kind: "fade", dur: 0.12 }, { subtitleMode: "word" }), NS],
  ]),
  P("sub-word-highlight", "Highlight nền vàng từng từ", { fontSize: 56, fontWeight: 800, color: TXT, accentColor: GOLD, background: "rgba(12,12,12,0.7)", radius: 12, padding: 18 }, subLay, [
    ["gold", "Nền vàng", {}, A("pop", 0.22, { kind: "fade", dur: 0.1 }, { subtitleMode: "word" }), NS],
    ["soft", "Nền vàng nhạt", { accentColor: "#E0C286" }, A("fade", 0.2, { kind: "fade", dur: 0.1 }, { subtitleMode: "word" }), NS],
    ["bold", "Viền đen", { background: "rgba(12,12,12,0)", strokeColor: INK, strokeWidth: 6 }, A("bounce", 0.3, { kind: "fade", dur: 0.1 }, { subtitleMode: "word" }), NS],
  ]),
  P("sub-social-outline", "Mạng xã hội viền đen", { fontSize: 66, fontWeight: 900, background: "rgba(0,0,0,0)", strokeColor: INK, strokeWidth: 8, padding: 8, radius: 0 }, subLay, [
    ["white", "Chữ trắng, nhấn vàng", {}, A("pop", 0.2, { kind: "fade", dur: 0.08 }, { subtitleMode: "word" }), NS],
    ["big", "Chữ to", { fontSize: 78, strokeWidth: 10 }, A("bounce", 0.3, { kind: "fade", dur: 0.08 }, { subtitleMode: "word" }), NS],
    ["gold", "Chữ vàng", { color: GOLD, accentColor: TXT }, A("zoom", 0.22, { kind: "fade", dur: 0.08 }, { subtitleMode: "line" }), NS],
  ]),
]);

const ltLay = L({ x: 5, y: 74, w: 40, h: 14 }, { x: 6, y: 72, w: 80, h: 12 });
file("lowerThird", [
  P("lt-glass", "Kính mờ", { fontSize: 44, fontWeight: 700, align: "left", background: "rgba(24,25,29,0.9)", radius: 24, padding: 28, strokeColor: "rgba(255,255,255,0.15)", strokeWidth: 2 }, ltLay, [
    ["gold", "Nhấn vàng", {}, A("left", 0.5), S("whoosh-soft", null)],
    ["dark", "Kính tối", { background: "rgba(12,12,12,0.92)" }, A("soft", 0.5), S("slide", null)],
    ["rise", "Trồi lên", {}, A("rise", 0.5, { kind: "down", dur: 0.3 }), S("whoosh-soft", "slide")],
  ]),
  P("lt-gold-bar", "Thanh vàng", { fontSize: 44, fontWeight: 800, align: "left", background: "rgba(12,12,12,0.85)", radius: 4, padding: 26, strokeColor: GOLD, strokeWidth: 4 }, ltLay, [
    ["bar", "Viền vàng", {}, A("left", 0.45), S("whoosh-soft", null)],
    ["solid", "Nền vàng", { background: GOLD, color: INK, accentColor: INK, strokeColor: null, strokeWidth: 0, shadow: false }, A("left", 0.45), S("whoosh-soft", null)],
    ["right", "Từ phải", {}, A("right", 0.45), S("whoosh-soft", "slide")],
  ]),
  P("lt-underline", "Tối giản gạch chân", { fontFamily: "Lexend", fontSize: 42, fontWeight: 600, align: "left", background: "rgba(0,0,0,0)", radius: 0, padding: 12, strokeColor: INK, strokeWidth: 4 }, ltLay, [
    ["gold", "Gạch vàng", {}, A("soft", 0.5), S("tap", null)],
    ["white", "Gạch trắng", { accentColor: TXT }, A("fade", 0.4), S("tap", null)],
    ["rise", "Trồi nhẹ", {}, A("rise", 0.45, { kind: "up", dur: 0.3 }), S("whoosh-soft", null)],
  ]),
  P("lt-card", "Thẻ bo tròn", { fontFamily: "Nunito", fontSize: 44, fontWeight: 800, align: "left", background: "rgba(20,21,23,0.92)", radius: 36, padding: 30 }, ltLay, [
    ["dark", "Thẻ tối", {}, A("pop", 0.45), S("pop-bubble", null)],
    ["gold", "Thẻ vàng", { background: GOLD, color: INK, accentColor: INK }, A("bounce", 0.5), S("pop", "tap")],
    ["light", "Thẻ sáng", { background: "rgba(237,237,237,0.95)", color: INK, accentColor: "#6B4E14" }, A("zoom", 0.45), S("ding", null)],
  ]),
  P("lt-news", "Tin tức", { fontSize: 46, fontWeight: 800, align: "left", background: "rgba(12,12,12,0.9)", radius: 0, padding: 24, strokeColor: GOLD, strokeWidth: 3 }, ltLay, [
    ["classic", "Cổ điển", {}, A("left", 0.4), S("swoosh-up", null)],
    ["flash", "Nhanh", {}, A("stamp", 0.35), S("stamp", null)],
    ["clean", "Gọn", { strokeWidth: 0 }, A("drop", 0.4, { kind: "up", dur: 0.25 }), S("whoosh-fast", "swoosh-up")],
  ]),
]);

const coLay = L({ x: 58, y: 16, w: 36, h: 22 }, { x: 8, y: 14, w: 84, h: 18 });
const bigLay = L({ x: 55, y: 22, w: 40, h: 30 }, { x: 10, y: 18, w: 80, h: 22 });
file("callout", [
  P("co-note", "Ghi chú", { fontSize: 40, fontWeight: 600, align: "left", background: "rgba(20,21,23,0.9)", radius: 20, padding: 28, strokeColor: GOLD, strokeWidth: 2 }, coLay, [
    ["gold", "Viền vàng", {}, A("pop", 0.4, { kind: "shrink", dur: 0.25 }), S("pop-bubble", null)],
    ["soft", "Nhẹ nhàng", { strokeWidth: 0 }, A("soft", 0.45), S("tap", null)],
    ["card", "Thẻ sáng", { background: "rgba(237,237,237,0.95)", color: INK, accentColor: GOLD, strokeWidth: 0 }, A("rise", 0.45), S("click-ui", null)],
  ]),
  P("co-warning", "Cảnh báo", { fontSize: 44, fontWeight: 800, align: "left", background: "rgba(12,12,12,0.9)", radius: 16, padding: 28, strokeColor: RED, strokeWidth: 4, accentColor: RED }, coLay, [
    ["red", "Viền đỏ", {}, A("stamp", 0.35, { kind: "shrink", dur: 0.25 }), S("error-soft", null)],
    ["fill", "Nền đỏ", { background: "#B91C1C", color: TXT, strokeColor: null, strokeWidth: 0, accentColor: TXT }, A("bounce", 0.4), S("impact-soft", null)],
    ["quiet", "Nhẹ", { strokeWidth: 2 }, A("soft", 0.4), S("error-soft", null)],
  ]),
  P("co-bignumber", "Số liệu lớn", { fontSize: 120, fontWeight: 900, background: "rgba(12,12,12,0)", radius: 0, padding: 12, color: GOLD, strokeColor: INK, strokeWidth: 8 }, bigLay, [
    ["gold", "Số vàng", {}, A("zoom", 0.5, { kind: "shrink", dur: 0.3 }), S("impact-soft", null)],
    ["white", "Số trắng", { color: TXT }, A("stamp", 0.4), S("stamp", null)],
    ["card", "Trên nền", { background: "rgba(12,12,12,0.85)", radius: 28, padding: 32 }, A("pop", 0.45), S("pop", "tap")],
  ]),
  P("co-quote", "Trích dẫn", { fontFamily: "Nunito", fontSize: 46, fontWeight: 700, align: "left", background: "rgba(20,21,23,0.85)", radius: 8, padding: 36 }, coLay, [
    ["gold", "Nhấn vàng", {}, A("soft", 0.6), S("sparkle", null)],
    ["center", "Căn giữa", { align: "center" }, A("fade", 0.5), S("chime", null)],
    ["light", "Nền sáng", { background: "rgba(237,237,237,0.95)", color: INK }, A("rise", 0.5), S("whoosh-soft", null)],
  ]),
  P("co-checklist", "Checklist", { fontSize: 42, fontWeight: 700, align: "left", background: "rgba(20,21,23,0.9)", radius: 20, padding: 28, strokeColor: INK, strokeWidth: 4 }, coLay, [
    ["gold", "Tích vàng", {}, A("left", 0.4), S("click-ui", null)],
    ["ok", "Tích xanh", { accentColor: "#22C55E" }, A("pop", 0.35), S("success", null)],
    ["plain", "Không nền", { background: "rgba(0,0,0,0)" }, A("rise", 0.4), S("tick", null)],
  ]),
]);

file("text", [
  P("tx-title", "Tiêu đề lớn", { fontSize: 96, fontWeight: 900, background: "rgba(0,0,0,0)", padding: 12, radius: 0, strokeColor: INK, strokeWidth: 6 }, L({ x: 10, y: 38, w: 80, h: 20 }, { x: 8, y: 36, w: 84, h: 18 }), [
    ["white", "Chữ trắng", {}, A("rise", 0.55, { kind: "up", dur: 0.35 }), S("whoosh-soft", null)],
    ["gold", "Chữ vàng", { color: GOLD }, A("zoom", 0.55), S("impact-soft", null)],
    ["box", "Trên hộp tối", { background: "rgba(12,12,12,0.85)", radius: 24, padding: 32 }, A("stamp", 0.4), S("stamp", null)],
  ]),
  P("tx-keyword", "Từ khoá nhấn", { fontSize: 80, fontWeight: 900, color: GOLD, background: "rgba(0,0,0,0)", strokeColor: INK, strokeWidth: 8, padding: 8, radius: 0 }, L({ x: 25, y: 40, w: 50, h: 14 }, { x: 10, y: 38, w: 80, h: 12 }), [
    ["pop", "Bật ra", {}, A("pop", 0.3, { kind: "shrink", dur: 0.2 }), S("pop", null)],
    ["bounce", "Nảy", {}, A("bounce", 0.4), S("pop-bubble", null)],
    ["white", "Chữ trắng", { color: TXT }, A("stamp", 0.3), S("tick", null)],
  ]),
  P("tx-counter", "Số đếm", { fontFamily: "Lexend", fontSize: 140, fontWeight: 800, color: TXT, background: "rgba(0,0,0,0)", padding: 12, radius: 0, strokeColor: INK, strokeWidth: 8 }, L({ x: 30, y: 30, w: 40, h: 28 }, { x: 15, y: 28, w: 70, h: 22 }), [
    ["gold", "Số vàng", { color: GOLD }, A("zoom", 0.5), S("riser-short", null)],
    ["white", "Số trắng", {}, A("drop", 0.45), S("impact-soft", null)],
    ["card", "Trên thẻ", { background: "rgba(12,12,12,0.85)", radius: 32, padding: 36 }, A("pop", 0.45), S("pop", null)],
  ]),
  P("tx-question", "Câu hỏi", { fontFamily: "Nunito", fontSize: 72, fontWeight: 800, background: "rgba(12,12,12,0.75)", radius: 28, padding: 32 }, L({ x: 15, y: 18, w: 70, h: 16 }, { x: 8, y: 16, w: 84, h: 16 }), [
    ["gold", "Nhấn vàng", {}, A("soft", 0.5), S("notification", null)],
    ["bare", "Không nền", { background: "rgba(0,0,0,0)", strokeColor: INK, strokeWidth: 6 }, A("rise", 0.45), S("whoosh-soft", null)],
    ["glass", "Kính mờ", { background: "rgba(24,25,29,0.88)", strokeColor: "rgba(255,255,255,0.15)", strokeWidth: 2 }, A("fade", 0.5), S("click-ui", null)],
  ]),
]);

// ---- gói SFX (prefer: nguồn ưu tiên khi có cả hai — "kenney" = thu thật CC0 nếu đã nhập, rơi về "synth")
const K = (c, g) => (c ? { category: c, gainDb: g } : null);
const pack = (id, name, description, prefer, inMap, outMap, emphasis) => ({ id, name, description, prefer, in: inMap, out: outMap, emphasis, intro: K("whoosh-long-electro", -10) });
writeFileSync(OUT + "sfx-packs.json", JSON.stringify({ type: "sfxPacks", packs: [
  pack("corporate", "Doanh nghiệp sang trọng", "Chuông, tiếng gõ nhẹ, chuyển động mượt; không meme.", "kenney",
    { rise: K("whoosh-soft", -15), drop: K("whoosh-soft", -15), left: K("slide", -15), right: K("slide", -15), pop: K("ding", -15), bounce: K("chime", -15), zoom: K("transition-sweep", -16), soft: K("tap", -15), stamp: K("impact-soft", -12), fade: null },
    { fade: null, shrink: null, up: null, down: null }, K("tick", -26)),
  pack("minimal", "Tối giản", "Nhẹ, ít, tinh tế; hợp nội dung nghiêm túc.", "kenney",
    { rise: K("whoosh-soft", -14), drop: K("whoosh-soft", -14), left: K("slide", -14), right: K("slide", -14), pop: K("pop-bubble", -13), bounce: K("pop-bubble", -12), zoom: K("whoosh-soft", -14), soft: K("tap", -14), stamp: K("tap", -10), fade: null },
    { fade: null, shrink: null, up: K("slide", -18), down: K("slide", -18) }, K("tick", -24)),
  pack("social", "Năng động mạng xã hội", "Nhanh, nhiều điểm nhấn: whoosh nhanh, pop, impact.", "synth",
    { rise: K("whoosh-fast", -10), drop: K("swoosh-down", -10), left: K("whoosh-fast", -10), right: K("whoosh-fast", -10), pop: K("pop", -9), bounce: K("pop", -8), zoom: K("swoosh-up", -10), soft: K("whoosh-soft", -13), stamp: K("stamp", -8), fade: null },
    { fade: null, shrink: K("pop-bubble", -14), up: K("swoosh-up", -15), down: K("swoosh-down", -15) }, K("tick", -20)),
  pack("tech", "Công nghệ", "Click số, glitch, gõ phím, thông báo.", "synth",
    { rise: K("slide", -11), drop: K("glitch", -12), left: K("slide", -11), right: K("slide", -11), pop: K("click-ui", -9), bounce: K("notification", -12), zoom: K("transition-sweep", -12), soft: K("click-ui", -12), stamp: K("glitch", -10), fade: null },
    { fade: null, shrink: K("click-ui", -16), up: K("tick", -16), down: K("tick", -16) }, K("typing", -22)),
] }, null, 2), "utf8");
