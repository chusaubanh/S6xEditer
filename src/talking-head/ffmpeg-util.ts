import { spawn } from "node:child_process";
import { resolveMediaBinary } from "../studio/utils/media-binary.js";

/** Chạy ffmpeg/ffprobe/python, trả cả stdout lẫn stderr (loudnorm in JSON ra stderr). */
export function runCapture(exe: string, args: string[], opts: { env?: NodeJS.ProcessEnv; inherit?: boolean; binary?: boolean } = {}): Promise<{ stdout: string; stderr: string; stdoutBuf?: Buffer }> {
  return new Promise((resolve, reject) => {
    const bin = exe === "ffmpeg" || exe === "ffprobe" ? resolveMediaBinary(exe) : exe;
    const p = spawn(bin, args, { windowsHide: true, env: opts.env ?? process.env });
    let stdout = "";
    const chunks: Buffer[] = [];
    let stderr = "";
    p.stdout.on("data", (d) => {
      if (opts.binary) chunks.push(d);
      else stdout += d;
      if (opts.inherit) process.stdout.write(d);
    });
    p.stderr.on("data", (d) => {
      stderr += d;
      if (opts.inherit) process.stderr.write(d);
    });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr, stdoutBuf: opts.binary ? Buffer.concat(chunks) : undefined });
      else reject(new Error(`${exe} thoát mã ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

export interface ProbeInfo {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec?: string;
}

export async function probe(file: string): Promise<{ info: ProbeInfo; raw: unknown }> {
  const { stdout } = await runCapture("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file]);
  const raw = JSON.parse(stdout);
  const v = raw.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
  if (!v) throw new Error(`Không có luồng video trong ${file}`);
  const [n, d] = String(v.avg_frame_rate ?? "30/1").split("/").map(Number);
  return {
    raw,
    info: {
      duration: parseFloat(raw.format?.duration ?? v.duration),
      width: v.width,
      height: v.height,
      fps: d ? n / d : 30,
      hasAudio: raw.streams.some((s: { codec_type: string }) => s.codec_type === "audio"),
      videoCodec: v.codec_name,
    },
  };
}

export function aspectLabel(w: number, h: number): string {
  const r = w / h;
  if (Math.abs(r - 9 / 16) < 0.01) return "9:16";
  if (Math.abs(r - 16 / 9) < 0.01) return "16:9";
  if (Math.abs(r - 4 / 5) < 0.01) return "4:5";
  return `${w}:${h}`;
}
