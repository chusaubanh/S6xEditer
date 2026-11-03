import { readFile } from "node:fs/promises";

export interface VoicingStats {
  voicedRatio: number; // tỉ lệ khung có thanh (F0 ổn định)
  f0Median: number; // Hz, 0 nếu không có khung nào có thanh
  rms: number;
}

const F0_MIN = 70;
const F0_MAX = 400;
const PEAK_MIN = 0.5; // ngưỡng tự tương quan chuẩn hoá để coi là có chu kỳ
const RMS_MIN = 0.004; // dưới ngưỡng này coi là im lặng (không có thanh)

/** Đọc wav PCM s16 mono (file work/audio16k.wav do th:transcribe tạo). */
export async function readWav16(file: string): Promise<{ samples: Float32Array; sampleRate: number }> {
  const buf = await readFile(file);
  const sampleRate = buf.readUInt32LE(24);
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === "data") {
      const n = Math.floor(Math.min(size, buf.length - pos - 8) / 2);
      const s = new Float32Array(n);
      for (let i = 0; i < n; i++) s[i] = buf.readInt16LE(pos + 8 + i * 2) / 32768;
      return { samples: s, sampleRate };
    }
    pos += 8 + size + (size % 2);
  }
  throw new Error(`Không thấy khối data trong ${file}`);
}

/** Tự tương quan chuẩn hoá trên một khung: trả {peak, lag} trong dải F0 70–400 Hz. */
function bestPeriod(x: Float32Array, start: number, len: number, sr: number): { peak: number; lag: number } {
  const lagMin = Math.floor(sr / F0_MAX);
  const lagMax = Math.min(Math.floor(sr / F0_MIN), len - 1);
  let e0 = 0;
  for (let i = 0; i < len; i++) e0 += x[start + i] * x[start + i];
  let best = 0;
  let bestLag = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let c = 0;
    let e1 = 0;
    for (let i = 0; i + lag < len; i++) {
      c += x[start + i] * x[start + i + lag];
      e1 += x[start + i + lag] * x[start + i + lag];
    }
    const r = c / Math.sqrt(e0 * e1 + 1e-12);
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  return { peak: best, lag: bestLag };
}

/** Phân tích một đoạn [t0, t1] giây: khung 40 ms, bước 10 ms. Voiced = đủ năng lượng và có chu kỳ rõ. */
export function analyzeSegment(x: Float32Array, sr: number, t0: number, t1: number): VoicingStats {
  const a = Math.max(0, Math.floor(t0 * sr));
  const b = Math.min(x.length, Math.floor(t1 * sr));
  const win = Math.floor(0.04 * sr);
  const hop = Math.floor(0.01 * sr);
  const f0s: number[] = [];
  let frames = 0;
  let voiced = 0;
  let sumSq = 0;
  for (let i = a; i < b; i++) sumSq += x[i] * x[i];
  for (let p = a; p + win <= b; p += hop) {
    frames++;
    let e = 0;
    for (let i = 0; i < win; i++) e += x[p + i] * x[p + i];
    if (Math.sqrt(e / win) < RMS_MIN) continue;
    const { peak, lag } = bestPeriod(x, p, win, sr);
    if (peak >= PEAK_MIN) {
      voiced++;
      f0s.push(sr / lag);
    }
  }
  f0s.sort((m, n) => m - n);
  return {
    voicedRatio: frames ? +(voiced / frames).toFixed(2) : 0,
    f0Median: f0s.length ? +f0s[Math.floor(f0s.length / 2)].toFixed(1) : 0,
    rms: b > a ? +Math.sqrt(sumSq / (b - a)).toFixed(4) : 0,
  };
}

/** Có thanh (ừm/à/ờ kéo dài) khi ≥ 50% khung voiced và F0 trung vị nằm trong 70–400 Hz; ngược lại là hơi thở/ồn nền. */
export function isVoiced(s: VoicingStats): boolean {
  return s.voicedRatio >= 0.5 && s.f0Median >= F0_MIN && s.f0Median <= F0_MAX;
}
