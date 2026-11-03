/**
 * Render cuối, chỉ chạy khi kịch bản và hình đã được người dùng duyệt.
 * tsx scripts/pipeline-runner.ts "<tài liệu>" [--max-still 8]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { evaluateQc, findFrozenIntervals, probeMedia } from "../src/gates/qc";
import { scanVideoScenes } from "../src/gates/raw-text";
import { REMOTION_FLAGS } from "../src/training/hardware";
import { assertApproved, loadScript, resolveJob } from "../src/training/job";
import { type Timeline } from "../src/training/training-contract";
import { normalizeLoudness } from "./finish-audio";

const args = process.argv.slice(2);
const input = args[0];
if (!input) {
  console.error('Sử dụng: npm run render -- "<tài liệu>"');
  process.exit(2);
}
const maxStillIndex = args.indexOf("--max-still");
const maxStillSec = maxStillIndex >= 0 ? Number(args[maxStillIndex + 1]) : 8;

const job = resolveJob(input);
assertApproved(job, "script");
assertApproved(job, "visual");
const script = loadScript(job);
const rawText = scanVideoScenes();
if (rawText.length) {
  for (const problem of rawText) console.error(`LỖI: ${problem}`);
  process.exit(1);
}
const timeline = JSON.parse(readFileSync(job.timelinePath, "utf8")) as Timeline;

const silentMix = join(job.outputDir, "_render.mp4");
const finalPath = join(job.outputDir, "video.mp4");

console.log("[1/3] Render");
execFileSync("npx", ["remotion", "render", "src/remotion/index.ts", "TrainingVideo", `"${silentMix}"`, `--props="${job.propsPath}"`, ...REMOTION_FLAGS, "--log=error"], { stdio: "inherit", shell: true });

console.log("[2/3] Chuẩn hoá độ to");
normalizeLoudness(silentMix, finalPath);
rmSync(silentMix);

console.log("[3/3] QC");
const facts = probeMedia(finalPath);
console.log(JSON.stringify(facts));
const errors = evaluateQc(facts, { aspect: script.aspect, durationSec: timeline.totalSec });
for (const frozen of findFrozenIntervals(finalPath, maxStillSec)) {
  errors.push(`Hình đứng yên ${frozen.duration.toFixed(1)} giây từ giây ${frozen.start.toFixed(1)}.`);
}
for (const error of errors) console.error(`LỖI: ${error}`);
if (errors.length) process.exit(1);
console.log(`Xong: ${finalPath}`);
