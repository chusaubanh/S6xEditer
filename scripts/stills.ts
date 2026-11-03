/**
 * Ảnh duyệt cho S6, S7 và người dùng: cuối mỗi câu, bản có chữ và bản ẩn chữ, kèm tờ liên hoàn và số đo độ phủ.
 * tsx scripts/stills.ts "<tài liệu>"
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { measureCoverage } from "../src/gates/qc";
import { resolveJob } from "../src/training/job";
import { ASPECTS, secToFrames, type Timeline, type TrainingScript } from "../src/training/training-contract";
import { openStillSession } from "./render-tools";

const MIN_COVERAGE = 0.62;
const MAX_GAP = 0.19;
const TOP = 0.08;
const BOTTOM = 0.925;

const SAFE_MARGIN = 60;

/** Khoảng cách từ nội dung tới mép khung; che góc watermark để không tính nó là nội dung. */
function edgeMargins(path: string, width: number, height: number) {
  const log = spawnSync("ffmpeg", ["-hide_banner", "-i", path, "-vf", `drawbox=x=${width - 120}:y=0:w=120:h=150:color=black:t=fill,format=gray,bbox=min_val=70`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const match = /x1:(\d+) x2:(\d+) y1:(\d+) y2:(\d+)/.exec(log);
  if (!match) throw new Error(`Không đo được mép khung: ${path}`);
  const [x1, x2, y1, y2] = match.slice(1).map(Number);
  return Math.min(x1, width - 1 - x2, y1, height - 1 - y2);
}

function auditFrame(path: string) {
  const info = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path], { encoding: "utf8" }).trim();
  const [width = 0, height = 0] = info.split(",").map(Number);
  const y0 = Math.round(height * TOP);
  const cropHeight = Math.round(height * BOTTOM) - y0;
  const raw = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", path, "-vf", `crop=${width}:${cropHeight}:0:${y0},format=gray`, "-f", "rawvideo", "-"], { maxBuffer: 256 * 1024 * 1024 }).stdout;
  const counts = new Uint32Array(256);
  for (const value of raw) counts[value] = (counts[value] ?? 0) + 1;
  const background = counts.indexOf(Math.max(...counts));
  return measureCoverage(raw, width, cropHeight, background);
}

const input = process.argv[2];
if (!input) {
  console.error('Sử dụng: stills "<tài liệu>"');
  process.exit(2);
}
const job = resolveJob(input);
const props = JSON.parse(readFileSync(job.propsPath, "utf8")) as { script: TrainingScript; timeline: Timeline };
const dir = join(job.outputDir, "stills");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const session = await openStillSession();
const report: string[] = [];
let failed = 0;
try {
  for (const scene of props.timeline.scenes) {
    for (const [i, sentence] of scene.sentences.entries()) {
      const frame = secToFrames(scene.startSec + sentence.startSec + sentence.durationSec) - 1;
      const name = `${scene.id}-${i}`;
      const withText = await session.shoot("TrainingVideo", frame, { ...props, hideText: false }, join(dir, `${name}.png`));
      await session.shoot("TrainingVideo", frame, { ...props, hideText: true }, join(dir, `${name}-an-chu.png`));
      // Hình hiện dần theo câu, nên độ phủ chỉ xét ở trạng thái cuối cảnh.
      if (i < scene.sentences.length - 1) continue;
      const audit = auditFrame(withText);
      const { width, height } = ASPECTS[props.script.aspect];
      const margin = edgeMargins(withText, width, height);
      const pass = audit.rowCoverage >= MIN_COVERAGE && audit.largestGap <= MAX_GAP && margin >= SAFE_MARGIN;
      if (!pass) failed++;
      report.push(`${pass ? "đạt " : "LỖI "} ${name}: phủ ${(audit.rowCoverage * 100).toFixed(0)}%, dải trống lớn nhất ${(audit.largestGap * 100).toFixed(0)}%, cách mép ${margin} px`);
    }
  }
} finally {
  await session.close();
}

try {
  const all = props.timeline.scenes.flatMap((scene) => scene.sentences.map((_, i) => `${scene.id}-${i}`));
  const concat = (suffix: string) => all.map((name) => `file '${join(dir, `${name}${suffix}.png`).replace(/\\/g, "/")}'`).join("\n");
  for (const [suffix, output] of [["", "to-lien-hoan.jpg"], ["-an-chu", "to-lien-hoan-an-chu.jpg"]] as const) {
    const list = join(dir, `list${suffix}.txt`);
    writeFileSync(list, concat(suffix));
    const columns = props.script.aspect === "16:9" ? 3 : 5;
    execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", `scale=480:-2,tile=${columns}x${Math.ceil(all.length / columns)}:padding=8:color=0x222222`, "-frames:v", "1", join(dir, output)]);
    rmSync(list);
  }
} catch (error) {
  console.error(`Không tạo được tờ liên hoàn: ${(error as Error).message}`);
  failed++;
}
writeFileSync(join(dir, "do-phu.txt"), `${report.join("\n")}\n`);
console.log(report.join("\n"));
console.log(`Ảnh duyệt: ${dir}`);
process.exit(failed ? 1 : 0);
