import { describe, expect, it } from "vitest";
import { clipTransformSpans, effectiveMoves, effectiveShifts, hasClipTransforms, staticCovers } from "./camera.js";
import { convertFace } from "./commands-broll.js";
import { ProjectSchema, VideoClipSchema, type Project } from "./project-schema.js";
import { INK, libplaceboMoves, placementExprs, scaleOverlayMoves } from "./video-moves.js";

const base = (extra: Record<string, unknown> = {}): Project =>
  ProjectSchema.parse({
    version: 1, job: "t", fps: 30, width: 1080, height: 1350, aspect: "4:5", duration: 10, source: { video: "cut.mp4" },
    videoClips: [{ id: "C-1", kind: "source", srcIn: 0, srcOut: 3 }, { id: "C-2", kind: "source", srcIn: 5, srcOut: 8, transform: { scale: 0.8, x: 10, y: -5 } }, { id: "C-3", kind: "hold", srcIn: 8, dur: 1 }],
    videoMoves: [{ start: 1, end: 2, mode: "zoom", scale: 1.2, source: "ai" }, { start: 4, end: 5, mode: "zoom", scale: 1.1, source: "user" }],
    videoShifts: [{ start: 1, end: 2, x: 10, source: "ai" }, { start: 6, end: 7, x: -5, source: "user" }],
    ...extra,
  });

describe("camera: máy quay tự do", () => {
  it("transform riêng của clip có giới hạn", () => {
    expect(() => VideoClipSchema.parse({ id: "a", kind: "source", srcIn: 0, srcOut: 1, transform: { scale: 9 } })).toThrow();
    expect(VideoClipSchema.parse({ id: "a", kind: "source", srcIn: 0, srcOut: 1, transform: { scale: 0.5 } }).transform).toEqual({ scale: 0.5, x: 0, y: 0 });
  });
  it("tắt máy quay tự động bỏ move/shift source ai", () => {
    expect(effectiveMoves(base())).toHaveLength(2);
    const off = base({ camera: { aiEnabled: false } });
    expect(effectiveMoves(off).map((m) => m.source)).toEqual(["user"]);
    expect(effectiveShifts(off).map((m) => m.source)).toEqual(["user"]);
  });
  it("đoạn thời gian của clip có khung riêng (khung nguyên)", () => {
    const sp = clipTransformSpans(base());
    expect(sp).toHaveLength(1);
    expect(sp[0].s).toBeCloseTo(3, 6);
    expect(sp[0].e).toBeCloseTo(6, 6);
    expect(hasClipTransforms(base())).toBe(true);
  });
  it("staticCovers: scale < 1 hoặc dịch quá mép → không phủ kín", () => {
    const info = { w: 1080, h: 1350 };
    expect(staticCovers(base(), info)).toBe(true);
    expect(staticCovers(base({ videoTransform: { scale: 0.8, x: 0, y: 0 } }), info)).toBe(false);
    expect(staticCovers(base({ videoTransform: { scale: 1.1, x: 20, y: 0 } }), info)).toBe(false);
    expect(staticCovers(base({ videoTransform: { scale: 1.5, x: 10, y: 0 } }), info)).toBe(true);
  });
  it("biểu thức libplacebo/CPU dùng pos_* + nền INK, đã lồng khung riêng clip", () => {
    const p = base(), info = { w: 1920, h: 1080 };
    const lp = libplaceboMoves(p, info), cpu = scaleOverlayMoves(p, info);
    expect(lp).toContain("pos_w=");
    expect(lp).toContain(`fillcolor=${INK}`);
    expect(lp).toContain("gte(t,");
    expect(cpu).toContain(`color=c=${INK}`);
    expect(cpu).toContain("eval=frame");
    expect(placementExprs(p, info, "t").count).toBeGreaterThan(0);
  });
  it("convertFace: cùng khung → giữ nguyên; zoom 2× quanh tâm → tâm giữ, kích thước ×2", () => {
    const id = { scale: 1, x: 0, y: 0 };
    const f = { x: 40, y: 20, w: 20, h: 20 };
    expect(convertFace(f, id, id)).toEqual(f);
    const g = convertFace(f, id, { scale: 2, x: 0, y: 0 });
    expect(g.w).toBe(40); expect(g.x + g.w / 2).toBeCloseTo(50, 1);
    expect(g.y + g.h / 2).toBeCloseTo(50 + (30 - 50) * 2, 1); // tâm y: 30 → 10
    const back = convertFace(g, { scale: 2, x: 0, y: 0 }, id);
    expect(back.x).toBeCloseTo(f.x, 1); expect(back.w).toBeCloseTo(f.w, 1);
  });
});
