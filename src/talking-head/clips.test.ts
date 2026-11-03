import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildClipsFromCutMap } from "./clips.js";
import { mixHash } from "./audio-mix.js";
import { buildClipsAudioFilter, clipFrames, clipsHash, ensureCutFromClips, mapTranscriptThroughClips, totalFrames } from "./clips-render.js";
import { runCapture } from "./ffmpeg-util.js";
import { assertNoClips, jobDir, writeJson } from "./jobs.js";
import { ProjectSchema, VideoClipSchema, type Project, type Transcript } from "./project-schema.js";
import { checkRevision } from "./revision.js";

const w = (text: string, start: number, end: number) => ({ text, start, end });
const base = { version: 1, job: "j", width: 1080, height: 1350, aspect: "4:5", duration: 10, source: { video: "cut.mp4" } };

describe("schema videoClips / revision", () => {
  it("project cũ (không clips, không revision) vẫn hợp lệ; revision mặc định 0", () => {
    const p = ProjectSchema.parse(base);
    expect(p.revision).toBe(0);
    expect(p.videoClips).toBeUndefined();
  });

  it("source cần srcOut > srcIn, hold cần dur > 0", () => {
    expect(() => VideoClipSchema.parse({ id: "C-1", kind: "source", srcIn: 5 })).toThrow();
    expect(() => VideoClipSchema.parse({ id: "C-1", kind: "source", srcIn: 5, srcOut: 5 })).toThrow();
    expect(() => VideoClipSchema.parse({ id: "C-1", kind: "hold", srcIn: 5 })).toThrow();
    expect(() => VideoClipSchema.parse({ id: "C-1", kind: "hold", srcIn: 5, dur: 0 })).toThrow();
    expect(VideoClipSchema.parse({ id: "C-1", kind: "hold", srcIn: 5, dur: 0.6 }).dur).toBe(0.6);
    const p = ProjectSchema.parse({ ...base, revision: 12, source: { video: "cut.mp4", raw: "../../x.mp4", rawAudio: "source-audio.wav", proxy: "source-proxy.mp4" }, videoClips: [{ id: "C-1", kind: "source", srcIn: 1, srcOut: 3 }] });
    expect(p.revision).toBe(12);
    expect(p.source.proxy).toBe("source-proxy.mp4");
  });
});

describe("checkRevision", () => {
  it("bản cũ hơn đĩa → stale 409; bằng hoặc mới hơn → revision + 1", () => {
    expect(checkRevision({ revision: 5 }, { revision: 4 })).toMatchObject({ ok: false, status: 409, body: { error: "stale" } });
    expect(checkRevision({ revision: 5 }, { revision: 5 })).toEqual({ ok: true, next: 6 });
    expect(checkRevision(null, {})).toEqual({ ok: true, next: 1 });
    expect(checkRevision({}, { revision: 3 })).toEqual({ ok: true, next: 4 });
  });
});

describe("migration cut-map → videoClips", () => {
  const keeps = [{ start: 10, end: 14 }, { start: 20, end: 30 }, { start: 40, end: 41 }];
  it("không intro: mỗi đoạn giữ là một clip source", () => {
    const c = buildClipsFromCutMap(keeps, undefined, 30);
    expect(c.map((x) => [x.kind, x.srcIn, x.srcOut])).toEqual([["source", 10, 14], ["source", 20, 30], ["source", 40, 41]]);
    expect(c.map((x) => x.id)).toEqual(["C-0001", "C-0002", "C-0003"]);
  });
  it("intro nằm trong một đoạn: hold + source intro + thân bài; intro vắt qua hai đoạn thì tách", () => {
    // timeline cắt: [0,4) = nguồn 10–14, [4,14) = nguồn 20–30; intro 3–6 vắt qua điểm nối
    const c = buildClipsFromCutMap(keeps, { from: 3, to: 6, gap: 0.6 }, 30);
    expect(c[0]).toMatchObject({ kind: "hold", srcIn: 13, dur: 0.6 });
    expect(c[1]).toMatchObject({ kind: "source", srcIn: 13, srcOut: 14 });
    expect(c[2]).toMatchObject({ kind: "source", srcIn: 20, srcOut: 22 });
    expect(c.length).toBe(1 + 2 + 3);
    const total = totalFrames(clipFrames(c, 30));
    expect(total).toBe(18 + 90 + 120 + 300 + 30);
  });
});

