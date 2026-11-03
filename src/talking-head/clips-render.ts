import { createHash } from "node:crypto";
import { copyFileSync, existsSync, renameSync, statSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gpuEncodeAvailable, videoCodecArgs } from "../studio/render/video-tools.js";
import { ASPECT_SIZE, aspectFilter, cuvidArgs, type Aspect } from "./cut-render.js";
import { runCapture } from "./ffmpeg-util.js";
import { computeClipGains, measureClipLoudness, type ClipGain } from "./clip-loudness.js";
import { readJson, resolveSourceRaw, writeJson } from "./jobs.js";
import { TranscriptSchema, clipsMediaKey, type Project, type Segment, type Transcript, type VideoClip } from "./project-schema.js";

const SR = 48000;
const XFADE = 480; // crossfade 10 ms (mẫu @48 kHz)
export const CLIP_GROUP_CACHE = "clips-cache";

export interface SourceInfo {
  path: string;
  fps: number;
  width: number;
  height: number;
  videoCodec?: string;
  hasAudio: boolean;
  duration: number;
}

// ---------- tính toán thuần (khung nguyên) ----------

export interface ClipFrames {
  clip: VideoClip;
  inF: number; // khung nguồn bắt đầu
  n: number; // số khung của clip
  startF: number; // khung bắt đầu trên timeline
}

export function clipFrames(clips: VideoClip[], fps: number): ClipFrames[] {
  let acc = 0;
  return clips.map((clip) => {
    const n = clip.kind === "hold" ? Math.max(1, Math.round(clip.dur! * fps)) : Math.round((clip.srcOut! - clip.srcIn) * fps);
    const r = { clip, inF: Math.round(clip.srcIn * fps), n, startF: acc };
    acc += n;
    return r;
  });
}
export const totalFrames = (cf: ClipFrames[]): number => cf.reduce((s, c) => s + c.n, 0);

/** Filter audio: mỗi clip cắt theo MẪU từ source-audio.wav (hold = im lặng), nối bằng acrossfade 10 ms, ép đúng độ dài. */
export function buildClipsAudioFilter(cf: ClipFrames[], fps: number, gains: number[] = []): string {
  const f: string[] = [];
  const bound = (frames: number) => Math.round((frames / fps) * SR); // biên mẫu tích luỹ: không trôi
  cf.forEach((c, i) => {
    const len = bound(c.startF + c.n) - bound(c.startF);
    const ext = i < cf.length - 1 ? XFADE : 0; // đuôi dài thêm 10 ms để sau chồng khớp độ dài
    if (c.clip.kind === "hold") f.push(`anullsrc=r=${SR}:cl=mono,atrim=end_sample=${len + ext},asetpts=PTS-STARTPTS[a${i}]`);
    else {
      const a = Math.round(c.clip.srcIn * SR);
      const g = gains[i] ? `,volume=${gains[i].toFixed(2)}dB` : ""; // gain riêng từng clip (đồng đều mức giọng), không limiter
      f.push(`[0:a]atrim=start_sample=${a}:end_sample=${a + len + ext},asetpts=PTS-STARTPTS${g}[a${i}]`);
    }
  });
  let prev = "a0";
  for (let i = 1; i < cf.length; i++) {
    f.push(`[${prev}][a${i}]acrossfade=d=0.01:c1=tri:c2=tri[x${i}]`);
    prev = `x${i}`;
  }
  const total = bound(totalFrames(cf));
  // gain lớn có thể đẩy đỉnh thoáng qua (tiếng gõ, vỗ) vượt 0 dBFS: limiter brickwall −1 dBFS ở cuối, chỉ tác động lên đỉnh vượt
  const lim = gains.some((g) => g > 0) ? "alimiter=limit=0.8913:attack=5:release=50:level=disabled," : "";
  f.push(`[${prev}]${lim}apad=whole_len=${total},atrim=end_sample=${total}[aout]`);
  return f.join(";\n");
}

