/**
 * Nhân sự #16: chuẩn hoá độ to về −14 LUFS bằng loudnorm hai lượt, giữ nguyên hình.
 * tsx scripts/finish-audio.ts <vào.mp4> <ra.mp4>
 */
import { execFileSync, spawnSync } from "node:child_process";

export function normalizeLoudness(input: string, output: string, target = -14): void {
  const filter = `loudnorm=I=${target}:TP=-1.5:LRA=11`;
  const first = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", input, "-af", `${filter}:print_format=json`, "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const start = first.stderr.lastIndexOf("{");
  const measured = JSON.parse(first.stderr.slice(start, first.stderr.indexOf("}", start) + 1)) as Record<string, string>;
  const second = `${filter}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-c:v", "copy", "-af", second, "-ar", "48000", "-c:a", "aac", "-b:a", "192k", output]);
}

const [input, output] = process.argv.slice(2);
if (input && output) normalizeLoudness(input, output);
