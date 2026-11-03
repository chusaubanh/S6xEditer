/**
 * Editor Chế độ C: `npm run editor -- <job> [--no-open]`
 * Máy chủ node:http thuần, cổng 4317 (bận thì +1). Không phụ thuộc gói ngoài.
 */
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveMediaBinary } from "../../src/studio/utils/media-binary.js";
import { ProjectSchema, saveProject } from "../../src/talking-head/project-schema.js";
import { checkRevision } from "../../src/talking-head/revision.js";
import { jobDir } from "../../src/talking-head/jobs.js";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PUBLIC = join(REPO, "scripts", "editor", "public");
const args = process.argv.slice(2);
const noOpen = args.includes("--no-open");
const jobArg = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--port");
if (!jobArg) {
  console.error("Cú pháp: npm run editor -- <job> [--no-open]");
  process.exit(1);
}
const JOB = jobArg;
// job id có thể lồng ("<tài liệu>/<slug>", có dấu và khoảng trắng); không thấy trong output/ thì coi như đường dẫn thư mục job
const JOB_DIR = (() => {
  try {
    const d = jobDir(JOB);
    if (existsSync(d)) return d;
  } catch { /* id không hợp lệ: thử như đường dẫn */ }
  return resolve(JOB);
})();
const STUDIO_MODE = !existsSync(join(JOB_DIR, "project.json")) && existsSync(join(JOB_DIR, "studio", "project.json"));
const STUDIO_PROJECT_FILE = join(JOB_DIR, "studio", "project.json");
const STUDIO_EDITS_FILE = join(JOB_DIR, "studio", "studio-edits.json");
if (!existsSync(join(JOB_DIR, "project.json")) && !STUDIO_MODE) {
  console.error(`Không thấy ${join(JOB_DIR, "project.json")}. Chạy: npm run th:project -- ${JOB}`);
  process.exit(1);
}
const PROJECT_FILE = STUDIO_MODE ? STUDIO_PROJECT_FILE : join(JOB_DIR, "project.json");

/** Chuyển hợp đồng document-video sang dạng project mà Studio cũ hiểu được.
 * Không đụng vào project gốc; các chỉnh sửa của editor được lưu riêng trong studio-edits.json. */
async function editorProject(): Promise<any> {
  const raw = JSON.parse(await readFile(PROJECT_FILE, "utf8"));
  if (!STUDIO_MODE) return raw;
  const edits = existsSync(STUDIO_EDITS_FILE) ? JSON.parse(await readFile(STUDIO_EDITS_FILE, "utf8")) : {};
  const videos = Array.isArray(raw.assets?.video) ? raw.assets.video : [];
  const duration = videos.reduce((n: number, a: any) => Math.max(n, Number(a.startSec || 0) + Number(a.durationSec || 0)), 0);
  const layers = videos.map((a: any) => ({
    id: a.id, type: "image", src: STUDIO_MODE ? `/job/studio/${a.path}` : a.path, start: Number(a.startSec || 0), duration: Number(a.durationSec || 0),
    x: 0, y: 0, w: 1080, h: 1350, opacity: a.enabled === false ? 0 : 1,
    style: { fontFamily: "Be Vietnam Pro", fontSize: 64, fontWeight: 800, color: "#EDEDED", accentColor: "#C5A059", background: "transparent", align: "center", radius: 0, padding: 0, shadow: false },
  }));
  return {
    version: 1, job: raw.id, fps: 30, width: 1080, height: 1350, aspect: "4:5", duration,
    source: { video: "video.mp4", audio: "voice.mp3" }, revision: Number(edits.revision || 0),
    videoTransform: edits.videoTransform || { scale: 1, x: 0, y: 0 },
    tracks: [{ id: "t-scenes", kind: "graphics", name: "Cảnh Bài 3", hidden: false, locked: false, layers }],
    videoMoves: edits.videoMoves || [], videoShifts: edits.videoShifts || [],
    audio: edits.audio || { voice: { gainDb: 0, muted: false }, music: { duckDb: -12, attack: .15, release: .45 }, master: { lufs: -16, truePeak: -1.5 } },
  };
}

async function saveEditorProject(data: any) {
  if (!STUDIO_MODE) return saveProject(PROJECT_FILE, data);
  const prev = existsSync(STUDIO_EDITS_FILE) ? JSON.parse(await readFile(STUDIO_EDITS_FILE, "utf8")) : {};
  const next = { ...prev, version: 1, projectId: JSON.parse(await readFile(PROJECT_FILE, "utf8")).id,
    revision: Number(prev.revision || 0) + 1, videoTransform: data.videoTransform || prev.videoTransform,
    videoMoves: data.videoMoves || [], videoShifts: data.videoShifts || [], audio: data.audio || prev.audio,
    tracks: data.tracks || prev.tracks, updatedAt: new Date().toISOString() };
  await writeFile(STUDIO_EDITS_FILE, JSON.stringify(next, null, 2), "utf8");
  return next;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".wav": "audio/wav", ".mp3": "audio/mpeg",
  ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8",
};

