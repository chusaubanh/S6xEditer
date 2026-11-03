import { describe, expect, it } from "vitest";
import { loadPresets } from "./presets.js";
import { ProjectSchema, type Project } from "./project-schema.js";
import { loadSfxLibrary, planSfx, relinkSfx } from "./sfx-plan.js";

const lib = loadSfxLibrary();
const gfx = (id: string, start: number, inKind: string, outKind = "fade", type = "callout") => ({
  id, type, start, duration: 3, x: 5, y: 5, w: 40, h: 10, text: id,
  animation: { in: { kind: inKind, dur: 0.45 }, out: { kind: outKind, dur: 0.3 } },
});
const mk = (layers: unknown[], sfx: unknown[] = []): Project =>
  ProjectSchema.parse({
    version: 1, job: "t", width: 1920, height: 1080, aspect: "16:9", duration: 60, source: { video: "cut.mp4" },
    tracks: [
      { id: "t-gfx", kind: "graphics", name: "Đồ hoạ", layers },
      { id: "t-sub", kind: "subtitle", name: "Phụ đề", layers: [{ ...gfx("S-1", 1, "pop", "fade", "subtitle") }] },
      ...(sfx.length ? [{ id: "t-sfx", kind: "sfx", name: "SFX", layers: sfx }] : []),
    ],
  });

