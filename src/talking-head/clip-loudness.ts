import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCapture } from "./ffmpeg-util.js";

export const CLIP_TARGET_LUFS = -18;
export const GAIN_MIN = -12;
export const GAIN_MAX = 30;
const GATE = -60; // dưới ngưỡng này coi là không có tiếng
const SHORT_CLIP = 1.0; // giây: ngắn hơn thì không đo tích hợp được, dùng momentary

export interface LoudnessSeries {
  /** thời điểm cuối cửa sổ momentary 400 ms (s) và giá trị (LUFS) */
  tM: number[];
  M: number[];
}

interface Cache {
  stamp: string;
  series: LoudnessSeries;
  clips: Record<string, number | null>; // "a-b" → loudness tích hợp của đoạn nguồn
}

const cacheFile = (dir: string) => join(dir, "source-loudness.json");
const stampOf = (audio: string) => createHash("sha1").update(`${statSync(audio).mtimeMs}:${statSync(audio).size}:v2`).digest("hex").slice(0, 16);

async function loadCache(audio: string, dir: string): Promise<Cache> {
  const stamp = stampOf(audio);
  if (existsSync(cacheFile(dir))) {
    const c = JSON.parse(await readFile(cacheFile(dir), "utf8")) as Cache;
    if (c.stamp === stamp) return c;
  }
  // momentary 400 ms của toàn file (100 ms một mốc), dùng cho clip rất ngắn
  const { stdout } = await runCapture("ffmpeg", ["-hide_banner", "-nostats", "-i", audio, "-af", "ebur128=metadata=1,ametadata=print:key=lavfi.r128.M:file=-", "-f", "null", "-"]);
  const series: LoudnessSeries = { tM: [], M: [] };
  let t = 0;
  for (const line of stdout.split(/\r?\n/)) {
    const mt = /pts_time:(-?[\d.]+)/.exec(line);
    if (mt) t = parseFloat(mt[1]);
    const mv = /lavfi\.r128\.M=(-?[\d.]+|-?inf)/.exec(line);
    if (mv) {
      series.tM.push(t);
      series.M.push(mv[1].includes("inf") ? -120 : parseFloat(mv[1]));
    }
  }
  return { stamp, series, clips: {} };
}

/** Momentary 400 ms của toàn nguồn (100 ms một mốc), dùng riêng cho proxy nghe thử. */
export async function loadMomentary(audio: string, dir: string): Promise<LoudnessSeries> {
  const c = await loadCache(audio, dir);
  if (!existsSync(cacheFile(dir))) await writeFile(cacheFile(dir), JSON.stringify(c), "utf8");
  return c.series;
}

/**
 * Âm thanh proxy CHỈ ĐỂ NGHE THỬ cho đều: đường bao gain theo loudness momentary (đích −20 LUFS, kẹp [−6, +30] dB, làm mượt ~3 s,
 * giữ gain qua quãng lặng), nội suy tuyến tính trong dB từng mẫu, rồi soft-limit ở 0.89. Trả Float32 mono 48 kHz. Render không dùng.
 */
export function levelProxyAudio(x: Float32Array, series: LoudnessSeries, sr = 48000, target = -20): Float32Array {
  const K = series.M.length;
  const raw: Array<number | null> = series.M.map((m) => (m > GATE ? Math.min(30, Math.max(-6, target - m)) : null));
  const first = raw.find((v) => v !== null) ?? 0;
  let last = first;
  const filled = raw.map((v) => (v === null ? last : (last = v)));
  const W = 15; // ±1.5 s
  const smooth = filled.map((_, i) => {
    let s = 0;
    let n = 0;
    for (let k = Math.max(0, i - W); k <= Math.min(K - 1, i + W); k++) {
      s += filled[k];
      n++;
    }
    return s / n;
  });
  const out = new Float32Array(x.length);
  const centers = series.tM.map((t) => (t - 0.2) * sr);
  let k = 0;
  for (let i = 0; i < x.length; i++) {
    while (k + 1 < K && centers[k + 1] <= i) k++;
    const a = smooth[k];
    const b = k + 1 < K ? smooth[k + 1] : a;
    const span = k + 1 < K ? centers[k + 1] - centers[k] : 1;
    const f = Math.min(1, Math.max(0, (i - centers[k]) / span));
    const g = Math.pow(10, (a + (b - a) * f) / 20);
    let y = x[i] * g;
    const ay = Math.abs(y);
    if (ay > 0.89) y = Math.sign(y) * (0.89 + 0.11 * Math.tanh((ay - 0.89) / 0.11));
    out[i] = y;
  }
  return out;
}

