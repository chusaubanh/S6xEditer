import { describe, expect, it } from "vitest";
import { ProjectSchema } from "./project-schema.js";

const base = {
  version: 1, job: "t", fps: 30, width: 1080, height: 1350, aspect: "4:5", duration: 20,
  source: { video: "cut.mp4", audio: "audio.wav" },
};
const layer = (o: Record<string, unknown>) => ({ id: "L-1", start: 1, duration: 2, ...o });

describe("project.json — B-roll (asset, transition, videoMoves, belowVideo)", () => {
  it("project cũ (không videoMoves/belowVideo) vẫn hợp lệ và videoMoves mặc định []", () => {
    const p = ProjectSchema.parse({ ...base, tracks: [{ id: "t", kind: "graphics", name: "x", layers: [layer({ type: "text", text: "a" })] }] });
    expect(p.videoMoves).toEqual([]);
    expect(p.tracks[0].belowVideo).toBeUndefined();
  });

  it("layer asset: src, tint, draw, animation.loop", () => {
    const p = ProjectSchema.parse({
      ...base,
      tracks: [{ id: "t", kind: "graphics", name: "g", layers: [layer({
        type: "asset", src: "assets/th-assets/arrow.svg", x: 10, y: 10, w: 20, h: 20, tint: "#C5A059", draw: { dur: 0.8 },
        animation: { in: { kind: "pop", dur: 0.4 }, out: { kind: "shrink", dur: 0.3 }, loop: { kind: "float", period: 2.4, amp: 1 } },
      })] }],
    });
    const l = p.tracks[0].layers[0];
    expect(l.type).toBe("asset");
    expect(l.tint).toBe("#C5A059");
    expect(l.draw?.dur).toBe(0.8);
    expect(l.animation.loop?.kind).toBe("float");
  });

  it("animation.loop: period/amp có mặc định, kind lạ bị từ chối", () => {
    const ok = ProjectSchema.parse({ ...base, tracks: [{ id: "t", kind: "graphics", name: "g", layers: [layer({ type: "asset", animation: { loop: { kind: "pulse" } } })] }] });
    expect(ok.tracks[0].layers[0].animation.loop).toEqual({ kind: "pulse", period: 2.4, amp: 1 });
    expect(() => ProjectSchema.parse({ ...base, tracks: [{ id: "t", kind: "graphics", name: "g", layers: [layer({ type: "asset", animation: { loop: { kind: "spiral" } } })] }] })).toThrow();
  });

  it("layer transition: dạng lồng và dạng phẳng đều đọc được", () => {
    const nested = ProjectSchema.parse({ ...base, tracks: [{ id: "t", kind: "graphics", name: "g", layers: [layer({ type: "transition", transition: { kind: "wipe", dur: 0.4, dir: "right" } })] }] });
    expect(nested.tracks[0].layers[0].transition).toEqual({ kind: "wipe", dur: 0.4, color: "#C5A059", dir: "right" });
    const flat = ProjectSchema.parse({ ...base, tracks: [{ id: "t", kind: "graphics", name: "g", layers: [layer({ type: "transition", kind: "flash", color: "#fff", dir: "up" })] }] });
    expect(flat.tracks[0].layers[0].kind).toBe("flash");
    expect(() => ProjectSchema.parse({ ...base, tracks: [{ id: "t", kind: "graphics", name: "g", layers: [layer({ type: "transition", transition: { kind: "spin" } })] }] })).toThrow();
  });

  it("videoMoves: mặc định ease, pip tự có giá trị mặc định, sắp theo thời gian", () => {
    const p = ProjectSchema.parse({ ...base, videoMoves: [
      { start: 12, end: 15.5, mode: "pip" },
      { start: 2, end: 4, mode: "zoom", scale: 1.2 },
    ] });
    expect(p.videoMoves).toHaveLength(2);
    const pip = p.videoMoves.find((m) => m.mode === "pip")!;
    expect(pip.pip).toEqual({ x: 62, y: 58, w: 34, radius: 24, shadow: true });
    expect(pip.ease).toEqual({ in: 0.35, out: 0.35 });
    expect(p.videoMoves.find((m) => m.mode === "zoom")!.scale).toBe(1.2);
  });

  it("videoMoves chồng thời gian bị từ chối; chạm đầu-cuối thì được", () => {
    expect(() => ProjectSchema.parse({ ...base, videoMoves: [{ start: 1, end: 4, mode: "zoom" }, { start: 3, end: 6, mode: "zoom" }] })).toThrow(/chồng/);
    expect(() => ProjectSchema.parse({ ...base, videoMoves: [{ start: 1, end: 4, mode: "zoom" }, { start: 4, end: 6, mode: "kenburns" }] })).not.toThrow();
    expect(() => ProjectSchema.parse({ ...base, videoMoves: [{ start: 5, end: 5, mode: "zoom" }] })).toThrow();
  });

  it("track.belowVideo giữ nguyên", () => {
    const p = ProjectSchema.parse({ ...base, tracks: [{ id: "t", kind: "scene", name: "nền", belowVideo: true, layers: [] }] });
    expect(p.tracks[0].belowVideo).toBe(true);
  });
});