describe("dựng từ clips (thuần)", () => {
  it("bộ lọc audio: cắt theo mẫu, hold = im lặng, acrossfade 10 ms, ép đúng độ dài", () => {
    const cf = clipFrames([{ id: "a", kind: "hold", srcIn: 5, dur: 0.6 }, { id: "b", kind: "source", srcIn: 5, srcOut: 6 }], 30);
    const f = buildClipsAudioFilter(cf, 30);
    expect(f).toContain("anullsrc=r=48000:cl=mono,atrim=end_sample=29280"); // 28800 + 480 crossfade
    expect(f).toContain("atrim=start_sample=240000:end_sample=288000"); // clip cuối không kéo dài
    expect(f).toContain("acrossfade=d=0.01");
    expect(f).toContain("atrim=end_sample=76800"); // (18 + 30) khung = 1.6 s
  });

  it("transcript: từ nguồn đổi mốc theo clips; hold không có từ; đoạn nguồn liền kề gộp một; intro lặp tạo segment mới", () => {
    const tr: Transcript = { language: "vi", segments: [
      { id: 0, start: 10, end: 14, text: "", words: [w("a", 10, 10.5), w("b", 12, 12.5), w("c", 13, 13.5)] },
      { id: 1, start: 20, end: 22, text: "", words: [w("d", 20, 21)] },
    ] } as Transcript;
    const clips = [
      { id: "1", kind: "hold" as const, srcIn: 10, dur: 0.6 },
      { id: "2", kind: "source" as const, srcIn: 10, srcOut: 11 }, // intro: có từ a
      { id: "3", kind: "source" as const, srcIn: 10, srcOut: 12 }, // thân bài
      { id: "4", kind: "source" as const, srcIn: 12, srcOut: 14 }, // liền kề → gộp với clip trước
      { id: "5", kind: "source" as const, srcIn: 20, srcOut: 22 },
    ];
    const out = mapTranscriptThroughClips(tr, clips, 30);
    expect(out.segments.map((s) => s.text)).toEqual(["a", "a b c", "d"]); // intro lặp câu thân bài → tách; clip thân liền kề → gộp
    expect(out.segments[0].words[0].start).toBeCloseTo(0.6, 3); // sau hold 0.6 s
    expect(out.segments[1].words[1].start).toBeCloseTo(0.6 + 1 + 0 + 2, 3); // b ở nguồn 12 = đầu clip 4
    expect(out.segments[2].start).toBeCloseTo(0.6 + 1 + 2 + 2, 3);
  });
});

describe("từ chối th:cut/th:intro khi có clips", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "th-clips-"));
    process.env.TH_OUTPUT_ROOT = root;
    await mkdir(jobDir("jj"), { recursive: true });
  });
  afterEach(async () => {
    delete process.env.TH_OUTPUT_ROOT;
    await rm(root, { recursive: true, force: true });
  });
  it("assertNoClips ném lỗi rõ ràng chỉ khi project có videoClips", async () => {
    expect(() => assertNoClips("jj", "th:cut")).not.toThrow(); // chưa có project.json
    await writeJson(join(jobDir("jj"), "project.json"), { ...base });
    expect(() => assertNoClips("jj", "th:cut")).not.toThrow();
    await writeJson(join(jobDir("jj"), "project.json"), { ...base, videoClips: [{ id: "C-1", kind: "source", srcIn: 0, srcOut: 1 }] });
    expect(() => assertNoClips("jj", "th:intro")).toThrow(/th:intro bị từ chối.*videoClips/);
  });
});