const median = (a: number[]): number | null => {
  if (!a.length) return null;
  const b = [...a].sort((x, y) => x - y);
  return b[Math.floor((b.length - 1) / 2)];
};

/** Loudness tích hợp (có cổng) của đoạn nguồn [a, b] bằng ebur128 trên file đã giảm ồn. */
async function integrated(audio: string, a: number, b: number): Promise<number | null> {
  const { stderr } = await runCapture("ffmpeg", ["-hide_banner", "-nostats", "-ss", a.toFixed(6), "-t", (b - a).toFixed(6), "-i", audio, "-af", "ebur128", "-f", "null", "-"]);
  const t = stderr.slice(stderr.lastIndexOf("Summary:"));
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(t);
  const v = m ? parseFloat(m[1]) : NaN;
  return Number.isFinite(v) && v > GATE ? v : null;
}

/**
 * Loudness đại diện của từng clip nguồn (null cho hold hoặc không có tiếng).
 * Clip ≥ 1 s: loudness tích hợp có cổng của chính đoạn đó (đúng thứ cần đều giữa các clip). Clip ngắn hơn: trung vị momentary có tiếng.
 * Kết quả đo lưu trong source-loudness.json (khoá theo dấu file nguồn), clip mới mới đo thêm.
 */
export async function measureClipLoudness(audio: string, dir: string, clips: Array<{ kind: "source" | "hold"; a: number; b: number }>): Promise<Array<number | null>> {
  const cache = await loadCache(audio, dir);
  let dirty = !existsSync(cacheFile(dir));
  const out: Array<number | null> = [];
  for (const c of clips) {
    if (c.kind !== "source") {
      out.push(null);
      continue;
    }
    if (c.b - c.a < SHORT_CLIP) {
      const v = cache.series.M.filter((x, i) => x > GATE && cache.series.tM[i] - 0.2 >= c.a && cache.series.tM[i] - 0.2 <= c.b);
      out.push(median(v));
      continue;
    }
    const key = `${c.a.toFixed(3)}-${c.b.toFixed(3)}`;
    if (!(key in cache.clips)) {
      cache.clips[key] = await integrated(audio, c.a, c.b);
      dirty = true;
    }
    out.push(cache.clips[key]);
  }
  if (dirty) await writeFile(cacheFile(dir), JSON.stringify(cache), "utf8");
  return out;
}

export interface ClipGain {
  gainDb: number;
  loudness: number | null;
  note?: string;
}

/**
 * Gain RIÊNG từng clip = −18 LUFS − loudness của clip, kẹp [−12, +30] dB.
 * Clip không đo được (hold, im lặng) lấy gain của clip liền kề (ưu tiên clip trước, không có thì clip sau), không có gì thì 0 dB.
 */
export function computeClipGains(clips: Array<{ kind: "source" | "hold" }>, loudness: Array<number | null>): ClipGain[] {
  const base: Array<ClipGain | null> = loudness.map((l) => {
    if (l === null) return null;
    const g = Math.min(GAIN_MAX, Math.max(GAIN_MIN, CLIP_TARGET_LUFS - l));
    return { gainDb: +g.toFixed(2), loudness: +l.toFixed(2), note: g !== CLIP_TARGET_LUFS - l ? "kẹp trong [−12, +30] dB" : undefined };
  });
  const firstKnown = base.findIndex((x) => x);
  return base.map((x, i) => {
    if (x) return x;
    let g = 0;
    for (let k = i - 1; k >= 0; k--) if (base[k]) { g = base[k]!.gainDb; break; }
    if (g === 0 && firstKnown >= 0 && i < firstKnown) g = base[firstKnown]!.gainDb;
    return { gainDb: g, loudness: null, note: clips[i].kind === "hold" ? "hold: im lặng, lấy gain clip liền kề" : "không có tiếng: lấy gain clip liền kề" };
  });
}
