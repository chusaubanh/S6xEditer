/**
 * Công cụ dựng "quay màn hình + thuyết minh + phụ đề nảy theo giọng + Focus Zoom & Net-Sense Callouts" (Bản v2).
 *
 *   npx tsx scripts/screencast/screencast-v2.ts "<output/…/screencast-v2.json>" [--only s06,s12] [--stills] [--render s06,s12|all] [--concat]
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { loadConfig } from "../../src/studio/foundation/config.js";
import { VieNeuClient } from "../../src/studio/tts/vieneu-client.js";
import { getDurationSec } from "../../src/studio/audio/audio-tools.js";
import { applyNarrationReplacements } from "../../src/studio/brand/brand-config.js";
import { runMediaCommand } from "../../src/studio/media/media-runner.js";
import { resolveMediaBinary } from "../../src/studio/utils/media-binary.js";
import { gpuEncodeAvailable } from "../../src/studio/render/video-tools.js";

const PAD_SEC = 0.6;
const MAX_SPEED = 16;
const OUT_W = 1920, OUT_H = 1080, OUT_FPS = 30;
const GOLD_ASS = "&H0059A0C5&"; // #C5A059 (Gold Hoàng Gia S6X theo thứ tự BGR)
const FONTS_DIR = "assets/fonts"; // Be Vietnam Pro
const BLUR_PAD = 10;

interface Callout {
  text: string;
  pos?: "top-left" | "top-right" | "top-center" | "bottom-left" | "bottom-right";
}

interface Crop {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Segment {
  id: string;
  clip: string;
  in: number;
  out: number;
  text: string;
  blurModelLabel?: boolean;
  subPos?: "top" | "bottom";
  crop?: Crop;
  callout?: Callout;
  note?: string;
}

interface Cfg {
  title: string;
  voice: { preset: string; style: "tu_nhien" | "tin_tuc" | "doc_truyen"; speed?: number };
  sourceDir: string;
  clips: Record<string, string>;
  intro?: { scenes?: { id: string; voiceSegments: string[] }[] };
  segments: Segment[];
}

interface Box { t0: number; t1: number; x: number; y: number; w: number; h: number }
interface Word { w: string; t0: number; t1: number }
interface Manifest {
  id: string; clip: string; in: number; out: number; speed: number;
  audioSec: number; durSec: number; tpadSec: number; subPos: string;
  blur: boolean; text: string; audio: string; ass: string;
  crop?: Crop; callout?: Callout;
}

const args = process.argv.slice(2);
const cfgPath = resolve(args.find((a) => !a.startsWith("--")) ?? "");
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined;
};

if (!existsSync(cfgPath)) {
  console.error('Dùng: npx tsx scripts/screencast/screencast-v2.ts "<screencast-v2.json>" [--only ids] [--stills] [--render ids|all] [--concat]');
  process.exit(1);
}

const cfg: Cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const docDir = dirname(cfgPath);
const workDir = join(docDir, "screencast-v2");
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

/* ── TTS có cache (tận dụng cả cache screencast cũ nếu có) ──────────────── */
async function tts(text: string): Promise<string> {
  const spoken = applyNarrationReplacements(text);
  const hash = createHash("sha1").update(`${client.cacheIdentity}|${spoken}`).digest("hex").slice(0, 16);
  const file = join(workDir, "tts", `${hash}.mp3`);
  const legacyFile = join(docDir, "screencast", "tts", `${hash}.mp3`);
  if (!existsSync(file)) {
    if (existsSync(legacyFile)) {
      copyFileSync(legacyFile, file);
    } else {
      await client.generate(spoken, file);
    }
  }
  return file;
}

/** Đầu/cuối tiếng nói thật (bỏ khoảng lặng) để ước mốc từng chữ */
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

/* ── Phụ đề & Callout ASS ─────────────────────────────────────────────────── */
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
  const toks = bl.flat();
  const total = toks.reduce((s, t) => s + weight(t), 0);
  const per = (span[1] - span[0]) / total;
  let t = span[0];
  return bl.map((b) => b.map((tok) => { const w = { w: tok, t0: t, t1: t + weight(tok) * per }; t = w.t1; return w; }));
}

