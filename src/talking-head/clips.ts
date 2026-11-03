import { copyFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { ensureCutFromClips, clipFrames, totalFrames } from "./clips-render.js";
import { REPO_ROOT, jobDir, readJson, requireFile, withStep } from "./jobs.js";
import { loadProject, saveProject, type VideoClip } from "./project-schema.js";
import { rawPath, SOURCE_AUDIO, SOURCE_PROXY } from "./source-media.js";
import type { Range } from "./cut-core.js";

/**
 * Từ cut-map (đoạn giữ trên video gốc, đã snap khung) + thông tin intro (mốc trên timeline cắt TRƯỚC intro) dựng videoClips:
 * [hold gap][source intro (có thể tách nếu vắt qua điểm nối)][các đoạn thân bài]. Mọi mốc quy về khung nguyên.
 */
export function buildClipsFromCutMap(keeps: Range[], intro: { from: number; to: number; gap: number } | undefined, fps: number): VideoClip[] {
  const kf = keeps.map((k) => ({ a: Math.round(k.start * fps), b: Math.round(k.end * fps) }));
  const t = (f: number) => +(f / fps).toFixed(6);
  const clips: VideoClip[] = [];
  let n = 0;
  const id = () => `C-${String(++n).padStart(4, "0")}`;
  if (intro) {
    const fromF = Math.round(intro.from * fps);
    const toF = Math.round(intro.to * fps);
    const pieces: Array<{ a: number; b: number }> = [];
    let c = 0;
    for (const k of kf) {
      const len = k.b - k.a;
      const o0 = Math.max(fromF, c);
      const o1 = Math.min(toF, c + len);
      if (o1 > o0) pieces.push({ a: k.a + (o0 - c), b: k.a + (o1 - c) });
      c += len;
    }
    if (!pieces.length) throw new Error("Đoạn intro không nằm trong các đoạn giữ của cut-map.");
    clips.push({ id: id(), kind: "hold", srcIn: t(pieces[0].a), dur: +(Math.round(intro.gap * fps) / fps).toFixed(6) });
    for (const p of pieces) clips.push({ id: id(), kind: "source", srcIn: t(p.a), srcOut: t(p.b) });
  }
  for (const k of kf) clips.push({ id: id(), kind: "source", srcIn: t(k.a), srcOut: t(k.b) });
  return clips;
}

/** th:clips-init: migration job cũ → videoClips (từ chối nếu đã có). Sao lưu project.before-clips.json. */
export async function clipsInit(job: string): Promise<void> {
  const dir = jobDir(job);
  const projectFile = requireFile(join(dir, "project.json"), "Chạy th:project trước.");
  const project = await loadProject(projectFile);
  if (project.videoClips?.length) throw new Error("Project đã có videoClips — không migration lại.");
  const map = await readJson<{ keeps: Range[]; intro?: { from: number; to: number; gap: number }; introOffset?: number }>(requireFile(join(dir, "cut-map.json"), "Cần cut-map.json (từ th:cut)."));
  const media = await readJson<{ info: { fps: number } }>(join(dir, "media.json"));
  const raw = await rawPath(job);
  const fps = media.info.fps;
  const clips = buildClipsFromCutMap(map.keeps, map.intro, fps);
  const total = totalFrames(clipFrames(clips, fps)) / fps;
  const warn = Math.abs(total - project.duration) > 1 / fps ? `CẢNH BÁO: tổng clips ${total.toFixed(3)}s ≠ project.duration ${project.duration}s` : "";
  await withStep(job, "clips-init", async () => {
    const bak = join(dir, "project.before-clips.json");
    if (!existsSync(bak)) copyFileSync(projectFile, bak);
    project.source = {
      ...project.source,
      raw: relative(REPO_ROOT, raw).replace(/\\/g, "/"), // tương đối gốc repo; dạng cũ "../../input/..." vẫn đọc được
      rawAudio: SOURCE_AUDIO,
      proxy: SOURCE_PROXY,
    };
    project.videoClips = clips;
    await saveProject(projectFile, project);
    return { result: null, outputs: ["project.json", "project.before-clips.json"] };
  });
  console.log(`videoClips: ${clips.length} clip (${clips.filter((c) => c.kind === "hold").length} hold), tổng ${total.toFixed(3)}s, ${Math.round(total * fps)} khung`);
  if (warn) console.warn(warn);
}

/** th:clips-build: dựng cut.mp4/audio.wav/transcript.cut.json từ videoClips (cache theo hash). */
export async function clipsBuild(job: string, force = false, cpu = false): Promise<void> {
  const dir = jobDir(job);
  const project = await loadProject(requireFile(join(dir, "project.json"), "Chạy th:project trước."));
  await withStep(job, "clips-build", async () => {
    const r = await ensureCutFromClips(project, dir, { force, cpu });
    console.log(r.changed ? `Dựng từ clips: ${r.frames} khung, ${r.mode}, ${r.seconds}s (hash ${r.hash})` : `Clips không đổi (hash ${r.hash}): dùng lại cut.mp4/audio.wav; transcript.cut.json đã tạo lại.`);
    return { result: null, outputs: ["cut.mp4", "audio.wav", "transcript.cut.json"] };
  });
}
