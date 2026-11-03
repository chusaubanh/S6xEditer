import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { resolveMediaBinary } from "../studio/utils/media-binary.js";
import { runCapture } from "./ffmpeg-util.js";
import { REPO_ROOT } from "./presets.js";
import { clipsMediaKey, type Layer, type Project } from "./project-schema.js";

const MAX_AMIX_INPUTS = 32;
const SR = 48000;

export interface MixResult {
  duration: number;
  lufs: number;
  truePeak: number;
  lra: number;
  sfxCount: number;
  musicCount: number;
  skipped: string[];
}

export interface Loudness { lufs: number; truePeak: number; lra: number }

/** Đo bằng ffmpeg ebur128 (true peak bật). */
export async function measureLoudness(file: string): Promise<Loudness> {
  const { stderr } = await runCapture("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"]);
  const s = stderr.slice(stderr.lastIndexOf("Summary:"));
  const num = (re: RegExp) => parseFloat(re.exec(s)?.[1] ?? "NaN");
  return { lufs: num(/I:\s+(-?[\d.]+)\s+LUFS/), lra: num(/LRA:\s+(-?[\d.]+)\s+LU/), truePeak: num(/Peak:\s+(-?[\d.]+)\s+dBFS/) };
}

function resolveSrc(src: string | undefined, jobDir: string): string | null {
  if (!src) return null;
  if (isAbsolute(src)) return existsSync(src) ? src : null;
  for (const base of [jobDir, REPO_ROOT]) if (existsSync(join(base, src))) return join(base, src);
  return null;
}

const f = (n: number) => n.toFixed(4).replace(/\.?0+$/, "") || "0";

/** Nhóm tối đa 32 đầu vào mỗi amix; trả về nhãn đầu ra. Không đổi mức (normalize=0). */
function mixTree(labels: string[], out: string, tag: string, lines: string[]): void {
  if (labels.length === 1) {
    lines.push(`[${labels[0]}]anull[${out}]`);
    return;
  }
  let level = 0;
  let cur = labels;
  while (cur.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < cur.length; i += MAX_AMIX_INPUTS) {
      const grp = cur.slice(i, i + MAX_AMIX_INPUTS);
      const last = cur.length <= MAX_AMIX_INPUTS;
      const name = last ? out : `${tag}g${level}_${i / MAX_AMIX_INPUTS}`;
      if (grp.length === 1) lines.push(`[${grp[0]}]anull[${name}]`);
      else lines.push(`${grp.map((l) => `[${l}]`).join("")}amix=inputs=${grp.length}:duration=longest:normalize=0:dropout_transition=0[${name}]`);
      next.push(name);
    }
    cur = next;
    level++;
  }
}

export interface MixContext {
  /** độ dài file nguồn (giây) theo đường dẫn đã resolve — để lặp nhạc ngắn hơn timeline */
  durations?: Record<string, number>;
  /** video nguồn có luồng audio (fallback khi thiếu source.audio) */
  videoHasAudio?: boolean;
  /** mức giọng trung bình trong vùng có tiếng (dBFS, RMS 50 ms) — để quy đổi duckDb */
  voiceLevelDb?: number;
  /** thêm đầu ra phụ: nhạc thô (sau gain) và nhạc đã ducking, để đo */
  stems?: boolean;
}