describe("sfx-plan", () => {
  const layers = [gfx("L-1", 2, "left", "fade", "lowerThird"), gfx("L-2", 8, "pop", "shrink"), gfx("L-3", 14, "stamp", "fade", "text"), gfx("L-4", 20, "rise", "up")];

  it("zoom nhấn của plan có SFX, zoom do camera auto thì không", () => {
    const base = mk([]);
    const mv = (start: number, beatId: string) => ({ start, end: start + 2, mode: "zoom", scale: 1.2, x: 0, y: 0, ease: { in: 0.5, out: 0.5 }, source: "ai", beatId });
    const out = planSfx({ ...base, videoMoves: [mv(10, "B1-zoom"), mv(30, "auto-1")] } as unknown as Project, { pack: "corporate", density: "low" });
    const ats = out.tracks.find((t) => t.kind === "sfx")!.layers.map((l) => l.start);
    expect(ats.some((a) => a > 9 && a < 12)).toBe(true);
    expect(ats.some((a) => a > 29 && a < 33)).toBe(false);
  });

  it("mỗi beat trong scene có pop nhẹ tại start+delay (không linkedLayerId), cách nhau ≥ 0.25 s; text mật độ low vẫn có SFX vào", () => {
    const scene = { id: "S-1", type: "scene", start: 10, duration: 8, x: 0, y: 0, w: 100, h: 100, templateId: "no-such", inputs: { delays: [0.5, 0.6, 2, 4] }, animation: { in: { kind: "fade", dur: 0.2 }, out: { kind: "fade", dur: 0.2 } }, meta: { overlay: true } };
    const out = planSfx(mk([scene, gfx("L-9", 30, "fade")]), { pack: "corporate", density: "low" });
    const a = out.tracks.find((t) => t.kind === "sfx")!.layers;
    const beats = a.filter((l) => !l.meta?.linkedLayerId && l.start > 10 && l.start < 18 && l.meta?.category === "pop-bubble");
    expect(beats.length).toBe(3); // 0.5 và 0.6 gộp thành một (cách < 0.25 s)
    expect(a.some((l) => l.meta?.linkedLayerId === "L-9")).toBe(true);
  });

  it("thư viện tự sinh có đủ danh mục", () => {
    expect(lib.length).toBeGreaterThan(100);
    expect(new Set(lib.map((e) => e.category)).size).toBeGreaterThanOrEqual(25);
  });

  it("tạo track SFX, gắn linkedLayerId/linkEdge, không có SFX cho phụ đề, xác định", () => {
    const p = mk(layers);
    const a = planSfx(p, { pack: "social", density: "mid" });
    const b = planSfx(p, { pack: "social", density: "mid" });
    expect(a).toEqual(b);
    const t = a.tracks.find((x) => x.kind === "sfx")!;
    expect(t.layers.length).toBeGreaterThanOrEqual(4);
    for (const l of t.layers) {
      expect(l.meta?.source).toBe("auto");
      expect(l.meta?.linkedLayerId).toMatch(/^L-/);
      expect(l.src).toMatch(/^assets\/sfx-th\//);
    }
    expect(t.layers.some((l) => l.meta?.linkedLayerId === "S-1")).toBe(false);
    // whoosh đặt sớm hơn lúc layer bắt đầu + dur (đỉnh trùng lúc tới nơi)
    const w = t.layers.find((l) => l.meta?.linkedLayerId === "L-1" && l.meta.linkEdge === "in")!;
    expect(w.start).toBeLessThan(2 + 0.45);
  });

  it("khoảng cách tối thiểu giữa các SFX và mật độ low < high", () => {
    const dense = Array.from({ length: 30 }, (_, i) => gfx(`L-${i}`, 1 + i * 0.4, "pop", "shrink"));
    const p = mk(dense);
    const lo = planSfx(p, { pack: "social", density: "low" }).tracks.find((x) => x.kind === "sfx")!.layers;
    const hi = planSfx(p, { pack: "social", density: "high" }).tracks.find((x) => x.kind === "sfx")!.layers;
    expect(hi.length).toBeGreaterThan(lo.length);
    const hitOf = (l: (typeof lo)[number]) => l.start + (lib.find((e) => e.file === l.src)?.hit ?? 0);
    const times = lo.map(hitOf).sort((x, y) => x - y);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(0.35 - 0.002);
  });

  it("không lặp cùng file 2 lần liên tiếp, không 2 SFX năng lượng cao liền nhau", () => {
    const many = Array.from({ length: 20 }, (_, i) => gfx(`L-${i}`, 2 + i * 1.5, "stamp", "fade", "text"));
    const out = planSfx(mk(many), { pack: "social", density: "mid" }).tracks.find((x) => x.kind === "sfx")!.layers;
    for (let i = 1; i < out.length; i++) {
      expect(out[i].src).not.toBe(out[i - 1].src);
      const e = (l: (typeof out)[number]) => lib.find((x) => x.file === l.src)!.energy;
      const h = (l: (typeof out)[number]) => l.start + (lib.find((x) => x.file === l.src)!.hit ?? 0);
      if (h(out[i]) - h(out[i - 1]) < 3 - 1e-6) expect(e(out[i]) === "high" && e(out[i - 1]) === "high").toBe(false);
    }
  });

  it("giữ SFX người dùng, chỉ thay layer auto", () => {
    const user = { id: "A-0100", type: "audio", start: 30, duration: 0.5, src: "assets/sfx-th/ding/ding-01.wav", meta: { source: "user" } };
    const old = { id: "A-0001", type: "audio", start: 40, duration: 0.5, src: "assets/sfx-th/tap/tap-01.wav", meta: { source: "auto", linkedLayerId: "L-1", linkEdge: "in" } };
    const out = planSfx(mk(layers, [user, old]), { pack: "corporate", density: "mid" });
    const ids = out.tracks.find((x) => x.kind === "sfx")!.layers.map((l) => l.id);
    expect(ids).toContain("A-0100");
    expect(ids).not.toContain("A-0001");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("relinkSfx dời SFX theo layer bị kéo, xoá SFX auto mồ côi, bỏ liên kết SFX người dùng", () => {
    const p = planSfx(mk(layers), { pack: "social", density: "mid" });
    const link = p.tracks.find((x) => x.kind === "sfx")!.layers.find((l) => l.meta?.linkedLayerId === "L-2" && l.meta.linkEdge === "in")!;
    const moved = structuredClone(p);
    moved.tracks[0].layers.find((l) => l.id === "L-2")!.start += 5;
    const r = relinkSfx(moved, lib).tracks.find((x) => x.kind === "sfx")!.layers.find((l) => l.id === link.id)!;
    expect(r.start).toBeCloseTo(link.start + 5, 2);
    const orphan = structuredClone(p);
    orphan.tracks[0].layers = orphan.tracks[0].layers.filter((l) => l.id !== "L-2");
    const sfx = orphan.tracks.find((x) => x.kind === "sfx")!;
    sfx.layers.find((l) => l.id !== link.id && l.meta?.linkedLayerId === "L-3")!.meta!.source = "user";
    const after = relinkSfx(orphan, lib).tracks.find((x) => x.kind === "sfx")!.layers;
    expect(after.some((l) => l.meta?.linkedLayerId === "L-2")).toBe(false);
  });

  it("mọi gói trong sfx-packs có danh mục tồn tại", () => {
    for (const pk of loadPresets().sfxPacks) {
      const out = planSfx(mk(layers), { pack: pk.id, density: "mid" }).tracks.find((x) => x.kind === "sfx")!;
      expect(out.layers.length).toBeGreaterThan(0);
    }
  });

  describe("B-roll", () => {
    // layer asset/transition/scene + videoMoves chèn thẳng (bỏ qua schema, vì schema do bên khác mở rộng)
    const raw = (l: Record<string, unknown>) => ({ x: 0, y: 0, w: 10, h: 10, rotation: 0, opacity: 1, animation: { in: { kind: "pop", dur: 0.4 }, out: { kind: "shrink", dur: 0.3 } }, ...l });
    const broll = (): Project => {
      const p = mk([]) as unknown as { tracks: { kind: string; layers: unknown[] }[]; videoMoves: unknown[] };
      p.tracks[0].layers.push(
        raw({ id: "X-1", type: "asset", start: 4, duration: 3, src: "a.svg" }),
        raw({ id: "X-2", type: "asset", start: 9, duration: 3, src: "b.svg", draw: { dur: 0.8 }, animation: { in: { kind: "fade", dur: 0.3 }, out: { kind: "fade", dur: 0.3 } } }),
        raw({ id: "T-1", type: "transition", kind: "wipe", start: 14, duration: 0.5, dur: 0.5 }),
        raw({ id: "S-9", type: "scene", start: 14.3, duration: 4, animation: { in: { kind: "fade", dur: 0.3 }, out: { kind: "fade", dur: 0.3 } } }),
        raw({ id: "T-2", type: "transition", kind: "shutter", start: 30, duration: 0.5, dur: 0.5 }),
      );
      p.videoMoves = [{ start: 22, end: 26, mode: "zoom", scale: 1.25, ease: { in: 0.4, out: 0.4 } }, { start: 40, end: 45, mode: "pip", ease: { in: 0.4, out: 0.4 } }];
      return p as unknown as Project;
    };
    const cats = (p: Project) => p.tracks.find((t) => t.kind === "sfx")!.layers.map((l) => `${l.meta?.linkedLayerId ?? "move"}:${l.meta?.category}`);

    it("low chỉ cutaway/transition/zoom; mid thêm asset in; high thêm draw", () => {
      const low = cats(planSfx(broll(), { pack: "corporate", density: "low" }));
      expect(low.some((c) => c.startsWith("X-1"))).toBe(true); // mọi phần tử hiện ra đều có SFX, kể cả mật độ low
      expect(low).toContain("T-1:transition-sweep");
      expect(low).toContain("T-2:camera-shutter");
      expect(low.some((c) => c.startsWith("move:impact-soft"))).toBe(true);
      expect(low.some((c) => c.startsWith("move:swoosh"))).toBe(false);
      const mid = cats(planSfx(broll(), { pack: "corporate", density: "mid" }));
      expect(mid).toContain("X-1:pop-bubble");
      expect(mid.some((c) => c.startsWith("X-2"))).toBe(false);
      expect(mid).toContain("move:swoosh-up");
      const high = cats(planSfx(broll(), { pack: "corporate", density: "high" }));
      expect(high).toContain("X-2:scribble");
    });

    it("cutaway cạnh transition không thêm SFX lặp; scene lẻ có transition-sweep vào/ra", () => {
      const out = cats(planSfx(broll(), { pack: "social", density: "mid" }));
      expect(out.filter((c) => c.startsWith("S-9")).length).toBe(1); // cạnh vào đã có T-1, chỉ còn cạnh ra
      expect(out).toContain("T-1:whoosh-fast");
      const p = mk([]) as unknown as { tracks: { layers: unknown[] }[] };
      p.tracks[0].layers.push(raw({ id: "S-1", type: "scene", start: 5, duration: 4, animation: { in: { kind: "fade", dur: 0.3 }, out: { kind: "fade", dur: 0.3 } } }));
      const sc = cats(planSfx(p as unknown as Project, { pack: "tech", density: "low" }));
      expect(sc).toEqual(["S-1:transition-sweep", "S-1:transition-sweep"]);
    });

    it("scribble bị cắt theo draw.dur và vẫn giữ khoảng cách tối thiểu", () => {
      const out = planSfx(broll(), { pack: "corporate", density: "high" }).tracks.find((t) => t.kind === "sfx")!.layers;
      const sc = out.find((l) => l.meta?.category === "scribble")!;
      expect(sc.duration).toBeLessThanOrEqual(0.9 + 1e-6);
      const hit = (l: (typeof out)[number]) => l.start + (lib.find((e) => e.file === l.src)?.hit ?? 0);
      const t = out.map(hit).sort((a, b) => a - b);
      for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeGreaterThanOrEqual(0.2 - 0.002);
    });
  });
});
