import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, aspectKey, applyPreset, loadPresets } from "./presets.js";
import { LayerSchema } from "./project-schema.js";

describe("presets", () => {
  const lib = loadPresets();
  const sfxCats = new Set(
    (JSON.parse(readFileSync(join(REPO_ROOT, "assets/sfx-th/manifest.json"), "utf8")) as { category: string }[]).map((e) => e.category),
  );

  it("mỗi loại >= 5 preset (text >= 4), mỗi preset 2-4 biến thể, có layout cho 2 tỷ lệ", () => {
    for (const [type, list] of Object.entries(lib.presets)) {
      expect(list.length).toBeGreaterThanOrEqual(type === "text" ? 4 : 5);
      for (const p of list) {
        expect(p.variants.length).toBeGreaterThanOrEqual(2);
        expect(p.variants.length).toBeLessThanOrEqual(4);
        for (const v of p.variants) {
          expect(v.layout["16:9"].w).toBeGreaterThan(0);
          expect(v.layout["4:5"].w).toBeGreaterThan(0);
        }
      }
    }
    expect(lib.sfxPacks.length).toBeGreaterThanOrEqual(4);
  });

  it("danh mục SFX trong preset và gói đều tồn tại trong thư viện", () => {
    const used: string[] = [];
    for (const list of Object.values(lib.presets))
      for (const p of list) for (const v of p.variants) used.push(...[v.sfx.in, v.sfx.out].filter((x): x is string => !!x));
    for (const pk of lib.sfxPacks) {
      for (const m of [...Object.values(pk.in), ...Object.values(pk.out), pk.emphasis]) if (m) used.push(m.category);
    }
    for (const c of used) expect(sfxCats.has(c), c).toBe(true);
  });

  it("font nằm trong assets/fonts", () => {
    const fonts = new Set(["Be Vietnam Pro", "Lexend", "Nunito"]);
    for (const list of Object.values(lib.presets)) for (const p of list) for (const v of p.variants) expect(fonts.has(v.style.fontFamily)).toBe(true);
    expect(existsSync(join(REPO_ROOT, "assets/fonts/Lexend.ttf"))).toBe(true);
  });

  it("applyPreset giữ text/thời gian/vị trí, đổi style + animation + meta", () => {
    const l = LayerSchema.parse({ id: "L-1", type: "lowerThird", start: 3, duration: 4, x: 7, y: 60, w: 50, h: 10, text: "An", subtext: "GĐ", meta: { source: "ai" } });
    const r = applyPreset(l, "lt-gold-bar", "solid");
    expect([r.id, r.text, r.subtext, r.start, r.duration, r.x, r.y, r.w, r.h]).toEqual(["L-1", "An", "GĐ", 3, 4, 7, 60, 50, 10]);
    expect(r.style.background).toBe("#C5A059");
    expect(r.meta).toMatchObject({ source: "ai", presetId: "lt-gold-bar", variantId: "solid" });
    expect(r.animation.in.kind).toBe("left");
    const n = applyPreset(l, "lt-gold-bar", "solid", { aspect: "16:9" });
    expect(n.x).toBe(5);
    expect(n.style.fontSize).toBe(37);
    expect(() => applyPreset(l, "lt-gold-bar", "nope")).toThrow();
  });

  it("9:16 rơi về bố cục 4:5", () => {
    expect(aspectKey("9:16")).toBe("4:5");
    expect(aspectKey("16:9")).toBe("16:9");
  });
});
