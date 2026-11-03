/**
 * Công cụ dựng "quay màn hình + thuyết minh + phụ đề nảy theo giọng" (một file, dùng lại được).
 *
 *   npx tsx scripts/screencast/screencast.ts "<output/…/screencast.json>" [--only s06,s12] [--stills [--stills-multi] [--stills-dir d]] [--render s06,s12|all] [--concat]
 *
 * Đọc screencast.json: { aspect, voice:{preset,style,speed}, sourceDir, clips:{A:"file.mp4"}, intro, segments:[
 *   { id, clip, in, out, text, blurModelLabel?, subPos?: "top"|"bottom" } ] }
 * và (nếu có segment blurModelLabel) blur-boxes.json cạnh nó: { "C":[{t0,t1,x,y,w,h}], … } — hộp nhãn theo giây NGUỒN,
 * toạ độ pixel ảnh nguồn. File này do bước dò khung hình 1 fps (OpenCV matchTemplate, xem scratch) sinh ra.
 *
 * Việc làm (mặc định không render): TTS từng đoạn (cache theo hash text+giọng) → thời lượng đoạn = lời đọc + PAD →
 * tốc độ video = clamp((out-in)/thời lượng, 1, 16), video ngắn hơn lời đọc thì giữ khung cuối → phụ đề ASS (khối ≤ 8 từ,
 * ngắt ở dấu câu, từ đang đọc vàng + nảy 100→118→100) → manifest.json, script-review.md, voice-preview.mp3.
 * --stills: ảnh 1920x1080 giữa đoạn (đã phụ đề + làm mờ), thêm đầu/cuối cho đoạn blurModelLabel. --render: mp4 từng đoạn.
 * Nhãn model bị làm mờ ở phần video NGUỒN (trước khi tua nhanh), nên đúng cả khi quay có zoom/pan.
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

const PAD_SEC = 0.6;
const MAX_SPEED = 16;
const OUT_W = 1920, OUT_H = 1080, OUT_FPS = 30;
const GOLD_ASS = "&H0059A0C5&"; // A.gold #C5A059 (scripts/scene-kit/sets/_s6x_art.mjs) viết theo BGR
const FONTS_DIR = "assets/fonts"; // Be Vietnam Pro (font thương hiệu của repo)
const BLUR_PAD = 10;

interface Segment { id: string; clip: string; in: number; out: number; text: string; blurModelLabel?: boolean; subPos?: "top" | "bottom"; note?: string }
interface Cfg {
  title: string; voice: { preset: string; style: "tu_nhien" | "tin_tuc" | "doc_truyen"; speed?: number };
  sourceDir: string; clips: Record<string, string>; intro?: { scenes?: { id: string; voiceSegments: string[] }[] }; segments: Segment[];
}
interface Box { t0: number; t1: number; x: number; y: number; w: number; h: number }
interface Word { w: string; t0: number; t1: number }
interface Manifest { id: string; clip: string; in: number; out: number; speed: number; audioSec: number; durSec: number; tpadSec: number; subPos: string; blur: boolean; text: string; audio: string; ass: string }

const args = process.argv.slice(2);
const cfgPath = resolve(args.find((a) => !a.startsWith("--")) ?? "");
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : undefined; };
if (!existsSync(cfgPath)) { console.error('Dùng: npx tsx scripts/screencast/screencast.ts "<screencast.json>" [--only ids] [--stills] [--render ids|all]'); process.exit(1); }
const cfg: Cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const docDir = dirname(cfgPath);
const workDir = join(docDir, "screencast");
mkdirSync(join(workDir, "tts"), { recursive: true });
mkdirSync(join(workDir, "ass"), { recursive: true });
const only = opt("only")?.split(",");
const segs = cfg.segments.filter((s) => !only || only.includes(s.id));

const client = new VieNeuClient({ endpoint: loadConfig().vieneuEndpoint, voice: cfg.voice.preset, style: cfg.voice.style, speed: cfg.voice.speed });
const ffmpeg = resolveMediaBinary("ffmpeg");

/* ── TTS có cache ─────────────────────────────────────────────────────────── */
async function tts(text: string): Promise<string> {
  const spoken = applyNarrationReplacements(text);
  const file = join(workDir, "tts", `${createHash("sha1").update(`${client.cacheIdentity}|${spoken}`).digest("hex").slice(0, 16)}.mp3`);
  if (!existsSync(file)) await client.generate(spoken, file);
  return file;
}

