import { describe, expect, it } from "vitest";
import { BrollPlanSchema, buildBroll } from "./broll-plan.js";
import { addIntroToProject, buildIntroLayers, clippedWordWarnings, introAudioFilter, shiftPlan, shiftProject, shiftTranscript, snapIntro } from "./intro.js";
import type { Project, Transcript } from "./project-schema.js";

const w = (text: string, start: number, end: number) => ({ text, start, end });
const t = snapIntro(10, 14, 0.6, 30); // gap 18 khung + 120 khung = 138 khung = 4.6 s

describe("snapIntro", () => {
  it("D bằng (gap + to − from) theo khung nguyên", () => {
    expect(t.gapF).toBe(18);
    expect(t.toF - t.fromF).toBe(120);
    expect(t.D).toBeCloseTo(4.6, 6);
    const odd = snapIntro(61.457, 68.03, 0.6, 30);
    expect(odd.D * 30).toBeCloseTo(Math.round(odd.D * 30), 6);
    expect(() => snapIntro(5, 5.01, 0.6, 30)).toThrow();
  });

  it("cảnh báo khi cắt vào giữa từ và gợi ý biên an toàn", () => {
    const warn = clippedWordWarnings([w("Các", 9.9, 10.2), w("bạn", 10.3, 10.5), w("được", 13.9, 14.2)], t);
    expect(warn.length).toBe(2);
    expect(warn[0]).toContain("Các");
    expect(warn[1]).toContain("được");
    expect(clippedWordWarnings([w("a", 10.0, 10.2)], t)).toEqual([]);
  });
});

describe("dời thời gian", () => {
  const project = {
    version: 1, job: "j", fps: 30, width: 1080, height: 1350, aspect: "4:5", duration: 100, source: { video: "cut.mp4" },
    tracks: [
      { id: "t-sub", kind: "subtitle", name: "Phụ đề", layers: [{ id: "L-1", type: "subtitle", start: 1, duration: 2, x: 6, y: 74, w: 88, h: 14, text: "a b", words: [w("a", 1, 1.5), w("b", 1.5, 2)], style: { fontSize: 50, accentColor: "#C5A059" }, meta: { presetId: "p" } }] },
      { id: "t-trans", kind: "graphics", name: "CC", layers: [{ id: "T-1", type: "transition", start: 5, duration: 0.4, kind: "panel", color: "#C5A059", dir: "left" }] },
      { id: "t-sfx", kind: "sfx", name: "SFX", layers: [{ id: "A-1", type: "audio", start: 1.1, duration: 0.8, src: "x.wav", offset: 0.1, fadeOut: 0.03 }] },
      { id: "t-music", kind: "music", name: "Nhạc", layers: [{ id: "M-1", type: "audio", start: 0, duration: 100, src: "m.wav", fadeIn: 1.5 }] },
    ],
    videoMoves: [{ start: 2, end: 4, mode: "zoom", scale: 1.2, x: 0, y: 0, ease: { in: 0.3, out: 0.3 } }],
    videoShifts: [{ start: 6, end: 8 }],
  } as unknown as Project;

  it("layer, từ phụ đề, transition, SFX, videoMoves dời D; nhạc kéo dài; duration cập nhật; trường tương đối giữ nguyên", () => {
    const s = shiftProject(project as never, t.D) as never as { tracks: Array<{ id: string; layers: Array<Record<string, any>> }>; videoMoves: any[]; videoShifts: any[]; duration: number };
    const L = (id: string) => s.tracks.flatMap((x) => x.layers).find((l) => l.id === id)!;
    expect(L("L-1").start).toBeCloseTo(5.6, 3);
    expect(L("L-1").words[1].end).toBeCloseTo(6.6, 3);
    expect(L("T-1").start).toBeCloseTo(9.6, 3);
    expect(L("A-1").start).toBeCloseTo(5.7, 3);
    expect(L("A-1").offset).toBe(0.1); // offset trong file nguồn không dời
    expect(L("M-1").start).toBe(0);
    expect(L("M-1").duration).toBeCloseTo(104.6, 3);
    expect(s.videoMoves[0].start).toBeCloseTo(6.6, 3);
    expect(s.videoShifts[0].end).toBeCloseTo(12.6, 3);
    expect(s.duration).toBeCloseTo(104.6, 3);
    expect(project.duration).toBe(100); // không sửa bản gốc
  });

  it("layer intro: phụ đề kế thừa preset, chữ lớn hơn 10%, flash ở điểm nối, whoosh có đỉnh ở gap − 0.05 và fadeOut dưới giọng", () => {
    const words = [w("Các", 0.6, 0.9), w("bạn", 0.9, 1.2), w("nghe", 1.2, 1.5)];
    const lib = [{ id: "whoosh-long-electro-01", category: "whoosh-long-electro", file: "assets/sfx-th/x.wav", duration: 2.576, hit: 0.491, peakDb: -3, lufs: -20, tags: [], energy: "high" as const }];
    const layers = buildIntroLayers(project as never, words, t, { sfxId: "whoosh-long-electro-01", library: lib });
    expect(layers.subs[0].style.fontSize).toBe(55);
    expect(layers.subs[0].meta).toMatchObject({ presetId: "p", intro: true });
    expect(layers.flash.start).toBeCloseTo(t.D - 0.15, 3);
    const sfx = layers.sfx!;
    expect(sfx.start + sfx.offset! + 0.491 - sfx.offset!).toBeCloseTo(0.55, 2); // đỉnh = start + hit − offset
    expect(sfx.meta.peakAt).toBeCloseTo(0.55, 2);
    expect(sfx.fadeOut).toBeGreaterThan(0.3);
    const merged = addIntroToProject(shiftProject(project as never, t.D), layers) as never as { tracks: Array<{ id: string }> };
    expect(merged.tracks[0].id).toBe("t-intro");
  });

  it("transcript: segment intro chèn ở đầu, phần còn lại dời D, id đánh lại", () => {
    const tr = { language: "vi", duration: 100, segments: [
      { id: 0, start: 9, end: 11, text: "x", words: [w("x", 9, 9.4), w("Các", 10.1, 10.5), w("bạn", 10.5, 11)] },
      { id: 1, start: 20, end: 21, text: "y", words: [w("y", 20, 21)] },
    ] } as Transcript;
    const out = shiftTranscript(tr, t);
    expect(out.segments.map((s) => s.id)).toEqual([0, 1, 2]);
    expect(out.segments[0].words.map((x) => x.text)).toEqual(["Các", "bạn"]);
    expect(out.segments[0].words[0].start).toBeCloseTo(0.6 + 0.1, 2);
    expect(out.segments[2].start).toBeCloseTo(24.6, 3);
    expect(out.duration).toBeCloseTo(104.6, 3);
  });

  it("plan: start/end tường minh dời D, anchor giữ nguyên, introOffset ghi (cộng dồn)", () => {
    const p = shiftPlan({ version: 1, beats: [{ id: "a", start: 5, end: 8, kind: "cutaway" }, { id: "b", anchor: { phrase: "x", dur: 2 }, kind: "zoom" }], introOffset: 1 }, t.D) as any;
    expect(p.beats[0]).toMatchObject({ start: 9.6, end: 12.6 });
    expect(p.beats[1].anchor.phrase).toBe("x");
    expect(p.introOffset).toBeCloseTo(5.6, 3);
  });

  it("bộ lọc audio: im lặng + intro + cũ, chính xác theo mẫu", () => {
    const f = introAudioFilter(t, 2, 48000 * 100);
    expect(f).toContain("anullsrc=r=48000:cl=stereo,atrim=end_sample=28800");
    expect(f).toContain("atrim=start_sample=480000:end_sample=672000");
    expect(f).toContain("concat=n=3");
    expect(f).toContain("atrim=end_sample=4800000");
  });
});

