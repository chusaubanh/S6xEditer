import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMixGraph, measureLoudness, mixProjectAudio } from "./audio-mix.js";
import { runCapture } from "./ffmpeg-util.js";
import { ProjectSchema, type Project } from "./project-schema.js";

let dir = "";
const sine = (file: string, freq: number, dur: number, vol: number) =>
  runCapture("ffmpeg", ["-y", "-f", "lavfi", "-i", `sine=frequency=${freq}:duration=${dur}:sample_rate=48000`, "-af", `volume=${vol}`, "-ac", "2", join(dir, file)]);

const audioLayer = (id: string, start: number, src: string, duration: number, gainDb = -6) => ({
  id, type: "audio", start, duration, src, offset: 0, gainDb, fadeIn: 0, fadeOut: 0.02, meta: { source: "auto" },
});
const mk = (sfx: unknown[], music: unknown[] = [], extra: object = {}): Project =>
  ProjectSchema.parse({
    version: 1, job: "t", width: 1920, height: 1080, aspect: "16:9", duration: 10, source: { video: "cut.mp4", audio: "voice.wav" },
    tracks: [
      { id: "t-sfx", kind: "sfx", name: "SFX", layers: sfx },
      { id: "t-music", kind: "music", name: "Nhạc", layers: music },
    ],
    ...extra,
  });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "th-mix-"));
  await sine("voice.wav", 300, 10, 0.2);
  await sine("beep.wav", 1000, 0.5, 0.5);
  await sine("music.wav", 220, 10, 0.3);
  await sine("music-short.wav", 330, 4, 0.3);
}, 60000);
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("audio-mix", () => {
  it("chia nhóm amix khi > 32 đầu vào", () => {
    const sfx = Array.from({ length: 70 }, (_, i) => audioLayer(`A-${i}`, i * 0.1, "beep.wav", 0.5));
    const { graph } = buildMixGraph(mk(sfx), dir);
    const counts = [...graph.matchAll(/amix=inputs=(\d+)/g)].map((m) => Number(m[1]));
    expect(Math.max(...counts)).toBeLessThanOrEqual(32);
    expect(counts.length).toBeGreaterThan(2);
  });

  it("trộn giọng + SFX + nhạc: đúng thời lượng, LUFS ±1 quanh đích, TP <= -1", async () => {
    const p = mk(
      [audioLayer("A-1", 1, "beep.wav", 0.5), audioLayer("A-2", 1.1, "beep.wav", 0.5, 0), audioLayer("A-3", 6, "beep.wav", 0.5), audioLayer("A-9", 3, "missing.wav", 0.5)],
      [{ ...audioLayer("M-1", 0, "music.wav", 10, -10), fadeIn: 0.5, fadeOut: 1 }],
      { audio: { voice: { gainDb: 0 }, master: { lufs: -16, truePeak: -1.5 } } },
    );
    const out = join(dir, "mix.wav");
    const r = await mixProjectAudio(p, dir, out);
    expect(r.skipped.length).toBe(1);
    expect(r.sfxCount).toBe(3);
    const m = await measureLoudness(out);
    expect(Math.abs(m.lufs - -16)).toBeLessThanOrEqual(1);
    expect(m.truePeak).toBeLessThanOrEqual(-1);
    const { stdout } = await runCapture("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]);
    expect(Math.abs(parseFloat(stdout) - 10)).toBeLessThan(0.05);
    const { stdout: sr } = await runCapture("ffprobe", ["-v", "error", "-show_entries", "stream=sample_rate,channels", "-of", "csv=p=0", out]);
    expect(sr.trim()).toBe("48000,2");
  }, 120000);

  it("nhạc ngắn hơn layer tự lặp (crossfade) hoặc dừng + fade-out khi loop=false", async () => {
    const layer = (loop: boolean) => ({ ...audioLayer("M-1", 0, "music-short.wav", 10, -10), meta: { source: "auto", loop } });
    for (const loop of [true, false]) {
      const p = mk([], [], { audio: { music: { duckDb: -12 } } });
      (p.tracks[1].layers as unknown[]).push(layer(loop)); // bỏ qua schema (meta.loop chưa có trong ProjectSchema)
      const out = join(dir, `mix-loop-${loop}.wav`);
      const r = await mixProjectAudio(p, dir, out);
      expect(r.musicCount).toBe(1);
      const { stdout } = await runCapture("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]);
      expect(Math.abs(parseFloat(stdout) - 10)).toBeLessThan(0.05);
      // nhạc lặp phủ cả cuối clip; không lặp thì im sau ~4 s
      const { stderr } = await runCapture("ffmpeg", ["-hide_banner", "-ss", "8", "-i", out, "-af", "volumedetect", "-f", "null", "-"]);
      const mean = parseFloat(/mean_volume: (-?[\d.]+)/.exec(stderr)![1]);
      if (loop) expect(mean).toBeGreaterThan(-45);
    }
    const g = buildMixGraph(Object.assign(mk([], []), { tracks: [{ id: "m", kind: "music", name: "n", hidden: false, locked: false, layers: [layer(true)] }] }) as Project, dir, { durations: { [join(dir, "music-short.wav")]: 4 } }).graph;
    expect(g).toContain("acrossfade=d=1");
  }, 120000);

  it("thiếu source.audio thì lấy audio của source.video", async () => {
    await runCapture("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=10:r=10", "-f", "lavfi", "-i", "sine=frequency=400:duration=10:sample_rate=48000", "-shortest", "-c:v", "mpeg4", join(dir, "clip.mp4")]);
    const p = mk([], [], { source: { video: "clip.mp4" } });
    const out = join(dir, "mix-fallback.wav");
    const r = await mixProjectAudio(p, dir, out);
    expect(Math.abs(r.lufs - -16)).toBeLessThanOrEqual(1);
  }, 120000);

  it("giọng tắt và không có SFX/nhạc vẫn ra file im lặng đúng thời lượng", async () => {
    const out = join(dir, "mix-empty.wav");
    await mixProjectAudio(mk([], [], { audio: { voice: { muted: true } } }), dir, out);
    const { stdout } = await runCapture("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]);
    expect(Math.abs(parseFloat(stdout) - 10)).toBeLessThan(0.05);
  }, 120000);

  it("giọng tắt (muted) vẫn trộn được với SFX", async () => {
    const p = mk([audioLayer("A-1", 1, "beep.wav", 0.5, -3)], [], { audio: { voice: { muted: true } } });
    const out = join(dir, "mix-muted.wav");
    const r = await mixProjectAudio(p, dir, out);
    expect(r.truePeak).toBeLessThanOrEqual(-1);
  }, 120000);
});
