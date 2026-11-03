/**
 * Nhân sự #16: đặt một SFX về trái hoặc phải trước khi đưa vào kịch bản.
 * tsx scripts/pan-audio.ts <vào> <ra.wav> <-1..1>
 */
import { execFileSync } from "node:child_process";

export const panFilter = (pan: number): string => {
  if (pan < -1 || pan > 1) throw new Error("Pan phải trong khoảng -1 đến 1.");
  const left = Math.cos(((pan + 1) * Math.PI) / 4).toFixed(4);
  const right = Math.sin(((pan + 1) * Math.PI) / 4).toFixed(4);
  return `pan=stereo|c0=${left}*c0|c1=${right}*c0`;
};

const [input, output, pan] = process.argv.slice(2);
if (input && output && pan !== undefined) {
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", input, "-ac", "1", "-af", panFilter(Number(pan)), output]);
}