describe("th:broll sau intro", () => {
  // intro lặp lại cụm "khách hàng" ở đầu; thân bài bắt đầu từ D = 6 s
  const words = [w("khách", 1, 1.4), w("hàng", 1.4, 1.8), w("a", 2, 2.2), w("b", 6, 6.3), w("khách", 8, 8.4), w("hàng", 8.4, 8.8), w("c", 9, 9.3)];
  const segments = [{ start: 1, end: 2.2 }, ...Array.from({ length: 12 }, (_, i) => ({ start: 6 + i * 2.1, end: 6 + i * 2.1 + 2 }))];
  const project = { version: 1, job: "j", fps: 30, width: 1080, height: 1350, aspect: "4:5", duration: 40, source: { video: "cut.mp4" }, videoTransform: { scale: 1, x: 0, y: 0 }, tracks: [] } as unknown as Project;
  const plan = (extra: object, beats: unknown[]) => BrollPlanSchema.parse({ version: 1, beats, ...extra });

  it("anchor theo cụm từ trùng với intro được giải về thân bài; wordIndex không bị lệch bởi từ intro", () => {
    const beats = [{ id: "z", anchor: { phrase: "khách hàng", dur: 2 }, kind: "zoom" }, { id: "k", anchor: { wordIndex: 3, dur: 1 }, kind: "zoom", scale: 1.1 }];
    const { project: out } = buildBroll(project, plan({ introOffset: 6 }, beats), { words, segments });
    const mv = (out as unknown as { videoMoves: Array<{ beatId: string; start: number }> }).videoMoves;
    expect(mv.find((m) => m.beatId === "z")!.start).toBeCloseTo(8, 3); // không rơi vào intro (1.0)
    // wordIndex 3 tính trên danh sách đã lọc bỏ từ intro: từ thứ 4 của thân bài (không có) -> bỏ qua kèm cảnh báo
    expect(mv.some((m) => m.beatId === "k")).toBe(false);
  });

  it("camera auto không đặt zoom trong intro hoặc vắt qua điểm nối", () => {
    const { project: out } = buildBroll(project, plan({ introOffset: 6, camera: { auto: true } }, []), { words, segments, face: { x: 53, y: 17, w: 12, h: 13 } });
    const mv = (out as unknown as { videoMoves: Array<{ start: number }> }).videoMoves;
    expect(mv.length).toBeGreaterThan(0);
    for (const m of mv) expect(m.start).toBeGreaterThanOrEqual(6.5 - 1e-6);
  });
});
