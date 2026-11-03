/**
 * Dựng video hướng dẫn "quay màn hình + thuyết minh + phụ đề nảy theo giọng", xen kẽ các cảnh scene-kit
 * (bản tổng quát của screencast-rieng.ts — bản đó giữ nguyên cho job "Hướng dẫn transcript").
 *
 * - Cảnh scene-kit render trước bằng `npm run pipeline -- <docDir>/script.json` (video.mp4 + clips/scene-<id>-fit.mp4).
 *   Công cụ cắt video.mp4 theo độ dài cộng dồn của các clip *-fit (đúng ranh giới cảnh, giữ nguyên tiếng + SFX).
 * - Đoạn quay màn hình: TTS VieNeu từng đoạn (cache), tua tối đa maxSpeed, giữ khung cuối khi lời dài hơn hình,
 *   phụ đề ASS nảy vàng S6X + nhãn góc. `spoken` (nếu có) là lời đưa vào TTS; `text` là phụ đề trên màn hình.
 * - `sequence` quyết định thứ tự: [{ "sk": ["s01","s02"] }, { "sc": ["m01","m02"] }, ...].
 *
 *   npx tsx scripts/screencast/screencast-mix.ts "<docDir>/screencast.json" [--only m01,m02] [--stills] [--voice-preview] [--render all|m01,m02] [--concat] [--clean]
 * --clean: render/ghép KHÔNG in phụ đề + nhãn góc (bản nền cho editor); --concat --clean ghi thêm editor-overlays.json
 *   (phụ đề từng khối + nhãn góc theo giây của video ghép) để dựng thành lớp chỉnh được.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { loadConfig } from "../../src/studio/foundation/config.js";
import { VieNeuClient } from "../../src/studio/tts/vieneu-client.js";
import { getDurationSec } from "../../src/studio/audio/audio-tools.js";
import { applyNarrationReplacements } from "../../src/studio/brand/brand-config.js";
import { runMediaCommand } from "../../src/studio/media/media-runner.js";
import { resolveMediaBinary } from "../../src/studio/utils/media-binary.js";
import { gpuEncodeAvailable } from "../../src/studio/render/video-tools.js";

const PAD_SEC = 0.8;
const MAX_SPEED = 2.0;
const OUT_W = 1920, OUT_H = 1080, OUT_FPS = 30;
const GOLD_ASS = "&H0059A0C5&"; // #C5A059 theo BGR
const FONTS_DIR = "assets/fonts";
const BLUR_PAD = 10;

interface Callout {
  text: string;
  pos?: "top-left" | "top-right" | "top-center" | "bottom-left" | "bottom-right";
}
interface Crop { x: number; y: number; w: number; h: number }
interface Segment {
  id: string;
  clip: string;
  in: number;
  out: number;
  text: string;
  spoken?: string;
  blurModelLabel?: boolean;
  subPos?: "top" | "bottom";
  crop?: Crop;
  callout?: Callout;
  maxSpeed?: number;
  note?: string;
}
type Step = { sk: string[] } | { sc: string[] };
interface Cfg {
  title: string;
  voice: { preset: string; style: "tu_nhien" | "tin_tuc" | "doc_truyen"; speed: number };
  sourceDir: string;
  clips: Record<string, string>;
  srcSize?: { w: number; h: number };
  sceneKitScript?: string; // mặc định script.json cạnh file cấu hình
  finalName: string;
  sequence: Step[];
  segments: Segment[];
}
interface Box { t0: number; t1: number; x: number; y: number; w: number; h: number }
interface Word { w: string; t0: number; t1: number }
interface Manifest {
  id: string; clip: string; in: number; out: number; speed: number;
  audioSec: number; durSec: number; tpadSec: number; subPos: string;
  text: string; audio: string; ass: string;
  subs: { start: number; end: number; words: { text: string; start: number; end: number }[] }[];
  callout?: Callout & { start: number; end: number };
}

const args = process.argv.slice(2);
const cfgPath = resolve(args.find((a) => !a.startsWith("--")) ?? "");
const flag = (n: string) => args.includes(`--${n}`);
const CLEAN = args.includes("--clean");
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
};

if (!existsSync(cfgPath)) {
  console.error('Dùng: npx tsx scripts/screencast/screencast-mix.ts "<screencast.json>" [--only ids] [--stills] [--voice-preview] [--render all|ids] [--concat]');
  process.exit(1);
}

const cfg: Cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
if (!cfg.voice?.speed) throw new Error("screencast.json: voice.speed bắt buộc (phải trùng script.json của scene-kit).");
const SRC_W = cfg.srcSize?.w ?? 1920, SRC_H = cfg.srcSize?.h ?? 1080;
const docDir = dirname(cfgPath);
const workDir = join(docDir, "build-screencast");
mkdirSync(join(workDir, "tts"), { recursive: true });
mkdirSync(join(workDir, "ass"), { recursive: true });

const only = opt("only")?.split(",");
const segs = cfg.segments.filter((s) => !only || only.includes(s.id));

const client = new VieNeuClient({
  endpoint: loadConfig().vieneuEndpoint,
  voice: cfg.voice.preset,
  style: cfg.voice.style,
  speed: cfg.voice.speed,
});
const ffmpeg = resolveMediaBinary("ffmpeg");

/* ── TTS có cache ─────────────────────────────────────────────────────────── */
async function tts(text: string): Promise<string> {
  const spoken = applyNarrationReplacements(text);
  const hash = createHash("sha1").update(`${client.cacheIdentity}|speed${cfg.voice.speed}|${spoken}`).digest("hex").slice(0, 16);
  const file = join(workDir, "tts", `${hash}.mp3`);
  if (!existsSync(file)) {
    console.log(`[TTS] ${spoken.slice(0, 50)}…`);
    await client.generate(spoken, file);
  }
  return file;
}

