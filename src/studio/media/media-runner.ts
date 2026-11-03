import { spawn } from "node:child_process";
import { resolveMediaBinary } from "../utils/media-binary.js";

/**
 * Execute an ffmpeg or ffprobe command using the locally resolved binary.
 */
export function runMediaCommand(
  cmd: "ffmpeg" | "ffprobe" | string,
  args: string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    const executable =
      cmd === "ffmpeg" || cmd === "ffprobe"
        ? resolveMediaBinary(cmd)
        : cmd;
    const proc = spawn(executable, args, { windowsHide: true });
    let out = "";
    let err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} failed (exit ${code}): ${err.slice(-1000)}`));
    });
    proc.on("error", reject);
  });
}

/**
 * Get media file duration in seconds.
 *
 * For MP3 files, ffprobe's format=duration estimates duration from bitrate * filesize
 * and can be inaccurate for low-sample-rate TTS audio. We count actual encoded packets.
 * For video and other media containers, we probe format=duration or stream=duration.
 */
export async function getMediaDurationSec(path: string): Promise<number> {
  if (path.toLowerCase().endsWith(".mp3")) {
    try {
      const raw = await runMediaCommand("ffprobe", [
        "-v",
        "error",
        "-count_packets",
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=nb_read_packets,sample_rate",
        "-of",
        "json",
        path,
      ]);
      const data = JSON.parse(raw);
      const stream = data?.streams?.[0];
      const packets = parseInt(stream?.nb_read_packets ?? "", 10);
      const sampleRate = parseInt(stream?.sample_rate ?? "", 10);
      if (packets > 0 && sampleRate > 0) {
        // MPEG-1 L3 (32/44.1/48 kHz): 1152 samples/frame
        // MPEG-2/2.5 L3 (<=24 kHz): 576 samples/frame
        const samplesPerFrame = sampleRate >= 32000 ? 1152 : 576;
        return (packets * samplesPerFrame) / sampleRate;
      }
    } catch {
      // fall through to format duration below
    }
  }

  const out = await runMediaCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  const d = parseFloat(out.trim());
  if (isNaN(d)) {
    throw new Error(`ffprobe returned non-numeric duration for ${path}: ${out}`);
  }
  return d;
}
