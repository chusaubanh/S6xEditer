import { copyFileSync, existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gpuEncodeAvailable, videoCodecArgs } from "../studio/render/video-tools.js";
import { probe, runCapture } from "./ffmpeg-util.js";
import { assertNoClips, jobDir, readJson, requireFile, withStep, writeJson } from "./jobs.js";
import { loadProject, saveProject, TranscriptSchema, type Project, type Segment, type Transcript } from "./project-schema.js";
import { loadSfxLibrary } from "./sfx-plan.js";
import { splitSubtitles } from "./subtitles.js";
import type { Word } from "./types.js";

export const DEFAULT_INTRO_SFX = "whoosh-long-electro-01";
const EDGE_FADE = 0.007; // 7 ms ở hai mép đoạn intro, tránh lách tách
const SR = 48000;

// ---------- tính thời gian (khung hình nguyên) ----------

export interface IntroTimes {
  fps: number;
  fromF: number;
  toF: number;
  gapF: number;
  fromSec: number;
  toSec: number;
  gapSec: number;
  introSec: number;
  D: number; // = gap + (to − from), đúng bội số khung
}

export function snapIntro(from: number, to: number, gap: number, fps: number): IntroTimes {
  const fromF = Math.round(from * fps);
  const toF = Math.round(to * fps);
  const gapF = Math.round(gap * fps);
  if (toF <= fromF) throw new Error("--to phải lớn hơn --from (sau khi snap về biên khung).");
  return {
    fps, fromF, toF, gapF,
    fromSec: fromF / fps, toSec: toF / fps, gapSec: gapF / fps,
    introSec: (toF - fromF) / fps,
    D: (gapF + toF - fromF) / fps,
  };
}

/** Cảnh báo khi from/to cắt vào giữa một từ (kèm biên khung an toàn gần nhất). */
export function clippedWordWarnings(words: Word[], t: IntroTimes): string[] {
  const out: string[] = [];
  const f = (s: number) => (Math.round(s * t.fps) / t.fps).toFixed(3);
  for (const w of words) {
    if (w.start < t.fromSec - 1e-6 && w.end > t.fromSec + 1e-6) {
      out.push(`--from ${t.fromSec.toFixed(3)} cắt vào từ "${w.text}" (${w.start.toFixed(3)}–${w.end.toFixed(3)}); đề xuất --from ${f(w.start - 0.03)}.`);
    }
    if (w.start < t.toSec - 1e-6 && w.end > t.toSec + 1e-6) {
      out.push(`--to ${t.toSec.toFixed(3)} cắt vào từ "${w.text}" (${w.start.toFixed(3)}–${w.end.toFixed(3)}); đề xuất --to ${f(w.end + 0.03)}.`);
    }
  }
  return out;
}

// ---------- dời thời gian (thuần, làm trên JSON thô) ----------

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Dời mọi thứ có thời gian thêm D. Nhạc không dời mà kéo dài (start giữ nguyên, duration += D). */
export function shiftProject(project: Raw, D: number): Raw {
  const p = structuredClone(project);
  const r = (x: number) => +(x + D).toFixed(3);
  for (const t of p.tracks ?? []) {
    for (const l of t.layers ?? []) {
      if (t.kind === "music") {
        l.duration = r(l.duration);
        continue;
      }
      l.start = r(l.start);
      for (const w of l.words ?? []) {
        w.start = r(w.start);
        w.end = r(w.end);
      }
    }
  }
  for (const key of ["videoMoves", "videoShifts"]) {
    for (const m of p[key] ?? []) {
      m.start = r(m.start);
      m.end = r(m.end);
    }
  }
  p.duration = r(p.duration);
  return p;
}

/** broll-plan: start/end tường minh dời D; anchor giữ nguyên (buildBroll bỏ qua vùng intro nhờ introOffset). */
export function shiftPlan(plan: Raw, D: number): Raw {
  const p = structuredClone(plan);
  for (const b of p.beats ?? []) {
    if (typeof b.start === "number") b.start = +(b.start + D).toFixed(3);
    if (typeof b.end === "number") b.end = +(b.end + D).toFixed(3);
  }
  for (const s of (p.shifts as Array<{ start: number; end: number }> | undefined) ?? []) { s.start = +(s.start + D).toFixed(3); s.end = +(s.end + D).toFixed(3); } // khoảng dịch người nói của plan
  p.introOffset = +((p.introOffset ?? 0) + D).toFixed(3);
  return p;
}

