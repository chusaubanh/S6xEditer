/**
 * Chế độ C — dựng video cuối từ project.json: video nguồn (cut.mp4 + videoTransform) + overlay + audio.
 *
 * CÁCH ĐÃ CHỌN: B (overlay trong suốt rồi ffmpeg overlay lên cut.mp4).
 *  - HyperFrames 0.6.94 hỗ trợ `render --format webm|mov|png-sequence` có alpha (xem `render --help`),
 *    nên overlay-runtime.js (dùng chung với editor) chạy nguyên trong một composition HTML trong suốt.
 *  - Không chọn A (nhúng <video> nguồn vào composition): HyperFrames phải seek/giải mã lại từng khung bằng Chrome,
 *    chậm và dễ lệch khung; ffmpeg ghép trực tiếp nhanh và giữ nguyên chất lượng nguồn.
 *  - Không cần C (khoá màu xanh): đã có alpha thật.
 *
 * TỐC ĐỘ
 *  1. Chỉ render các KHUNG KHÁC NHAU: overlay-runtime.frameKey(project, t) cho chữ ký thuần của khung; khung trùng chữ ký
 *     (đoạn giữ nguyên của phụ đề, khoảng trống) chỉ render một lần, khung trống dùng PNG trong suốt.
 *  2. Cache theo hash khung ở output/<job>/.overlay-cache/ (chữ ký + hộp cắt + muối phiên bản): sửa một layer chỉ render lại
 *     các khung đổi chữ ký.
 *  3. Chỉ chụp VÙNG CÓ LAYER: overlay-runtime.frameBox(project, t) cho hộp bao từng khung (nới theo hoạt ảnh/viền/bóng),
 *     làm tròn ra lưới 120 px và gom thành tối đa MAX_GROUPS nhóm; mỗi nhóm là một lần chạy HyperFrames với canvas bằng đúng
 *     hộp đó (PNG nhỏ hơn rất nhiều), ffmpeg overlay lại tại toạ độ hộp.
 *  4. ffmpeg chạy toàn GPU khi được (cuvid giải mã + cắt reframe ngay ở decoder → scale_cuda → overlay_cuda → h264_nvenc nhận
 *     thẳng khung CUDA); tự rơi về CPU khi CUDA lỗi hoặc job không hợp (codec lạ, fps lệch, reframe lộ viền). Cờ --cpu để ép CPU.
 *  5. HyperFrames: --browser-gpu (Chrome dùng GPU thật, log "browserGpuMode: hardware"). --gpu (mã hoá GPU) vô nghĩa với
 *     png-sequence. Đã đo số worker 3/6/12 và --quality draft: thời gian chụp không đổi (≈ 0,1–0,26 s/khung toàn hệ thống),
 *     nút thắt là chụp + nén PNG alpha từng khung của Chrome, GPU chỉ tải ~8% → hộp cắt (mục 3) là đòn bẩy chính.
 *
 * ĐO ĐẠC (job demo 20 s 9:16, 600 khung/277 khác nhau, có scene + image; RTX 3050 / i5-10400F):
 *   | Bước                                   | Trước                     | Sau                          |
 *   | webm VP9 alpha, toàn 600 khung (vòng 1)| 114 s tổng                | —                            |
 *   | HyperFrames chụp 277 khung             | 45–48 s (worker 3/6/12 và --quality draft: như nhau) | 43 s |
 *   | chụp thu về hộp cắt (demo không scene) | 21,8 s                    | 18,5 s (-15%)                |
 *   | ffmpeg ghép + mã hoá (CPU → GPU)       | 11,4–15,7 s               | 5,2–6,6 s                    |
 *   | Tổng, cache trống                      | 59–69 s                   | 50 s                         |
 *   | Tổng, cache đủ (render lại không đổi)  | 11,9–15,7 s               | 5,2 s                        |
 *   nvidia-smi (1 s/mẫu, có thể lẫn tải của tiến trình khác): ffmpeg GPU trung bình GPU ≈ 78%, encoder ≈ 30%, decoder ≈ 10%;
 *   ffmpeg CPU ≈ 62% / 18% / 0%. Khâu chụp của HyperFrames: GPU 8–81% tuỳ lần đo; thời gian không đổi theo số worker.
 *   Thử chia overlay thành 6 nhóm hộp cắt: 121 s tổng (chậm hơn) vì mỗi nhóm thêm ~10 s khởi động và một luồng overlay → MAX_GROUPS = 1.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runMediaCommand } from "../studio/media/media-runner.js";
import { gpuEncodeAvailable } from "../studio/render/video-tools.js";
import { log } from "../studio/utils/logger.js";
import { resolveMediaBinary, toAsciiShortPath } from "../studio/utils/media-binary.js";
import { jobDir } from "./jobs.js";
import { loadProject, type Project } from "./project-schema.js";
import { effectiveMoves, effectiveShifts, hasClipTransforms, staticCovers } from "./camera.js";
import { INK, libplaceboMoves, scaleOverlayMoves } from "./video-moves.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNTIME = join(REPO, "scripts", "editor", "public", "overlay-runtime.js");
const HF_VERSION = "0.6.94";
const GRID = 120; // px: làm tròn hộp cắt ra lưới này (cache ổn định, kích thước chẵn)
const MAX_GROUPS = 1; // đo thực tế: mỗi nhóm thêm ~10 s khởi động HyperFrames + 1 luồng overlay ffmpeg; nhiều nhóm chậm hơn 1 nhóm (xem bảng đo)

export interface RenderOptions {
  /** Giữ thư mục tạm (gỡ lỗi). */
  keepTmp?: boolean;
  /** Chỉ render các khung overlay còn thiếu vào cache rồi dừng. */
  overlayOnly?: boolean;
  /** Số worker Chrome của HyperFrames (mặc định env TH_WORKERS hoặc 6). */
  workers?: number;
  /** Bỏ qua cache khung (render lại tất cả). */
  noCache?: boolean;
  /** Ép ffmpeg chạy hoàn toàn trên CPU (mặc định thử chuỗi CUDA trước, lỗi thì tự rơi về CPU). */
  cpu?: boolean;
  /** Audio đã trộn (mix.wav) dùng thay source.audio. */
  audioFile?: string;
}

