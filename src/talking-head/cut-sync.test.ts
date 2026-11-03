import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { frameCount, renderCut, snapKeeps } from "./cut-render.js";
import { runCapture } from "./ffmpeg-util.js";

const FPS = 30;

/** Onset (giây) của các tiếng beep trong wav f32 mono 48k: cửa sổ 5 ms vượt ngưỡng sau ≥ 50 ms im lặng. */
function onsets(buf: Buffer): number[] {
  const f = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const win = 240;
  const out: number[] = [];
  let quiet = 99;
  for (let i = 0; i + win <= f.length; i += win) {
    let peak = 0;
    for (let j = i; j < i + win; j++) peak = Math.max(peak, Math.abs(f[j]));
    if (peak > 0.1 && quiet >= 10) out.push(i / 48000);
    quiet = peak > 0.02 ? 0 : quiet + 1;
  }
  return out;
}

describe("cắt: đồng bộ tiếng-hình không cộng dồn", () => {
  it("60 s, 95 đoạn (3 nhóm), beep mỗi 0.5 s: lệch onset ≤ 1 khung ở mọi điểm cắt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "th-sync-"));
    try {
      const src = join(dir, "src.mp4");
      await runCapture("ffmpeg", ["-y", "-f", "lavfi", "-i", `testsrc=size=320x240:rate=${FPS}:duration=60`,
        "-f", "lavfi", "-i", "aevalsrc=exprs=0.8*sin(2*PI*1000*t)*lt(mod(t\\,0.5)\\,0.05):s=48000:d=60",
        "-c:v", "libx264", "-preset", "ultrafast", "-g", "30", "-c:a", "aac", "-b:a", "128k", src]);
      // đoạn giữ i bắt đầu đúng tại một beep (bỏ 1 beep cứ mỗi 4 đoạn), dài 0.4 s
      const raw = Array.from({ length: 95 }, (_, i) => {
        const start = 0.5 * (i + Math.floor(i / 4));
        return { start, end: start + 0.4 };
      });
      const keeps = snapKeeps(raw, FPS, 60);
      expect(keeps.length).toBe(95);
      const out = join(dir, "cut.mp4");
      const r = await renderCut({ src: { path: src, fps: FPS, width: 320, height: 240, videoCodec: "h264", hasAudio: true, duration: 60 }, keeps, aspect: "keep", out, workDir: join(dir, "w"), forceCpu: true });
      expect(r.groups).toBe(3);

      const probe = JSON.parse((await runCapture("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,duration,nb_read_frames", "-of", "json", out])).stdout);
      const v = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
      const a = probe.streams.find((s: { codec_type: string }) => s.codec_type === "audio");
      expect(Number(v.nb_read_frames)).toBe(frameCount(keeps, FPS));
      expect(Math.abs(Number(a.duration) - Number(v.duration))).toBeLessThanOrEqual(1 / FPS);

      const pcm = (await runCapture("ffmpeg", ["-v", "error", "-i", out, "-f", "f32le", "-ac", "1", "-ar", "48000", "-"], { binary: true })).stdoutBuf!;
      const got = onsets(pcm);
      expect(got.length).toBe(95);
      let maxDev = 0;
      got.forEach((t, i) => (maxDev = Math.max(maxDev, Math.abs(t - i * 0.4))));
      const lastDev = Math.abs(got[94] - 94 * 0.4);
      console.log(`lệch onset tối đa ${(maxDev * 1000).toFixed(1)} ms, điểm cuối ${(lastDev * 1000).toFixed(1)} ms, nhóm ${r.groups}`);
      expect(maxDev).toBeLessThanOrEqual(1 / FPS);
      expect(lastDev).toBeLessThanOrEqual(1 / FPS);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 180000);
});