/** Ghép đường dẫn con vào gốc, chặn thoát khỏi gốc (path traversal). */
function safeJoin(base: string, rel: string): string | null {
  let decoded: string;
  try { decoded = decodeURIComponent(rel); } catch { return null; }
  if (decoded.includes("\0")) return null;
  const full = normalize(join(base, decoded));
  const root = resolve(base);
  return full === root || full.startsWith(root + sep) ? full : null;
}

function send(res: ServerResponse, code: number, body: string | Buffer, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}
const sendJson = (res: ServerResponse, code: number, obj: unknown) =>
  send(res, code, JSON.stringify(obj), "application/json; charset=utf-8");

function serveFile(req: IncomingMessage, res: ServerResponse, file: string) {
  let st;
  try { st = statSync(file); } catch { return send(res, 404, "Không tìm thấy"); }
  if (!st.isFile()) return send(res, 404, "Không tìm thấy");
  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.range;
  const headers: Record<string, string | number> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m && (m[1] || m[2])) {
      let start = m[1] ? parseInt(m[1], 10) : Math.max(0, st.size - parseInt(m[2], 10));
      let end = m[1] && m[2] ? parseInt(m[2], 10) : st.size - 1;
      end = Math.min(end, st.size - 1);
      if (start > end || start >= st.size) {
        res.writeHead(416, { "Content-Range": `bytes */${st.size}` });
        return res.end();
      }
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${st.size}`, "Content-Length": end - start + 1 });
      if (req.method === "HEAD") return res.end();
      return createReadStream(file, { start, end }).pipe(res);
    }
  }
  res.writeHead(200, { ...headers, "Content-Length": st.size });
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

function listFonts() {
  const dir = join(REPO, "assets", "fonts");
  const fam = new Set<string>();
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!/\.(ttf|otf)$/i.test(f)) continue;
      fam.add(f.replace(/\.[^.]+$/, "").split("-")[0].replace(/([a-z])([A-Z])/g, "$1 $2"));
    }
  }
  return [...fam];
}

function meta() {
  let guideline: unknown = {};
  try { guideline = JSON.parse(readFileSync(join(REPO, "assets", "brand", "brand-guideline.json"), "utf8")); } catch { /* không có guideline */ }
  const g = guideline as { palette?: Record<string, string> };
  const tdir = join(REPO, "templates");
  const templates = existsSync(tdir) ? readdirSync(tdir).filter((d) => d.startsWith("frame-")).sort() : [];
  return {
    job: JOB,
    caps: ["clipTransform", "camera"], // máy chủ biết lưu videoClips[].transform và project.camera (máy chủ cũ không có → editor ẩn các tính năng này)
    palette: g.palette ?? {},
    fonts: listFonts(),
    presets: {
      in: ["rise", "drop", "left", "right", "pop", "bounce", "zoom", "soft", "stamp", "fade", "none"],
      out: ["fade", "shrink", "up", "down", "none"],
    },
    templates,
  };
}

/** Dạng sóng: PCM mono 8 kHz, gộp min/max mỗi 10 ms (80 mẫu) → [min0,max0,min1,max1,...] thang -100..100. Cache peaks.json. */
async function getPeaks(): Promise<string> {
  const proj = await editorProject();
  const src = join(JOB_DIR, proj.source?.audio ?? proj.source?.video ?? "");
  if (!existsSync(src)) throw new Error("Không thấy nguồn âm thanh " + src);
  const cache = join(JOB_DIR, "peaks.json");
  if (existsSync(cache) && statSync(cache).mtimeMs >= statSync(src).mtimeMs) return readFile(cache, "utf8");
  const peaks: number[] = [];
  await new Promise<void>((resolveP, reject) => {
    const p = spawn(resolveMediaBinary("ffmpeg"), ["-v", "error", "-i", src, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"], { windowsHide: true });
    let carry: Buffer | null = null, n = 0, mn = 32767, mx = -32768;
    p.stdout.on("data", (chunk: Buffer) => {
      const buf = carry ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      carry = usable < buf.length ? buf.subarray(usable) : null;
      for (let i = 0; i < usable; i += 2) {
        const v = buf.readInt16LE(i);
        if (v < mn) mn = v;
        if (v > mx) mx = v;
        if (++n === 80) { peaks.push(Math.round((mn / 32768) * 100), Math.round((mx / 32768) * 100)); n = 0; mn = 32767; mx = -32768; }
      }
    });
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolveP() : reject(new Error("ffmpeg lỗi khi tạo peaks (exit " + c + ")"))));
  });
  const out = JSON.stringify({ rate: 100, duration: peaks.length / 200, peaks });
  await writeFile(cache, out, "utf8");
  return out;
}

async function readBody(req: IncomingMessage, limit = 20 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > limit) throw new Error("Nội dung quá lớn");
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

type LibraryHandler = (req: IncomingMessage, res: ServerResponse, ctx: { job: string; jobDir: string; repoRoot: string }) => Promise<boolean>;
let libraryHandler: LibraryHandler | null | undefined;
/** api-library.ts do module âm thanh/preset cung cấp; chưa có thì bỏ qua (nạp động một lần). */
async function getLibraryHandler(): Promise<LibraryHandler | null> {
  if (libraryHandler !== undefined) return libraryHandler;
  try {
    const modPath = "./api-library.js"; // biến để tsc không đòi file khi chưa có
    const mod = await import(modPath);
    libraryHandler = (mod as { handleLibraryApi?: LibraryHandler }).handleLibraryApi ?? null;
  } catch (e) {
    console.warn("Chưa có scripts/editor/api-library.ts — thư viện preset/SFX/nhạc tắt: " + String((e as Error).message).slice(0, 120).replace(/\s+/g, " "));
    libraryHandler = null;
  }
  return libraryHandler;
}

/** GET /api/source: thông tin video gốc + proxy cho trình duyệt nguồn. Dữ liệu lấy từ project.source + thumbs/index.json + source-peaks.json. */
async function sourceInfo(): Promise<[number, unknown]> {
  const proj = JSON.parse(await readFile(PROJECT_FILE, "utf8")) as { fps?: number; source?: { proxy?: string } };
  const proxy = proj.source?.proxy;
  if (!proxy || !existsSync(join(JOB_DIR, proxy))) return [404, { error: "Job chưa có source.proxy (chạy th:proxy)" }];
  const tIdx = join(JOB_DIR, "thumbs", "index.json"), pk = join(JOB_DIR, "source-peaks.json");
  let duration = 0;
  if (existsSync(tIdx)) duration = JSON.parse(await readFile(tIdx, "utf8")).duration ?? 0;
  if (!duration && existsSync(pk)) duration = JSON.parse(await readFile(pk, "utf8")).duration ?? 0;
  const url = (f: string) => "/job/" + f.split("/").map(encodeURIComponent).join("/");
  return [200, {
    duration, fps: proj.fps ?? 30, proxyUrl: url(proxy),
    thumbsIndex: existsSync(tIdx) ? "/job/thumbs/index.json" : null,
    peaksUrl: existsSync(pk) ? "/job/source-peaks.json" : null,
    transcriptUrl: existsSync(join(JOB_DIR, "transcript.edited.json")) ? "/job/transcript.edited.json" : null,
  }];
}

/** Dựng lại cut.mp4/audio.wav/transcript.cut.json từ videoClips (th:clips-build) chạy nền; chỉ một lần cùng lúc; chỉ theo dõi tiến trình do chính server này sinh. */
const build: { state: "idle" | "running" | "done" | "error"; startedAt: number; endedAt: number; log: string[]; code: number | null } = { state: "idle", startedAt: 0, endedAt: 0, log: [], code: null };
function buildStatus() {
  const end = build.state === "running" ? Date.now() : build.endedAt;
  return { state: build.state, seconds: build.startedAt ? +((end - build.startedAt) / 1000).toFixed(1) : 0, code: build.code, log: build.log.slice(-8) };
}
function startClipsBuild(): [number, unknown] {
  if (build.state === "running") return [409, { error: "busy", ...buildStatus() }];
  Object.assign(build, { state: "running", startedAt: Date.now(), endedAt: 0, log: [], code: null });
  const proc = spawn(process.execPath, ["--import", "tsx", join(REPO, "src", "talking-head", "cli.ts"), "clips-build", JOB], { cwd: REPO, windowsHide: true });
  const feed = (d: Buffer) => { for (const ln of String(d).split(/\r?\n/)) if (ln.trim()) { build.log.push(ln.trim().slice(0, 300)); if (build.log.length > 200) build.log.shift(); } };
  proc.stdout.on("data", feed); proc.stderr.on("data", feed);
  proc.on("error", (e) => { build.log.push(String(e.message)); Object.assign(build, { state: "error", endedAt: Date.now(), code: -1 }); });
  proc.on("close", (c) => { if (build.state === "running") Object.assign(build, { state: c === 0 ? "done" : "error", endedAt: Date.now(), code: c }); });
  return [202, buildStatus()];
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const p = url.pathname;

  // ---- Video gốc chỉnh được (videoClips): thông tin nguồn + dựng lại cut từ clips (đặt TRƯỚC nhánh /api/ chung) ----
  if (p === "/api/source" && req.method === "GET") return sendJson(res, ...(await sourceInfo()));
  if (p === "/api/clips/build" && req.method === "POST") return sendJson(res, ...startClipsBuild());
  if (p === "/api/clips/build" && req.method === "GET") return sendJson(res, 200, buildStatus());

  if (p.startsWith("/api/") && !["/api/project", "/api/meta", "/api/peaks"].includes(p)) {
    const h = await getLibraryHandler();
    if (h && (await h(req, res, { job: JOB, jobDir: JOB_DIR, repoRoot: REPO }))) return;
    // dự phòng khi api-library chưa xử lý: dàn ý và trạng thái chạy của job
    if (p === "/api/outline" && req.method === "GET") {
      const f = join(JOB_DIR, "outline.json");
      return existsSync(f) ? send(res, 200, await readFile(f, "utf8"), "application/json; charset=utf-8") : sendJson(res, 404, { error: "Chưa có outline.json" });
    }
    if (p === "/api/run" && req.method === "GET") {
      const f = join(JOB_DIR, "run.json");
      return sendJson(res, 200, { run: existsSync(f) ? JSON.parse(await readFile(f, "utf8")) : null, stale: [] });
    }
    return sendJson(res, 404, { error: "Không có API " + p });
  }

  if (p === "/api/project") {
    if (req.method === "GET") {
      return send(res, 200, JSON.stringify(await editorProject()), "application/json; charset=utf-8");
    }
    if (req.method === "PUT") {
      let data: unknown;
      try { data = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, { error: "JSON không hợp lệ" }); }
      if (STUDIO_MODE) {
        const saved = await saveEditorProject(data);
        return sendJson(res, 200, { ok: true, savedAt: saved.updatedAt, revision: saved.revision });
      }
      const r = ProjectSchema.safeParse(data);
      if (!r.success) return sendJson(res, 400, { error: "project.json không đúng định dạng", issues: r.error.issues.slice(0, 10) });
      // rào revision: bản gửi lên cũ hơn bản trên đĩa → 409 stale; lưu xong revision +1
      const disk = existsSync(PROJECT_FILE) ? (JSON.parse(await readFile(PROJECT_FILE, "utf8")) as { revision?: number }) : null;
      const rc = checkRevision(disk, r.data);
      if (!rc.ok) return sendJson(res, rc.status, rc.body);
      r.data.revision = rc.next;
      await saveProject(PROJECT_FILE, r.data);
      return sendJson(res, 200, { ok: true, savedAt: new Date().toISOString(), revision: rc.next });
    }
    return send(res, 405, "Method Not Allowed");
  }
  if (p === "/api/peaks") {
    try { return send(res, 200, await getPeaks(), "application/json; charset=utf-8"); }
    catch (e) { return sendJson(res, 500, { error: String((e as Error).message) }); }
  }
  if (p === "/api/meta") return sendJson(res, 200, meta());

  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method Not Allowed");

  const maps: [string, string][] = [
    ["/job/", JOB_DIR], ["/assets/", join(REPO, "assets")], ["/templates/", join(REPO, "templates")],
    ["/fonts/", join(REPO, "assets", "fonts")],
  ];
  for (const [prefix, base] of maps) {
    if (p.startsWith(prefix)) {
      const f = safeJoin(base, p.slice(prefix.length));
      return f ? serveFile(req, res, f) : send(res, 403, "Cấm");
    }
  }
  const f = safeJoin(PUBLIC, p === "/" ? "index.html" : p.slice(1));
  return f ? serveFile(req, res, f) : send(res, 403, "Cấm");
}

const server = createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: String(e?.message ?? e) });
    else res.end();
  });
});

function listen(port: number, tries = 0) {
  server.once("error", (e: NodeJS.ErrnoException) => {
    if ((e.code === "EADDRINUSE" || e.code === "EACCES") && tries < 30) listen(port + 1, tries + 1);
    else { console.error(e); process.exit(1); }
  });
  server.listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}`;
    console.log(`Editor S6X (job ${JOB}) chạy tại ${url}  — Ctrl+C để dừng`);
    if (!noOpen) {
      if (process.platform === "win32") spawn("cmd", ["/c", "start", '""', url], { stdio: "ignore", windowsHide: true }).unref();
      else spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { stdio: "ignore" }).unref();
    }
  });
}
const portArg = args.indexOf("--port");
listen(portArg >= 0 ? Number(args[portArg + 1]) || 4317 : 4317);