/** transcript.cut mới: segment intro ở đầu (từ trong [from,to] đổi mốc về sau lead-in), phần còn lại dời D, đánh lại id. */
export function shiftTranscript(tr: Transcript, t: IntroTimes): Transcript {
  const introSegs: Segment[] = [];
  for (const seg of tr.segments) {
    const words = seg.words
      .filter((w) => (w.start + w.end) / 2 >= t.fromSec && (w.start + w.end) / 2 <= t.toSec)
      .map((w) => ({ ...w, start: +(t.gapSec + Math.max(0, w.start - t.fromSec)).toFixed(3), end: +(t.gapSec + Math.min(t.introSec, w.end - t.fromSec)).toFixed(3) }));
    if (words.length) introSegs.push({ id: 0, start: words[0].start, end: words[words.length - 1].end, text: words.map((w) => w.text).join(" "), words });
  }
  const rest = tr.segments.map((s) => ({
    ...s,
    start: +(s.start + t.D).toFixed(3),
    end: +(s.end + t.D).toFixed(3),
    words: s.words.map((w) => ({ ...w, start: +(w.start + t.D).toFixed(3), end: +(w.end + t.D).toFixed(3) })),
  }));
  const segments = [...introSegs, ...rest].map((s, i) => ({ ...s, id: i }));
  return { ...tr, duration: tr.duration !== undefined ? +(tr.duration + t.D).toFixed(3) : undefined, segments };
}

export function introWords(tr: Transcript, t: IntroTimes): Word[] {
  return shiftTranscript(tr, t).segments.filter((s) => s.end <= t.D + 1e-6 && s.start < t.D).flatMap((s) => s.words);
}

// ---------- layer cho intro ----------

function maxCharsFor(aspect: string): number {
  return aspect === "16:9" ? 44 : aspect === "4:5" ? 32 : 38; // chữ lớn hơn 10% nên ít ký tự mỗi dòng hơn
}

export function buildIntroLayers(project: Raw, words: Word[], t: IntroTimes, opts: { sfxId: string; library?: ReturnType<typeof loadSfxLibrary> }) {
  const subTrack = project.tracks.find((tr: Raw) => tr.kind === "subtitle");
  const template = subTrack?.layers?.[0] as Raw | undefined;
  const accent = template?.style?.accentColor ?? "#C5A059";
  const subs: Raw[] = splitSubtitles(words, maxCharsFor(project.aspect)).map((c, i) => {
    const base: Raw = template
      ? structuredClone(template)
      : { type: "subtitle", x: 6, y: 74, w: 88, h: 14, style: {}, animation: { in: { kind: "fade", dur: 0.1 }, out: { kind: "fade", dur: 0.1 }, subtitleMode: "word" } };
    const start = c.words[0].start;
    const end = c.words[c.words.length - 1].end;
    base.id = `L-I${String(i + 1).padStart(2, "0")}`;
    base.start = start;
    base.duration = Math.max(0.3, +(end - start).toFixed(3));
    base.text = c.lines.join("\n");
    base.words = c.words;
    base.style = { ...(base.style ?? {}), fontSize: Math.round((base.style?.fontSize ?? 58) * 1.1) };
    base.meta = { ...(base.meta ?? {}), source: "auto", intro: true };
    return base;
  });

  const flash: Raw = {
    id: "T-I01", type: "transition", start: +Math.max(0, t.D - 0.15).toFixed(3), duration: 0.3, kind: "flash", color: accent,
    meta: { source: "auto", intro: true },
  };

  const lib = opts.library ?? loadSfxLibrary();
  const entry = lib.find((e) => e.id === opts.sfxId);
  let sfx: Raw | null = null;
  if (entry) {
    const peakAt = t.gapSec - 0.05; // đỉnh whoosh rơi ngay trước chữ đầu tiên
    const hit = entry.hit ?? 0;
    const startRaw = peakAt - hit;
    const offset = Math.max(0, -startRaw);
    const start = Math.max(0, startRaw);
    const duration = +(entry.duration - offset).toFixed(3);
    const voiceOnset = words.length ? words[0].start : t.gapSec;
    const fadeOut = +Math.min(duration, Math.max(0.3, start + duration - voiceOnset)).toFixed(3); // đuôi tắt dần dưới giọng
    sfx = {
      id: "A-I01", type: "audio", start: +start.toFixed(3), duration, src: entry.file, offset: +offset.toFixed(3), gainDb: -10, fadeIn: 0, fadeOut,
      meta: { category: entry.category, source: "ai", intro: true, peakAt: +(start + hit - offset).toFixed(3) },
    };
  }
  return { subs, flash, sfx };
}

