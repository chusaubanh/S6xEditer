import { copyFileSync, existsSync, statSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gpuEncodeAvailable } from "../studio/render/video-tools.js";
import { probe, runCapture } from "./ffmpeg-util.js";
import { ASR_PYTHON, REPO_ROOT, jobDir, requireFile, withStep, writeJson } from "./jobs.js";
import { loadMedia } from "./commands-text.js";
import { computePeaks } from "./peaks.js";
import { levelProxyAudio, loadMomentary } from "./clip-loudness.js";
import { readWav16 } from "./voicing.js";

export const SOURCE_AUDIO = "source-audio.wav";
export const SOURCE_PROXY = "source-proxy.mp4";

export async function rawPath(job: string): Promise<string> {
  const media = await loadMedia(job);
  return requireFile(resolve(REPO_ROOT, media.source), "Không thấy video gốc trong input/<job>/raw.");
}

const newer = (a: string, b: string) => existsSync(a) && statSync(a).mtimeMs >= statSync(b).mtimeMs;

/** th:source-audio: tách audio CẢ video gốc, DeepFilterNet3 (GPU) một lần → source-audio.wav 48 kHz mono, KHÔNG loudnorm. */
export async function sourceAudio(job: string, force = false): Promise<string> {
  const dir = jobDir(job);
  const raw = await rawPath(job);
  const out = join(dir, SOURCE_AUDIO);
  if (!force && newer(out, raw)) {
    console.log(`${SOURCE_AUDIO} đã có (mới hơn video gốc): ${out}`);
    return out;
  }
  requireFile(ASR_PYTHON, "Chạy npm run th:setup trước.");
  await withStep(job, "source-audio", async () => {
    const work = join(dir, "work", "source");
    await mkdir(work, { recursive: true });
    const rawWav = join(work, "audio-raw.wav");
    await runCapture("ffmpeg", ["-y", "-i", raw, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", rawWav]);
    const clean = join(work, "audio-denoised.wav");
    await runCapture(ASR_PYTHON, [join(REPO_ROOT, "scripts", "asr", "denoise.py"), "--in", rawWav, "--out", clean], { inherit: true });
    await rm(rawWav, { force: true });
    // chỉ giảm ồn, KHÔNG gain (giữ mức gốc); gain riêng từng clip do ensureCutFromClips lo. Đo loudness chỉ để tham khảo.
    copyFileSync(clean, out);
    const m = await measureLoudness(out);
    await writeJson(join(dir, "source-audio.json"), { measuredI: m.I, measuredMedianShortTerm: m.median, truePeak: m.tp, createdAt: new Date().toISOString() });
    console.log(`loudness nguồn (tham khảo): I=${m.I} LUFS, trung vị ngắn hạn=${m.median}, TP=${m.tp} dBFS`);
    return { result: null, outputs: [SOURCE_AUDIO] };
  });
  console.log(`${SOURCE_AUDIO}: ${out}`);
  return out;
}

/** Loudness tích hợp (LUFS) và true peak (dBTP) bằng ebur128. */
export async function measureLoudness(file: string): Promise<{ I: number; tp: number; median: number }> {
  const { stdout, stderr } = await runCapture("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128=peak=true:metadata=1,ametadata=print:key=lavfi.r128.S:file=-", "-f", "null", "-"]);
  // trung vị loudness ngắn hạn (3 s) của các đoạn có tiếng (> −70): bền với nguồn lúc to lúc nhỏ
  const st = [...stdout.matchAll(/lavfi\.r128\.S=(-?[\d.]+)/g)].map((m) => +m[1]).filter((x) => x > -70).sort((a, b) => a - b);
  const median = st.length ? st[Math.floor((st.length - 1) / 2)] : -70;
  const t = stderr.slice(stderr.lastIndexOf("Summary:"));
  return { I: parseFloat(/I:\s+(-?[\d.]+) LUFS/.exec(t)![1]), tp: parseFloat(/Peak:\s+(-?[\d.]+) dBFS/.exec(t)![1]), median };
}

export const THUMB_COLS = 10;
export const THUMB_ROWS = 10;
export const THUMB_H = 90;

/** th:proxy: proxy editor (H.264 NVENC keyint 15, kích thước gốc, giọng đã giảm ồn mux AAC) + thumbs sprite 1 khung/giây + source-peaks.json. */
export async function proxy(job: string, force = false): Promise<void> {
  const dir = jobDir(job);
  const raw = await rawPath(job);
  const audio = requireFile(join(dir, SOURCE_AUDIO), "Chạy th:source-audio trước.");
  await withStep(job, "proxy", async () => {
    const gpu = await gpuEncodeAvailable();
    const { info } = await probe(raw);
    const out = join(dir, SOURCE_PROXY);
    if (force || !newer(out, audio)) {
      const dec = gpu ? ["-hwaccel", "cuda"] : [];
      // âm thanh proxy: đường bao gain theo loudness (chỉ để nghe thử cho đều, render không dùng)
      const work = join(dir, "work", "source");
      await mkdir(work, { recursive: true });
      const lv = levelProxyAudio((await readWav16(audio)).samples, await loadMomentary(audio, dir));
      const f32 = join(work, "proxy-audio.f32");
      await writeFile(f32, Buffer.from(lv.buffer, lv.byteOffset, lv.byteLength));
      await runCapture("ffmpeg", ["-y", ...dec, "-i", raw, "-f", "f32le", "-ar", "48000", "-ac", "1", "-i", f32, "-map", "0:v:0", "-map", "1:a:0", ...(gpu ? ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "27", "-b:v", "0"] : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "27"]), "-bf", "0", // proxy: chất lượng vừa đủ để chỉnh, không cần cq 18
        "-g", "15", "-keyint_min", "15", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-movflags", "+faststart", out]);
    }
    // thumbs: 1 khung/giây, cao 90 px, ghép 10x10 mỗi sheet
    const tdir = join(dir, "thumbs");
    await rm(tdir, { recursive: true, force: true });
    await mkdir(tdir, { recursive: true });
    const tileW = Math.round((THUMB_H * info.width) / info.height / 2) * 2;
    await runCapture("ffmpeg", ["-y", ...(gpu ? ["-hwaccel", "cuda"] : []), "-i", raw, "-an", "-vf", `fps=1,scale=${tileW}:${THUMB_H},tile=${THUMB_COLS}x${THUMB_ROWS}`, "-start_number", "1", join(tdir, "sheet-%03d.png")]);
    const sheets = (await readdir(tdir)).filter((f) => f.endsWith(".png")).sort();
    await writeJson(join(tdir, "index.json"), {
      fps: 1, tileW, tileH: THUMB_H, cols: THUMB_COLS, rows: THUMB_ROWS, perSheet: THUMB_COLS * THUMB_ROWS,
      count: Math.ceil(info.duration), duration: info.duration, sheets,
    });
    const peaks = await computePeaks(audio);
    await writeFile(join(dir, "source-peaks.json"), JSON.stringify(peaks), "utf8");
    console.log(`${SOURCE_PROXY}: ${out}\nthumbs: ${tdir} (${sheets.length} sheet, ${Math.ceil(info.duration)} khung)\nsource-peaks.json: ${peaks.duration.toFixed(1)}s`);
    return { result: null, outputs: [SOURCE_PROXY, "thumbs/index.json", "source-peaks.json"] };
  });
}