type Box = [number, number, number, number]; // x0,y0,x1,y1 (px canvas)
type Runtime = {
  frameKey: (p: Project, t: number, fps: number) => string;
  frameBox: (p: Project, t: number) => Box | null;
};

function composition(p: Project, times: number[], fps: number, box: Box): string {
  const json = JSON.stringify(p).replace(/</g, "\\u003c");
  const { width: W, height: H } = p;
  const bw = box[2] - box[0], bh = box[3] - box[1];
  const dur = times.length / fps;
  return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>th-overlay</title>
<style>html,body{margin:0;padding:0;width:${bw}px;height:${bh}px;overflow:hidden;background:transparent}
#root{position:relative;width:${bw}px;height:${bh}px;background:transparent;overflow:hidden}
#ov{position:absolute;left:${-box[0]}px;top:${-box[1]}px;width:${W}px;height:${H}px}</style></head>
<body>
<div id="root" class="clip" data-composition-id="main" data-start="0" data-duration="${dur.toFixed(4)}" data-width="${bw}" data-height="${bh}"><div id="ov"></div></div>
<script>
window.__TH_PROJECT__ = ${json};
var TIMES = ${JSON.stringify(times)}, FPS = ${fps}, ov = null;
function at(sec){ var i = Math.round((Number(sec) || 0) * FPS); return TIMES[Math.max(0, Math.min(TIMES.length - 1, i))]; }
// Timeline chỉ được đăng ký SAU khi font + iframe cảnh đã nạp xong: HyperFrames đợi timeline "main" trước khi chụp khung đầu.
import("./overlay-runtime.js").then(function(m){
  ov = m.mountOverlay(document.getElementById("ov"), window.__TH_PROJECT__, { assetBase: "./", canvasW: ${W}, canvasH: ${H} });
  return ov.ready().then(function(){
    ov.seek(TIMES[0]);
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = {
      pause: function(){}, seek: function(t){ ov.seek(at(t)); },
      duration: function(){ return ${dur.toFixed(4)}; }, totalDuration: function(){ return ${dur.toFixed(4)}; }, paused: function(){ return true; }
    };
  });
});
</script></body></html>`;
}

function hfEnv() {
  const ffmpegBin = toAsciiShortPath(resolveMediaBinary("ffmpeg"));
  const ffprobeBin = toAsciiShortPath(resolveMediaBinary("ffprobe"));
  const sep = process.platform === "win32" ? ";" : ":";
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") || "PATH";
  const extra = [ffmpegBin, ffprobeBin].filter((b) => existsSync(b)).map((b) => dirname(b));
  return {
    ...process.env,
    [pathKey]: [...extra, process.env[pathKey] || ""].join(sep),
    FFMPEG_PATH: ffmpegBin, FFPROBE_PATH: ffprobeBin,
    HYPERFRAMES_FFMPEG_PATH: ffmpegBin, HYPERFRAMES_FFPROBE_PATH: ffprobeBin,
  };
}

function runHyperframes(dir: string, outDir: string, fps: number, workers: number): Promise<void> {
  const npxCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  const useNode = existsSync(npxCli);
  const runner = useNode ? process.execPath : process.platform === "win32" ? "npx.cmd" : "npx";
  const args = [
    ...(useNode ? [npxCli, "-y"] : ["-y"]),
    `hyperframes@${HF_VERSION}`, "render", toAsciiShortPath(dir),
    "--composition", "index.html", "--format", "png-sequence", "--output", toAsciiShortPath(outDir),
    "--fps", String(fps), "--quality", process.env.TH_HF_QUALITY || "standard", `--workers=${workers}`, "--quiet",
  ];
  if (process.env.S6X_GPU !== "0") args.push("--browser-gpu");
  return new Promise((resolve, reject) => {
    const proc = spawn(runner, args, { stdio: ["ignore", "inherit", "inherit"], shell: runner.endsWith(".cmd"), env: hfEnv() });
    proc.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`hyperframes render lỗi (exit ${c})`))));
    proc.on("error", reject);
  });
}

async function probe(file: string): Promise<{ w: number; h: number; dur: number; hasAudio: boolean; codec: string; fps: number }> {
  const j = JSON.parse(await runMediaCommand("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,r_frame_rate,width,height:format=duration", "-of", "json", file]));
  const v = (j.streams ?? []).find((s: { codec_type: string }) => s.codec_type === "video");
  if (!v) throw new Error(`Không có luồng video trong ${file}`);
  const [fn, fd] = String(v.r_frame_rate ?? "0/1").split("/").map(Number);
  return { codec: v.codec_name as string, fps: fn / (fd || 1), w: v.width, h: v.height, dur: parseFloat(j.format?.duration ?? "0"), hasAudio: (j.streams ?? []).some((s: { codec_type: string }) => s.codec_type === "audio") };
}

/** Video nguồn → nhãn [bg] đã reframe (CPU): phủ kín canvas (cover) × scale, lệch x/y theo % canvas, đặt lên nền đen. */
export function backgroundFilter(p: Project, vw: number, vh: number, dur: number): string {
  const { width: W, height: H, fps } = p;
  const vt = p.videoTransform;
  const cs = Math.max(W / vw, H / vh) * Math.max(0.05, vt.scale || 1);
  const dw = Math.round((vw * cs) / 2) * 2, dh = Math.round((vh * cs) / 2) * 2;
  const x = Math.round((W - dw) / 2 + (vt.x / 100) * W), y = Math.round((H - dh) / 2 + (vt.y / 100) * H);
  return `color=c=${INK}:s=${W}x${H}:r=${fps}:d=${dur.toFixed(3)}[base];[0:v]fps=${fps},scale=${dw}:${dh}:flags=lanczos,setsar=1[v0];[base][v0]overlay=${x}:${y}:shortest=1[bg]`;
}

/**
 * Chuỗi ffmpeg toàn GPU: cuvid giải mã + cắt đúng cửa sổ reframe ngay ở decoder (-crop, đơn vị điểm ảnh nguồn),
 * scale_cuda → khung canvas. Trả null (→ CPU) khi: codec không phải h264/hevc, fps nguồn ≠ fps project,
 * hoặc cửa sổ reframe lộ ra ngoài video (cần nền đen).
 */
export function gpuBackgroundArgs(p: Project, info: { w: number; h: number; codec: string; fps: number }, srcVideo: string):
  { input: string[]; bg: string } | null {
  const dec = info.codec === "h264" ? "h264_cuvid" : info.codec === "hevc" ? "hevc_cuvid" : null;
  if (!dec || Math.abs(info.fps - p.fps) > 0.01) return null;
  const { width: W, height: H } = p, vt = p.videoTransform;
  const s = Math.max(W / info.w, H / info.h) * Math.max(0.05, vt.scale || 1); // điểm ảnh hiển thị / điểm ảnh nguồn
  const dw = info.w * s, dh = info.h * s;
  const left = (dw - W) / 2 - (vt.x / 100) * W, top = (dh - H) / 2 - (vt.y / 100) * H;
  const ev = (v: number) => Math.round(v / 2) * 2;
  const L = ev(left / s), T = ev(top / s), SW = ev(W / s), SH = ev(H / s);
  if (L < 0 || T < 0 || L + SW > info.w + 1 || T + SH > info.h + 1) return null;
  const R = Math.max(0, info.w - L - SW), B = Math.max(0, info.h - T - SH);
  return {
    input: ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda", "-c:v", dec, "-crop", `${T}x${B}x${L}x${R}`, "-i", srcVideo],
    bg: `[0:v]scale_cuda=${W}:${H}:interp_algo=lanczos:format=yuv420p[b0]`,
  };
}

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const fileSig = (f: string) => (existsSync(f) ? `${statSync(f).size}:${Math.round(statSync(f).mtimeMs)}` : "none");

/** Cây thư mục template: gộp (tên:kích thước:mtime) để cache khung biết khi template đổi. */
function dirSig(dir: string): string {
  if (!existsSync(dir)) return "none";
  const out: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name), rel + e.name + "/");
      else out.push(rel + e.name + ":" + fileSig(join(d, e.name)));
    }
  };
  walk(dir, "");
  return sha(out.sort().join("|"));
}

export interface FrameGroup {
  box: Box; // đã làm tròn lưới, chẵn
  /** hash theo khung (chỉ khung thuộc nhóm), "" = khung không thuộc nhóm */
  hashes: string[];
  /** hash -> thời điểm (s) của khung đầu tiên mang hash đó */
  firstTime: Map<string, number>;
}
export interface FramePlan {
  nFrames: number;
  groups: FrameGroup[];
}

const area = (b: Box) => (b[2] - b[0]) * (b[3] - b[1]);
const union = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

/** Tính chữ ký + hộp cắt từng khung (thuần, nhanh), gom khung vào ≤ MAX_GROUPS nhóm theo hộp. Xuất ra để test. */
export function planFrames(p: Project, dur: number, rt: Runtime, salt: string): FramePlan {
  const nFrames = Math.max(1, Math.round(dur * p.fps));
  const { width: W, height: H } = p;
  const snap = (b: Box): Box => [
    Math.max(0, Math.floor(b[0] / GRID) * GRID), Math.max(0, Math.floor(b[1] / GRID) * GRID),
    Math.min(W, Math.ceil(b[2] / GRID) * GRID), Math.min(H, Math.ceil(b[3] / GRID) * GRID),
  ];
  const keys: string[] = new Array(nFrames);
  const boxes: (Box | null)[] = new Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const t = f / p.fps;
    keys[f] = rt.frameKey(p, t, p.fps);
    const b = keys[f] === "" ? null : rt.frameBox(p, t);
    boxes[f] = b ? (process.env.TH_NO_CROP ? [0, 0, W, H] : snap(b)) : null;
  }
  // nhóm theo hộp đã làm tròn, rồi gộp dần cặp tốn thêm ít diện tích nhất cho tới khi ≤ MAX_GROUPS
  let gb = new Map<string, Box>();
  for (const b of boxes) if (b) gb.set(b.join(","), b);
  const list: Box[] = [...gb.values()];
  const remap = new Map<string, number>();
  while (list.length > MAX_GROUPS) {
    let bi = 0, bj = 1, best = Infinity;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const cost = area(union(list[i], list[j])) - area(list[i]) - area(list[j]);
      if (cost < best) { best = cost; bi = i; bj = j; }
    }
    list[bi] = union(list[bi], list[bj]);
    list.splice(bj, 1);
  }
  const groups: FrameGroup[] = list.map((box) => ({ box, hashes: new Array(nFrames).fill(""), firstTime: new Map() }));
  for (let f = 0; f < nFrames; f++) {
    const b = boxes[f];
    if (!b) continue;
    const k = b.join(",");
    let gi = remap.get(k);
    if (gi === undefined) {
      gi = list.findIndex((g) => b[0] >= g[0] && b[1] >= g[1] && b[2] <= g[2] && b[3] <= g[3]);
      // nhiều hộp có thể nằm trong nhiều nhóm: chọn nhóm nhỏ nhất chứa được
      let bestA = Infinity;
      list.forEach((g, i) => { if (b[0] >= g[0] && b[1] >= g[1] && b[2] <= g[2] && b[3] <= g[3] && area(g) < bestA) { bestA = area(g); gi = i; } });
      remap.set(k, gi as number);
    }
    const g = groups[gi as number];
    const h = sha(salt + "|" + g.box.join(",") + "|" + keys[f]).slice(0, 20);
    g.hashes[f] = h;
    if (!g.firstTime.has(h)) g.firstTime.set(h, f / p.fps);
  }
  return { nFrames, groups };
}

/**
 * Dọn .overlay-cache theo LRU: giới hạn TH_OVERLAY_CACHE_MB (mặc định 2048). Khung đang dùng trong lần render này được đánh dấu
 * mới (mtime = bây giờ) và không bao giờ bị xoá; xoá các khung cũ nhất trước. Trả số MB đã dọn.
 */
export function pruneOverlayCache(cacheDir: string, used: Set<string>, limitMB = Number(process.env.TH_OVERLAY_CACHE_MB) || 2048): number {
  const now = new Date();
  const files: { f: string; size: number; mtime: number; keep: boolean }[] = [];
  let total = 0;
  for (const name of readdirSync(cacheDir)) {
    if (!name.endsWith(".png") || name.startsWith("blank-")) continue;
    const f = join(cacheDir, name), st = statSync(f);
    const keep = used.has(name.slice(0, -4));
    if (keep) utimesSync(f, now, now);
    files.push({ f, size: st.size, mtime: keep ? now.getTime() : st.mtimeMs, keep });
    total += st.size;
  }
  const limit = limitMB * 1024 * 1024;
  let freed = 0;
  if (total > limit) {
    for (const x of files.filter((y) => !y.keep).sort((a, b) => a.mtime - b.mtime)) {
      if (total - freed <= limit) break;
      try { unlinkSync(x.f); freed += x.size; } catch { /* đang bị khoá: bỏ qua */ }
    }
  }
  return freed / 1024 / 1024;
}

export async function renderProject(job: string, opt: RenderOptions = {}): Promise<string> {
  const dir = jobDir(job);
  const p = await loadProject(join(dir, "project.json"));
  const srcVideo = join(dir, p.source.video);
  if (!existsSync(srcVideo)) throw new Error(`Thiếu ${srcVideo}. Chạy: npm run th:cut -- ${job}`);
  const srcAudio = opt.audioFile ?? (p.source.audio ? join(dir, p.source.audio) : null);
  if (srcAudio && !existsSync(srcAudio)) throw new Error(`Thiếu ${srcAudio}. Chạy: npm run th:audio -- ${job}`);
  const info = await probe(srcVideo);
  const dur = p.duration > 0 ? Math.min(p.duration, info.dur || p.duration) : info.dur;
  const t0 = Date.now();

  const rt = (await import(pathToFileURL(RUNTIME).href)) as Runtime;
  const layers = p.tracks.filter((t) => !t.hidden).flatMap((t) => t.layers);
  const sceneIds = [...new Set(layers.filter((l) => l.type === "scene" && l.templateId).map((l) => l.templateId as string))].sort();
  const imgs = [...new Set(layers.filter((l) => (l.type === "image" || l.type === "asset") && l.src).map((l) => l.src as string))].sort();
  const salt = sha([
    HF_VERSION, p.width, p.height, p.fps, p.aspect, sha(readFileSync(RUNTIME, "utf8")), sha(readFileSync(join(dirname(RUNTIME), "clips-core.js"), "utf8")),
    ...sceneIds.map((id) => id + ":" + dirSig(join(REPO, "templates", id))),
    ...imgs.map((i) => i + ":" + fileSig(join(REPO, i))),
    ...readdirSync(join(REPO, "assets", "fonts")).map((f) => f + fileSig(join(REPO, "assets", "fonts", f))),
  ].join("|"));

  const cacheDir = join(dir, ".overlay-cache");
  mkdirSync(cacheDir, { recursive: true });
  const plan = planFrames(p, dur, rt, salt);
  const cached = (h: string) => !opt.noCache && existsSync(join(cacheDir, h + ".png"));
  let total = 0, todo = 0;
  const missingOf = plan.groups.map((g) => {
    const m = [...g.firstTime.entries()].filter(([h]) => !cached(h)).sort((a, b) => a[1] - b[1]);
    total += g.firstTime.size; todo += m.length;
    return m;
  });
  log.info(`Khung: ${plan.nFrames} | khác nhau: ${total} | cần render: ${todo} | nhóm hộp cắt: ${plan.groups.map((g) => `${g.box[2] - g.box[0]}x${g.box[3] - g.box[1]}@${g.box[0]},${g.box[1]}`).join(" ") || "—"}`);

  if (todo) {
    const tmp = mkdtempSync(join(tmpdir(), "th-render-"));
    try {
      copyFileSync(RUNTIME, join(tmp, "overlay-runtime.js"));
      copyFileSync(join(dirname(RUNTIME), "clips-core.js"), join(tmp, "clips-core.js")); // overlay-runtime import clips-core (videoState theo clip)
      mkdirSync(join(tmp, "assets", "fonts"), { recursive: true });
      for (const f of readdirSync(join(REPO, "assets", "fonts"))) copyFileSync(join(REPO, "assets", "fonts", f), join(tmp, "assets", "fonts", f));
      for (const src of imgs) {
        const from = join(REPO, src);
        if (existsSync(from)) { mkdirSync(dirname(join(tmp, src)), { recursive: true }); copyFileSync(from, join(tmp, src)); }
        else log.warn(`Không thấy ảnh ${src}`);
      }
      for (const id of sceneIds) {
        const from = join(REPO, "templates", id);
        if (existsSync(from)) cpSync(from, join(tmp, "templates", id), { recursive: true });
        else log.warn(`Không thấy template ${id}`);
      }
      const workers = opt.workers ?? (Number(process.env.TH_WORKERS) || 6);
      for (let gi = 0; gi < plan.groups.length; gi++) {
        const missing = missingOf[gi];
        if (!missing.length) continue;
        const g = plan.groups[gi];
        writeFileSync(join(tmp, "index.html"), composition(p, missing.map(([, t]) => t), p.fps, g.box), "utf8");
        const outDir = join(tmp, `frames-${gi}`);
        log.info(`Nhóm ${gi + 1}/${plan.groups.length}: render ${missing.length} khung ${g.box[2] - g.box[0]}x${g.box[3] - g.box[1]} (HyperFrames ${HF_VERSION}, ${workers} worker)`);
        await runHyperframes(tmp, outDir, p.fps, workers);
        const files = readdirSync(outDir).filter((f) => f.toLowerCase().endsWith(".png")).sort();
        if (files.length < missing.length) throw new Error(`HyperFrames chỉ trả ${files.length}/${missing.length} khung PNG`);
        missing.forEach(([h], i) => copyFileSync(join(outDir, files[i]), join(cacheDir, h + ".png")));
      }
    } finally {
      if (!opt.keepTmp) rmSync(tmp, { recursive: true, force: true });
    }
  }
  const tOverlay = (Date.now() - t0) / 1000;
  log.info(`Overlay xong sau ${tOverlay.toFixed(1)} s`);
  if (opt.overlayOnly) return cacheDir;

  // mỗi nhóm một dòng thời gian concat đầy đủ: khung thuộc nhóm → PNG, còn lại → PNG trong suốt cùng cỡ
  const q = (f: string) => f.replace(/\\/g, "/").replace(/'/g, "'\\''");
  const lists: string[] = [];
  for (let gi = 0; gi < plan.groups.length; gi++) {
    const g = plan.groups[gi];
    const bw = g.box[2] - g.box[0], bh = g.box[3] - g.box[1];
    const blank = join(cacheDir, `blank-${bw}x${bh}.png`);
    if (!existsSync(blank)) {
      await runMediaCommand("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=black@0.0:s=${bw}x${bh},format=rgba`, "-frames:v", "1", blank]);
    }
    const lines: string[] = [];
    let i = 0, lastFile = blank;
    while (i < plan.nFrames) {
      let j = i;
      while (j < plan.nFrames && g.hashes[j] === g.hashes[i]) j++;
      lastFile = g.hashes[i] ? join(cacheDir, g.hashes[i] + ".png") : blank;
      lines.push(`file '${q(lastFile)}'`, `duration ${((j - i) / p.fps).toFixed(6)}`);
      i = j;
    }
    lines.push(`file '${q(lastFile)}'`); // quirk của concat demuxer: mục cuối phải lặp lại
    const lf = join(cacheDir, `concat-g${gi}.txt`);
    writeFileSync(lf, lines.join("\n"), "utf8");
    lists.push(lf);
  }
  const n = lists.length;
  const concatIn = lists.flatMap((lf) => ["-f", "concat", "-safe", "0", "-i", lf]);

  const partial = join(dir, "video.partial.mp4");
  const audioIn = srcAudio ?? srcVideo;
  const hasAudio = !!srcAudio || info.hasAudio;
  const audioMap = hasAudio ? ["-map", `${n + 1}:a:0`, "-c:a", "aac", "-b:a", "192k"] : [];
  const tail = ["-t", dur.toFixed(3), "-movflags", "+faststart", partial];
  const tFf = Date.now();
  const nvenc = ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "18", "-b:v", "0"];
  const gpu = await gpuEncodeAvailable();
  const effMoves = effectiveMoves(p), effShifts = effectiveShifts(p);
  // khung động = có move/shift hiệu lực, khung riêng theo clip, hoặc khung tĩnh không phủ kín canvas (cần nền INK) → libplacebo/pos_* (GPU) hoặc scale+overlay (CPU)
  const hasMoves = effMoves.some((m) => m.mode !== "pip") || effShifts.length > 0 || hasClipTransforms(p) || !staticCovers(p, info);
  if (effMoves.some((m) => m.mode === "pip")) log.warn("videoMoves mode pip chưa hỗ trợ khi render (ưu tiên thấp): đoạn pip hiển thị video tĩnh.");
  if (p.tracks.some((t) => t.belowVideo && t.layers.length)) log.warn("Track belowVideo chưa hỗ trợ khi render (chỉ cần với pip): bỏ qua.");
  const gpuPlan = !hasMoves && gpu && !opt.cpu ? gpuBackgroundArgs(p, info, srcVideo) : null;
  let mode = "CPU";
  if (hasMoves) {
    // Chuỗi zoom/kenburns: MỘT lần ffmpeg cho cả video. libplacebo (Vulkan GPU, tham số theo t) → overlay_cuda → NVENC;
    // lỗi thì rơi về zoompan CPU. Biểu thức dài nên đưa vào file (-/filter_complex).
    const fcFile = join(cacheDir, "filter-moves.txt");
    const tryRun = async (label: string, head: string, cuda: boolean) => {
      const parts = [head];
      if (cuda) parts.push("[b0s]hwupload_cuda[b0]"); else parts.push("[b0s]null[b0]");
      plan.groups.forEach((g, i) => {
        if (cuda) {
          parts.push(`[${i + 1}:v]fps=${p.fps},format=yuva420p,hwupload_cuda[o${i + 1}]`);
          parts.push(`[b${i}][o${i + 1}]overlay_cuda=${g.box[0]}:${g.box[1]}:eof_action=pass[b${i + 1}]`);
        } else {
          parts.push(`[${i + 1}:v]fps=${p.fps},format=rgba[o${i + 1}]`);
          parts.push(`[b${i}][o${i + 1}]overlay=${g.box[0]}:${g.box[1]}:format=auto:shortest=1[b${i + 1}]`);
        }
      });
      const fg = parts.join(";").replace(new RegExp(`\\[b${n}\\]$`), cuda ? "[v]" : "[vv]");
      writeFileSync(fcFile, cuda ? fg : fg + ";[vv]format=yuv420p[v]", "utf8");
      const encode = cuda || gpu ? nvenc : ["-c:v", "libx264", "-preset", "medium", "-crf", "18"];
      await runMediaCommand("ffmpeg", ["-y", "-v", "error", "-i", srcVideo, ...concatIn, "-i", audioIn, "-/filter_complex", fcFile, "-map", "[v]", ...audioMap,
        ...encode, ...(cuda ? [] : ["-pix_fmt", "yuv420p"]), "-r", String(p.fps), ...tail]);
      mode = label;
    };
    if (gpu && !opt.cpu) {
      // libplacebo (Vulkan) + overlay_cuda cùng lúc đôi khi lỗi ngữ cảnh CUDA → dùng libplacebo (GPU) + overlay CPU + NVENC cho ổn định
      try { await tryRun(`GPU (libplacebo Vulkan + NVENC), ${effMoves.length} chuyển động + ${effShifts.length} dịch${hasClipTransforms(p) ? " + khung riêng theo clip" : ""}`, libplaceboMoves(p, info), false); }
      catch (e) { log.warn(`libplacebo lỗi, rơi về zoompan CPU: ${String((e as Error).message).slice(0, 300)}`); rmSync(partial, { force: true }); }
    }
    if (mode === "CPU") await tryRun(`CPU (scale+overlay), ${effMoves.length} chuyển động + ${effShifts.length} dịch`, scaleOverlayMoves(p, info), false);
  } else if (gpuPlan) {
    try {
      const parts = [gpuPlan.bg];
      plan.groups.forEach((g, i) => {
        parts.push(`[${i + 1}:v]fps=${p.fps},format=yuva420p,hwupload_cuda[o${i + 1}]`);
        parts.push(`[b${i}][o${i + 1}]overlay_cuda=${g.box[0]}:${g.box[1]}:eof_action=pass[b${i + 1}]`);
      });
      const filter = parts.join(";").replace(new RegExp(`\\[b${n}\\]$`), "[v]").replace(/\[b(\d+)\]$/, "[v]");
      await runMediaCommand("ffmpeg", ["-y", "-v", "error", ...gpuPlan.input, ...concatIn, "-i", audioIn,
        "-filter_complex", filter, "-map", "[v]", ...audioMap, ...nvenc, "-r", String(p.fps), ...tail]);
      mode = "GPU (cuvid + scale_cuda + overlay_cuda + NVENC)";
    } catch (e) {
      log.warn(`Chuỗi CUDA lỗi, rơi về CPU: ${String((e as Error).message).slice(0, 300)}`);
      rmSync(partial, { force: true });
    }
  } else if (!opt.cpu) log.warn("Không dùng được chuỗi CUDA cho job này (codec/fps/reframe lộ viền/NVENC) → CPU");
  if (mode === "CPU") {
    const parts = [backgroundFilter(p, info.w, info.h, dur)];
    let prev = "bg";
    plan.groups.forEach((g, i) => {
      parts.push(`[${i + 1}:v]fps=${p.fps},format=rgba[o${i + 1}]`);
      parts.push(`[${prev}][o${i + 1}]overlay=${g.box[0]}:${g.box[1]}:format=auto:shortest=1[c${i + 1}]`);
      prev = `c${i + 1}`;
    });
    parts.push(`[${prev}]format=yuv420p[v]`);
    const encode = gpu ? nvenc : ["-c:v", "libx264", "-preset", "medium", "-crf", "18"];
    await runMediaCommand("ffmpeg", ["-y", "-v", "error", "-i", srcVideo, ...concatIn, "-i", audioIn,
      "-filter_complex", parts.join(";"), "-map", "[v]", ...audioMap, ...encode, "-pix_fmt", "yuv420p", "-r", String(p.fps), ...tail]);
  }
  log.info(`ffmpeg [${mode}] xong sau ${((Date.now() - tFf) / 1000).toFixed(1)} s`);

  const out = join(dir, "video.mp4");
  if (existsSync(out)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const arch = join(dir, `video._archive-${stamp}.mp4`);
    renameSync(out, arch);
    log.info(`Đã lưu bản cũ: ${arch}`);
  }
  renameSync(partial, out);
  const used = new Set<string>();
  for (const g of plan.groups) for (const h of g.hashes) if (h) used.add(h);
  const freed = pruneOverlayCache(cacheDir, used);
  if (freed > 0) log.info(`Dọn cache overlay: đã xoá ${freed.toFixed(0)} MB (giới hạn ${Number(process.env.TH_OVERLAY_CACHE_MB) || 2048} MB)`);
  log.info(`Tổng thời gian: ${((Date.now() - t0) / 1000).toFixed(1)} s (overlay ${tOverlay.toFixed(1)} s)`);
  return out;
}
