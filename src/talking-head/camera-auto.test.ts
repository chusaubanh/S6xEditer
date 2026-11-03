import { describe, expect, it } from "vitest";
import { BrollPlanSchema, buildBroll, sceneInputs } from "./broll-plan.js";
import { autoCameraMoves, CAMERA_DEFAULTS, faceShift, sentenceBoundaries } from "./camera-auto.js";
import type { Project } from "./project-schema.js";

// 20 câu, mỗi câu 2 s, hở 0.1 s giữa các câu: ranh giới ở 2.05, 4.15, ...
const segments = Array.from({ length: 20 }, (_, i) => ({ start: i * 2.1, end: i * 2.1 + 2 }));
const words = segments.flatMap((s, i) => [0, 1].map((k) => ({ text: `w${i}${k}`, start: s.start + k, end: s.start + k + 0.9 })));
const DUR = 42;
const face = { x: 53, y: 17, w: 12, h: 13 };
const project = {
  version: 1, job: "t", fps: 30, width: 1080, height: 1350, aspect: "4:5", duration: DUR, source: { video: "cut.mp4" }, videoTransform: { scale: 1, x: 0, y: 0 }, tracks: [],
} as unknown as Project;
const plan = (beats: unknown[], camera?: unknown) => BrollPlanSchema.parse({ version: 1, beats, camera });
type M = { start: number; end: number; mode: string; scale: number; x: number; y: number; beatId?: string };
const movesOf = (p: Project) => (p as unknown as { videoMoves: M[] }).videoMoves;

describe("camera auto", () => {
  it("ranh giới = mọi chỗ nối segment (bất kể hở) + hở giữa từ ≥ 0.08 s", () => {
    expect(sentenceBoundaries([{ start: 0, end: 2 }, { start: 2.1, end: 4 }, { start: 5, end: 6 }])).toEqual([2.05, 4.5]);
    const w = [{ start: 0, end: 1 }, { start: 1.05, end: 2 }, { start: 2.2, end: 3 }];
    expect(sentenceBoundaries([], w)).toEqual([2.1]);
  });

  it("zoom nhẹ xen kẽ, cách 3–6 s, đầu/cuối ở ranh giới câu, ease 0.4–0.8", () => {
    const b = sentenceBoundaries(segments);
    const { moves } = autoCameraMoves({ boundaries: b, duration: DUR, blocked: [], camera: { ...CAMERA_DEFAULTS, auto: true }, face });
    expect(moves.length).toBeGreaterThan(5);
    for (const m of moves) {
      expect(b).toContain(m.end);
      expect(m.end - m.start).toBeGreaterThanOrEqual(3);
      expect(m.end - m.start).toBeLessThanOrEqual(6);
      expect(m.scale).toBeLessThanOrEqual(1.1);
      expect(m.ease.in).toBeGreaterThanOrEqual(0.4);
      expect(m.ease.in).toBeLessThanOrEqual(0.8);
    }
    expect(new Set(moves.map((m) => m.scale)).size).toBe(2); // xen kẽ hai mức
    for (let i = 1; i < moves.length; i++) expect(moves[i].start).toBeGreaterThanOrEqual(moves[i - 1].end);
  });

  it("không zoom trong cutaway và ±0.5 s quanh nó; zoom do plan chỉ định được ưu tiên và chặn auto chồng lên", () => {
    const beats = [
      { id: "c", start: 10, end: 14, kind: "cutaway", templateId: "frame-x" },
      { id: "z", start: 22, end: 24, kind: "zoom" },
    ];
    const { project: out } = buildBroll(project, plan(beats, { auto: true }), { words, segments, face });
    const moves = movesOf(out);
    const auto = moves.filter((m) => m.beatId?.startsWith("auto"));
    expect(auto.length).toBeGreaterThan(3);
    for (const m of auto) {
      expect(m.end <= 9.5 || m.start >= 14.5).toBe(true);
      expect(m.end <= 21.7 || m.start >= 24.3).toBe(true);
    }
    const punch = moves.find((m) => m.beatId === "z")!;
    expect(punch.scale).toBe(1.2);
    expect(punch.scale).toBeGreaterThan(Math.max(...auto.map((m) => m.scale)));
  });

  it("tâm zoom theo mặt: phóng về phía mặt, kẹp để video phủ kín khung", () => {
    const s = faceShift(face, 1.2);
    expect(s.x).toBeCloseTo(-(59 - 50) * 0.2, 1);
    expect(s.y).toBeCloseTo(-(23.5 - 50) * 0.2, 1);
    expect(Math.abs(faceShift({ x: 0, y: 0, w: 4, h: 4 }, 1.1).x)).toBeLessThanOrEqual(5);
  });
});

describe("overlay và inputs của scene", () => {
  it("overlay phủ toàn khung, nằm track Minh hoạ trên video, meta.overlay + role, sceneDuration và delays từ cues", () => {
    const beats = [{ id: "o1", start: 4, end: 10, kind: "overlay", templateId: "frame-tcvbh2-ov", role: "supplement", cues: [{ wordIndex: 4 }, { phrase: "w31" }] }];
    const { project: out, summary } = buildBroll(project, plan(beats), { words, segments, face });
    const track = out.tracks.find((t) => t.id === "t-overlay")!;
    expect(track.name).toBe("Minh hoạ");
    expect((track as unknown as { belowVideo?: boolean }).belowVideo).toBeUndefined();
    const l = track.layers[0];
    expect([l.x, l.y, l.w, l.h]).toEqual([0, 0, 100, 100]);
    expect(l.type).toBe("scene");
    expect(l.meta).toMatchObject({ overlay: true, role: "supplement", source: "ai" });
    expect(l.inputs).toMatchObject({ sceneDuration: 6, delays: [0.2, 3.3] });
    expect(summary[0].what).toContain("[supplement]");
  });

  it("sceneInputs: inputs của beat đè giá trị tự điền", () => {
    const b = plan([{ id: "x", start: 0, end: 3, kind: "cutaway", templateId: "t", inputs: { sceneDuration: 9, a: 1 } }]).beats[0];
    expect(sceneInputs(b, { start: 0, end: 3 }, words)).toEqual({ sceneDuration: 9, a: 1 });
  });

  it("asset dùng src trực tiếp, không cần manifest", () => {
    const { project: out, warnings } = buildBroll(project, plan([{ id: "a", start: 2, end: 5, kind: "asset", src: "output/t/art/x.svg" }]), { words, segments, face: { x: 42, y: 8, w: 16, h: 30 } });
    expect(out.tracks.find((t) => t.id === "t-broll")!.layers[0].src).toBe("output/t/art/x.svg");
    expect(warnings.filter((w) => !w.includes("subject.json"))).toEqual([]);
  });
});