/** Đoạn có tiếng nói thật (bỏ khoảng lặng đầu/cuối) */
function speechSpan(file: string, total: number): [number, number] {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-i", file, "-af", "silencedetect=n=-38dB:d=0.1", "-f", "null", "-"], { encoding: "utf8" });
  const log = r.stderr || "";
  let start = 0, end = total;
  const first = /silence_start: (-?[\d.]+)[\s\S]*?silence_end: ([\d.]+)/.exec(log);
  if (first && Number(first[1]) <= 0.05) start = Number(first[2]);
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const lastStart = starts[starts.length - 1];
  if (lastStart !== undefined && lastStart > total - 0.8 && lastStart > start) end = lastStart;
  return [start, end];
}

/* ── Phụ đề & nhãn góc ASS ───────────────────────────────────────────────── */
const weight = (tok: string) => {
  const core = tok.replace(/[.,:;?!…]+$/g, "");
  const base = /^[A-Za-z0-9]+$/.test(core) && core.length > 4 ? Math.ceil(core.length / 3) : 1;
  return base + (/[.?!…]$/.test(tok) ? 1.0 : /[,:;]$/.test(tok) ? 0.5 : 0);
};

function blocks(text: string): string[][] {
  const clauses = (text.match(/[^.,:;?!…]+[.,:;?!…]*/g) ?? [text]).map((c) => c.trim().split(/\s+/).filter(Boolean)).filter((c) => c.length);
  const out: string[][] = [];
  for (const c of clauses) {
    const n = Math.ceil(c.length / 8), size = Math.ceil(c.length / n);
    for (let i = 0; i < c.length; i += size) out.push(c.slice(i, i + size));
  }
  const merged: string[][] = [];
  for (const b of out) {
    const prev = merged[merged.length - 1];
    if (prev && b.length <= 2 && prev.length + b.length <= 8 && !/[.?!…]$/.test(prev[prev.length - 1])) prev.push(...b); else merged.push(b);
  }
  return merged;
}

function wordTimes(text: string, span: [number, number]): Word[][] {
  const bl = blocks(text);
  const total = bl.flat().reduce((s, t) => s + weight(t), 0);
  const per = (span[1] - span[0]) / total;
  let t = span[0];
  return bl.map((b) => b.map((tok) => { const w = { w: tok, t0: t, t1: t + weight(tok) * per }; t = w.t1; return w; }));
}