/** Đầu/cuối tiếng nói thật (bỏ khoảng lặng), để ước mốc từng chữ. */
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

/* ── Phụ đề ───────────────────────────────────────────────────────────────── */
const weight = (tok: string) => {
  const core = tok.replace(/[.,:;?!…]+$/g, "");
  const base = /^[A-Za-z0-9]+$/.test(core) && core.length > 4 ? Math.ceil(core.length / 3) : 1;
  return base + (/[.?!…]$/.test(tok) ? 1.0 : /[,:;]$/.test(tok) ? 0.5 : 0);
};

/** Khối ≤ 8 từ, ngắt ở dấu câu; mệnh đề dài chia đều. */
function blocks(text: string): string[][] {
  const clauses = (text.match(/[^.,:;?!…]+[.,:;?!…]*/g) ?? [text]).map((c) => c.trim().split(/\s+/).filter(Boolean)).filter((c) => c.length);
  const out: string[][] = [];
  for (const c of clauses) {
    const n = Math.ceil(c.length / 8), size = Math.ceil(c.length / n);
    for (let i = 0; i < c.length; i += size) out.push(c.slice(i, i + size));
  }
  // mệnh đề ngắn (≤ 2 từ) gộp vào khối trước nếu còn chỗ
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

const assTime = (s: number) => { const cs = Math.round(s * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`; };

function buildAss(text: string, span: [number, number], durSec: number, pos: "top" | "bottom"): string {
  // Chữ: viền tối mỏng (lớp 1). Nền: hộp đen ~70% (lớp 0, BorderStyle=3, đệm 18px) vẽ riêng từ bản chữ trong suốt không scale,
  // để chữ đang đọc nảy lên không làm hộp lệch bậc.
  const style = (n: string, al: number, mv: number, box: boolean) => `Style: ${n},Be Vietnam Pro,62,&H00FFFFFF,&H00FFFFFF,${box ? "&H26000000,&H26000000" : "&H00141414,&H64000000"},-1,0,0,0,100,100,1.5,0,${box ? 3 : 1},${box ? 18 : 3},0,${al},120,120,${mv},1`;
  const lines = [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${OUT_W}`, `PlayResY: ${OUT_H}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    style("Bot", 2, 56, false), style("Top", 8, 150, false), style("BoxBot", 2, 56, true), style("BoxTop", 8, 150, true), "",
    "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];
  // Cả hai lớp dùng CÙNG \an + \pos tuyệt đối + \q2 (không tự xuống dòng) để hộp và chữ không thể lệch nhau.
  const place = pos === "top" ? "\\an8\\pos(960,150)" : "\\an2\\pos(960,1024)";
  // hộp libass tính theo cả chiều cao dòng (có phần trên chữ hoa) nên chữ nằm thấp hơn tâm hộp ~8 px: dời hộp xuống 8 px để tâm trùng chữ
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

/* ── Làm mờ nhãn model (theo giây nguồn) ──────────────────────────────────── */
let blurAll: Record<string, Box[]> | null = null;
function boxesFor(s: Segment): Box[] {
  if (!s.blurModelLabel) return [];
  blurAll ??= JSON.parse(readFileSync(join(docDir, "blur-boxes.json"), "utf8"));
  return (blurAll![s.clip] ?? []).filter((b) => b.t1 > s.in && b.t0 < s.out);
}

/** Chuỗi filter làm mờ chạy trên video nguồn 1918x1078; `off` = giây nguồn ứng với t=0 của luồng. */
function blurChain(boxes: Box[], off: number, srcW: number, srcH: number): string {
  if (!boxes.length) return "[0:v]null[bl]";
  const ev = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const parts: string[] = [];
  let cur = "[0:v]";
  boxes.forEach((b, i) => {
    const x = Math.max(0, ev(b.x - BLUR_PAD)), y = Math.max(0, ev(b.y - BLUR_PAD));
    const w = Math.min(srcW - x, ev(b.w + 2 * BLUR_PAD)), h = Math.min(srcH - y, ev(b.h + 2 * BLUR_PAD));
    const r = Math.max(2, Math.min(14, Math.floor(Math.min(w, h) / 2) - 2)), rc = Math.max(1, Math.floor(r / 2) - 1);
    parts.push(`${cur}split=2[a${i}][b${i}]`);
    parts.push(`[b${i}]crop=${w}:${h}:${x}:${y},boxblur=luma_radius=${r}:luma_power=4:chroma_radius=${rc}:chroma_power=4[k${i}]`);
    parts.push(`[a${i}][k${i}]overlay=${x}:${y}:enable='between(t+${off.toFixed(3)},${b.t0.toFixed(3)},${b.t1.toFixed(3)})'[o${i}]`);
    cur = `[o${i}]`;
  });
  parts.push(`${cur}null[bl]`);
  return parts.join(";");
}

const assFilterPath = (p: string) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
const rel = (p: string) => p.replace(resolve(process.cwd()) + "\\", "").replace(/\\/g, "/");

function clipPath(s: Segment) { return join(cfg.sourceDir, cfg.clips[s.clip]); }

/* ── Dựng ─────────────────────────────────────────────────────────────────── */
const manifest: Manifest[] = [];
for (const s of segs) {
  const audio = await tts(s.text);
  const audioSec = await getDurationSec(audio);
  const srcLen = s.out - s.in;
  const speed = Math.min(MAX_SPEED, Math.max(1, srcLen / (audioSec + PAD_SEC)));
  // tốc độ chạm trần 16x mà nguồn vẫn dài hơn lời đọc: kéo dài đoạn (giọng lặng) thay vì cắt mất cuối nguồn
  const durSec = Math.max(audioSec + PAD_SEC, srcLen / speed);
  const tpadSec = Math.max(0, durSec - srcLen / speed);
  const pos = s.subPos ?? "bottom";
  const assFile = join(workDir, "ass", `${s.id}.ass`);
  writeFileSync(assFile, buildAss(s.text, speechSpan(audio, audioSec), durSec, pos), "utf8");
  manifest.push({ id: s.id, clip: s.clip, in: s.in, out: s.out, speed: +speed.toFixed(2), audioSec: +audioSec.toFixed(2), durSec: +durSec.toFixed(2), tpadSec: +tpadSec.toFixed(2), subPos: pos, blur: !!s.blurModelLabel, text: s.text, audio, ass: assFile });
}
writeFileSync(join(workDir, only ? "manifest-partial.json" : "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
console.log(`TTS + phụ đề: ${manifest.length} đoạn, tổng ${manifest.reduce((a, m) => a + m.durSec, 0).toFixed(1)}s`);

const gpu = await gpuEncodeAvailable();
const venc = gpu ? ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "20", "-b:v", "0"] : ["-c:v", "libx264", "-preset", "medium", "-crf", "20"];
const SRC_W = 1918, SRC_H = 1078;

/** Phần filter chung sau làm mờ: tua → fps → scale → giữ khung cuối → phụ đề. `ptsOffset` dùng cho ảnh tĩnh. */
function tailChain(m: Manifest, ptsOffset: number): string {
  const f = [`[bl]setpts=PTS/${m.speed}`, `fps=${OUT_FPS}`, `scale=${OUT_W}:${OUT_H}:flags=lanczos`];
  if (m.tpadSec > 0 && ptsOffset === 0) f.push(`tpad=stop_mode=clone:stop_duration=${m.tpadSec.toFixed(3)}`);
  if (ptsOffset > 0) f.push(`setpts=PTS+${ptsOffset.toFixed(3)}/TB`);
  f.push(`subtitles=filename='${assFilterPath(rel(m.ass))}':fontsdir='${FONTS_DIR}'`, "format=yuv420p");
  return f.join(",") + "[v]";
}

async function render(m: Manifest, s: Segment) {
  const out = join(workDir, `${m.id}.mp4`);
  // watermark như pipeline (assets/brand/watermark.png, rộng 84, mờ 0,4, góc trên phải lề 44) để hai nửa video đồng nhất
  const fc = `${blurChain(boxesFor(s), s.in, SRC_W, SRC_H)};${tailChain(m, 0)};[2:v]scale=84:-1,format=rgba,colorchannelmixer=aa=0.4[wm];[v][wm]overlay=W-w-44:44[vo]`;
  await runMediaCommand("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(s.in), "-t", String(s.out - s.in), "-i", clipPath(s), "-i", m.audio, "-i", "assets/brand/watermark.png",
    "-filter_complex", fc, "-map", "[vo]", "-map", "1:a", "-af", `aresample=48000,apad=whole_dur=${m.durSec}`, "-t", String(m.durSec), "-r", String(OUT_FPS),
    ...venc, "-pix_fmt", "yuv420p", "-g", "30", "-bf", "0", "-c:a", "aac", "-b:a", "192k", "-ac", "2", out]);
  return out;
}

/** Ảnh tĩnh ở giây ĐẦU RA `tOut` của đoạn. */
async function still(m: Manifest, s: Segment, tOut: number, out: string) {
  const srcT = Math.min(s.out - 0.05, s.in + tOut * m.speed);
  const fc = `${blurChain(boxesFor(s), srcT, SRC_W, SRC_H)};${tailChain(m, tOut)}`;
  await runMediaCommand("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", srcT.toFixed(3), "-i", clipPath(s), "-filter_complex", fc, "-map", "[v]", "-frames:v", "1", out]);
}

if (flag("stills")) {
  const dir = opt("stills-dir") ?? "scratch/qa-transcript1/screencast";
  mkdirSync(dir, { recursive: true });
  for (const m of manifest) {
    const s = cfg.segments.find((x) => x.id === m.id)!;
    await still(m, s, m.durSec / 2, join(dir, `${m.id}-mid.png`));
    if (flag("stills-multi")) { // thêm 25% và 75% đoạn để soi phụ đề không che thao tác khi quay có zoom/pan
      await still(m, s, m.durSec * 0.25, join(dir, `${m.id}-q1.png`));
      await still(m, s, m.durSec * 0.75, join(dir, `${m.id}-q3.png`));
    }
    if (m.blur) {
      await still(m, s, 0.3, join(dir, `${m.id}-start.png`));
      await still(m, s, Math.max(0.5, m.audioSec - 0.3), join(dir, `${m.id}-end.png`));
    }
    console.log(`ảnh ${m.id}`);
  }
}

const renderIds = opt("render");
if (renderIds) {
  for (const m of manifest) {
    if (renderIds !== "all" && !renderIds.split(",").includes(m.id)) continue;
    console.log(`render ${m.id} → ${basename(await render(m, cfg.segments.find((x) => x.id === m.id)!))}`);
  }
}

if (flag("concat")) {
  const list = manifest.map((m) => `file '${resolve(workDir, `${m.id}.mp4`).replace(/\\/g, "/")}'`).join("\n");
  writeFileSync(join(workDir, "concat.txt"), list, "utf8");
  await runMediaCommand("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(workDir, "concat.txt"), "-c", "copy", join(docDir, "video-screencast.mp4")]);
}

/* ── voice-preview.mp3 = intro (voice-raw.mp3 do pipeline:voice) + mọi đoạn + đệm ───────────────────────────── */
const introRaw = join(docDir, "voice-raw.mp3");
const ins = [...(existsSync(introRaw) ? [introRaw] : []), ...manifest.map((m) => m.audio)];
if (!only && ins.length) {
  const fc = ins.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=mono,apad=pad_dur=${i === 0 && existsSync(introRaw) ? 0.5 : PAD_SEC}[a${i}]`).join(";") + ";" + ins.map((_, i) => `[a${i}]`).join("") + `concat=n=${ins.length}:v=0:a=1[o]`;
  await runMediaCommand("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...ins.flatMap((f) => ["-i", f]), "-filter_complex", fc, "-map", "[o]", "-c:a", "libmp3lame", "-q:a", "2", join(docDir, "voice-preview.mp3")]);
  console.log("voice-preview.mp3 (intro + toàn bộ đoạn) đã ghi");
}

/* ── script-review.md ─────────────────────────────────────────────────────── */
if (!only) {
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const total = manifest.reduce((a, m) => a + m.durSec, 0);
  let introSec = 0;
  try { const t = JSON.parse(readFileSync(join(docDir, "timeline.json"), "utf8")); const last = t.scenes[t.scenes.length - 1]; introSec = last.start + last.duration; } catch { /* chưa có timeline intro */ }
  const rows = manifest.map((m) => {
    const s = cfg.segments.find((x) => x.id === m.id)!;
    const notes = [s.note, m.blur ? "làm mờ nhãn model" : "", m.tpadSec > 0 ? `giữ khung cuối ${m.tpadSec}s` : "", m.speed >= 4 ? "tua nhanh" : ""].filter(Boolean).join("; ");
    return `| ${m.id} | ${m.clip} ${m.in}–${m.out}s (${m.out - m.in}s) | x${m.speed} | ${m.durSec}s | ${m.text.replace(/\|/g, "/")} | ${m.subPos === "top" ? "trên" : "dưới"} | ${notes} |`;
  });
  const md = [
    `# Duyệt kịch bản phần quay màn hình — ${cfg.title}`, "",
    `Giọng ${cfg.voice.preset} · ${cfg.voice.style} · tốc độ ${cfg.voice.speed ?? 1} · khung ${OUT_W}x${OUT_H} ${OUT_FPS}fps.`,
    `Mỗi đoạn dài = lời đọc + ${PAD_SEC}s đệm; tốc độ video = clamp(độ dài nguồn / thời lượng, 1, ${MAX_SPEED}).`, "",
    "| Đoạn | Nguồn (clip, giây) | Tốc độ | Thời lượng | Lời đọc | Phụ đề | Ghi chú |", "|---|---|---|---|---|---|---|", ...rows, "",
    `**Phần quay màn hình:** ${total.toFixed(1)}s (${fmt(total)}). **Intro scene-kit:** ${introSec.toFixed(1)}s (${fmt(introSec)}). **Tổng dự kiến:** ${(total + introSec).toFixed(1)}s (${fmt(total + introSec)}).`, "",
  ].join("\n");
  // script-review.md = bảng intro do script:validate sinh (giữ bản gốc ở script-review-intro.md) + bảng phần quay màn hình
  const reviewPath = join(docDir, "script-review.md"), introPath = join(docDir, "script-review-intro.md");
  if (existsSync(reviewPath) && !readFileSync(reviewPath, "utf8").includes("<!-- screencast -->")) writeFileSync(introPath, readFileSync(reviewPath, "utf8"), "utf8");
  const intro = existsSync(introPath) ? `${readFileSync(introPath, "utf8")}\n\n---\n\n` : "";
  writeFileSync(reviewPath, `${intro}<!-- screencast -->\n${md}`, "utf8");
  console.log("script-review.md (intro + quay màn hình) đã ghi");
}
