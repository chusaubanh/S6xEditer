import type { IncomingMessage, ServerResponse } from "node:http";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { loadMusicLibrary, suggestMusic } from "../../src/talking-head/music.js";
import { applyPreset, loadPresets } from "../../src/talking-head/presets.js";
import { LayerSchema, ProjectSchema, RunSchema } from "../../src/talking-head/project-schema.js";
import { loadSfxLibrary, planSfx, relinkSfx } from "../../src/talking-head/sfx-plan.js";

export interface LibraryCtx { job: string; jobDir: string; repoRoot: string }

function sendJson(res: ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

async function readJsonBody(req: IncomingMessage, limit = 20 * 1024 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > limit) throw new Error("Nội dung quá lớn");
    chunks.push(c as Buffer);
  }
  const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (typeof v !== "object" || v === null) throw new Error("Thân yêu cầu phải là object JSON");
  return v as Record<string, unknown>;
}

/** Tỷ lệ của scene-kit frame lấy từ data-width/height trong index.html (mặc định 4:5). */
function templateAspect(dir: string): string {
  try {
    const fd = openSync(join(dir, "index.html"), "r");
    const buf = Buffer.alloc(4000);
    const n = readSync(fd, buf, 0, 4000, 0);
    closeSync(fd);
    const html = buf.subarray(0, n).toString("utf8");
    const w = Number(/data-width="(\d+)"/.exec(html)?.[1]);
    const h = Number(/data-height="(\d+)"/.exec(html)?.[1]);
    if (w && h) return Math.abs(w / h - 16 / 9) < 0.02 ? "16:9" : Math.abs(w / h - 4 / 5) < 0.02 ? "4:5" : `${w}:${h}`;
  } catch { /* không đọc được -> mặc định */ }
  return "4:5";
}

let templateCache: { dir: string; list: { id: string; aspect: string; url: string }[] } | null = null;
function listTemplates(tdir: string) {
  if (templateCache?.dir === tdir) return templateCache.list;
  const list = existsSync(tdir)
    ? readdirSync(tdir).filter((d) => d.startsWith("frame-")).sort().map((id) => ({ id, aspect: templateAspect(join(tdir, id)), url: `/templates/${id}/` }))
    : [];
  templateCache = { dir: tdir, list };
  return list;
}

const ROUTES = ["GET /api/library", "POST /api/preset/apply", "POST /api/sfx/plan", "POST /api/sfx/relink", "POST /api/music/suggest", "GET /api/outline", "GET /api/run"];

/** Trả true nếu đã xử lý route (editor server gọi cho mọi /api/* trừ project/meta/peaks). */
export async function handleLibraryApi(req: IncomingMessage, res: ServerResponse, ctx: LibraryCtx): Promise<boolean> {
  const p = new URL(req.url ?? "/", "http://localhost").pathname;
  const route = `${req.method ?? "GET"} ${p}`;
  if (!ROUTES.includes(route)) return false;
  try {
    if (route === "GET /api/library") {
      const lib = loadPresets();
      const tdir = join(ctx.repoRoot, "templates");
      const templates = listTemplates(tdir);
      sendJson(res, 200, {
        presets: lib.presets,
        sfxPacks: lib.sfxPacks,
        sfx: loadSfxLibrary(ctx.repoRoot).map((e) => ({ ...e, url: "/" + e.file })),
        music: loadMusicLibrary(ctx.repoRoot).map((e) => ({ ...e, url: `/assets/music-th/${e.file}` })),
        templates,
      });
      return true;
    }
    if (route === "GET /api/outline") {
      const f = join(ctx.jobDir, "outline.json");
      sendJson(res, 200, existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
      return true;
    }
    if (route === "GET /api/run") {
      const f = join(ctx.jobDir, "run.json");
      const run = existsSync(f) ? RunSchema.parse(JSON.parse(readFileSync(f, "utf8"))) : null;
      sendJson(res, 200, { run, stale: run ? Object.entries(run.steps).filter(([, v]) => v.status === "stale").map(([k]) => k) : [] });
      return true;
    }

    const body = await readJsonBody(req);
    const need = (k: string): string => {
      if (typeof body[k] !== "string" || !body[k]) throw new Error(`Thiếu trường ${k}`);
      return body[k] as string;
    };
    if (route === "POST /api/preset/apply") {
      if (!Array.isArray(body.layers)) throw new Error("Thiếu trường layers");
      const presetId = need("presetId"), variantId = need("variantId");
      const aspect = typeof body.aspect === "string" ? body.aspect : undefined;
      const out = body.layers.map((l) => applyPreset(LayerSchema.parse(l), presetId, variantId, body.asNew ? { aspect } : {}));
      sendJson(res, 200, { layers: out });
      return true;
    }
    const project = ProjectSchema.parse(body.project);
    if (route === "POST /api/sfx/plan") {
      const density = body.density;
      if (density !== "low" && density !== "mid" && density !== "high") throw new Error("density phải là low|mid|high");
      sendJson(res, 200, { project: planSfx(project, { pack: need("pack"), density }) });
      return true;
    }
    if (route === "POST /api/sfx/relink") {
      sendJson(res, 200, { project: relinkSfx(project, loadSfxLibrary(ctx.repoRoot)) });
      return true;
    }
    // POST /api/music/suggest
    const outlineFile = join(ctx.jobDir, "outline.json");
    const outline = existsSync(outlineFile) ? JSON.parse(readFileSync(outlineFile, "utf8")) : null;
    const ranked = suggestMusic(project, outline, { mood: typeof body.mood === "string" ? body.mood : undefined }).map((r) => ({
      id: r.entry.id, score: r.score, reason: r.reason, title: r.entry.title, mood: r.entry.mood, duration: r.entry.duration,
      needsLoop: r.needsLoop, hasVocals: !!r.entry.hasVocals, peaks: r.entry.peaks ?? [], url: `/assets/music-th/${r.entry.file}`,
    }));
    sendJson(res, 200, { ranked });
    return true;
  } catch (e) {
    const err = e as Error & { issues?: unknown[] };
    sendJson(res, 400, { error: err.message?.slice(0, 500) ?? "Lỗi", ...(err.issues ? { issues: err.issues.slice(0, 5) } : {}) });
    return true;
  }
}
