import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gpuEncodeAvailable, videoCodecArgs } from "../studio/render/video-tools.js";
import { runCapture } from "./ffmpeg-util.js";
import type { Range } from "./cut-core.js";

export type Aspect = "9:16" | "16:9" | "4:5" | "keep";

/** Kích thước đầu ra theo khung (keep = giữ nguyên). */
export const ASPECT_SIZE: Record<Exclude<Aspect, "keep">, [number, number]> = { "9:16": [1080, 1920], "16:9": [1920, 1080], "4:5": [1080, 1350] };

export interface CutSource {
  path: string;
  fps: number;
  width: number;
  height: number;
  videoCodec?: string;
  hasAudio: boolean;
  duration: number;
}

const XFADE = 0.01; // crossfade audio 10 ms ở điểm cắt
export const GROUP_SIZE = 40; // số đoạn giữ tối đa mỗi lần render video

/**
 * Snap mọi điểm cắt về biên khung hình (theo fps nguồn) để video và audio dùng CÙNG mốc.
 * shortcut: giả định nguồn CFR gần đúng; nguồn VFR nặng thì mốc có thể lệch tới 1 khung, nâng cấp bằng cách chuẩn hoá fps trước.
 */
export function snapKeeps(keeps: Range[], fps: number, duration: number): Range[] {
  const maxFrame = Math.floor(duration * fps);
  const out: Range[] = [];
  for (const k of keeps) {
    const a = Math.max(0, Math.round(k.start * fps));
    const b = Math.min(maxFrame, Math.round(k.end * fps));
    if (b <= a) continue;
    const last = out[out.length - 1];
    if (last && a <= Math.round(last.end * fps)) last.end = b / fps;
    else out.push({ start: a / fps, end: b / fps });
  }
  return out;
}

export function frameCount(keeps: Range[], fps: number): number {
  return keeps.reduce((s, k) => s + Math.round((k.end - k.start) * fps), 0);
}

/** Bộ lọc khung hình sau khi ghép (CPU): crop giữa + scale, hoặc giữ nguyên (ép kích thước chẵn). */
export function aspectFilter(aspect: Aspect): string {
  if (aspect === "keep") return "scale=trunc(iw/2)*2:trunc(ih/2)*2";
  const [w, h] = ASPECT_SIZE[aspect];
  return `crop=min(iw\\,ih*${w}/${h}):min(ih\\,iw*${h}/${w}),scale=${w}:${h}`;
}

/** Filter video cho một nhóm đoạn: trim theo khung (lệch nửa khung cho khỏi sai số làm tròn), concat, fps. */
export function buildVideoFilter(keeps: Range[], aspect: Aspect, fps: number, gpu: boolean): string {
  const f: string[] = [];
  const half = 0.5 / fps;
  keeps.forEach((k, i) => {
    f.push(`[0:v]trim=start=${(k.start - half).toFixed(6)}:end=${(k.end - half).toFixed(6)},setpts=PTS-STARTPTS[v${i}]`);
  });
  f.push(`${keeps.map((_, i) => `[v${i}]`).join("")}concat=n=${keeps.length}:v=1:a=0[vc]`);
  // GPU: cuvid đã crop/resize lúc giải mã; trim/concat/fps là filter chung nên chạy được trên khung CUDA
  f.push(gpu ? `[vc]fps=${fps}[vout]` : `[vc]${aspectFilter(aspect)},fps=${fps},format=yuv420p[vout]`);
  return f.join(";\n");
}

/** Filter audio cho toàn bộ đoạn giữ: atrim cùng mốc, acrossfade 10 ms, rồi ép đúng độ dài = số khung / fps. */
export function buildAudioFilter(keeps: Range[], fps: number, srcDuration: number, totalSec: number): string {
  const f: string[] = [];
  keeps.forEach((k, i) => {
    // đuôi dài thêm XFADE (trừ đoạn cuối) để sau khi chồng lên nhau tổng độ dài khớp
    const end = i < keeps.length - 1 ? Math.min(srcDuration, k.end + XFADE) : k.end;
    f.push(`[0:a]aresample=48000,atrim=start=${k.start.toFixed(6)}:end=${end.toFixed(6)},asetpts=PTS-STARTPTS[a${i}]`);
  });
  let prev = "a0";
  for (let i = 1; i < keeps.length; i++) {
    f.push(`[${prev}][a${i}]acrossfade=d=${XFADE}:c1=tri:c2=tri[x${i}]`);
    prev = `x${i}`;
  }
  f.push(`[${prev}]aresample=async=1:first_pts=0,apad=whole_dur=${totalSec.toFixed(6)},atrim=end=${totalSec.toFixed(6)}[aout]`);
  return f.join(";\n");
}

