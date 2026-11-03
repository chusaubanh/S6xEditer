import { describe, expect, it } from "vitest";
import { BrollPlanSchema, buildBroll, buildShifts, placeAuto, resolveBeatTime, type AssetInfo, type BrollContext } from "./broll-plan.js";
import type { Project } from "./project-schema.js";

const words = ["Hôm", "nay", "mình", "nói", "về", "quy", "tắc", "ba", "giây"].map((t, i) => ({ text: t, start: i * 0.5, end: i * 0.5 + 0.4 }));
const assets = new Map<string, AssetInfo>([
  ["phone", { id: "phone", file: "phone.svg", aspect: 0.6, defaultSize: { w: 24 }, drawable: false, tintable: true }],
  ["arrow", { id: "arrow", file: "arrow.svg", aspect: 1, defaultSize: { w: 20 }, drawable: true }],
]);
const ctx: BrollContext = { words, assets, face: { x: 55, y: 10, w: 30, h: 35 } };

const baseProject = (extra: Partial<Project> = {}): Project =>
  ({
    version: 1, job: "t", fps: 30, width: 1080, height: 1350, aspect: "4:5", duration: 60, source: { video: "cut.mp4" }, videoTransform: { scale: 1, x: 0, y: 0 },
    tracks: [
      { id: "t-sub", kind: "subtitle", name: "Phụ đề", hidden: false, locked: false, layers: [{ id: "L-1", type: "subtitle", start: 0, duration: 60, x: 6, y: 74, w: 88, h: 14 }] },
    ],
    ...extra,
  }) as unknown as Project;

const plan = (beats: unknown[]) => BrollPlanSchema.parse({ version: 1, beats });
const layersOf = (p: Project, trackId: string) => p.tracks.find((t) => t.id === trackId)?.layers ?? [];