/** transcript.cut từ words nguồn: từ nằm trong clip source → mốc timeline; hold không có từ. Segment nguồn nằm liền kề qua nhiều clip thì gộp một. */
export function mapTranscriptThroughClips(tr: Transcript, clips: VideoClip[], fps: number): Transcript {
  const cf = clipFrames(clips, fps);
  const out: Segment[] = [];
  const open = new Map<number, { seg: Segment; clipIdx: number; endSrc: number }>(); // segment nguồn → mảnh đang mở
  cf.forEach((c, ci) => {
    if (c.clip.kind !== "source") return;
    const t0 = c.startF / fps;
    const inS = c.inF / fps;
    const outS = inS + c.n / fps;
    for (const seg of tr.segments) {
      const words = seg.words
        .filter((w) => (w.start + w.end) / 2 >= inS && (w.start + w.end) / 2 <= outS)
        .map((w) => ({ ...w, start: +(t0 + Math.max(0, w.start - inS)).toFixed(3), end: +(t0 + Math.min(outS - inS, w.end - inS)).toFixed(3) }));
      if (!words.length) continue;
      const cur = open.get(seg.id);
      // gộp khi clip liền kề và nguồn đi tiếp về phía trước (như remapTranscript); intro lặp lại câu ở thân bài thì tách
      if (cur && cur.clipIdx === ci - 1 && inS >= cur.endSrc - 1e-6) {
        cur.seg.words.push(...words);
        cur.clipIdx = ci;
        cur.endSrc = outS;
      } else {
        const piece: Segment = { id: 0, start: 0, end: 0, text: "", words };
        out.push(piece);
        open.set(seg.id, { seg: piece, clipIdx: ci, endSrc: outS });
      }
    }
  });
  const segments = out
    .map((s) => ({ ...s, start: s.words[0].start, end: s.words[s.words.length - 1].end, text: s.words.map((w) => w.text).join(" ") }))
    .sort((a, b) => a.start - b.start)
    .map((s, i) => ({ ...s, id: i }));
  return { ...tr, duration: totalFrames(cf) / fps, segments };
}

const stamp = (f: string) => (existsSync(f) ? `${statSync(f).mtimeMs}:${statSync(f).size}` : "missing");

export function clipsHash(project: Project, src: SourceInfo, rawAudio: string | null, gains: number[] = []): string {
  return createHash("sha256")
    .update(JSON.stringify({ clips: clipsMediaKey(project.videoClips), aspect: project.aspect, w: project.width, h: project.height, fps: src.fps, raw: stamp(src.path), ra: rawAudio ? stamp(rawAudio) : null, g: gains, v: 2 }))
    .digest("hex")
    .slice(0, 24);
}

// ---------- dựng ----------

export interface ClipsRenderResult {
  changed: boolean;
  frames: number;
  mode: string;
  seconds: number;
  hash: string;
}

/**
 * Dựng cut.mp4 + audio.wav + transcript.cut.json từ project.videoClips (cache theo hash trong clips.hash).
 * Video: mỗi clip mã hoá riêng (cache theo nội dung, sửa một clip chỉ dựng lại clip đó) rồi concat -c copy. Audio: từ source-audio.wav.
 */
