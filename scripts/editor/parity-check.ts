/**
 * Kiểm tra khớp editor ↔ render: `npx tsx scripts/editor/parity-check.ts <job> [--at 2.5,7.5,11.5] [--threshold 8]`
 *
 * Với mỗi thời điểm t:
 *  1. Chụp overlay từ chính trang editor (parity.html = overlay-runtime của editor, không video) bằng Chrome headless, nền trong suốt.
 *  2. Dựng "khung kỳ vọng" = nền (cut.mp4 + videoTransform, cùng bộ lọc với th:render) + ảnh overlay đó.
 *  3. Trích khung thật từ output/<job>/video.mp4 (kết quả th:render).
 *  4. Đo bố cục chữ (parity.html dump DOM): layer căn giữa phải đối xứng quanh tâm layer (≤ 2% chiều rộng), khe giữa các từ > 0.15 em.
 *  5. So sai khác trung bình |R,G,B| (thang 0–255) CHỈ trong vùng overlay có alpha > 10.
 * NGƯỠNG mặc định 8: nén h264 (NVENC cq 18) + khử răng cưa khác nhau giữa Chrome hệ thống và Chrome của HyperFrames
 * thường cho 1–4; vượt 8 nghĩa là khác về bố cục/màu/font. Ảnh đối chiếu lưu ở output/<job>/qa/parity/.
 * Thoát mã 1 nếu có khung vượt ngưỡng.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { backgroundFilter } from "../../src/talking-head/render-overlay.js";
import { loadProject } from "../../src/talking-head/project-schema.js";
import { jobDir } from "../../src/talking-head/jobs.js";
import { resolveMediaBinary } from "../../src/studio/utils/media-binary.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const job = args.find((a) => !a.startsWith("--"));
const flag = (n: string) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : undefined; };
if (!job) { console.error("Cú pháp: parity-check.ts <job> [--at 2.5,7.5] [--threshold 8]"); process.exit(1); }
const THRESHOLD = Number(flag("threshold") ?? 8);
const FFMPEG = resolveMediaBinary("ffmpeg");

function chromePath(): string {
  const c = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"];
  const f = c.find((x) => x && existsSync(x));
  if (!f) throw new Error("Không tìm thấy Chrome/Edge (đặt CHROME_PATH)");
  return f;
}

function ffRaw(a: string[]): Promise<Buffer> {
  return new Promise((res, rej) => {
    const p = spawn(FFMPEG, ["-v", "error", ...a], { windowsHide: true });
    const out: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (c) => (c === 0 ? res(Buffer.concat(out)) : rej(new Error("ffmpeg: " + err.slice(-400)))));
  });
}

async function startServer(): Promise<{ url: string; stop: () => void }> {
  const proc = spawn(process.execPath, ["--import", "tsx", join(REPO, "scripts", "editor", "server.ts"), job!, "--no-open", "--port", "4365"], { cwd: REPO, windowsHide: true });
  const url = await new Promise<string>((res, rej) => {
    const to = setTimeout(() => rej(new Error("Server editor không khởi động")), 30000);
    proc.stdout.on("data", (d) => { const m = /(http:\/\/localhost:\d+)/.exec(String(d)); if (m) { clearTimeout(to); res(m[1]); } });
    proc.stderr.on("data", (d) => process.stderr.write(d));
    proc.on("exit", (c) => rej(new Error("Server thoát sớm: " + c)));
  });
  return { url, stop: () => proc.kill() };
}

const dir = jobDir(job);
const project = await loadProject(join(dir, "project.json"));
const out = join(dir, "qa", "parity");
mkdirSync(out, { recursive: true });
const times = (flag("at") ?? "2.5,7.5,11.5").split(",").map(Number).filter((n) => Number.isFinite(n));
const { width: W, height: H } = project;
// videoState dùng chung với editor (overlay-runtime): khung kỳ vọng của đoạn zoom/kenburns tính bằng đúng công thức đó
const rt = (await import(pathToFileURL(join(REPO, "scripts", "editor", "public", "overlay-runtime.js")).href)) as {
  videoState: (p: unknown, t: number) => { scale: number; x: number; y: number; mode: string | null; pip: unknown };
};

const probe = JSON.parse(spawnSync(resolveMediaBinary("ffprobe"), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", join(dir, project.source.video)], { encoding: "utf8" }).stdout);
const vw = probe.streams[0].width, vh = probe.streams[0].height;

const srv = await startServer();
let layoutFail = false;
const results: { t: number; meanDiff: number; pctOver40: number; overlayPixels: number; pass: boolean }[] = [];
try {
  for (const t of times) {
    const tag = `t${t.toFixed(2).replace(".", "_")}`;
    const ovPng = join(out, `${tag}-editor-overlay.png`);
    const chrome = spawnSync(chromePath(), ["--headless=new", "--disable-gpu", `--screenshot=${ovPng}`, `--window-size=${W},${H}`, "--default-background-color=00000000",
      "--virtual-time-budget=8000", "--hide-scrollbars", `${srv.url}/parity.html?t=${t}`], { encoding: "utf8", windowsHide: true });
    if (!existsSync(ovPng)) throw new Error("Chrome không chụp được overlay: " + chrome.stderr.slice(-300));
    // bố cục chữ: dump DOM của parity.html rồi đọc <pre id="metrics">
    const dom = spawnSync(chromePath(), ["--headless=new", "--disable-gpu", "--dump-dom", "--virtual-time-budget=8000", `${srv.url}/parity.html?t=${t}`], { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).stdout;
    const mm = /<pre id="metrics">([^]*?)<\/pre>/.exec(dom);
    const metrics: { id: string; align: string; centerOffsetPct: number; minWordGapEm: number | null; maxWordGapEm: number }[] = mm
      ? JSON.parse(mm[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")) : [];
    for (const m of metrics) {
      const okC = m.align !== "center" || m.centerOffsetPct <= 2, okG = m.minWordGapEm === null || (m.minWordGapEm > 0.15 && m.maxWordGapEm < 0.45);
      console.log(`   layer ${m.id}: lệch tâm ${m.centerOffsetPct}% (căn ${m.align}, ngưỡng 2%) | khe từ ${m.minWordGapEm ?? "—"}…${m.maxWordGapEm} em (cần > 0.15 và < 0.45) ${okC && okG ? "ĐẠT" : "KHÔNG ĐẠT"}`);
      if (!(okC && okG)) layoutFail = true;
    }
    const videoPng = join(out, `${tag}-video.png`), expPng = join(out, `${tag}-expected.png`), diffPng = join(out, `${tag}-diff.png`);
    await ffRaw(["-y", "-ss", String(t), "-i", join(dir, "video.mp4"), "-frames:v", "1", videoPng]);
    const vs = rt.videoState(project, t);
    // khung kỳ vọng TỔNG QUÁT (tự do): đặt video đã scale vào canvas theo videoState tại t (khung riêng theo clip + moves + shifts), phần trống = ink #0C0C0C
    const cs = Math.max(W / vw, H / vh) * vs.scale, dw = vw * cs, dh = vh * cs;
    const px = W / 2 + (vs.x / 100) * W - dw / 2, py = H / 2 + (vs.y / 100) * H - dh / 2;
    const moving = true;
    const bg = `color=c=0x0C0C0C:s=${W}x${H}:d=1[bgb];[0:v]scale=${dw.toFixed(3)}:${dh.toFixed(3)}:flags=lanczos[sv];[bgb][sv]overlay=${px.toFixed(3)}:${py.toFixed(3)}[bg]`;
    await ffRaw(["-y", "-ss", String(t), "-i", join(dir, project.source.video), "-i", ovPng, "-filter_complex",
      `${bg};[bg][1:v]overlay=0:0:format=auto,format=rgb24[o]`, "-map", "[o]", "-frames:v", "1", expPng]);
    await ffRaw(["-y", "-i", videoPng, "-i", expPng, "-filter_complex", "[0][1]blend=all_mode=difference,eq=contrast=4:brightness=0", "-frames:v", "1", diffPng]);
    const rv = await ffRaw(["-i", videoPng, "-f", "rawvideo", "-pix_fmt", "rgba", "-"]);
    const re = await ffRaw(["-i", expPng, "-f", "rawvideo", "-pix_fmt", "rgba", "-"]);
    const ro = await ffRaw(["-i", ovPng, "-f", "rawvideo", "-pix_fmt", "rgba", "-"]);
    let sum = 0, n = 0, over = 0, coreSum = 0, coreN = 0;
    for (let i = 0; i < W * H; i++) {
      if (ro[i * 4 + 3] <= 10) continue;
      const d = (Math.abs(rv[i * 4] - re[i * 4]) + Math.abs(rv[i * 4 + 1] - re[i * 4 + 1]) + Math.abs(rv[i * 4 + 2] - re[i * 4 + 2])) / 3;
      sum += d; n++;
      if (d > 40) over++;
      if (ro[i * 4 + 3] >= 250) { coreSum += d; coreN++; } // lõi đặc của chữ/hình: không dính biên khử răng cưa
    }
    let fullSum = 0;
    if (moving) for (let i = 0; i < W * H; i++) fullSum += (Math.abs(rv[i * 4] - re[i * 4]) + Math.abs(rv[i * 4 + 1] - re[i * 4 + 1]) + Math.abs(rv[i * 4 + 2] - re[i * 4 + 2])) / 3;
    const fullDiff = moving ? fullSum / (W * H) : 0;
    const meanDiff = n ? sum / n : 0;
    const r = { t, meanDiff: +meanDiff.toFixed(2), pctOver40: n ? +((100 * over) / n).toFixed(2) : 0, overlayPixels: n, fullFrameDiff: moving ? +fullDiff.toFixed(2) : undefined, coreDiff: coreN ? +(coreSum / coreN).toFixed(2) : undefined, pass: (meanDiff <= THRESHOLD || (coreN > 0 && coreSum / coreN <= THRESHOLD / 2)) && (!moving || fullDiff <= THRESHOLD) };
    results.push(r);
    if (moving) console.log(`   khung video ${vs.mode ?? "tĩnh"}: scale ${vs.scale.toFixed(3)} x ${vs.x.toFixed(2)} y ${vs.y.toFixed(2)} — sai khác CẢ KHUNG so với khung kỳ vọng = ${fullDiff.toFixed(2)}`);
    console.log(`t=${t}s  vùng overlay=${n}px  sai khác TB=${r.meanDiff}${coreN ? ` lõi=${(coreSum / coreN).toFixed(2)}` : ""}  px>40=${r.pctOver40}%  ${r.pass ? "ĐẠT" : "KHÔNG ĐẠT"} (ngưỡng ${THRESHOLD})`);
    if (n === 0) console.log("   (không có layer nào hiển thị tại t này)");
  }
} finally {
  srv.stop();
}
writeFileSync(join(out, "report.json"), JSON.stringify({ job, threshold: THRESHOLD, results }, null, 2));
console.log(`Ảnh đối chiếu: ${out}`);
if (results.some((r) => !r.pass) || layoutFail) process.exit(1);
