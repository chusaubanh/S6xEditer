import { spawnSync } from "node:child_process";
import { ASPECTS, FPS, type Aspect } from "../training/training-contract";

export interface MediaFacts {
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  durationSec: number;
  lufs: number | null;
}

export interface QcExpectation {
  aspect: Aspect;
  durationSec?: number;
  lufs?: number;
}

export const LUFS_TOLERANCE = 1;
export const DURATION_TOLERANCE_SEC = 0.5;

/** Trả về danh sách lỗi; rỗng là đạt. */
export function evaluateQc(facts: MediaFacts, expected: QcExpectation): string[] {
  const errors: string[] = [];
  const size = ASPECTS[expected.aspect];
  if (facts.width !== size.width || facts.height !== size.height) {
    errors.push(`Khổ ${facts.width}x${facts.height}, cần ${size.width}x${size.height} (${expected.aspect}).`);
  }
  if (Math.abs(facts.fps - FPS) > 0.01) errors.push(`Tốc độ khung ${facts.fps}, cần ${FPS}.`);
  if (facts.videoCodec !== "h264") errors.push(`Codec hình ${facts.videoCodec}, cần h264.`);
  if (facts.audioCodec !== "aac") errors.push(`Codec tiếng ${facts.audioCodec ?? "không có"}, cần aac.`);
  if (expected.durationSec !== undefined && Math.abs(facts.durationSec - expected.durationSec) > DURATION_TOLERANCE_SEC) {
    errors.push(`Thời lượng ${facts.durationSec.toFixed(2)} giây, cần ${expected.durationSec} giây.`);
  }
  const target = expected.lufs ?? -14;
  if (facts.lufs === null) {
    errors.push("Không đo được độ to.");
  } else if (Math.abs(facts.lufs - target) > LUFS_TOLERANCE) {
    errors.push(`Độ to ${facts.lufs} LUFS, cần ${target} ±${LUFS_TOLERANCE}.`);
  }
  return errors;
}

const run = (command: string, args: string[]) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
};

export function parseIntegratedLufs(ebur128Log: string): number | null {
  const summary = ebur128Log.slice(ebur128Log.lastIndexOf("Summary:"));
  const match = summary.match(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/);
  return match?.[1] ? Number(match[1]) : null;
}

export function probeMedia(path: string): MediaFacts {
  const probe = run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path]);
  if (probe.status !== 0) throw new Error(`ffprobe không đọc được ${path}: ${probe.stderr}`);
  const data = JSON.parse(probe.stdout) as {
    streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string }[];
    format: { duration: string };
  };
  const video = data.streams.find((stream) => stream.codec_type === "video");
  if (!video) throw new Error("Tệp không có luồng hình.");
  const audio = data.streams.find((stream) => stream.codec_type === "audio");
  const [num = 0, den = 1] = (video.r_frame_rate ?? "0/1").split("/").map(Number);
  let lufs: number | null = null;
  if (audio) {
    lufs = parseIntegratedLufs(run("ffmpeg", ["-hide_banner", "-nostats", "-i", path, "-af", "ebur128=framelog=quiet", "-f", "null", "-"]).stderr);
  }
  return {
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps: num / den,
    videoCodec: video.codec_name,
    audioCodec: audio?.codec_name ?? null,
    durationSec: Number(data.format.duration),
    lufs,
  };
}

/** Khoảng hình đứng yên, dùng `freezedetect` của FFmpeg. */
export function findFrozenIntervals(path: string, minSec: number): { start: number; duration: number }[] {
  const log = run("ffmpeg", ["-hide_banner", "-nostats", "-i", path, "-vf", `freezedetect=n=0.001:d=${minSec}`, "-f", "null", "-"]).stderr;
  return parseFreezeLog(log);
}

export function parseFreezeLog(log: string): { start: number; duration: number }[] {
  const starts = [...log.matchAll(/freeze_start:\s*([\d.]+)/g)].map((match) => Number(match[1]));
  const durations = [...log.matchAll(/freeze_duration:\s*([\d.]+)/g)].map((match) => Number(match[1]));
  return starts.map((start, i) => ({ start, duration: durations[i] ?? Number.POSITIVE_INFINITY }));
}

/** Đo độ phủ khung trên ảnh gray: trả tỉ lệ hàng có nội dung và dải trống lớn nhất theo tỉ lệ chiều cao. */
export function measureCoverage(gray: Uint8Array, width: number, height: number, background: number): { rowCoverage: number; largestGap: number } {
  const threshold = 36;
  let covered = 0;
  let gap = 0;
  let largest = 0;
  for (let y = 0; y < height; y++) {
    let has = false;
    for (let x = 0; x < width; x += 4) {
      if (Math.abs((gray[y * width + x] ?? 0) - background) > threshold) {
        has = true;
        break;
      }
    }
    if (has) {
      covered++;
      gap = 0;
    } else {
      gap++;
      largest = Math.max(largest, gap);
    }
  }
  return { rowCoverage: covered / height, largestGap: largest / height };
}