describe("buildBroll", () => {
  it("vị trí auto tránh mặt, phụ đề và nằm trong title-safe", () => {
    const { project, warnings } = buildBroll(baseProject(), plan([{ id: "b1", start: 2, end: 5, kind: "asset", assetId: "phone" }]), ctx);
    const l = layersOf(project, "t-broll")[0];
    expect(l.type).toBe("asset");
    expect(l.src).toBe("assets/th-assets/phone.svg");
    const r = { x: l.x, y: l.y, w: l.w, h: l.h };
    expect(r.x).toBeGreaterThanOrEqual(6);
    expect(r.x + r.w).toBeLessThanOrEqual(94);
    expect(r.x + r.w <= 55 - 2).toBe(true); // lệch sang trái, né mặt (x 55–85)
    expect(r.y + r.h).toBeLessThanOrEqual(74); // không chạm phụ đề
    expect(warnings.filter((w) => !w.includes("subject.json"))).toEqual([]);
  });

  it("không có chỗ trống thì trả null; vùng mặt mặc định khi thiếu subject.json", () => {
    expect(placeAuto({ w: 40, h: 40 }, { x: 0, y: 0, w: 100, h: 100 }, [], [])).toBeNull();
    const { warnings } = buildBroll(baseProject(), plan([]), { words, assets });
    expect(warnings[0]).toContain("subject.json");
  });

  it("giới hạn ≤ 2 asset/keyword cùng lúc, beat thứ 3 bị bỏ kèm cảnh báo", () => {
    const beats = [
      { id: "a", start: 1, end: 6, kind: "asset", assetId: "phone" },
      { id: "b", start: 2, end: 6, kind: "asset", assetId: "arrow" },
      { id: "c", start: 3, end: 5, kind: "asset", assetId: "arrow" },
      { id: "d", start: 7, end: 9, kind: "asset", assetId: "arrow" },
    ];
    const { project, warnings } = buildBroll(baseProject(), plan(beats), { ...ctx, face: { x: 35, y: 8, w: 30, h: 35 } }); // mặt giữa: hai bên trống
    expect(layersOf(project, "t-broll").map((l) => l.meta?.beatId)).toEqual(["a", "b", "d"]);
    expect(warnings.some((w) => w.includes("Beat c") && w.includes("≤ 2"))).toBe(true);
  });

  it("cảnh báo cutaway ngoài 2–6 s và quay lại người nói < 2 s; không tự sửa", () => {
    const beats = [
      { id: "c1", start: 10, end: 11.5, kind: "cutaway", templateId: "frame-tcvbh2-a" },
      { id: "c2", start: 12.5, end: 20, kind: "cutaway", templateId: "frame-tcvbh2-b", transitionIn: { kind: "flash", dur: 0.3 } },
    ];
    const { project, warnings } = buildBroll(baseProject(), plan(beats), ctx);
    expect(warnings.some((w) => w.includes("c1") && w.includes("2–6"))).toBe(true);
    expect(warnings.some((w) => w.includes("c2") && w.includes("≥ 2 s"))).toBe(true);
    expect(layersOf(project, "t-scene").map((l) => [l.start, l.duration])).toEqual([[10, 1.5], [12.5, 7.5]]); // giữ nguyên
    expect(layersOf(project, "t-trans")[0].type).toBe("transition");
    expect(layersOf(project, "t-trans")[0].animation.in.dur).toBeGreaterThan(0); // planSfx đọc animation.in của mọi layer đồ hoạ
  });

  it("track phụ đề nằm trên cùng, trên chuyển cảnh/B-roll/minh hoạ/cảnh", () => {
    const beats = [
      { id: "o", start: 1, end: 5, kind: "overlay", templateId: "frame-x" },
      { id: "c", start: 10, end: 14, kind: "cutaway", templateId: "frame-y", transitionIn: { kind: "flash", dur: 0.3 } },
    ];
    const ids = buildBroll(baseProject(), plan(beats), ctx).project.tracks.map((t) => t.id);
    expect(ids[0]).toBe("t-sub");
    for (const id of ["t-trans", "t-overlay", "t-scene"]) expect(ids.indexOf(id)).toBeGreaterThan(0);
  });

  it("dịch người nói sang phía đối diện overlay: gộp cùng phía, chéo mượt khác phía, ẩn dưới cutaway, kẹp theo room", () => {
    const vt = { scale: 2.9, x: -16 };
    const w: string[] = [];
    const sh = buildShifts(
      [{ start: 6, end: 10, side: "left", beatId: "a" }, { start: 10.3, end: 14, side: "left", beatId: "b" }, { start: 20, end: 25, side: "right", beatId: "c" }, { start: 25, end: 30, side: "left", beatId: "d" }, { start: 41, end: 45, side: "left", beatId: "e" }],
      [{ start: 33, end: 40.8 }], 53, vt, 60, w,
    ) as Array<{ start: number; end: number; x: number; beatId: string }>;
    expect(sh.map((x) => x.beatId)).toEqual(["a+b", "c", "d", "e"]); // a,b gộp một lần dịch
    expect(sh[0].x).toBeCloseTo(17); // 70 − 53: người nói sang phải, minh hoạ bên trái
    expect(sh[1].x).toBeCloseTo(-23); // bên phải: về 30%
    expect(sh[0].start).toBeCloseTo(5.7); // trước overlay 0.3 s
    expect(sh[1].end).toBeGreaterThan(sh[2].start); // c và d chéo nhau (không giật qua lại)
    expect(buildShifts([{ start: 0, end: 3, side: "left", beatId: "t" }], [], 53, vt, 60, w)[0]).toMatchObject({ start: 0, ease: { in: 0 } }); // đầu video: không ease vào
    expect(sh[3].start).toBeCloseTo(40.3); // ngay sau cutaway: mở chỗ trống khi còn bị che
    const tight = buildShifts([{ start: 1, end: 3, side: "left", beatId: "z" }], [], 20, { scale: 1.2, x: 0 }, 60, w) as Array<{ x: number }>;
    expect(tight[0].x).toBeCloseTo(10); // kẹp ở (1.2−1)·50, không lộ viền
    expect(w.some((m) => m.includes("room"))).toBe(true);
  });

  it("beat overlay có side sinh videoShifts source ai, dựng lại không nhân đôi", () => {
    const pl = plan([{ id: "o", start: 5, end: 9, kind: "overlay", templateId: "frame-x", side: "left" }]);
    const c2 = { ...ctx, face: { x: 30, y: 10, w: 20, h: 30 } };
    const once = buildBroll(baseProject({ videoTransform: { scale: 2.9, x: -16, y: 50 } } as Partial<Project>), pl, c2).project;
    const twice = buildBroll(once, pl, c2).project;
    const shifts = (twice as unknown as { videoShifts: Array<{ source: string }> }).videoShifts;
    expect(shifts.length).toBe(1);
    expect(shifts[0].source).toBe("ai");
  });

  it("neo theo cụm từ, dựng lại xoá layer ai cũ và giữ layer user", () => {
    expect(resolveBeatTime(plan([{ id: "x", anchor: { phrase: "quy tắc", dur: 2 }, kind: "keyword", text: "q" }]).beats[0], words)).toEqual({ start: 2.5, end: 4.5 });
    const first = buildBroll(baseProject(), plan([{ id: "a", start: 1, end: 4, kind: "asset", assetId: "arrow" }]), ctx).project;
    layersOf(first, "t-broll").push({ ...layersOf(first, "t-broll")[0], id: "U-1", meta: { source: "user" } } as never);
    const again = buildBroll(first, plan([{ id: "z", start: 20, end: 23, kind: "asset", assetId: "arrow" }]), ctx).project;
    expect(layersOf(again, "t-broll").map((l) => l.meta?.source)).toEqual(["user", "ai"]);
    expect(layersOf(again, "t-broll").some((l) => l.meta?.beatId === "a")).toBe(false);
  });

  it("pip dựng cảnh nền belowVideo + videoMove; camera move chồng nhau bị bỏ kèm cảnh báo", () => {
    const beats = [
      { id: "z1", start: 5, end: 8, kind: "zoom" },
      { id: "z2", start: 7, end: 9, kind: "kenburns" },
      { id: "p1", start: 20, end: 25, kind: "pip", templateId: "frame-tcvbh2-c" },
    ];
    const { project, warnings } = buildBroll(baseProject(), plan(beats), ctx);
    const moves = (project as unknown as { videoMoves: Array<{ mode: string }> }).videoMoves;
    expect(moves.map((m) => m.mode)).toEqual(["zoom", "pip"]);
    expect(warnings.some((w) => w.includes("z2") && w.includes("chồng"))).toBe(true);
    expect((project.tracks.find((t) => t.id === "t-scene-below") as unknown as { belowVideo: boolean }).belowVideo).toBe(true);
  });
});
