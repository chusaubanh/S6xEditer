/**
 * Xuất video đã duyệt thành project CapCut nhiều lớp: mỗi cảnh một clip, mỗi câu đọc, mỗi tiếng hiệu ứng và nhạc nền một đoạn riêng.
 * tsx scripts/capcut-export.ts "<tài liệu>" --name "<tên draft>" [--drafts <thư mục>]
 * Không có --drafts thì ghi vào kho CapCut thật, nên CapCut phải đang đóng.
 * shortcut: chữ và watermark vẫn nằm trong clip cảnh; muốn sửa được thì phải tách thành lớp chữ riêng.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { musicVolume } from "../src/remotion/compositions/TrainingVideoComposition";
import { GL, H264_ARGS } from "../src/training/hardware";
import { assertApproved, loadScript, resolveJob } from "../src/training/job";
import { musicKeyTimes, planClips, planSfx, planVoice } from "../src/training/placement";
import { FPS, type Timeline } from "../src/training/training-contract";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const name = flag("--name");
const drafts = flag("--drafts");
if (!args[0] || !name) {
  console.error('Sử dụng: npm run capcut:export -- "<tài liệu>" --name "<tên draft>" [--drafts <thư mục>]');
  process.exit(2);
}

const job = resolveJob(args[0]);
assertApproved(job, "script");
assertApproved(job, "visual");
const script = loadScript(job);
const timeline = JSON.parse(readFileSync(job.timelinePath, "utf8")) as Timeline;
const video = join(job.outputDir, "video.mp4");
if (!existsSync(video)) throw new Error("Chưa có video.mp4. Chạy npm run render trước.");
if (!drafts && spawnSync("tasklist", ["/FI", "IMAGENAME eq CapCut.exe"], { encoding: "utf8" }).stdout.includes("CapCut.exe")) {
  throw new Error("CapCut đang mở. Đóng hẳn CapCut rồi chạy lại.");
}

const cli = resolve("node_modules/capcut-cli/dist/index.js");
const capcut = (cliArgs: string[], input?: string): Record<string, unknown> => {
  const out = execFileSync("node", [cli, ...cliArgs], { encoding: "utf8", input, maxBuffer: 1 << 26 });
  return JSON.parse(out.slice(out.indexOf("{"))) as Record<string, unknown>;
};
const ffmpeg = (ffArgs: string[]) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...ffArgs]);
const durationOf = (path: string): number =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], { encoding: "utf8" }));

const media = join(job.outputDir, "capcut", "media");
rmSync(media, { recursive: true, force: true });
mkdirSync(media, { recursive: true });

// CapCut không chuẩn hoá giúp, nên bản trộn đo trước rồi cộng cùng một mức vào mọi file âm thanh.
console.log("[1/4] Đo độ to của bản trộn");
const mix = join(job.outputDir, "capcut", "_mix.wav");
execFileSync("npx", ["remotion", "render", "src/remotion/index.ts", "TrainingVideo", `"${mix}"`, `--props="${job.propsPath}"`, "--codec=wav", `--gl=${GL}`, "--log=error"], { stdio: "inherit", shell: true });
const measure = (path: string, filter = "") => {
  const log = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", path, "-af", `${filter}ebur128=peak=true`, "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const summary = log.slice(log.lastIndexOf("Summary:"));
  return { lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]), peak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]) };
};
const before = measure(mix);
// CapCut không có limiter như bản video, nên chừa đỉnh −1 dBFS dù có thể chưa tới −14 LUFS.
const gainDb = Math.min(-14 - before.lufs, -1 - before.peak);
const after = measure(mix, `volume=${gainDb}dB,`);
rmSync(mix);
console.log(`Trước ${before.lufs} LUFS, cộng ${gainDb.toFixed(1)} dB, sau ${after.lufs} LUFS, đỉnh ${after.peak} dBFS`);
if (after.peak > 0) throw new Error(`Bản trộn vượt 0 dBFS (${after.peak}).`);

const bake = (src: string, out: string) => ffmpeg(["-i", join("public", src), "-af", `volume=${gainDb}dB`, "-ar", "48000", "-c:a", "pcm_s16le", out]);

console.log("[2/4] Cắt cảnh và tách âm thanh");
const clips = planClips(timeline).map((clip, i) => {
  const path = join(media, `${String(i + 1).padStart(2, "0")}-${clip.id}.mp4`);
  ffmpeg(["-i", video, "-vf", `trim=start_frame=${clip.fromFrame}:end_frame=${clip.toFrame},setpts=PTS-STARTPTS`, "-an", "-r", String(FPS), ...H264_ARGS, path]);
  return { ...clip, path };
});
const framesOut = clips.reduce((sum, clip) => sum + clip.toFrame - clip.fromFrame, 0);

const voice = planVoice(timeline).map((item) => {
  const path = join(media, `giong-${item.name}.wav`);
  bake(item.src, path);
  return { ...item, path };
});
const sfxFiles = new Map<string, string>();
for (const scene of script.scenes) {
  for (const cue of scene.sfx) {
    if (sfxFiles.has(cue.src)) continue;
    const path = join(media, `sfx-${basename(cue.src).replace(/\.\w+$/, "")}.wav`);
    bake(cue.src, path);
    sfxFiles.set(cue.src, path);
  }
}
const sfx = planSfx(script, timeline, (src) => durationOf(sfxFiles.get(src) as string));

console.log("[3/4] Dựng project");
const store = drafts ? ["--drafts", resolve(drafts)] : [];
const created = capcut(["init", name, ...store, "--width", String(1080), "--height", String(1350)]);
const project = created.draft_path as string;
if (script.aspect !== "4:5") throw new Error("shortcut: khung draft mới viết cho 4:5, khổ khác cần thêm kích thước.");

for (const clip of clips) {
  capcut(["add-video", project, clip.path, `${clip.fromFrame / FPS}s`, `${(clip.toFrame - clip.fromFrame) / FPS}s`, "--track-name", "Canh"]);
}
for (const item of voice) {
  capcut(["add-audio", project, item.path, `${item.startSec}s`, `${durationOf(item.path)}s`, "--track-name", "Giong"]);
}
for (const item of sfx) {
  const path = sfxFiles.get(item.src) as string;
  capcut(["add-audio", project, path, `${item.startSec}s`, `${durationOf(path)}s`, "--volume", String(item.volume), "--track-name", `SFX ${item.lane + 1}`]);
}
if (script.music) {
  const path = join(media, `nhac-${basename(script.music.src).replace(/\.\w+$/, "")}.wav`);
  ffmpeg(["-i", join("public", script.music.src), "-t", String(timeline.totalSec), "-af", `volume=${gainDb}dB`, "-ar", "48000", "-c:a", "pcm_s16le", path]);
  const added = capcut(["add-audio", project, path, "0s", `${timeline.totalSec}s`, "--track-name", "Nhac nen"]);
  const keys = musicKeyTimes(script, timeline).map((sec) =>
    JSON.stringify({ property: "volume", time: `${sec}s`, value: String(musicVolume(sec * FPS, script, timeline)) }),
  );
  capcut(["keyframe", project, added.segment_id as string, "--batch"], keys.join("\n"));
}

console.log("[4/4] Kiểm");
const lint = capcut(["lint", project]);
const draft = JSON.parse(readFileSync(join(project, "draft_content.json"), "utf8")) as { tracks: { type: string; name: string; segments: unknown[] }[] };
const counted = Object.fromEntries(draft.tracks.map((track) => [track.name || track.type, track.segments.length]));
const report = { project, gainDb, loudness: after, frames: framesOut, counted, lint: lint.summary };
writeFileSync(join(job.outputDir, "capcut", "report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
const sfxCount = draft.tracks.filter((track) => track.name.startsWith("SFX")).reduce((sum, track) => sum + track.segments.length, 0);
const wantFrames = Math.round(timeline.totalSec * FPS);
const problems = [
  clips.length !== counted.Canh && "Thiếu clip cảnh.",
  voice.length !== counted.Giong && "Thiếu câu đọc.",
  sfx.length !== sfxCount && "Thiếu tiếng hiệu ứng.",
  framesOut !== wantFrames && `Tổng khung ${framesOut}, cần ${wantFrames}.`,
  (lint.summary as { errors: number }).errors > 0 && "capcut lint báo lỗi.",
].filter(Boolean);
for (const problem of problems) console.error(`LỖI: ${problem}`);
if (problems.length) process.exit(1);
console.log(`Xong: ${project}`);