const CUVID: Record<string, string> = { h264: "h264_cuvid", hevc: "hevc_cuvid", vp9: "vp9_cuvid", av1: "av1_cuvid", mpeg4: "mpeg4_cuvid" };
const even = (n: number) => Math.floor(n / 2) * 2;

/** Tham số giải mã GPU: cuvid crop giữa + resize theo --aspect. Trả null nếu codec không có cuvid. */
export function cuvidArgs(codec: string | undefined, w: number, h: number, aspect: Aspect): string[] | null {
  const dec = CUVID[codec ?? ""];
  if (!dec) return null;
  const args = ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda", "-c:v", dec];
  if (aspect === "keep") return args;
  const [tw, th] = ASPECT_SIZE[aspect];
  const ratio = tw / th;
  const cw = even(Math.min(w, h * ratio));
  const ch = even(Math.min(h, w / ratio));
  const l = even((w - cw) / 2);
  const t = even((h - ch) / 2);
  return [...args, "-crop", `${t}x${h - ch - t}x${l}x${w - cw - l}`, "-resize", `${tw}x${th}`];
}

export interface RenderResult {
  mode: string;
  frames: number;
  seconds: number;
  groups: number;
}

/** Render cut.mp4: video theo nhóm ≤ 40 đoạn (ghép bằng concat copy), audio một lượt, rồi mux. keeps phải đã snap khung. */
export async function renderCut(opts: { src: CutSource; keeps: Range[]; aspect: Aspect; out: string; workDir: string; forceCpu?: boolean }): Promise<RenderResult> {
  const { src, keeps, aspect, out, workDir } = opts;
  const t0 = Date.now();
  await mkdir(workDir, { recursive: true });
  const nvenc = !opts.forceCpu && (await gpuEncodeAvailable());
  const dec = nvenc ? cuvidArgs(src.videoCodec, src.width, src.height, aspect) : null;
  const groups: Range[][] = [];
  for (let i = 0; i < keeps.length; i += GROUP_SIZE) groups.push(keeps.slice(i, i + GROUP_SIZE));
  const frames = frameCount(keeps, src.fps);
  const totalSec = frames / src.fps;
  const parts = groups.map((_, g) => join(workDir, `cut-part-${g}.mp4`));

  const renderVideo = async (gpu: boolean) => {
    for (let g = 0; g < groups.length; g++) {
      const script = join(workDir, `cut-video-${g}.txt`);
      await writeFile(script, buildVideoFilter(groups[g], aspect, src.fps, gpu), "utf8");
      const args = ["-y", ...(gpu ? dec! : []), "-i", src.path, "-/filter_complex", script, "-map", "[vout]", "-an",
        ...videoCodecArgs(nvenc, "medium"), "-bf", "0", "-g", String(Math.round(src.fps)), "-fps_mode", "cfr"];
      if (!gpu) args.push("-pix_fmt", "yuv420p");
      args.push("-movflags", "+faststart", parts[g]);
      await runCapture("ffmpeg", args);
    }
  };
  let mode = dec ? "GPU (cuvid+NVENC)" : nvenc ? "CPU lọc + NVENC" : "CPU";
  if (dec) {
    try {
      await renderVideo(true);
    } catch (e) {
      console.warn(`GPU lỗi, chạy lại bằng CPU: ${String((e as Error).message).slice(-300)}`);
      mode = "CPU (fallback)";
      await renderVideo(false);
    }
  } else await renderVideo(false);

  const mux = ["-y", "-f", "concat", "-safe", "0", "-i", join(workDir, "cut-parts.txt")];
  await writeFile(join(workDir, "cut-parts.txt"), parts.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"), "utf8");
  let audioWav: string | null = null;
  if (src.hasAudio) {
    audioWav = join(workDir, "cut-audio.wav");
    const script = join(workDir, "cut-audio.txt");
    await writeFile(script, buildAudioFilter(keeps, src.fps, src.duration, totalSec), "utf8");
    await runCapture("ffmpeg", ["-y", "-i", src.path, "-/filter_complex", script, "-map", "[aout]", "-c:a", "pcm_s16le", audioWav]);
    mux.push("-i", audioWav);
  }
  mux.push("-map", "0:v", ...(audioWav ? ["-map", "1:a", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"] : []), "-c:v", "copy", "-movflags", "+faststart", out);
  await runCapture("ffmpeg", mux);
  for (const p of [...parts, ...(audioWav ? [audioWav] : [])]) await rm(p, { force: true });
  return { mode, frames, seconds: +((Date.now() - t0) / 1000).toFixed(1), groups: groups.length };
}
