import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./presets.js";
import { ProjectSchema } from "./project-schema.js";

// scripts/ nằm ngoài rootDir của tsc -> nạp động bằng biến (giống editor server)
const apiPath = "../../scripts/editor/api-library.js";
let handleLibraryApi: (req: IncomingMessage, res: ServerResponse, ctx: { job: string; jobDir: string; repoRoot: string }) => Promise<boolean>;
let dir = "";
beforeAll(async () => {
  handleLibraryApi = (await import(apiPath)).handleLibraryApi;
  dir = await mkdtemp(join(tmpdir(), "api-lib-"));
  await writeFile(join(dir, "outline.json"), JSON.stringify({ summary: "Hướng dẫn công cụ AI", items: [] }));
  await writeFile(join(dir, "run.json"), JSON.stringify({ version: 1, job: "t", createdAt: "x", updatedAt: "x", steps: { cut: { status: "stale" }, audio: { status: "done" } } }));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function call(method: string, url: string, body?: unknown): Promise<{ handled: boolean; code: number; json: any }> {
  const req = Object.assign(Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]), { method, url, headers: {} }) as unknown as IncomingMessage;
  let code = 0, text = "";
  const res = { writeHead: (c: number) => { code = c; }, end: (t: string) => { text = t; } } as unknown as ServerResponse;
  const handled = await handleLibraryApi(req, res, { job: "t", jobDir: dir, repoRoot: REPO_ROOT });
  return { handled, code, json: text ? JSON.parse(text) : undefined };
}

const project = ProjectSchema.parse({
  version: 1, job: "t", width: 1920, height: 1080, aspect: "16:9", duration: 30, source: { video: "cut.mp4" },
  tracks: [{ id: "t-g", kind: "graphics", name: "G", layers: [{ id: "L-1", type: "callout", start: 3, duration: 3, x: 1, y: 2, w: 30, h: 10, text: "Hi", animation: { in: { kind: "pop", dur: 0.4 }, out: { kind: "shrink", dur: 0.3 } } }] }],
});

describe("api-library", () => {
  it("bỏ qua route không phải của mình", async () => {
    expect((await call("GET", "/api/project")).handled).toBe(false);
    expect((await call("GET", "/api/nope")).handled).toBe(false);
  });
  it("GET /api/library gộp preset, gói SFX, SFX, nhạc, template", { timeout: 60000 }, async () => {
    const { json, code } = await call("GET", "/api/library");
    expect(code).toBe(200);
    expect(json.presets.subtitle.length).toBeGreaterThanOrEqual(5);
    expect(json.sfxPacks.length).toBeGreaterThanOrEqual(4);
    expect(json.sfx[0].url).toMatch(/^\/assets\/sfx-th\//);
    if (json.music.length) expect(json.music[0].url).toMatch(/^\/assets\/music-th\//);
    expect(json.templates).toEqual([]); // thư viện template đã bỏ khỏi repo này
  });
  it("preset/apply giữ chữ, asNew đặt layout theo tỷ lệ", async () => {
    const l = project.tracks[0].layers[0];
    const a = (await call("POST", "/api/preset/apply", { layers: [l], presetId: "co-note", variantId: "gold", aspect: "16:9" })).json.layers[0];
    expect([a.text, a.x, a.meta.presetId]).toEqual(["Hi", 1, "co-note"]);
    const b = (await call("POST", "/api/preset/apply", { layers: [l], presetId: "co-note", variantId: "gold", aspect: "16:9", asNew: true })).json.layers[0];
    expect(b.x).toBe(58);
    const bad = await call("POST", "/api/preset/apply", { layers: [l], presetId: "nope", variantId: "x" });
    expect([bad.code, typeof bad.json.error]).toEqual([400, "string"]);
  });
  it("sfx/plan, sfx/relink, music/suggest", async () => {
    const plan = (await call("POST", "/api/sfx/plan", { project, pack: "social", density: "mid" })).json.project;
    const sfxOf = (p: typeof plan) => p.tracks.find((t: { kind: string }) => t.kind === "sfx").layers;
    expect(sfxOf(plan).length).toBeGreaterThan(0);
    expect((await call("POST", "/api/sfx/plan", { project, pack: "social", density: "x" })).code).toBe(400);
    const moved = structuredClone(plan);
    moved.tracks[0].layers[0].start += 2;
    const re = (await call("POST", "/api/sfx/relink", { project: moved })).json.project;
    expect(sfxOf(re)[0].start).toBeGreaterThan(sfxOf(plan)[0].start);
    const { json } = await call("POST", "/api/music/suggest", { project });
    if (json.ranked.length) expect(json.ranked[0].reason).toContain("cong-nghe"); // dàn ý nhắc AI -> mood cong-nghe
    expect(json.ranked.every((r: { hasVocals: boolean }) => !r.hasVocals)).toBe(true);
  });
  it("outline và run", async () => {
    expect((await call("GET", "/api/outline")).json.summary).toContain("AI");
    expect((await call("GET", "/api/run")).json.stale).toEqual(["cut"]);
  });
});