/** Nhét layer intro vào project (đã dời): phụ đề ở t-sub, flash ở track riêng t-intro, whoosh ở t-sfx. */
export function addIntroToProject(shifted: Raw, layers: ReturnType<typeof buildIntroLayers>): Raw {
  const p = structuredClone(shifted);
  const ensure = (id: string, kind: string, name: string, front = false): Raw => {
    let tr = p.tracks.find((x: Raw) => x.id === id);
    if (!tr) {
      tr = { id, kind, name, hidden: false, locked: false, layers: [] };
      if (front) p.tracks.unshift(tr);
      else p.tracks.push(tr);
    }
    return tr;
  };
  const sub = p.tracks.find((x: Raw) => x.kind === "subtitle") ?? ensure("t-sub", "subtitle", "Phụ đề");
  sub.layers.unshift(...layers.subs);
  ensure("t-intro", "graphics", "Intro", true).layers.push(layers.flash);
  if (layers.sfx) ensure("t-sfx", "sfx", "SFX").layers.unshift(layers.sfx);
  return p;
}

// ---------- audio / video ----------

const layoutOf = (ch: number) => (ch === 1 ? "mono" : "stereo");

/** [im lặng gap][đoạn intro có fade 7 ms][audio cũ], chính xác theo mẫu, ép đúng tổng độ dài. */
export function introAudioFilter(t: IntroTimes, channels: number, totalSamples: number): string {
  const sr = SR;
  const gapS = Math.round(t.gapSec * sr);
  const a = Math.round(t.fromSec * sr);
  const b = Math.round(t.toSec * sr);
  return [
    "[0:a]asplit=2[s1][s2]",
    `anullsrc=r=${sr}:cl=${layoutOf(channels)},atrim=end_sample=${gapS}[sil]`,
    `[s1]atrim=start_sample=${a}:end_sample=${b},asetpts=PTS-STARTPTS,afade=t=in:d=${EDGE_FADE},afade=t=out:st=${(((b - a) / sr) - EDGE_FADE).toFixed(6)}:d=${EDGE_FADE}[intro]`,
    `[s2]asetpts=PTS-STARTPTS,afade=t=in:d=${EDGE_FADE}[old]`,
    "[sil][intro][old]concat=n=3:v=0:a=1[cat]",
    `[cat]apad=whole_len=${totalSamples},atrim=end_sample=${totalSamples}[aout]`,
  ].join(";\n");
}

async function buildAudio(src: string, out: string, t: IntroTimes, channels: number, totalSamples: number, workDir: string, tag: string) {
  const script = join(workDir, `intro-audio-${tag}.txt`);
  await writeFile(script, introAudioFilter(t, channels, totalSamples), "utf8");
  await runCapture("ffmpeg", ["-y", "-i", src, "-/filter_complex", script, "-map", "[aout]", "-c:a", "pcm_s16le", "-ar", String(SR), out]);
}

// ---------- lệnh chính ----------

const BACKUP_FILES = ["cut.mp4", "audio.wav", "project.json", "transcript.cut.json", "broll-plan.json", "cut-map.json"];
const pre = (f: string) => f.replace(/(\.[^.]+)$/, ".pre-intro$1");

export interface IntroOptions {
  from: number;
  to: number;
  gap?: number;
  introSfx?: string;
  redo?: boolean;
}

