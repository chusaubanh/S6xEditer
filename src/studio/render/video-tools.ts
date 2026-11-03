import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runMediaCommand, getMediaDurationSec } from "../media/media-runner.js";

let gpuProbe: Promise<boolean> | undefined;

/** True when ffmpeg can really encode with NVENC on this machine (probed once). S6X_GPU=0 forces CPU. */
export function gpuEncodeAvailable(): Promise<boolean> {
  if (process.env.S6X_GPU === "0") return Promise.resolve(false);
  gpuProbe ??= runMediaCommand("ffmpeg", [
    "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=256x256:d=0.1",
    "-c:v", "h264_nvenc", "-f", "null", "-",
  ]).then(() => true, () => false);
  return gpuProbe;
}

/** Same bitstream shape for GPU and CPU so clips from either path concat together. */
export function videoCodecArgs(gpu: boolean, cpuPreset: string): string[] {
  return gpu
    ? ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "18", "-b:v", "0"]
    : ["-c:v", "libx264", "-preset", cpuPreset, "-crf", "18"];
}

/** Common encode flags so every fitted clip is concat-compatible (same codec) and 100% NLE/Premiere-safe. */
const ENCODE = (fps: number, gpu: boolean) => [
  "-an",
  ...videoCodecArgs(gpu, "medium"),
  "-pix_fmt", "yuv420p",
  "-profile:v", "high",
  "-level", "4.1",
  "-bf", "0",
  "-flags", "+cgop",
  "-g", String(fps),
  "-keyint_min", String(fps),
  "-sc_threshold", "0",
  "-color_primaries", "bt709",
  "-color_trc", "bt709",
  "-colorspace", "bt709",
  "-movflags", "+faststart",
  "-r", String(fps),
];

/**
 * Re-encode `inPath` to exactly `targetSec` seconds (video only):
 * - longer target -> freeze the last frame (tpad clone) to fill the remainder,
 *   so a 5s poster animation holds while the scene's narration continues;
 * - shorter target -> trim. Output is normalized for concat.
 */
export async function fitClipToDuration(
  inPath: string,
  targetSec: number,
  outPath: string,
  fps = 30,
): Promise<void> {
  const inDur = await getMediaDurationSec(inPath);
  const target = Math.max(0.1, targetSec);
  const args = ["-y", "-i", inPath];
  if (target > inDur + 0.02) {
    const ext = target - inDur;
    args.push("-vf", `tpad=stop_mode=clone:stop_duration=${ext.toFixed(3)}`);
  }
  args.push("-t", target.toFixed(3), ...ENCODE(fps, await gpuEncodeAvailable()), outPath);
  await runMediaCommand("ffmpeg", args);
}

/** Concatenate uniformly-encoded clips into one silent video (stream copy). */
export async function concatVideos(clipPaths: string[], outPath: string): Promise<void> {
  if (clipPaths.length === 0) throw new Error("concatVideos: empty clipPaths");
  const tmp = await mkdtemp(join(tmpdir(), "vconcat-"));
  try {
    const listFile = join(tmp, "list.txt");
    // Absolute paths: the concat demuxer resolves `file '...'` relative to the
    // list file's directory (the temp dir), not the process cwd.
    // Forward slashes are mandatory to prevent Windows backslashes being treated as escape characters.
    const body = clipPaths
      .map((p) => `file '${resolve(p).replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
      .join("\n");
    await writeFile(listFile, body, "utf8");
    await runMediaCommand("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", outPath]);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export interface MuxWatermarkOptions {
  watermarkPath?: string;
  watermarkOpacity?: number;
  watermarkWidth?: number;
  watermarkMargin?: number;
}

/**
 * Mux an audio track onto a silent video. If a watermark image is provided,
 * it is overlaid at the top-right corner with the specified opacity.
 * The video length wins (no -shortest), so an outro visual hold past
 * the end of narration is preserved as silent tail.
 */
export async function muxAudioOntoVideo(
  videoPath: string,
  audioPath: string,
  outPath: string,
  options?: MuxWatermarkOptions,
): Promise<void> {
  const wmPath = options?.watermarkPath;
  if (wmPath && existsSync(wmPath)) {
    const opacity = options?.watermarkOpacity ?? 0.4;
    const wmWidth = options?.watermarkWidth ?? 84;
    const margin = options?.watermarkMargin ?? 44;
    await runMediaCommand("ffmpeg", [
      "-y",
      "-i", videoPath,
      "-i", wmPath,
      "-i", audioPath,
      "-filter_complex",
      `[1:v]scale=${wmWidth}:-1,format=rgba,colorchannelmixer=aa=${opacity}[wm];[0:v][wm]overlay=W-w-${margin}:${margin}`,
      ...videoCodecArgs(await gpuEncodeAvailable(), "veryfast"),
      "-pix_fmt", "yuv420p",
      "-profile:v", "high",
      "-level", "4.1",
      "-bf", "0",
      "-flags", "+cgop",
      "-g", "30",
      "-keyint_min", "30",
      "-sc_threshold", "0",
      "-color_primaries", "bt709",
      "-color_trc", "bt709",
      "-colorspace", "bt709",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      outPath,
    ]);
  } else {
    await runMediaCommand("ffmpeg", [
      "-y",
      "-i", videoPath,
      "-i", audioPath,
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      outPath,
    ]);
  }
}
