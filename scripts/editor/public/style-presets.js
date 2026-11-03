// Kiểu có sẵn cho subtitle / lowerThird. Chỉ dùng các trường style + animation đã có trong spec project.json v1.
const base = { accentColor: "#C5A059", align: "center", shadow: true, strokeColor: null, strokeWidth: 0 };

export const PRESETS = {
  subtitle: [
    { id: "s6x", label: "S6X hộp tối",
      style: { ...base, fontSize: 54, fontWeight: 800, color: "#EDEDED", background: "rgba(12,12,12,0.72)", radius: 16, padding: 24 },
      animation: { in: { kind: "rise", dur: 0.3 }, out: { kind: "fade", dur: 0.2 }, subtitleMode: "word" } },
    // Mạng xã hội: không nền, trắng đậm 900, viền đen 7 px (runtime vẽ stroke dưới fill nên dấu tiếng Việt không bị đè), từ đang nói vàng + phóng 1.06
    { id: "social", label: "Mạng xã hội",
      style: { ...base, fontSize: 68, fontWeight: 900, color: "#FFFFFF", background: "rgba(0,0,0,0)", radius: 0, padding: 12, strokeColor: "#000000", strokeWidth: 7, shadow: false },
      animation: { in: { kind: "pop", dur: 0.25 }, out: { kind: "fade", dur: 0.1 }, subtitleMode: "word" } },
    { id: "minimal", label: "Tối giản",
      style: { ...base, fontSize: 52, fontWeight: 700, color: "#FFFFFF", background: "rgba(0,0,0,0)", radius: 0, padding: 12 },
      animation: { in: { kind: "fade", dur: 0.2 }, out: { kind: "fade", dur: 0.2 }, subtitleMode: "word" } },
  ],
  lowerThird: [
    { id: "s6x", label: "S6X hộp tối",
      style: { ...base, align: "left", fontSize: 46, fontWeight: 800, color: "#EDEDED", background: "rgba(12,12,12,0.72)", radius: 10, padding: 22 },
      animation: { in: { kind: "left", dur: 0.5 }, out: { kind: "fade", dur: 0.3 } } },
    { id: "social", label: "Mạng xã hội",
      style: { ...base, align: "left", fontSize: 48, fontWeight: 900, color: "#0C0C0C", accentColor: "#0C0C0C", background: "#C5A059", radius: 8, padding: 22, shadow: false },
      animation: { in: { kind: "pop", dur: 0.35 }, out: { kind: "shrink", dur: 0.25 } } },
    { id: "minimal", label: "Tối giản",
      style: { ...base, align: "left", fontSize: 44, fontWeight: 700, color: "#FFFFFF", background: "rgba(0,0,0,0)", radius: 0, padding: 14 },
      animation: { in: { kind: "soft", dur: 0.6 }, out: { kind: "fade", dur: 0.3 } } },
  ],
};

/**
 * Vị trí/kích thước (% canvas) đẹp theo khung hình, nằm trong title-safe 90%. Dùng khi áp preset và khi thêm layer mới.
 * 16:9 (1920x1080), 4:5 (1080x1350), 9:16 (1080x1920).
 */
const LAYOUTS = {
  subtitle: { "16:9": { x: 15, y: 78, w: 70, h: 14 }, "4:5": { x: 8, y: 72, w: 84, h: 16 }, "9:16": { x: 15, y: 56, w: 70, h: 16 } },
  lowerThird: { "16:9": { x: 5, y: 60, w: 36, h: 14 }, "4:5": { x: 7, y: 7, w: 70, h: 12 }, "9:16": { x: 6, y: 8, w: 72, h: 11 } },
  callout: { "16:9": { x: 56, y: 12, w: 38, h: 18 }, "4:5": { x: 10, y: 24, w: 80, h: 14 }, "9:16": { x: 12, y: 30, w: 76, h: 14 } },
  text: { "16:9": { x: 10, y: 40, w: 80, h: 14 }, "4:5": { x: 10, y: 40, w: 80, h: 12 }, "9:16": { x: 10, y: 40, w: 80, h: 12 } },
  // cảnh scene-kit gốc 4:5 (1080x1350): khung dọc 4:5 phủ kín; khung 16:9 = thẻ 4:5 bên phải (45% x 100% = đúng tỷ lệ 4:5, không letterbox)
  scene: { "16:9": { x: 55, y: 0, w: 45, h: 100 }, "4:5": { x: 0, y: 0, w: 100, h: 100 }, "9:16": { x: 0, y: 0, w: 100, h: 100 } },
};
export function layoutFor(type, aspect) {
  const t = LAYOUTS[type] || LAYOUTS.text;
  return { ...(t[aspect] || t["9:16"]) };
}