export async function intro(job: string, opts: IntroOptions): Promise<void> {
  assertNoClips(job, "th:intro");
  const dir = jobDir(job);
  const gap = opts.gap ?? 0.6;
  const metaFile = join(dir, "intro.json");
  const have = existsSync(metaFile);
  if (have && !opts.redo) throw new Error("Job đã có intro (intro.json). Dùng --redo để dựng lại từ các bản *.pre-intro.* (không dời hai lần).");
  // bản gốc trước intro: lưu một lần, không bao giờ ghi đè; --redo khôi phục từ đó
  for (const f of BACKUP_FILES) {
    const src = join(dir, f);
    const bak = join(dir, pre(f));
    if (!existsSync(bak) && existsSync(src) && !have) copyFileSync(src, bak);
    else if (have && existsSync(bak)) copyFileSync(bak, src);
  }
  const cutMp4 = requireFile(join(dir, "cut.mp4"), "Chạy th:cut trước.");
  const audioWav = requireFile(join(dir, "audio.wav"), "Chạy th:audio trước.");
  const projectFile = requireFile(join(dir, "project.json"), "Chạy th:project trước.");
  const trFile = requireFile(join(dir, "transcript.cut.json"), "Chạy th:cut trước.");

  const { info } = await probe(cutMp4);
  const t = snapIntro(opts.from, opts.to, gap, info.fps);
  const oldFrames = Math.round(info.duration * info.fps);
  const newFrames = oldFrames + t.gapF + (t.toF - t.fromF);
  const totalSec = newFrames / info.fps;
  if (t.toSec > info.duration + 1e-6) throw new Error(`--to ${t.toSec}s vượt độ dài cut.mp4 (${info.duration}s).`);

  const tr = await readJson(trFile, TranscriptSchema);
  const warnings = clippedWordWarnings(tr.segments.flatMap((s) => s.words), t);

  await withStep(job, "intro", async () => {
    const work = join(dir, "work", "intro");
    await mkdir(work, { recursive: true });
    const nvenc = await gpuEncodeAvailable();
    const encode = (gpu: boolean) => [...videoCodecArgs(gpu, "medium"), "-bf", "0", "-g", String(Math.round(info.fps)), "-fps_mode", "cfr", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
    const half = 0.5 / info.fps;
    const trimF = `trim=start=${(t.fromSec - half).toFixed(6)}:end=${(t.toSec - half).toFixed(6)},setpts=PTS-STARTPTS,tpad=start_mode=clone:start=${t.gapF}`;
    const videoAll = join(work, "video-all.mp4");
    let path: string;
    try {
      if (!nvenc) throw new Error("no-nvenc");
      // đường nhanh: chỉ mã hoá phần lead-in + intro bằng đúng tham số của th:cut rồi concat -c copy với video cũ (đã bỏ audio)
      const part = join(work, "intro-part.mp4");
      const oldV = join(work, "old-video.mp4");
      await runCapture("ffmpeg", ["-y", "-hwaccel", "cuda", "-i", cutMp4, "-filter_complex", `[0:v]${trimF}[vout]`, "-map", "[vout]", "-an", ...encode(true), part]);
      await runCapture("ffmpeg", ["-y", "-i", cutMp4, "-an", "-c:v", "copy", oldV]);
      const list = join(work, "concat.txt");
      await writeFile(list, [part, oldV].map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"), "utf8");
      await runCapture("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", videoAll]);
      path = "NVENC: mã hoá riêng lead-in+intro, concat -c copy (video cũ không mã hoá lại)";
    } catch (e) {
      if ((e as Error).message !== "no-nvenc") console.warn(`Đường nhanh lỗi, mã hoá lại toàn bộ bằng CPU: ${(e as Error).message.slice(-200)}`);
      const g = `[0:v]split=2[a][b];[a]${trimF}[i];[b]setpts=PTS-STARTPTS[m];[i][m]concat=n=2:v=1:a=0[vout]`;
      await runCapture("ffmpeg", ["-y", "-i", cutMp4, "-filter_complex", g, "-map", "[vout]", "-an", ...encode(false), videoAll]);
      path = "CPU libx264: mã hoá lại toàn bộ";
    }

    // audio: PCM chính xác theo mẫu, AAC mã hoá đúng một lần
    const totalSamples = Math.round(totalSec * SR);
    const own = join(work, "cut-audio-old.wav");
    await runCapture("ffmpeg", ["-y", "-i", cutMp4, "-vn", "-c:a", "pcm_s16le", "-ar", String(SR), own]);
    const chans = JSON.parse((await runCapture("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "json", own])).stdout).streams[0].channels as number;
    const ownNew = join(work, "cut-audio-new.wav");
    await buildAudio(own, ownNew, t, chans, totalSamples, work, "cut");
    const voiceNew = join(work, "audio-new.wav");
    const vch = JSON.parse((await runCapture("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "json", audioWav])).stdout).streams[0].channels as number;
    await buildAudio(audioWav, voiceNew, t, vch, totalSamples, work, "voice");
    const cutNew = join(work, "cut-new.mp4");
    await runCapture("ffmpeg", ["-y", "-i", videoAll, "-i", ownNew, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", String(SR), "-movflags", "+faststart", cutNew]);

    // kiểm tra trước khi thay file thật
    const chk = await runCapture("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,duration,nb_read_frames", "-of", "json", cutNew]);
    const st = JSON.parse(chk.stdout).streams as Array<{ codec_type: string; duration: string; nb_read_frames: string }>;
    const v = st.find((s) => s.codec_type === "video")!;
    const a = st.find((s) => s.codec_type === "audio")!;
    const wavDur = parseFloat(JSON.parse((await runCapture("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", voiceNew])).stdout).format.duration);
    const problems: string[] = [];
    if (Number(v.nb_read_frames) !== newFrames) problems.push(`số khung ${v.nb_read_frames} ≠ ${newFrames}`);
    if (Math.abs(parseFloat(a.duration) - parseFloat(v.duration)) > 1 / info.fps) problems.push("cut.mp4: |audio − video| > 1 khung");
    if (Math.abs(wavDur - parseFloat(v.duration)) > 1 / info.fps) problems.push("audio.wav: |audio − video| > 1 khung");
    if (problems.length) throw new Error(`Kiểm tra sau ghép thất bại: ${problems.join("; ")} (chưa thay file thật)`);
    copyFileSync(cutNew, cutMp4);
    copyFileSync(voiceNew, audioWav);

    // project / transcript / plan / cut-map
    const project = await loadProject(projectFile);
    const words = introWords(tr, t);
    const lib = loadSfxLibrary();
    const sfxId = opts.introSfx ?? DEFAULT_INTRO_SFX;
    if (!lib.some((e) => e.id === sfxId)) warnings.push(`Không thấy SFX "${sfxId}" trong thư viện: bỏ qua whoosh mở đầu.`);
    const shifted = shiftProject(project as unknown as Raw, t.D);
    const withIntro = addIntroToProject(shifted, buildIntroLayers(project as unknown as Raw, words, t, { sfxId, library: lib }));
    await saveProject(projectFile, withIntro as unknown as Project);
    await writeJson(trFile, shiftTranscript(tr, t));
    const planFile = join(dir, "broll-plan.json");
    if (existsSync(planFile)) await writeJson(planFile, shiftPlan(await readJson<Raw>(planFile), t.D));
    const mapFile = join(dir, "cut-map.json");
    if (existsSync(mapFile)) await writeJson(mapFile, { ...(await readJson<Raw>(mapFile)), introOffset: t.D, intro: { from: t.fromSec, to: t.toSec, gap: t.gapSec } });
    await rm(join(dir, "peaks.json"), { force: true });
    await writeJson(metaFile, { from: t.fromSec, to: t.toSec, gap: t.gapSec, introOffset: t.D, frames: { old: oldFrames, new: newFrames }, sfx: sfxId, path, createdAt: new Date().toISOString() });
    console.log(`INTRO ${t.fromSec.toFixed(3)}–${t.toSec.toFixed(3)} (+lead-in ${t.gapSec}s) => D = ${t.D.toFixed(3)}s; ${oldFrames} → ${newFrames} khung`);
    console.log(`Đường video: ${path}`);
    for (const w of warnings) console.warn(`CẢNH BÁO: ${w}`);
    return { result: null, outputs: ["cut.mp4", "audio.wav", "project.json", "transcript.cut.json", "broll-plan.json", "intro.json"] };
  });
}