const assTime = (s: number) => {
  const cs = Math.round(s * 100);
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

function buildAss(text: string, span: [number, number], durSec: number, pos: "top" | "bottom", callout?: Callout): string {
  const style = (n: string, al: number, mv: number, box: boolean) =>
    `Style: ${n},Be Vietnam Pro,62,&H00FFFFFF,&H00FFFFFF,${box ? "&H26000000,&H26000000" : "&H00141414,&H64000000"},-1,0,0,0,100,100,1.5,0,${box ? 3 : 1},${box ? 18 : 3},0,${al},120,120,${mv},1`;
  const calloutStyle = `Style: CalloutBadge,Be Vietnam Pro,38,&H00FFFFFF,&H00FFFFFF,${GOLD_ASS},&H26141517,-1,0,0,0,100,100,2,0,3,14,0,7,50,50,50,1`;
  const lines = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${OUT_W}`, `PlayResY: ${OUT_H}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    style("Bot", 2, 56, false), style("Top", 8, 150, false), style("BoxBot", 2, 56, true), style("BoxTop", 8, 150, true), calloutStyle, "",
    "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];

  if (callout?.text) {
    let calloutPos = "\\an9\\pos(1860,60)";
    if (callout.pos === "top-left") calloutPos = "\\an7\\pos(60,60)";
    else if (callout.pos === "top-center") calloutPos = "\\an8\\pos(960,60)";
    else if (callout.pos === "bottom-left") calloutPos = "\\an1\\pos(60,940)";
    else if (callout.pos === "bottom-right") calloutPos = "\\an3\\pos(1860,940)";
    const popAnim = "\\fscx80\\fscy80\\t(0,140,\\fscx108\\fscy108)\\t(140,240,\\fscx100\\fscy100)";
    lines.push(`Dialogue: 3,0:00:00.15,${assTime(Math.max(0.3, durSec - 0.2))},CalloutBadge,,0,0,0,,{${calloutPos}\\q2${popAnim}}${callout.text}`);
  }

  const place = pos === "top" ? "\\an8\\pos(960,150)" : "\\an2\\pos(960,1024)";
  const boxPlace = pos === "top" ? "\\an8\\pos(960,158)" : "\\an2\\pos(960,1032)";
  const bw = wordTimes(text, span);
  bw.forEach((b, bi) => {
    const blockEnd = bi + 1 < bw.length ? Math.min(bw[bi + 1][0].t0, b[b.length - 1].t1 + 0.6) : Math.min(durSec, b[b.length - 1].t1 + 0.4);
    lines.push(`Dialogue: 0,${assTime(Math.max(0, b[0].t0 - 0.05))},${assTime(blockEnd)},${pos === "top" ? "BoxTop" : "BoxBot"},,0,0,0,,{${boxPlace}\\q2\\1a&HFF&}${b.map((x) => x.w).join(" ")}`);
    b.forEach((word, wi) => {
      const start = wi === 0 ? Math.max(0, word.t0 - 0.05) : word.t0;
      const end = wi + 1 < b.length ? b[wi + 1].t0 : blockEnd;
      const txt = b.map((x, i) => i === wi
        ? `{\\1c${GOLD_ASS}\\fscx100\\fscy100\\t(0,60,\\fscx118\\fscy118)\\t(60,120,\\fscx100\\fscy100)}${x.w}{\\r}`
        : x.w).join(" ");
      lines.push(`Dialogue: 1,${assTime(start)},${assTime(end)},${pos === "top" ? "Top" : "Bot"},,0,0,0,,{${place}\\q2}${txt}`);
    });
  });
  return lines.join("\n") + "\n";
}

/* ── Làm mờ vùng (blur-boxes.json, theo clip) ────────────────────────────── */
let blurAll: Record<string, Box[]> | null = null;
function boxesFor(s: Segment): Box[] {
  if (!s.blurModelLabel) return [];
  blurAll ??= JSON.parse(readFileSync(join(docDir, "blur-boxes.json"), "utf8"));
  return (blurAll![s.clip] ?? []).filter((b) => b.t1 > s.in && b.t0 < s.out);
}

function blurChain(boxes: Box[], off: number): string {
  if (!boxes.length) return "[0:v]null[bl]";
  const ev = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const parts: string[] = [];
  let cur = "[0:v]";
  boxes.forEach((b, i) => {
    const x = Math.max(0, ev(b.x - BLUR_PAD)), y = Math.max(0, ev(b.y - BLUR_PAD));
    const w = Math.min(SRC_W - x, ev(b.w + 2 * BLUR_PAD)), h = Math.min(SRC_H - y, ev(b.h + 2 * BLUR_PAD));
    const r = Math.max(2, Math.min(12, Math.floor(Math.min(w, h) / 2) - 2)), rc = Math.max(1, Math.floor(r / 2) - 1);
    parts.push(`${cur}split=2[a${i}][b${i}]`);
    parts.push(`[b${i}]crop=${w}:${h}:${x}:${y},boxblur=luma_radius=${r}:luma_power=2:chroma_radius=${rc}:chroma_power=2[k${i}]`);
    parts.push(`[a${i}][k${i}]overlay=${x}:${y}:enable='between(t+${off.toFixed(3)},${b.t0.toFixed(3)},${b.t1.toFixed(3)})'[o${i}]`);
    cur = `[o${i}]`;
  });
  parts.push(`${cur}null[bl]`);
  return parts.join(";");
}

const assFilterPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
const rel = (p: string) => p.replace(resolve(process.cwd()) + "\\", "").replace(/\\/g, "/");
const clipPath = (s: Segment) => join(cfg.sourceDir, cfg.clips[s.clip]);

/* ── Manifest: TTS + phụ đề ──────────────────────────────────────────────── */
const manifest: Manifest[] = [];
for (const s of segs) {
  const audio = await tts(s.spoken ?? s.text);
  const audioSec = await getDurationSec(audio);
  const srcLen = s.out - s.in;
  const speed = Math.min(s.maxSpeed ?? MAX_SPEED, Math.max(1, srcLen / (audioSec + PAD_SEC)));
  const durSec = Math.max(audioSec + PAD_SEC, srcLen / speed);
  const tpadSec = Math.max(0, durSec - srcLen / speed);
  const pos = s.subPos ?? "bottom";
  const assFile = join(workDir, "ass", `${s.id}.ass`);
  const span = speechSpan(audio, audioSec);
  writeFileSync(assFile, buildAss(s.text, span, durSec, pos, s.callout), "utf8");
  const bw = wordTimes(s.text, span);
  const subs = bw.map((b, bi) => ({
    start: Math.max(0, b[0].t0 - 0.05),
    end: bi + 1 < bw.length ? Math.min(bw[bi + 1][0].t0, b[b.length - 1].t1 + 0.6) : Math.min(durSec, b[b.length - 1].t1 + 0.4),
    words: b.map((x) => ({ text: x.w, start: x.t0, end: x.t1 })),
  }));
  manifest.push({
    id: s.id, clip: s.clip, in: s.in, out: s.out, speed: +speed.toFixed(2),
    audioSec: +audioSec.toFixed(2), durSec: +durSec.toFixed(2), tpadSec: +tpadSec.toFixed(2),
    subPos: pos, text: s.text, audio, ass: assFile, subs,
    ...(s.callout?.text ? { callout: { ...s.callout, start: 0.15, end: Math.max(0.3, durSec - 0.2) } } : {}),
  });
}
writeFileSync(join(workDir, only ? "manifest-partial.json" : "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
console.log(`✓ TTS + phụ đề: ${manifest.length} đoạn, tổng ${manifest.reduce((a, m) => a + m.durSec, 0).toFixed(1)}s`);
for (const m of manifest) {
  const note = m.tpadSec > 0.3 ? ` · giữ khung cuối ${m.tpadSec}s` : "";
  console.log(`  ${m.id}: hình ${(m.out - m.in).toFixed(1)}s → ${m.durSec}s (x${m.speed})${note}`);
}

const cleanDir = join(workDir, "clean");
if (CLEAN) mkdirSync(cleanDir, { recursive: true });
const gpu = await gpuEncodeAvailable();
const venc = gpu ? ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "20", "-b:v", "0"] : ["-c:v", "libx264", "-preset", "medium", "-crf", "20"];
const aenc = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"];

function tailChain(m: Manifest, s: Segment, ptsOffset: number, burn = true): string {
  const f = [`[bl]setpts=PTS/${m.speed}`, `fps=${OUT_FPS}`];
  if (s.crop) {
    const cropW = Math.floor(s.crop.w / 2) * 2;
    const cropH = Math.round(cropW * 9 / 16 / 2) * 2;
    const cropX = Math.min(Math.max(0, Math.floor(s.crop.x / 2) * 2), SRC_W - cropW);
    const cropY = Math.min(Math.max(0, Math.floor(s.crop.y / 2) * 2), SRC_H - cropH);
    f.push(`crop=${cropW}:${cropH}:${cropX}:${cropY}`);
  }
  f.push(`scale=${OUT_W}:${OUT_H}:flags=lanczos`, "setsar=1");
  if (m.tpadSec > 0 && ptsOffset === 0) f.push(`tpad=stop_mode=clone:stop_duration=${m.tpadSec.toFixed(3)}`);
  if (ptsOffset > 0) f.push(`setpts=PTS+${ptsOffset.toFixed(3)}/TB`);
  if (burn) f.push(`subtitles=filename='${assFilterPath(rel(m.ass))}':fontsdir='${FONTS_DIR}'`);
  f.push("format=yuv420p");
  return f.join(",") + "[v]";
}

async function render(m: Manifest, s: Segment) {
  const out = join(CLEAN ? cleanDir : workDir, `${m.id}.mp4`);
  const fc = `${blurChain(boxesFor(s), s.in)};${tailChain(m, s, 0, !CLEAN)};[2:v]scale=84:-1,format=rgba,colorchannelmixer=aa=0.4[wm];[v][wm]overlay=W-w-44:44[vo]`;
  await runMediaCommand("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", String(s.in), "-t", String(s.out - s.in),
    "-i", clipPath(s), "-i", m.audio, "-i", "assets/brand/watermark.png",
    "-filter_complex", fc, "-map", "[vo]", "-map", "1:a",
    "-af", `aresample=48000,apad=whole_dur=${m.durSec}`,
    "-t", String(m.durSec), "-r", String(OUT_FPS),
    ...venc, "-pix_fmt", "yuv420p", "-g", "30", "-bf", "0", ...aenc, out,
  ]);
  return out;
}

/** Ảnh kiểm tra ở thời điểm tOut (giây, theo video ra) */
async function still(m: Manifest, s: Segment, tOut: number, out: string) {
  const srcT = Math.min(s.out - 0.05, s.in + tOut * m.speed);
  const fc = `${blurChain(boxesFor(s), srcT)};${tailChain(m, s, tOut)}`;
  await runMediaCommand("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", srcT.toFixed(3), "-i", clipPath(s), "-filter_complex", fc, "-map", "[v]", "-frames:v", "1", out]);
}

