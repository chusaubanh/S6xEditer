import { spawn } from "node:child_process";
import { resolveMediaBinary } from "../studio/utils/media-binary.js";

/** Dạng sóng giống /api/peaks của editor: PCM mono 8 kHz, min/max mỗi 10 ms → [min0,max0,...] thang -100..100. */
export async function computePeaks(file: string): Promise<{ rate: number; duration: number; peaks: number[] }> {
  const peaks: number[] = [];
  await new Promise<void>((resolveP, reject) => {
    const p = spawn(resolveMediaBinary("ffmpeg"), ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { windowsHide: true });
    let carry: Buffer | null = null;
    let n = 0;
    let mn = 32767;
    let mx = -32768;
    p.stdout.on("data", (chunk: Buffer) => {
      const buf = carry ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      carry = usable < buf.length ? buf.subarray(usable) : null;
      for (let i = 0; i < usable; i += 2) {
        const v = buf.readInt16LE(i);
        if (v < mn) mn = v;
        if (v > mx) mx = v;
        if (++n === 80) {
          peaks.push(Math.round((mn / 32768) * 100), Math.round((mx / 32768) * 100));
          n = 0;
          mn = 32767;
          mx = -32768;
        }
      }
    });
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolveP() : reject(new Error(`ffmpeg lỗi khi tạo peaks (exit ${c})`))));
  });
  return { rate: 100, duration: peaks.length / 200, peaks };
}
