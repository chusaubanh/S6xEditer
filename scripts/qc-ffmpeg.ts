/**
 * Nhân sự #18 - FFmpeg: kiểm tệp cuối. Sai thì thoát mã 1.
 * tsx scripts/qc-ffmpeg.ts <video> --aspect 16:9 [--duration 180] [--lufs -14]
 */
import { existsSync } from "node:fs";
import { evaluateQc, probeMedia } from "../src/gates/qc";
import { ASPECT_NAMES, type Aspect } from "../src/training/training-contract";

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const path = args[0];
const aspect = option("aspect") as Aspect | undefined;
if (!path || !existsSync(path) || !aspect || !ASPECT_NAMES.includes(aspect)) {
  console.error(`Sử dụng: qc-ffmpeg <tệp có sẵn> --aspect ${ASPECT_NAMES.join("|")} [--duration giây] [--lufs -14]`);
  process.exit(2);
}

const duration = option("duration");
const lufs = option("lufs");
const facts = probeMedia(path);
console.log(JSON.stringify(facts));
const errors = evaluateQc(facts, {
  aspect,
  ...(duration ? { durationSec: Number(duration) } : {}),
  ...(lufs ? { lufs: Number(lufs) } : {}),
});
for (const error of errors) console.error(`LỖI: ${error}`);
console.log(errors.length ? "QC: KHÔNG ĐẠT" : "QC: ĐẠT");
process.exit(errors.length ? 1 : 0);
