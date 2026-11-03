/** `npm run th:render -- <job> [--keep-tmp] [--overlay-only] [--workers N] [--no-cache] [--cpu] [--force-mix]` — xuất video cuối Chế độ C. */
import { join } from "node:path";
import { ensureProjectMix, needsMix } from "./audio-mix.js";
import { ensureCutFromClips } from "./clips-render.js";
import { jobDir, parseArgs, warnStale, withStep } from "./jobs.js";
import { loadProject } from "./project-schema.js";
import { renderProject } from "./render-overlay.js";
import { log } from "../studio/utils/logger.js";

const { pos, flags } = parseArgs(process.argv.slice(2));
const job = pos[0];
if (!job) {
  console.error("Cú pháp: npm run th:render -- <job> [--keep-tmp] [--overlay-only]");
  process.exit(1);
}

try {
  const out = await withStep(job, "render", async () => {
    await warnStale(job, ["cut", "audio", "project"]);
    // Trộn giọng + SFX + nhạc (ducking, loudnorm) -> mix.wav; cache theo hash đầu vào nên render lại không trộn lại
    const project = await loadProject(join(jobDir(job), "project.json"));
    // videoClips là nguồn sự thật: dựng lại cut.mp4/audio.wav/transcript.cut.json theo hash trước pass overlay
    if (project.videoClips?.length) {
      const c = await ensureCutFromClips(project, jobDir(job), { cpu: !!flags.cpu });
      log.info(c.changed ? `Video gốc: dựng lại từ ${project.videoClips.length} clip — ${c.frames} khung, ${c.mode}, ${c.seconds}s` : "Video gốc: clips không đổi, dùng lại cut.mp4/audio.wav");
      if (Math.abs(c.frames / project.fps - project.duration) > 1.5 / project.fps) log.warn(`project.duration ${project.duration}s lệch tổng clips ${(c.frames / project.fps).toFixed(3)}s`);
    }
    let audioFile: string | undefined;
    if (needsMix(project) && !flags["overlay-only"]) {
      const m = await ensureProjectMix(project, jobDir(job), join(jobDir(job), "mix.wav"), !!flags["force-mix"]);
      audioFile = m.file;
      log.info(m.cached ? "Audio: dùng lại mix.wav (không đổi)" : `Audio: trộn xong mix.wav — ${m.result!.lufs} LUFS, ${m.result!.truePeak} dBTP, ${m.result!.sfxCount} SFX, ${m.result!.musicCount} nhạc${m.result!.skipped.length ? `, bỏ qua ${m.result!.skipped.length} file thiếu` : ""}`);
    }
    const f = await renderProject(job, { audioFile, keepTmp: !!flags["keep-tmp"], overlayOnly: !!flags["overlay-only"], noCache: !!flags["no-cache"], cpu: !!flags.cpu, workers: flags.workers ? Number(flags.workers) : undefined });
    return { result: f, outputs: [f] };
  });
  log.info(`Xong: ${out}`);
} catch (e) {
  log.error("th:render thất bại", e);
  process.exit(1);
}