describe("ensureCutFromClips (tổng hợp, CPU)", () => {
  it("hold + 2 đoạn: đúng số khung, |A−V| ≤ 1 khung, cache theo hash, onset beep đúng chỗ", async () => {
    const dir = await mkdtemp(join(tmpdir(), "th-clips-e2e-"));
    try {
      const src = join(dir, "raw.mp4");
      // 20 s, 320x240, beep 0.05 s mỗi 0.5 s
      await runCapture("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=20", "-f", "lavfi", "-i", "aevalsrc=exprs=0.8*sin(2*PI*1000*t)*lt(mod(t\\,0.5)\\,0.05):s=48000:d=20", "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-c:a", "aac", src]);
      const wav = join(dir, "source-audio.wav");
      await runCapture("ffmpeg", ["-y", "-i", src, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", wav]);
      await writeFile(join(dir, "media.json"), JSON.stringify({ info: { duration: 20, width: 320, height: 240, fps: 30, hasAudio: true, videoCodec: "h264" } }));
      await writeJson(join(dir, "transcript.raw.json"), { language: "vi", segments: [{ id: 0, start: 1, end: 4, text: "x y", words: [w("x", 1, 1.4), w("y", 6.1, 6.4)] }] });
      const project = ProjectSchema.parse({
        ...base, aspect: "keep", width: 320, height: 240, duration: 0.6 + 3 + 2,
        source: { video: "cut.mp4", audio: "audio.wav", raw: "raw.mp4", rawAudio: "source-audio.wav" },
        videoClips: [{ id: "C-1", kind: "hold", srcIn: 5, dur: 0.6 }, { id: "C-2", kind: "source", srcIn: 5, srcOut: 8 }, { id: "C-3", kind: "source", srcIn: 12, srcOut: 14 }],
      }) as Project;
      const r1 = await ensureCutFromClips(project, dir, { cpu: true });
      expect(r1.changed).toBe(true);
      expect(r1.frames).toBe(18 + 90 + 60);
      const pr = JSON.parse((await runCapture("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,duration,nb_read_frames", "-of", "json", join(dir, "cut.mp4")])).stdout).streams as Array<{ codec_type: string; duration: string; nb_read_frames?: string }>;
      const v = pr.find((s) => s.codec_type === "video")!;
      const a = pr.find((s) => s.codec_type === "audio")!;
      expect(Number(v.nb_read_frames)).toBe(168);
      expect(Math.abs(parseFloat(a.duration) - parseFloat(v.duration))).toBeLessThanOrEqual(1 / 30);
      // onset beep: clip 2 bắt đầu tại nguồn 5.0 (đúng beep) ⇒ onset ở 0.6 s; clip 3 bắt đầu nguồn 12.0 ⇒ onset ở 3.6 s
      const pcm = (await runCapture("ffmpeg", ["-v", "error", "-i", join(dir, "audio.wav"), "-f", "f32le", "-ac", "1", "-ar", "48000", "-"], { binary: true })).stdoutBuf!;
      const f = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
      const on = (t: number) => { for (let i = Math.floor((t - 0.05) * 48000); i < f.length; i++) if (Math.abs(f[i]) > 0.1) return i / 48000; return -1; };
      expect(Math.abs(on(0.6) - 0.6)).toBeLessThan(0.02);
      expect(Math.abs(on(3.6) - 3.6)).toBeLessThan(0.02);
      const tc = JSON.parse((await runCapture("node", ["-e", `process.stdout.write(require("fs").readFileSync(${JSON.stringify(join(dir, "transcript.cut.json"))},"utf8"))`])).stdout);
      expect(tc.segments.flatMap((s: Transcript["segments"][number]) => s.words).map((x: { text: string }) => x.text)).toEqual(["y"]); // x (nguồn 1 s) nằm ngoài clips nên bị bỏ; y ở nguồn 6.1 s nằm trong clip 2
      const r2 = await ensureCutFromClips(project, dir, { cpu: true });
      expect(r2.changed).toBe(false); // cache theo hash
      const r3 = await ensureCutFromClips({ ...project, videoClips: project.videoClips!.slice(0, 2) } as Project, dir, { cpu: true });
      expect(r3.changed).toBe(true);
      expect(r3.frames).toBe(108);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 180000);
});

describe("hash không phụ thuộc reframe", () => {
  const mk = (clips: unknown[]) => ProjectSchema.parse({ ...base, source: { video: "cut.mp4" }, videoClips: clips }) as Project;
  const src = { path: "/không-có-file", fps: 30, width: 320, height: 240, hasAudio: true, duration: 20 };
  const c1 = { id: "C-1", kind: "source", srcIn: 1, srcOut: 3 };

  it("đổi transform của clip → clipsHash và mixHash không đổi; đổi srcIn → đổi", () => {
    const a = mk([c1]);
    const b = mk([{ ...c1, transform: { scale: 1.3, x: 5, y: -2 } }]);
    expect(b.videoClips![0].transform).toBeDefined();
    expect(clipsHash(b, src, null)).toBe(clipsHash(a, src, null));
    expect(mixHash(b, "/x")).toBe(mixHash(a, "/x"));
    const c = mk([{ ...c1, srcIn: 1.5 }]);
    expect(clipsHash(c, src, null)).not.toBe(clipsHash(a, src, null));
    expect(mixHash(c, "/x")).not.toBe(mixHash(a, "/x"));
  });
});