/** Giải mã mono float 16 kHz (ffmpeg -> stdout nhị phân). */
export function decodeMono(file: string, sr = 16000): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const p = spawn(resolveMediaBinary("ffmpeg"), ["-v", "error", "-i", file, "-f", "f32le", "-ac", "1", "-ar", String(sr), "-"], { windowsHide: true });
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d) => chunks.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg thoát mã ${code}: ${err.slice(-500)}`));
      const b = Buffer.concat(chunks);
      resolve(new Float32Array(b.buffer, b.byteOffset, Math.floor(b.length / 4)).slice());
    });
  });
}

/** Khung 50 ms: dB RMS từng khung. */
export function frameDb(x: Float32Array, sr = 16000, ms = 50): number[] {
  const n = Math.round((sr * ms) / 1000);
  const out: number[] = [];
  for (let i = 0; i + n <= x.length; i += n) {
    let s = 0;
    for (let j = i; j < i + n; j++) s += x[j] * x[j];
    out.push(10 * Math.log10(s / n + 1e-12));
  }
  return out;
}

/** Mức giọng trung bình (dBFS) trên các khung "có tiếng" (cao hơn đỉnh-30 dB và > -50 dBFS). */
export async function measureVoiceLevel(file: string): Promise<number> {
  const db = frameDb(await decodeMono(file));
  const sorted = [...db].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? -60;
  const act = db.filter((v) => v > Math.max(-50, p95 - 30));
  return act.length ? act.reduce((a, b) => a + b, 0) / act.length : -30;
}

/** Tham số sidechaincompress để nhạc hạ ~duckDb khi giọng ở mức voiceLevelDb (đã hiệu chỉnh bằng đo thực, xem báo cáo). */
export function duckParams(duckDb: number, voiceLevelDb?: number): { threshold: number; ratio: number } {
  const duck = Math.min(-1, duckDb);
  const ratio = 8;
  const k = 1 - 1 / ratio;
  const L = voiceLevelDb ?? -22;
  const tDb = Math.min(-12, Math.max(-60, L - DUCK_CAL * (-duck / k)));
  return { threshold: Math.min(1, Math.max(0.000977, 10 ** (tDb / 20))), ratio };
}
const DUCK_CAL = 0.86; // hệ số hiệu chỉnh: giọng dao động quanh mức trung bình nên độ hạ thực < lý thuyết

/** Dò trước độ dài file nhạc, video có audio không, mức giọng. */
export async function probeForMix(project: Project, jobDir: string): Promise<MixContext> {
  const ctx: MixContext = { durations: {} };
  const dur = async (f: string) => parseFloat((await runCapture("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f])).stdout);
  let hasMusic = false;
  for (const t of project.tracks)
    if (t.kind === "music")
      for (const l of t.layers) {
        const f = resolveSrc(l.src, jobDir);
        if (f && !(f in ctx.durations!)) ctx.durations![f] = await dur(f);
        hasMusic = true;
      }
  const voice = project.source.audio ? resolveSrc(project.source.audio, jobDir) : null;
  let voiceFile = voice;
  if (!voice) {
    const v = resolveSrc(project.source.video, jobDir);
    if (v) {
      const { stdout } = await runCapture("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", v]);
      ctx.videoHasAudio = stdout.trim().length > 0;
      if (ctx.videoHasAudio) voiceFile = v;
    }
  }
  if (hasMusic && voiceFile) ctx.voiceLevelDb = await measureVoiceLevel(voiceFile);
  return ctx;
}

/** Dựng filter_complex cho bước trộn thô (trước loudnorm). Xuất cho test. */
export function buildMixGraph(project: Project, jobDir: string, ctx: MixContext = {}): { inputs: string[]; graph: string; sfxCount: number; musicCount: number; skipped: string[]; stems: string[] } {
  const D = project.duration;
  const a = project.audio ?? { voice: { gainDb: 0, muted: false }, music: { duckDb: -12, attack: 0.15, release: 0.45 }, master: { lufs: -16, truePeak: -1.5 } };
  const inputs: string[] = [];
  const lines: string[] = [];
  const skipped: string[] = [];
  const stems: string[] = [];
  const fmt = `aformat=sample_rates=${SR}:channel_layouts=stereo`;

  // giọng
  let voiceFile = project.source.audio ? resolveSrc(project.source.audio, jobDir) : null;
  if (!voiceFile && ctx.videoHasAudio) voiceFile = resolveSrc(project.source.video, jobDir); // fallback: audio của video nguồn
  if (voiceFile && !a.voice.muted) {
    inputs.push(voiceFile);
    lines.push(`[${inputs.length - 1}:a]${fmt},volume=${f(a.voice.gainDb)}dB,apad=whole_dur=${f(D)},atrim=0:${f(D)}[voice0]`);
  } else {
    lines.push(`anullsrc=r=${SR}:cl=stereo,atrim=0:${f(D)}[voice0]`);
  }
  lines.push(`[voice0]asplit=2[voice][vsc]`);

  const layerChain = (l: Layer, idx: number, label: string, srcLen?: number): void => {
    const off = l.offset ?? 0;
    const want = Math.min(l.duration, Math.max(0.01, D - l.start));
    let dur = want;
    let fadeOut = l.fadeOut ?? 0;
    const parts: string[] = [];
    const avail = srcLen ? Math.max(0.05, srcLen - off) : Infinity;
    if (avail >= want - 0.01) {
      parts.push(`[${idx}:a]${fmt}`, `atrim=start=${f(off)}:duration=${f(want)}`, "asetpts=PTS-STARTPTS");
    } else if ((l.meta as { loop?: boolean } | undefined)?.loop !== false) {
      // nhạc ngắn hơn layer: lặp, nối bằng crossfade 2 s (cân bằng công suất)
      const xf = Math.min(2, avail / 4);
      const k = Math.ceil((want - avail) / (avail - xf)) + 1;
      const copies = Array.from({ length: k }, (_, i) => `lp${label}_${i}`);
      lines.push(`[${idx}:a]${fmt},atrim=start=${f(off)}:duration=${f(avail)},asetpts=PTS-STARTPTS,asplit=${k}${copies.map((c) => `[${c}]`).join("")}`);
      let cur = copies[0];
      for (let i = 1; i < k; i++) {
        const nx = i === k - 1 ? `lpx${label}` : `lpx${label}_${i}`;
        lines.push(`[${cur}][${copies[i]}]acrossfade=d=${f(xf)}:c1=qsin:c2=qsin[${nx}]`);
        cur = nx;
      }
      parts.push(`[${cur}]atrim=0:${f(want)}`, "asetpts=PTS-STARTPTS");
    } else {
      // không lặp: phát hết bài rồi dừng, fade-out cuối
      dur = avail;
      fadeOut = Math.max(fadeOut, Math.min(2, avail / 2));
      parts.push(`[${idx}:a]${fmt}`, `atrim=start=${f(off)}:duration=${f(dur)}`, "asetpts=PTS-STARTPTS");
    }
    if ((l.fadeIn ?? 0) > 0) parts.push(`afade=t=in:d=${f(l.fadeIn!)}`);
    if (fadeOut > 0) parts.push(`afade=t=out:st=${f(Math.max(0, dur - fadeOut))}:d=${f(fadeOut)}`);
    parts.push(`volume=${f(l.gainDb ?? 0)}dB`);
    const ms = Math.round(l.start * 1000);
    parts.push(`adelay=${ms}|${ms}`);
    lines.push(`${parts.join(",")}[${label}]`);
  };

  const collect = (kind: "sfx" | "music"): string[] => {
    const labels: string[] = [];
    for (const t of project.tracks) {
      if (t.kind !== kind || t.hidden) continue;
      for (const l of t.layers) {
        if (l.type !== "audio" || l.start >= D) continue;
        const file = resolveSrc(l.src, jobDir);
        if (!file) {
          skipped.push(`${l.id}: ${l.src ?? "(không có src)"}`);
          continue;
        }
        inputs.push(file);
        const label = `${kind}${labels.length}`;
        layerChain(l, inputs.length - 1, label, kind === "music" ? ctx.durations?.[file] : undefined);
        labels.push(label);
      }
    }
    return labels;
  };
  const sfx = collect("sfx");
  const music = collect("music");

  const bus: string[] = ["voice"];
  if (sfx.length) {
    mixTree(sfx, "sfxraw", "s", lines);
    lines.push(`[sfxraw]alimiter=limit=0.891:level=0,apad=whole_dur=${f(D)},atrim=0:${f(D)}[sfxbus]`); // SFX chồng nhau < -1 dBTP
    bus.push("sfxbus");
  }
  if (music.length) {
    mixTree(music, "musicraw", "m", lines);
    const { threshold, ratio } = duckParams(a.music.duckDb, ctx.voiceLevelDb);
    lines.push(
      `[musicraw]apad=whole_dur=${f(D)},atrim=0:${f(D)}[mpad]`,
      `[mpad]${ctx.stems ? "asplit=2[mpad2][mraw]" : "anull[mpad2]"}`,
      `[mpad2][vsc]sidechaincompress=threshold=${f(threshold)}:ratio=${f(ratio)}:attack=${f(a.music.attack * 1000)}:release=${f(a.music.release * 1000)}:makeup=1[musicduck]`,
      ctx.stems ? `[musicduck]asplit=2[musicbus][mduck]` : `[musicduck]anull[musicbus]`,
    );
    if (ctx.stems) stems.push("mraw", "mduck");
    bus.push("musicbus");
  } else {
    lines.push(`[vsc]anullsink`);
  }
  mixTree(bus, "premix", "x", lines);
  lines.push(`[premix]alimiter=limit=0.891:level=0,atrim=0:${f(D)}[out]`);
  let graph = lines.join(";");
  // không có đầu vào file nào: nguồn im lặng phải là đầu vào thật (-i lavfi) chứ không phải filter nguồn
  if (!inputs.length) graph = graph.replace(`anullsrc=r=${SR}:cl=stereo,atrim=0:${f(D)}[voice0]`, `[0:a]${fmt},volume=0,atrim=0:${f(D)}[voice0]`);
  return { inputs, graph, sfxCount: sfx.length, musicCount: music.length, skipped, stems };
}

/**
 * Trộn âm thanh project: giọng + layer SFX + nhạc (ducking theo giọng) -> alimiter -> loudnorm 2 lượt -> 48 kHz WAV.
 * Đích lấy từ project.audio.master (mặc định -16 LUFS / -1.5 dBTP).
 */
export async function mixProjectAudio(project: Project, jobDir: string, outWav: string, opts: { stemsDir?: string } = {}): Promise<MixResult> {
  const master = project.audio?.master ?? { lufs: -16, truePeak: -1.5 };
  const ctx = { ...(await probeForMix(project, jobDir)), stems: !!opts.stemsDir };
  const { inputs, graph, sfxCount, musicCount, skipped, stems } = buildMixGraph(project, jobDir, ctx);
  const pre = join(dirname(outWav), ".mix-pre.wav");
  const scriptFile = join(dirname(outWav), ".mix-graph.txt");
  const args = ["-hide_banner", "-y"];
  for (const i of inputs) args.push("-i", i);
  // ffmpeg 9 đứt (assert best_input) khi graph không có đầu vào nào (giọng tắt + không SFX/nhạc) -> đầu vào im lặng làm nguồn cho [0:a]
  if (!inputs.length) args.push("-f", "lavfi", "-t", String(project.duration), "-i", `anullsrc=r=${SR}:cl=stereo`);
  // Windows giới hạn độ dài dòng lệnh -> graph dài thì đưa vào file
  if (graph.length > 12000) {
    await writeFile(scriptFile, graph, "utf8");
    args.push("-/filter_complex", scriptFile);
  } else args.push("-filter_complex", graph);
  args.push("-map", "[out]", "-ar", String(SR), "-ac", "2", "-c:a", "pcm_f32le", pre);
  if (opts.stemsDir) for (const st of stems) args.push("-map", `[${st}]`, "-ar", String(SR), "-c:a", "pcm_f32le", join(opts.stemsDir, `stem-${st}.wav`));
  try {
    await runCapture("ffmpeg", args);
    const target = `I=${master.lufs}:TP=${master.truePeak}:LRA=11`;
    const m1 = await runCapture("ffmpeg", ["-hide_banner", "-i", pre, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"]);
    const j = JSON.parse(m1.stderr.slice(m1.stderr.lastIndexOf("{"), m1.stderr.lastIndexOf("}") + 1));
    if (!Number.isFinite(Number(j.input_i)) || Number(j.input_i) < -69) {
      // im lặng hoàn toàn: loudnorm vô nghĩa, chỉ đổi định dạng
      await runCapture("ffmpeg", ["-hide_banner", "-y", "-i", pre, "-ar", String(SR), "-ac", "2", "-c:a", "pcm_s24le", outWav]);
      return { duration: project.duration, lufs: -70, truePeak: -150, lra: 0, sfxCount, musicCount, skipped };
    }
    const ln = `loudnorm=${target}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
    await runCapture("ffmpeg", ["-hide_banner", "-y", "-i", pre, "-af", `${ln},aresample=${SR}`, "-ar", String(SR), "-ac", "2", "-c:a", "pcm_s24le", outWav]);
  } finally {
    await rm(pre, { force: true });
    await rm(scriptFile, { force: true });
  }
  const m = await measureLoudness(outWav);
  return { duration: project.duration, ...m, sfxCount, musicCount, skipped };
}

