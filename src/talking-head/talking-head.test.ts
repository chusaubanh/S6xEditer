import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { alignEdits, alignSegment } from "./align-edits.js";
import { outlineLayers } from "./commands-media.js";
import { buildAudioFilter, buildVideoFilter, snapKeeps } from "./cut-render.js";
import { keepRangesFromCuts, mapTime, remapTranscript } from "./cut-core.js";
import { fillerCandidates, mergeNearby, renderCutsMd, repeatCandidates, silenceCandidates } from "./cut-plan.js";
import { CutsSchema, LayerSchema, OutlineSchema, ProjectSchema, loadProject, saveProject, type Project, type Segment } from "./project-schema.js";
import { splitSubtitles } from "./subtitles.js";

const w = (text: string, start: number, end: number) => ({ text, start, end });

describe("project schema", () => {
  const base: Project = ProjectSchema.parse({
    version: 1, job: "t", width: 1080, height: 1920, aspect: "9:16", duration: 10, source: { video: "cut.mp4" },
    tracks: [{ id: "t-sub", kind: "subtitle", name: "Phụ đề", layers: [] }],
  });

  it("điền mặc định cho layer và từ chối type sai", () => {
    const l = LayerSchema.parse({ id: "L-1", type: "text", start: 0, duration: 1, x: 0, y: 0, w: 10, h: 10, text: "a" });
    expect(l.style.accentColor).toBe("#C5A059");
    expect(l.animation.in.kind).toBe("fade");
    expect(() => LayerSchema.parse({ ...l, type: "video" })).toThrow();
    expect(() => ProjectSchema.parse({ ...base, version: 2 })).toThrow();
  });

  it("layer audio, project.audio mặc định, track sfx/music chỉ nhận audio", () => {
    const a = { id: "A-1", type: "audio", start: 1, duration: 0.8, src: "assets/sfx/x.mp3", offset: 0, gainDb: -8, fadeIn: 0, fadeOut: 0.05, meta: { category: "whoosh", linkedLayerId: "L-1", linkEdge: "in", presetId: "p", variantId: "v" } };
    const layer = LayerSchema.parse(a);
    expect(layer.w).toBe(0);
    expect(() => LayerSchema.parse({ ...a, meta: { linkEdge: "mid" } })).toThrow();
    const withAudio = ProjectSchema.parse({ ...base, audio: {}, tracks: [{ id: "t-sfx", kind: "sfx", name: "SFX", layers: [a] }] });
    expect(withAudio.audio).toEqual({ voice: { gainDb: 0, muted: false }, music: { duckDb: -12, attack: 0.15, release: 0.45 }, master: { lufs: -16, truePeak: -1.5 } });
    expect(base.audio).toBeUndefined();
    const text = { id: "L-2", type: "text", start: 0, duration: 1, x: 0, y: 0, w: 1, h: 1 };
    expect(() => ProjectSchema.parse({ ...base, tracks: [{ id: "t-m", kind: "music", name: "Nhạc", layers: [text] }] })).toThrow();
  });

  it("outline lồng và cuts hợp lệ", () => {
    expect(() => OutlineSchema.parse({ summary: "s", items: [{ id: "1", title: "a", level: 1, start: 0, end: 5, children: [{ id: "1.1", title: "b", level: 2, start: 0, end: 2 }] }] })).not.toThrow();
    expect(() => OutlineSchema.parse({ summary: "s", items: [{ id: "x", title: "a", level: 1, start: 0, end: 5 }] })).toThrow();
    expect(CutsSchema.parse({ ranges: [{ start: 0, end: 1, reason: "r", source: "auto" }] }).ranges[0].approved).toBe(false);
  });

  it("saveProject sao lưu bản cũ và giữ tối đa 20 bản", async () => {
    const dir = await mkdtemp(join(tmpdir(), "th-"));
    try {
      const file = join(dir, "project.json");
      await saveProject(file, base);
      for (let i = 0; i < 23; i++) {
        await writeFile(join(dir, `project.backup-2020-01-01T00-00-${String(i).padStart(2, "0")}.json`), "{}");
      }
      await saveProject(file, { ...base, duration: 11 });
      const backups = (await readdir(dir)).filter((f) => f.startsWith("project.backup-"));
      expect(backups.length).toBe(20);
      expect((await loadProject(file)).duration).toBe(11);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("align-edits", () => {
  const orig = [w("Hôm", 0, 0.4), w("nay", 0.4, 0.8), w("chúng", 1, 1.3), w("ta", 1.3, 1.5), w("học", 1.5, 2)];

  it("giữ timestamp của từ khớp, bỏ qua dấu câu/hoa thường", () => {
    const r = alignSegment(orig, "Hôm nay, chúng ta học.", 0, 2);
    expect(r.map((x) => x.text)).toEqual(["Hôm", "nay,", "chúng", "ta", "học."]);
    expect(r[2].start).toBe(1);
    expect(r[4].end).toBe(2);
  });

  it("từ chèn thêm được nội suy giữa hai neo", () => {
    const r = alignSegment(orig, "Hôm nay chúng ta cùng nhau học", 0, 2);
    expect(r.map((x) => x.text)).toEqual(["Hôm", "nay", "chúng", "ta", "cùng", "nhau", "học"]);
    expect(r[4].start).toBeCloseTo(1.5, 3);
    expect(r[5].end).toBeCloseTo(1.5, 3); // học giữ nguyên start 1.5 nên khoảng nội suy bằng 0
    expect(r[6].start).toBe(1.5);
  });

  it("từ bị sửa (khác chữ) vẫn có mốc, và số dòng phải khớp", () => {
    const r = alignSegment(orig, "Hôm nay chúng mình học", 0, 2);
    expect(r[3].text).toBe("mình");
    expect(r[3].start).toBeCloseTo(1.3, 3);
    const seg: Segment = { id: 0, start: 0, end: 2, text: "", words: orig };
    expect(() => alignEdits([seg], ["a", "b"])).toThrow();
    expect(alignEdits([seg], ["Hôm nay chúng ta học"])[0].text).toBe("Hôm nay chúng ta học");
  });
});

describe("cắt và ánh xạ timestamp", () => {
  const cuts = CutsSchema.parse({
    ranges: [
      { start: 2, end: 3, reason: "a", source: "user", approved: true },
      { start: 4, end: 5, reason: "b", source: "user", approved: false },
      { start: 6, end: 8, reason: "c", source: "ai", approved: true },
    ],
  });

  it("chỉ dùng đoạn đã duyệt để suy ra đoạn giữ", () => {
    expect(keepRangesFromCuts(cuts, 10)).toEqual([{ start: 0, end: 2 }, { start: 3, end: 6 }, { start: 8, end: 10 }]);
  });

  it("mapTime cộng dồn phần đã cắt", () => {
    const keeps = keepRangesFromCuts(cuts, 10);
    expect(mapTime(1, keeps)).toBe(1);
    expect(mapTime(3.5, keeps)).toBeCloseTo(2.5);
    expect(mapTime(9, keeps)).toBeCloseTo(6);
    expect(mapTime(7, keeps)).toBeCloseTo(5); // vùng cắt dính về mép đoạn giữ kế tiếp
  });

  it("remapTranscript bỏ từ bị cắt và dời mốc", () => {
    const keeps = keepRangesFromCuts(cuts, 10);
    const tr = {
      language: "vi",
      segments: [
        { id: 0, start: 0, end: 4, text: "", words: [w("a", 0, 1), w("b", 2.2, 2.8), w("c", 3.2, 3.8)] },
        { id: 1, start: 6.2, end: 7.5, text: "", words: [w("x", 6.2, 7.5)] },
      ],
    };
    const r = remapTranscript(tr, keeps);
    expect(r.segments.length).toBe(1);
    expect(r.segments[0].words.map((x) => x.text)).toEqual(["a", "c"]);
    expect(r.segments[0].words[1].start).toBeCloseTo(2.2);
  });

  it("filter ffmpeg: video trim theo khung + concat, audio crossfade 10 ms", () => {
    const keeps = snapKeeps([{ start: 0, end: 2 }, { start: 3, end: 6 }], 30, 10);
    expect(buildVideoFilter(keeps, "9:16", 30, false)).toContain("concat=n=2");
    expect(buildVideoFilter(keeps, "9:16", 30, false)).toContain("scale=1080:1920");
    expect(buildVideoFilter(keeps, "9:16", 30, true)).not.toContain("crop=");
    expect(buildAudioFilter(keeps, 30, 10, 5)).toContain("acrossfade=d=0.01");
  });

  it("snapKeeps đưa mốc về biên khung và gộp đoạn dính nhau", () => {
    const k = snapKeeps([{ start: 0.01, end: 1.004 }, { start: 1.02, end: 2.5 }, { start: 4, end: 4.01 }], 30, 10);
    expect(k.length).toBe(2); // đoạn 3 ngắn hơn 1 khung bị bỏ
    expect(k[0].start).toBe(0);
    expect(Math.round(k[0].end * 30)).toBe(30);
    expect(Math.round(k[1].start * 30)).toBe(31);
    expect(snapKeeps([{ start: 0, end: 1.004 }, { start: 1.01, end: 2 }], 30, 10).length).toBe(1); // dính nhau thì gộp
  });

  it("ứng viên lặng và câu lặp", () => {
    const segs: Segment[] = [
      { id: 0, start: 0.5, end: 2, text: "chúng ta bắt đầu bài học", words: [w("chúng", 0.5, 0.8), w("ta", 0.8, 1), w("bắt", 1, 1.3), w("đầu", 1.3, 1.6), w("bài", 1.6, 1.8), w("học", 1.8, 2)] },
      { id: 1, start: 4, end: 5.5, text: "chúng ta bắt đầu bài học nhé", words: [w("chúng", 4, 4.2), w("ta", 4.2, 4.4), w("bắt", 4.4, 4.7), w("đầu", 4.7, 5), w("bài", 5, 5.2), w("học", 5.2, 5.4), w("nhé", 5.4, 5.5)] },
    ];
    const sil = silenceCandidates(segs, 6);
    expect(sil.map((s) => [s.start, s.end])).toEqual([[0, 0.38], [2.06, 3.94], [5.8, 6]]); // đầu chừa 0.12, giữa chừa 0.12, đuôi chừa 0.3
    const rep = repeatCandidates(segs);
    expect(rep.length).toBe(1);
    expect(rep[0].start).toBe(0.5); // cắt lần trước, giữ lần sau đầy đủ hơn
  });
});

describe("cut-plan: độ tin cậy", () => {
  const segs: Segment[] = [
    { id: 0, start: 0, end: 2, text: "xin chào các bạn.", words: [w("xin", 0, 0.4), w("chào", 0.4, 0.8), w("các", 0.8, 1.2), w("bạn.", 1.2, 2)] },
    { id: 1, start: 3, end: 4, text: "hôm nay học", words: [w("hôm", 3, 3.3), w("nay", 3.5, 3.7), w("học", 3.9, 4)] },
  ];
  it("đệm khớp danh sách và vùng có thanh được đề xuất; hơi thở, mẩu ngắn, chưa đo thì không", () => {
    const c = fillerCandidates(
      [
        { start: 0.5, end: 0.6, text: "ừm", source: "list" },
        { start: 2.2, end: 2.6, text: "(tiếng đệm)", source: "vad-gap", voicedRatio: 0.8, f0Median: 140 }, // có thanh
        { start: 2.7, end: 2.88, text: "(tiếng đệm)", source: "vad-gap", voicedRatio: 0.9, f0Median: 140 }, // có thanh nhưng < 0.2 s
        { start: 3.3, end: 3.5, text: "(tiếng đệm)", source: "vad-gap", voicedRatio: 0.05, f0Median: 0 }, // hơi thở
        { start: 3.7, end: 3.8, text: "(tiếng đệm)", source: "vad-gap", voicedRatio: 0.9, f0Median: 140 }, // < 0.15 s, bỏ
        { start: 3.9, end: 4.3, text: "(tiếng đệm)", source: "vad-gap" }, // chưa có số đo
      ],
      segs,
    );
    expect(c.map((x) => [x.kind, x.approved])).toEqual([
      ["filler-word", true],
      ["filler-voiced", true],
      ["filler-voiced", false],
      ["breath", false],
      ["filler-vad", false],
    ]);
    expect(c[1].f0Median).toBe(140);
  });
  it("khoảng lặng ở ranh giới câu chừa 0.2 s, lặng < 0.45 s thì để yên", () => {
    const s2: Segment[] = [{ id: 0, start: 0, end: 3, text: "", words: [w("một.", 0, 0.5), w("hai", 1.5, 2), w("ba", 2.3, 3)] }];
    const r = silenceCandidates(s2, 3);
    expect(r.map((x) => [x.start, x.end])).toEqual([[0.6, 1.4]]); // gap 1.0 s sau dấu chấm: chừa 0.2 s
  });
  it("hợp nhất khoảng giao nhau theo mục tin cậy cao hơn; breath không bị gộp", () => {
    const m = mergeNearby([
      { start: 15.83, end: 16, reason: "a", source: "auto", approved: false, kind: "filler-voiced", confidence: 0.3 },
      { start: 15.95, end: 16.45, reason: "b", source: "auto", approved: true, kind: "silence", confidence: 0.9 },
      { start: 16.4, end: 16.6, reason: "c", source: "auto", approved: false, kind: "breath", confidence: 0.2 },
    ]);
    expect(m.length).toBe(2);
    expect(m[0]).toMatchObject({ start: 15.83, end: 16.45, kind: "silence", approved: true });
    expect(m[1].kind).toBe("breath");
  });
  it("gộp ứng viên cách nhau < 0.2 s và sinh cuts.md", () => {
    const m = mergeNearby([
      { start: 1, end: 1.3, reason: "a", source: "auto", approved: true, kind: "silence", confidence: 0.9 },
      { start: 1.4, end: 1.8, reason: "b", source: "auto", approved: true, kind: "filler-word", confidence: 0.8 },
      { start: 5, end: 5.5, reason: "c", source: "auto", approved: true },
    ]);
    expect(m.length).toBe(2);
    expect(m[0].end).toBe(1.8);
    expect(renderCutsMd(m, segs)).toContain("| 1 | 0:01.00–0:01.80 |");
  });
});

describe("phụ đề", () => {
  it("chia ≤ 2 dòng, ≤ 42 ký tự mỗi dòng", () => {
    const words = Array.from({ length: 40 }, (_, i) => w(`từ${i}`, i * 0.3, i * 0.3 + 0.25));
    const chunks = splitSubtitles(words);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.lines.length).toBeLessThanOrEqual(2);
      for (const l of c.lines) expect(l.length).toBeLessThanOrEqual(42);
    }
    expect(chunks.flatMap((c) => c.words).length).toBe(40);
  });

  it("ngắt ở dấu kết câu và khi lặng dài", () => {
    const chunks = splitSubtitles([w("Một", 0, 0.3), w("hai", 0.3, 0.6), w("ba.", 0.6, 0.9), w("bốn", 1, 1.3), w("năm", 3, 3.3)]);
    expect(chunks.map((c) => c.lines.join(" "))).toEqual(["Một hai ba.", "bốn", "năm"]);
  });

  it("layer tiêu đề mục ánh xạ sang timeline cắt", () => {
    const outline = OutlineSchema.parse({ summary: "", items: [{ id: "1", title: "Mở đầu", level: 1, start: 3, end: 9, children: [{ id: "1.1", title: "Ý nhỏ", level: 2, start: 3, end: 6 }, { id: "1.2", title: "Sâu", level: 3, start: 3, end: 6 }] }] });
    let n = 0;
    const layers = outlineLayers(outline, [{ start: 0, end: 2 }, { start: 3, end: 10 }], "9:16", { text: "#fff", accent: "#C5A059", ink: "#000" }, () => `L-${++n}`);
    expect(layers.map((l) => [l.type, l.start])).toEqual([["lowerThird", 2], ["callout", 2]]);
    expect(layers[0].duration).toBe(4);
  });
});
