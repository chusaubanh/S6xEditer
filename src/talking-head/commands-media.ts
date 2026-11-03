import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { mapTime, keepRangesFromCuts, remapTranscript, totalDuration, type Range } from "./cut-core.js";
import { aspectLabel, probe, runCapture } from "./ffmpeg-util.js";
import { ASR_PYTHON, REPO_ROOT, assertNoClips, jobDir, loadRun, warnStale, readJson, requireApproval, requireFile, withStep, writeJson } from "./jobs.js";
import { loadBestTranscript, loadMedia } from "./commands-text.js";
import { CutsSchema, OutlineSchema, TranscriptSchema, saveProject, type Layer, type Outline, type OutlineItem, type Project, type Track } from "./project-schema.js";
import { chunkToLayer, splitSubtitles, type SubGeo } from "./subtitles.js";


import { renderCut, snapKeeps, type Aspect } from "./cut-render.js";
export type { Aspect } from "./cut-render.js";

/** Không ghi đè: đổi tên file cũ thành <tên>.prev-<thời gian><đuôi>. */
async function archiveIfExists(file: string): Promise<void> {
  if (!existsSync(file)) return;
  const stamp = new Date().toISOString().replace(/:/g, "-");
  await rename(file, file.replace(/(\.[^.]+)$/, `.prev-${stamp}$1`));
}


// ---------- 02d cut ----------

export async function cut(job: string, aspectArg: string | undefined, forceCpu = false): Promise<void> {
  assertNoClips(job, "th:cut");
  if (!aspectArg) throw new Error("Thiếu --aspect: chọn 16:9 | 4:5 | 9:16 | keep (không có mặc định ngầm, hỏi người dùng).");
  const aspect = (aspectArg === "original" ? "keep" : aspectArg) as Aspect;
  if (!["9:16", "16:9", "4:5", "keep"].includes(aspect)) throw new Error("--aspect chỉ nhận 16:9 | 4:5 | 9:16 | keep");
  await requireApproval(job, "cut");
  const dir = jobDir(job);
  const media = await loadMedia(job);
  const cuts = await readJson(requireFile(join(dir, "cuts.json"), "Chạy th:cut-plan trước."), CutsSchema);
  // snap điểm cắt về biên khung hình trước khi cắt: video, audio và ánh xạ transcript dùng cùng mốc
  const keeps = snapKeeps(keepRangesFromCuts(cuts, media.info.duration), media.info.fps, media.info.duration);
  if (!keeps.length) throw new Error("Không còn đoạn nào để giữ. Kiểm tra cuts.json (mode/approved).");
  await withStep(job, "cut", async () => {
    const out = join(dir, "cut.mp4");
    await archiveIfExists(out);
    await archiveIfExists(join(dir, "transcript.cut.json"));
    const r = await renderCut({
      src: { path: resolve(REPO_ROOT, media.source), ...media.info },
      keeps, aspect, out, workDir: join(dir, "work"), forceCpu,
    });
    const run = await loadRun(job);
    run.aspect = aspect;
    await writeJson(join(dir, "run.json"), run);
    const { tr } = await loadBestTranscript(job);
    await writeJson(join(dir, "transcript.cut.json"), remapTranscript(tr, keeps));
    await writeJson(join(dir, "cut-map.json"), { aspect, keeps, duration: totalDuration(keeps) });
    console.log(`cut.mp4: ${out}
${keeps.length} đoạn giữ (${r.groups} nhóm), ${totalDuration(keeps).toFixed(2)}s (gốc ${media.info.duration.toFixed(1)}s), chế độ ${r.mode}, ${r.seconds}s`);
    return { result: null, outputs: ["cut.mp4", "transcript.cut.json", "cut-map.json"] };
  });
}

// ---------- 03 audio ----------