const assTime = (s: number) => {
  const cs = Math.round(s * 100);
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

function buildAss(
  text: string,
  span: [number, number],
  durSec: number,
  pos: "top" | "bottom",
  callout?: Callout
): string {
  const style = (n: string, al: number, mv: number, box: boolean) =>
    `Style: ${n},Be Vietnam Pro,62,&H00FFFFFF,&H00FFFFFF,${box ? "&H26000000,&H26000000" : "&H00141414,&H64000000"},-1,0,0,0,100,100,1.5,0,${box ? 3 : 1},${box ? 18 : 3},0,${al},120,120,${mv},1`;

  // Style cho Net-Sense Callout Badge: Nền than sẫm viền vàng hoàng gia S6X, chữ trắng đậm
  const calloutStyle = `Style: CalloutBadge,Be Vietnam Pro,38,&H00FFFFFF,&H00FFFFFF,${GOLD_ASS},&H26141517,-1,0,0,0,100,100,2,0,3,14,0,7,50,50,50,1`;

  const lines = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${OUT_W}`,
    `PlayResY: ${OUT_H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    style("Bot", 2, 56, false),
    style("Top", 8, 150, false),
    style("BoxBot", 2, 56, true),
    style("BoxTop", 8, 150, true),
    calloutStyle,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];

  // Callout Badge nếu có
  if (callout && callout.text) {
    let calloutPos = "\\an9\\pos(1860,60)"; // default top-right
    if (callout.pos === "top-left") calloutPos = "\\an7\\pos(60,60)";
    else if (callout.pos === "top-center") calloutPos = "\\an8\\pos(960,60)";
    else if (callout.pos === "bottom-left") calloutPos = "\\an1\\pos(60,940)";
    else if (callout.pos === "bottom-right") calloutPos = "\\an3\\pos(1860,940)";

    const cStart = "0:00:00.15";
    const cEnd = assTime(Math.max(0.3, durSec - 0.2));
    // Pop-in spring bounce effect
    const popAnim = "\\fscx80\\fscy80\\t(0,140,\\fscx108\\fscy108)\\t(140,240,\\fscx100\\fscy100)";
    lines.push(`Dialogue: 3,${cStart},${cEnd},CalloutBadge,,0,0,0,,{${calloutPos}\\q2${popAnim}}${callout.text}`);
  }

  const place = pos === "top" ? "\\an8\\pos(960,150)" : "\\an2\\pos(960,1024)";
  const boxPlace = pos === "top" ? "\\an8\\pos(960,158)" : "\\an2\\pos(960,1032)";
  const bw = wordTimes(text, span);

  bw.forEach((b, bi) => {
    const bs = Math.max(0, b[0].t0 - 0.05);
    const be = bi + 1 < bw.length ? Math.min(bw[bi + 1][0].t0, b[b.length - 1].t1 + 0.6) : Math.min(durSec, b[b.length - 1].t1 + 0.4);
    lines.push(`Dialogue: 0,${assTime(bs)},${assTime(be)},${pos === "top" ? "BoxTop" : "BoxBot"},,0,0,0,,{${boxPlace}\\q2\\1a&HFF&}${b.map((x) => x.w).join(" ")}`);
    const blockEnd = bi + 1 < bw.length ? Math.min(bw[bi + 1][0].t0, b[b.length - 1].t1 + 0.6) : Math.min(durSec, b[b.length - 1].t1 + 0.4);
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

/* ── Làm mờ nhãn model ───────────────────────────────────────────────────── */
let blurAll: Record<string, Box[]> | null = null;
function mergeBoxes(list: Box[]): Box[] {
  const merged: Box[] = [];
  for (const b of list) {
    const prev = merged[merged.length - 1];
    if (prev && b.t0 <= prev.t1 + 0.5 && Math.abs(b.x - prev.x) < 100 && Math.abs(b.y - prev.y) < 100) {
      const minX = Math.min(prev.x, b.x);
      const minY = Math.min(prev.y, b.y);
      const maxX = Math.max(prev.x + prev.w, b.x + b.w);
      const maxY = Math.max(prev.y + prev.h, b.y + b.h);
      prev.x = minX;
      prev.y = minY;
      prev.w = maxX - minX;
      prev.h = maxY - minY;
      prev.t1 = Math.max(prev.t1, b.t1);
    } else {
      merged.push({ ...b });
    }
  }
  return merged;
}

function boxesFor(s: Segment): Box[] {
  if (!s.blurModelLabel) return [];
  blurAll ??= JSON.parse(readFileSync(join(docDir, "blur-boxes.json"), "utf8"));
  const raw = (blurAll![s.clip] ?? []).filter((b) => b.t1 > s.in && b.t0 < s.out);
  return mergeBoxes(raw);
}

function blurChain(boxes: Box[], off: number, srcW: number, srcH: number): string {
  if (!boxes.length) return "[0:v]null[bl]";
  const ev = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const parts: string[] = [];
  let cur = "[0:v]";
  boxes.forEach((b, i) => {
    const x = Math.max(0, ev(b.x - BLUR_PAD)), y = Math.max(0, ev(b.y - BLUR_PAD));
    const w = Math.min(srcW - x, ev(b.w + 2 * BLUR_PAD)), h = Math.min(srcH - y, ev(b.h + 2 * BLUR_PAD));
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
function clipPath(s: Segment) { return join(cfg.sourceDir, cfg.clips[s.clip]); }

/* ── Chuẩn bị Manifest ────────────────────────────────────────────────────── */
const manifest: Manifest[] = [];
for (const s of segs) {
  const audio = await tts(s.text);
  const audioSec = await getDurationSec(audio);
  const srcLen = s.out - s.in;
  const speed = Math.min(MAX_SPEED, Math.max(1, srcLen / (audioSec + PAD_SEC)));
  const durSec = Math.max(audioSec + PAD_SEC, srcLen / speed);
  const tpadSec = Math.max(0, durSec - srcLen / speed);
  const pos = s.subPos ?? "bottom";
  const assFile = join(workDir, "ass", `${s.id}.ass`);
  writeFileSync(assFile, buildAss(s.text, speechSpan(audio, audioSec), durSec, pos, s.callout), "utf8");
  manifest.push({
    id: s.id, clip: s.clip, in: s.in, out: s.out, speed: +speed.toFixed(2),
    audioSec: +audioSec.toFixed(2), durSec: +durSec.toFixed(2), tpadSec: +tpadSec.toFixed(2),
    subPos: pos, blur: !!s.blurModelLabel, text: s.text, audio, ass: assFile,
    crop: s.crop, callout: s.callout
  });
}
writeFileSync(join(workDir, only ? "manifest-partial.json" : "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
console.log(`TTS + phụ đề v2: ${manifest.length} đoạn, tổng ${manifest.reduce((a, m) => a + m.durSec, 0).toFixed(1)}s`);

const gpu = await gpuEncodeAvailable();
const venc = gpu ? ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "20", "-b:v", "0"] : ["-c:v", "libx264", "-preset", "medium", "-crf", "20"];
const SRC_W = 1918, SRC_H = 1078;

/** Filter chain có hỗ trợ Crop / Focus Zoom cho từng segment */
function tailChain(m: Manifest, s: Segment, ptsOffset: number): string {
  const f = [`[bl]setpts=PTS/${m.speed}`, `fps=${OUT_FPS}`];
  if (s.crop) {
    // Crop vùng quan tâm rồi scale phóng to lên 1920x1080 (Focus Zoom)
    f.push(`crop=${s.crop.w}:${s.crop.h}:${s.crop.x}:${s.crop.y}`, `scale=${OUT_W}:${OUT_H}:flags=lanczos`);
  } else {
    f.push(`scale=${OUT_W}:${OUT_H}:flags=lanczos`);
  }
  if (m.tpadSec > 0 && ptsOffset === 0) f.push(`tpad=stop_mode=clone:stop_duration=${m.tpadSec.toFixed(3)}`);
  if (ptsOffset > 0) f.push(`setpts=PTS+${ptsOffset.toFixed(3)}/TB`);
  f.push(`subtitles=filename='${assFilterPath(rel(m.ass))}':fontsdir='${FONTS_DIR}'`, "format=yuv420p");
  return f.join(",") + "[v]";
}

async function render(m: Manifest, s: Segment) {
  const out = join(workDir, `${m.id}.mp4`);
  const fc = `${blurChain(boxesFor(s), s.in, SRC_W, SRC_H)};${tailChain(m, s, 0)};[2:v]scale=84:-1,format=rgba,colorchannelmixer=aa=0.4[wm];[v][wm]overlay=W-w-44:44[vo]`;
  await runMediaCommand("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", String(s.in), "-t", String(s.out - s.in),
    "-i", clipPath(s), "-i", m.audio, "-i", "assets/brand/watermark.png",
    "-filter_complex", fc, "-map", "[vo]", "-map", "1:a",
    "-af", `aresample=48000,apad=whole_dur=${m.durSec}`,
    "-t", String(m.durSec), "-r", String(OUT_FPS),
    ...venc, "-pix_fmt", "yuv420p", "-g", "30", "-bf", "0",
    "-c:a", "aac", "-b:a", "192k", "-ac", "2", out
  ]);
  return out;
}

async function still(m: Manifest, s: Segment, tOut: number, out: string) {
  const srcT = Math.min(s.out - 0.05, s.in + tOut * m.speed);
  const fc = `${blurChain(boxesFor(s), srcT, SRC_W, SRC_H)};${tailChain(m, s, tOut)}`;
  await runMediaCommand("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", srcT.toFixed(3), "-i", clipPath(s), "-filter_complex", fc, "-map", "[v]", "-frames:v", "1", out]);
}

if (flag("stills")) {
  const dir = opt("stills-dir") ?? "scratch/qa-transcript1-v2/screencast";
  mkdirSync(dir, { recursive: true });
  for (const m of manifest) {
    const s = cfg.segments.find((x) => x.id === m.id)!;
    await still(m, s, m.durSec / 2, join(dir, `${m.id}-mid.png`));
    console.log(`ảnh v2 ${m.id}`);
  }
}

const renderIds = opt("render");
if (renderIds) {
  for (const m of manifest) {
    if (renderIds !== "all" && !renderIds.split(",").includes(m.id)) continue;
    const s = cfg.segments.find((x) => x.id === m.id)!;
    const rendered = await render(m, s);
    console.log(`render v2: ${m.id} → ${basename(rendered)}`);
  }
}

if (flag("concat")) {
  const list = manifest.map((m) => `file '${resolve(workDir, `${m.id}.mp4`).replace(/\\/g, "/")}'`).join("\n");
  writeFileSync(join(workDir, "concat.txt"), list, "utf8");
  const screencastV2 = join(docDir, "video-screencast-v2.mp4");
  await runMediaCommand("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-f", "concat", "-safe", "0",
    "-i", join(workDir, "concat.txt"),
    "-c", "copy", screencastV2
  ]);
  console.log(`Đã xuất video screencast v2: ${screencastV2}`);

  // Nối intro (video.mp4) + video-screencast-v2.mp4 thành Huong-dan-tu-dung-cong-cu-go-bang-v2.mp4
  const introMp4 = join(docDir, "video.mp4");
  const finalV2Mp4 = join(docDir, "Huong-dan-tu-dung-cong-cu-go-bang-v2.mp4");
  if (existsSync(introMp4)) {
    const finalList = `file '${resolve(introMp4).replace(/\\/g, "/")}'\nfile '${resolve(screencastV2).replace(/\\/g, "/")}'`;
    writeFileSync(join(workDir, "concat-final.txt"), finalList, "utf8");
    await runMediaCommand("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "concat", "-safe", "0",
      "-i", join(workDir, "concat-final.txt"),
      "-c", "copy", finalV2Mp4
    ]);
    console.log(`\n🎉 HOÀN TẤT BẢN V2: ${finalV2Mp4}`);
  }
}