if (flag("stills")) {
  const dir = opt("stills-dir") ?? join(docDir, "stills");
  mkdirSync(dir, { recursive: true });
  for (const m of manifest) {
    const s = cfg.segments.find((x) => x.id === m.id)!;
    await still(m, s, m.durSec * 0.5, join(dir, `${m.id}-giua.png`));
    await still(m, s, Math.max(0, m.durSec - 0.3), join(dir, `${m.id}-cuoi.png`));
    console.log(`Ảnh kiểm tra: ${m.id}`);
  }
}

/* ── Bản nghe thử lời của phần quay màn hình ─────────────────────────────── */
if (flag("voice-preview")) {
  const out = join(docDir, "voice-preview-screencast.mp3");
  const fc = manifest.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,apad=pad_dur=0.6[a${i}]`).join(";") + ";" +
    manifest.map((_, i) => `[a${i}]`).join("") + `concat=n=${manifest.length}:v=0:a=1[ao]`;
  await runMediaCommand("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...manifest.flatMap((m) => ["-i", m.audio]), "-filter_complex", fc, "-map", "[ao]", "-c:a", "libmp3lame", "-b:a", "192k", out]);
  console.log(`✓ Nghe thử phần quay màn hình: ${out}`);
}

const renderIds = opt("render");
if (renderIds) {
  for (const m of manifest) {
    if (renderIds !== "all" && !renderIds.split(",").includes(m.id)) continue;
    const s = cfg.segments.find((x) => x.id === m.id)!;
    const rendered = await render(m, s);
    console.log(`Render: ${m.id} → ${basename(rendered)} (${m.durSec}s, x${m.speed})`);
  }
}

/* ── Ghép theo sequence ───────────────────────────────────────────────────── */
async function sceneKitCuts(): Promise<Map<string, [number, number]>> {
  const scriptFile = join(docDir, cfg.sceneKitScript ?? "script.json");
  const script = JSON.parse(readFileSync(scriptFile, "utf8")) as { scenes: { id: string }[] };
  const cuts = new Map<string, [number, number]>();
  let t = 0;
  for (const sc of script.scenes) {
    const fit = join(dirname(scriptFile), "clips", `scene-${sc.id}-fit.mp4`);
    if (!existsSync(fit)) throw new Error(`Thiếu ${fit} — chạy npm run pipeline cho script.json trước.`);
    const d = await getDurationSec(fit);
    cuts.set(sc.id, [t, t + d]);
    t += d;
  }
  return cuts;
}

if (flag("concat")) {
  const skVideo = join(docDir, "video.mp4");
  if (!existsSync(skVideo)) throw new Error(`Thiếu ${skVideo} — render scene-kit trước.`);
  const cuts = await sceneKitCuts();
  const parts: string[] = [];
  const overlays: { subs: (Manifest["subs"][number] & { seg: string })[]; callouts: (NonNullable<Manifest["callout"]> & { seg: string })[] } = { subs: [], callouts: [] };
  let cursor = 0;
  for (const [i, step] of cfg.sequence.entries()) {
    if ("sk" in step) {
      const a = cuts.get(step.sk[0]), b = cuts.get(step.sk[step.sk.length - 1]);
      if (!a || !b) throw new Error(`sequence[${i}]: cảnh scene-kit không có trong script.json: ${step.sk.join(",")}`);
      const out = join(workDir, `part-${String(i).padStart(2, "0")}-sk.mp4`);
      await runMediaCommand("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error", "-i", skVideo,
        "-ss", a[0].toFixed(3), "-to", b[1].toFixed(3),
        "-vf", `fps=${OUT_FPS},scale=${OUT_W}:${OUT_H},setsar=1,format=yuv420p`,
        "-af", "aresample=48000,aformat=channel_layouts=stereo",
        ...venc, "-pix_fmt", "yuv420p", "-g", "30", "-bf", "0", ...aenc, out,
      ]);
      parts.push(out);
      cursor += await getDurationSec(out);
    } else {
      for (const id of step.sc) {
        const f = join(CLEAN ? cleanDir : workDir, `${id}.mp4`);
        if (!existsSync(f)) throw new Error(`Thiếu ${f} — chạy --render all${CLEAN ? " --clean" : ""} trước.`);
        parts.push(f);
        const m = manifest.find((x) => x.id === id);
        if (!m) throw new Error(`sequence: ${id} không có trong manifest (bỏ --only khi ghép).`);
        const sh = (t: number) => +(cursor + t).toFixed(3);
        for (const b of m.subs) overlays.subs.push({ seg: id, start: sh(b.start), end: sh(b.end), words: b.words.map((w) => ({ text: w.text, start: sh(w.start), end: sh(w.end) })) });
        if (m.callout) overlays.callouts.push({ ...m.callout, seg: id, start: sh(m.callout.start), end: sh(m.callout.end) });
        cursor += await getDurationSec(f);
      }
    }
  }
  const finalVideo = join(docDir, CLEAN ? cfg.finalName.replace(/\.mp4$/i, "-clean.mp4") : cfg.finalName);
  if (CLEAN) writeFileSync(join(docDir, "editor-overlays.json"), JSON.stringify(overlays, null, 2), "utf8");
  const n = parts.length;
  // fps sau concat: đầu ra CFR theo thời gian (không có fps thì ghép các đoạn tpad/setpts để lại vài chỗ hụt PTS → đếm khung lệch thời gian)
  const fc = parts.map((_, i) => `[${i}:v]fps=${OUT_FPS},scale=${OUT_W}:${OUT_H},setsar=1[v${i}];[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`).join(";") + ";" +
    parts.map((_, i) => `[v${i}][a${i}]`).join("") + `concat=n=${n}:v=1:a=1[vc][ao];[vc]fps=${OUT_FPS}[vo]`;
  console.log(`Ghép ${n} phần theo sequence…`);
  await runMediaCommand("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    ...parts.flatMap((p) => ["-i", p]),
    "-filter_complex", fc, "-map", "[vo]", "-map", "[ao]",
    ...venc, "-pix_fmt", "yuv420p", "-fps_mode", "cfr", "-r", String(OUT_FPS), ...aenc, "-movflags", "+faststart", finalVideo,
  ]);
  console.log(`✓ Video hoàn chỉnh: ${finalVideo} (${(await getDurationSec(finalVideo)).toFixed(1)}s)`);
}