/** loudnorm 2 lượt: lượt 1 đo, lượt 2 chuẩn hoá tuyến tính theo số đo. */
export async function audio(job: string): Promise<void> {
  assertNoClips(job, "th:audio");
  const dir = jobDir(job);
  const cutMp4 = requireFile(join(dir, "cut.mp4"), "Chạy th:cut trước.");
  await warnStale(job, ["cut"]);
  requireFile(ASR_PYTHON, "Chạy npm run th:setup trước.");
  await withStep(job, "audio", async () => {
    const work = join(dir, "work");
    await mkdir(work, { recursive: true });
    const raw = join(work, "audio-raw.wav");
    const clean = join(work, "audio-denoised.wav");
    await runCapture("ffmpeg", ["-y", "-i", cutMp4, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", raw]);
    await runCapture(ASR_PYTHON, [join(REPO_ROOT, "scripts", "asr", "denoise.py"), "--in", raw, "--out", clean], { inherit: true });
    const target = "I=-16:TP=-1.5:LRA=11";
    const m1 = await runCapture("ffmpeg", ["-hide_banner", "-i", clean, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"]);
    const json = m1.stderr.slice(m1.stderr.lastIndexOf("{"), m1.stderr.lastIndexOf("}") + 1);
    const m = JSON.parse(json);
    const out = join(dir, "audio.wav");
    await archiveIfExists(out);
    const af = `loudnorm=${target}:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
    await runCapture("ffmpeg", ["-y", "-i", clean, "-af", af, "-ar", "48000", "-c:a", "pcm_s16le", out]);
    console.log(`audio.wav: ${out} (đo trước: I=${m.input_i} LUFS, TP=${m.input_tp})`);
    return { result: null, outputs: ["audio.wav"] };
  });
}

// ---------- 05 project ----------

interface Brand {
  palette: { text: string; accent: string; ink: string };
}

function geometry(aspect: string) {
  if (aspect === "16:9") {
    return {
      maxChars: 48,
      sub: { x: 15, y: 80, w: 70, h: 14, fontSize: 44 } satisfies SubGeo,
      lower: { x: 5, y: 8, w: 60, h: 11, fontSize: 44 },
      callout: { x: 5, y: 22, w: 40, h: 8, fontSize: 32 },
    };
  }
  if (aspect === "4:5") {
    return {
      maxChars: 36,
      sub: { x: 6, y: 74, w: 88, h: 14, fontSize: 50 } satisfies SubGeo,
      lower: { x: 6, y: 7, w: 88, h: 10, fontSize: 46 },
      callout: { x: 6, y: 19, w: 70, h: 7, fontSize: 34 },
    };
  }
  return {
    maxChars: 42,
    sub: { x: 6, y: 66, w: 88, h: 16, fontSize: 58 } satisfies SubGeo,
    lower: { x: 6, y: 8, w: 88, h: 9, fontSize: 54 },
    callout: { x: 6, y: 19, w: 70, h: 6, fontSize: 38 },
  };
}

export function flattenOutline(items: OutlineItem[]): OutlineItem[] {
  return items.flatMap((i) => [i, ...flattenOutline(i.children ?? [])]);
}

/** Layer tiêu đề mục từ outline level 1–2, mốc thời gian đã ánh xạ sang timeline cắt. */
export function outlineLayers(outline: Outline, keeps: Range[], aspect: string, colors: Brand["palette"], nextId: () => string): Layer[] {
  const g = geometry(aspect);
  const layers: Layer[] = [];
  for (const it of flattenOutline(outline.items).filter((i) => i.level <= 2)) {
    const s = mapTime(it.start, keeps);
    const e = mapTime(it.end, keeps);
    if (e - s < 0.5) continue; // mục đã bị cắt gần hết
    const lvl1 = it.level === 1;
    const geo = lvl1 ? g.lower : g.callout;
    layers.push({
      id: nextId(),
      type: lvl1 ? "lowerThird" : "callout",
      start: +s.toFixed(3),
      duration: +Math.min(4, e - s).toFixed(3),
      x: geo.x, y: geo.y, w: geo.w, h: geo.h,
      rotation: 0,
      opacity: 1,
      text: it.title,
      subtext: lvl1 ? `Phần ${it.id}` : undefined,
      style: {
        fontFamily: "Be Vietnam Pro", fontSize: geo.fontSize, fontWeight: lvl1 ? 800 : 700,
        color: colors.text, accentColor: colors.accent, background: "rgba(12,12,12,0.72)",
        align: "left", radius: 16, padding: 24, strokeColor: null, strokeWidth: 0, shadow: true,
      },
      animation: lvl1
        ? { in: { kind: "left", dur: 0.45 }, out: { kind: "fade", dur: 0.3 } }
        : { in: { kind: "pop", dur: 0.35 }, out: { kind: "fade", dur: 0.3 } },
      meta: { outlineId: it.id, source: "auto" },
    });
  }
  return layers;
}

export async function buildProject(job: string, force = false): Promise<void> {
  if (force) assertNoClips(job, "th:project --force");
  const dir = jobDir(job);
  const out = join(dir, "project.json");
  if (existsSync(out) && !force) throw new Error(`Đã có ${out}. Thêm --force để dựng lại (bản cũ được sao lưu project.backup-<time>.json).`);
  const cutMp4 = requireFile(join(dir, "cut.mp4"), "Chạy th:cut trước.");
  await warnStale(job, ["cut", "audio"]);
  const tr = await readJson(requireFile(join(dir, "transcript.cut.json"), "Chạy th:cut trước."), TranscriptSchema);
  await withStep(job, "project", async () => {
    const { info } = await probe(cutMp4);
    const aspect = aspectLabel(info.width, info.height);
    const brand = await readJson<Brand>(join(REPO_ROOT, "assets", "brand", "brand-guideline.json"));
    const colors = { text: brand.palette.text, accent: brand.palette.accent, ink: brand.palette.ink };
    let n = 0;
    const nextId = () => `L-${String(++n).padStart(4, "0")}`;

    const g = geometry(aspect);
    const subLayers = splitSubtitles(tr.segments.flatMap((s) => s.words), g.maxChars).map((c) => chunkToLayer(c, nextId(), g.sub, colors));

    const tracks: Track[] = [];
    const outlineFile = join(dir, "outline.json");
    const mapFile = join(dir, "cut-map.json");
    if (existsSync(outlineFile) && existsSync(mapFile)) {
      const outline = await readJson(outlineFile, OutlineSchema);
      const { keeps, introOffset } = await readJson<{ keeps: Range[]; introOffset?: number }>(mapFile); // sau th:intro mọi mốc dời thêm introOffset
      tracks.push({ id: "t-title", kind: "graphics", name: "Tiêu đề mục", hidden: false, locked: false, layers: outlineLayers(outline, keeps, aspect, colors, nextId).map((l) => ({ ...l, start: +(l.start + (introOffset ?? 0)).toFixed(3) })) });
    }
    tracks.push({ id: "t-sub", kind: "subtitle", name: "Phụ đề", hidden: false, locked: false, layers: subLayers });

    const project: Project = {
      version: 1,
      revision: 0,
      job,
      fps: Math.round(info.fps) || 30,
      width: info.width,
      height: info.height,
      aspect,
      duration: +info.duration.toFixed(3),
      source: { video: "cut.mp4", ...(existsSync(join(dir, "audio.wav")) ? { audio: "audio.wav" } : {}) },
      videoTransform: { scale: 1, x: 0, y: 0 },
      videoMoves: [], videoShifts: [],
      tracks,
    };
    await saveProject(out, project);
    console.log(`project.json: ${out}\n${aspect} ${info.width}x${info.height}, ${project.duration}s, ${subLayers.length} phụ đề, ${tracks.length} track`);
    return { result: null, outputs: ["project.json"] };
  });
}