export async function ensureCutFromClips(project: Project, dir: string, opts: { force?: boolean; cpu?: boolean } = {}): Promise<ClipsRenderResult> {
  const clips = project.videoClips;
  if (!clips?.length) throw new Error("project không có videoClips.");
  const media = await readJson<{ info: Omit<SourceInfo, "path"> }>(join(dir, "media.json"));
  const rawRel = project.source.raw;
  if (!rawRel) throw new Error("project.source.raw trống (chạy th:clips-init).");
  const raw = resolveSourceRaw(dir, rawRel);
  if (!existsSync(raw)) throw new Error(`Không thấy video gốc: ${raw}`);
  const src: SourceInfo = { path: raw, ...media.info };
  const audioSrc = project.source.rawAudio ? resolve(dir, project.source.rawAudio) : null;
  if (!audioSrc || !existsSync(audioSrc)) throw new Error("Thiếu source-audio.wav: chạy th:source-audio trước.");

  const fps = src.fps;
  const cf = clipFrames(clips, fps);
  const frames = totalFrames(cf);
  // gain riêng từng clip: −18 LUFS − loudness của đoạn nguồn đó (kẹp −12..+30 dB); bảng gain vào hash và clips.meta.json
  const loud = await measureClipLoudness(audioSrc, dir, cf.map((c) => ({ kind: c.clip.kind, a: c.clip.srcIn, b: c.clip.kind === "source" ? c.clip.srcOut! : c.clip.srcIn })));
  const gains: ClipGain[] = computeClipGains(cf.map((c) => ({ kind: c.clip.kind })), loud);
  const hash = clipsHash(project, src, audioSrc, gains.map((g) => g.gainDb));
  const cutMp4 = join(dir, "cut.mp4");
  const audioWav = join(dir, "audio.wav");
  const hashFile = join(dir, "clips.hash");
  const t0 = Date.now();

  // transcript.cut.json luôn tạo lại từ clips (rẻ) để anchor của th:broll đúng
  const trSrc = existsSync(join(dir, "transcript.edited.json")) ? join(dir, "transcript.edited.json") : join(dir, "transcript.raw.json");
  const writeTranscript = async () => writeJson(join(dir, "transcript.cut.json"), mapTranscriptThroughClips(await readJson(trSrc, TranscriptSchema), clips, fps));

  const fresh = !opts.force && existsSync(cutMp4) && existsSync(audioWav) && existsSync(hashFile) && (await readFile(hashFile, "utf8")).trim() === hash;
  if (fresh) {
    await writeTranscript();
    return { changed: false, frames, mode: "cache", seconds: 0, hash };
  }

  // sao lưu bản cũ một lần (không ghi đè)
  for (const f of ["cut.mp4", "audio.wav", "transcript.cut.json"]) {
    const bak = join(dir, f.replace(/(\.[^.]+)$/, ".pre-clips$1"));
    if (existsSync(join(dir, f)) && !existsSync(bak)) copyFileSync(join(dir, f), bak);
  }

  const aspect = (["9:16", "16:9", "4:5"].includes(project.aspect) ? project.aspect : "keep") as Aspect;
  const nvenc = !opts.cpu && (await gpuEncodeAvailable());
  // giải mã + crop + resize bằng cuvid (GPU) nhưng khung ra bộ nhớ thường: tpad/format/setpts là filter CPU, NVENC vẫn mã hoá bằng GPU
  const cv = nvenc ? cuvidArgs(src.videoCodec, src.width, src.height, aspect) : null;
  const dec = cv ? cv.slice(4) : null;
  const work = join(dir, "work", "clips");
  const cache = join(work, CLIP_GROUP_CACHE);
  await mkdir(cache, { recursive: true });
  const rawStamp = stamp(raw);

  const renderClip = async (c: ClipFrames, gpu: boolean): Promise<string> => {
    const key = createHash("sha1").update(JSON.stringify({ k: c.clip.kind, inF: c.inF, n: c.n, aspect, w: src.width, h: src.height, fps, gpu, nvenc, rawStamp, v: 1 })).digest("hex").slice(0, 20);
    const file = join(cache, `${key}.mp4`);
    const tmp = join(cache, `${key}.tmp.mp4`); // ghi file tạm rồi đổi tên: ffmpeg lỗi không để lại file hỏng trong cache
    if (existsSync(file)) return file;
    // seek vào lệch 1/4 khung rồi setpts về 0: tránh làm tròn nửa khung của cfr
    const ss = ((c.inF - 0.25) / fps).toFixed(6);
    const vf = ["setpts=PTS-STARTPTS"];
    if (c.clip.kind === "hold") vf.push(`tpad=stop_mode=clone:stop=${c.n - 1}`);
    if (!gpu) vf.push(aspectFilter(aspect));
    vf.push("format=yuv420p");
    // hold: chỉ đọc đúng 1 khung đầu vào (-t 0.75 khung) rồi tpad nhân bản; source: đọc đủ rồi chặn bằng -frames:v
    const inputOpts = c.clip.kind === "hold" ? ["-t", (0.75 / fps).toFixed(6)] : [];
    const args = ["-y", ...(gpu ? dec! : []), "-ss", ss, ...inputOpts, "-i", src.path, "-vf", vf.join(","), "-an", "-frames:v", String(c.n),
      ...videoCodecArgs(nvenc, "medium"), "-bf", "0", "-g", String(Math.round(fps)), "-fps_mode", "cfr", "-r", String(fps), "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp];
    try {
      await runCapture("ffmpeg", args);
      renameSync(tmp, file);
    } finally {
      await rm(tmp, { force: true });
    }
    return file;
  };
  const renderAll = async (gpu: boolean) => {
    const files: string[] = [];
    for (const c of cf) files.push(await renderClip(c, gpu));
    return files;
  };
  let mode = dec ? "GPU (cuvid+NVENC)" : nvenc ? "CPU lọc + NVENC" : "CPU";
  let parts: string[];
  if (dec) {
    try {
      parts = await renderAll(true);
    } catch (e) {
      console.warn(`GPU lỗi, chạy lại bằng CPU: ${String((e as Error).message).slice(-300)}`);
      mode = "CPU (fallback)";
      parts = await renderAll(false);
    }
  } else parts = await renderAll(false);

  // ghép video theo nhóm ≤ 40 clip, rồi ghép các nhóm: đều là concat -c copy
  const list = join(work, "concat.txt");
  await writeFile(list, parts.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"), "utf8");
  const videoAll = join(work, "video-all.mp4");
  await runCapture("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", videoAll]);

  // audio: PCM từ source-audio.wav, AAC mã hoá đúng một lần
  const script = join(work, "audio-filter.txt");
  await writeFile(script, buildClipsAudioFilter(cf, fps, gains.map((g) => g.gainDb)), "utf8");
  const newWav = join(work, "audio-new.wav");
  await runCapture("ffmpeg", ["-y", "-i", audioSrc, "-/filter_complex", script, "-map", "[aout]", "-c:a", "pcm_s16le", "-ar", String(SR), newWav]);
  const newCut = join(work, "cut-new.mp4");
  await runCapture("ffmpeg", ["-y", "-i", videoAll, "-i", newWav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", String(SR), "-movflags", "+faststart", newCut]);

  // kiểm tra trước khi thay file thật
  const chk = JSON.parse((await runCapture("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,duration", "-of", "json", newCut])).stdout).streams[0] as { nb_read_frames: string; duration: string };
  const wavDur = parseFloat(JSON.parse((await runCapture("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", newWav])).stdout).format.duration);
  const aDur = parseFloat(JSON.parse((await runCapture("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=duration", "-of", "json", newCut])).stdout).streams[0].duration);
  const vDur = parseFloat(chk.duration);
  const problems: string[] = [];
  if (Number(chk.nb_read_frames) !== frames) problems.push(`số khung ${chk.nb_read_frames} ≠ ${frames}`);
  if (Math.abs(aDur - vDur) > 1 / fps) problems.push("cut.mp4: |audio − video| > 1 khung");
  if (Math.abs(wavDur - vDur) > 1 / fps) problems.push("audio.wav: |audio − video| > 1 khung");
  if (problems.length) throw new Error(`Dựng từ clips thất bại kiểm tra: ${problems.join("; ")} (chưa thay file thật)`);

  copyFileSync(newCut, cutMp4);
  copyFileSync(newWav, audioWav);
  await rm(join(dir, "peaks.json"), { force: true });
  await writeTranscript();
  await writeFile(hashFile, hash, "utf8");
  await writeJson(join(dir, "clips.meta.json"), { hash, targetLufs: -18, gains: cf.map((c, i) => ({ id: c.clip.id, ...gains[i] })) });
  return { changed: true, frames, mode, seconds: +((Date.now() - t0) / 1000).toFixed(1), hash };
}