/** Có cần trộn không: project có layer audio (sfx/music) hoặc khối audio riêng. */
export function needsMix(project: Project): boolean {
  return !!project.audio || project.tracks.some((t) => (t.kind === "sfx" || t.kind === "music") && t.layers.some((l) => l.type === "audio"));
}

/** Hash đầu vào âm thanh: project.audio + layer audio + giọng/duration + mtime/size file nguồn. */
export function mixHash(project: Project, jobDir: string): string {
  const layers = project.tracks.filter((t) => t.kind === "sfx" || t.kind === "music").map((t) => ({ kind: t.kind, hidden: t.hidden, layers: t.layers.filter((l) => l.type === "audio") }));
  const files = new Set<string>();
  if (project.source.audio) files.add(project.source.audio);
  else files.add(project.source.video);
  for (const t of layers) for (const l of t.layers) if (l.src) files.add(l.src);
  const stamp = [...files].sort().map((src) => {
    const f = resolveSrc(src, jobDir);
    return f ? `${src}:${statSync(f).mtimeMs}:${statSync(f).size}` : `${src}:missing`;
  });
  return createHash("sha256").update(JSON.stringify({ a: project.audio, d: project.duration, layers, stamp, clips: clipsMediaKey(project.videoClips), v: 3 })).digest("hex").slice(0, 24);
}

/** Trộn nếu đầu vào đổi (hoặc mix chưa có); không thì dùng lại outWav. Hash lưu cạnh outWav (<outWav>.hash). */
export async function ensureProjectMix(project: Project, jobDir: string, outWav: string, force = false): Promise<{ file: string; cached: boolean; result?: MixResult }> {
  const h = mixHash(project, jobDir);
  const hf = `${outWav}.hash`;
  if (!force && existsSync(outWav) && existsSync(hf) && (await readFile(hf, "utf8")).trim() === h) return { file: outWav, cached: true };
  const result = await mixProjectAudio(project, jobDir, outWav);
  await writeFile(hf, h, "utf8");
  return { file: outWav, cached: false, result };
}
