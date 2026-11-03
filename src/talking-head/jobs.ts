import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type { z } from "zod";
import { ApprovalSchema, RunSchema, type Approval, type Run } from "./project-schema.js";

export const REPO_ROOT = process.cwd();
export const ASR_PYTHON = join(REPO_ROOT, ".venv-asr", "Scripts", "python.exe");

/**
 * Job id có thể lồng nhiều cấp, có dấu tiếng Việt và khoảng trắng: "<tài liệu gốc>/<slug video>", vd. "Tiêu chuẩn video bán hàng/02-khung-hinh-vang".
 * Dấu phân cách "/" hoặc "\\"; chuẩn hoá về "/". Từ chối id rỗng, đường dẫn tuyệt đối, ổ đĩa hoặc đoạn ".." (thoát khỏi output/).
 */
export function normalizeJobId(job: string): string {
  const parts = job.split(/[\\/]+/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error("Job id rỗng.");
  if (isAbsolute(job) || parts.some((p) => p === ".." || p === "." || /[:*?"<>|]/.test(p))) throw new Error(`Job id không hợp lệ: "${job}"`);
  return parts.join("/");
}
export const outputRoot = (): string => process.env.TH_OUTPUT_ROOT ?? join(REPO_ROOT, "output");
export const inputRoot = (): string => process.env.TH_INPUT_ROOT ?? join(REPO_ROOT, "input");
export function jobDir(job: string): string {
  return resolve(outputRoot(), ...normalizeJobId(job).split("/"));
}
/** Tên tài liệu gốc của job = đoạn đầu của job id (job một cấp cũ: chính nó). */
export const docOf = (job: string): string => normalizeJobId(job).split("/")[0];
/** input/<tài liệu gốc>/ (chứa raw/ dùng chung cho mọi video của tài liệu đó). */
export function inputDir(job: string): string {
  return resolve(inputRoot(), docOf(job));
}

/**
 * Đường dẫn video gốc từ project.source.raw: dạng mới tương đối GỐC REPO ("input/<doc>/raw/x.mp4"),
 * dạng cũ tương đối thư mục job ("../../input/<job>/raw/x.mp4"). Thử cả hai, ưu tiên dạng đúng với tiền tố.
 */
export function resolveSourceRaw(dir: string, rel: string): string {
  if (isAbsolute(rel)) return rel;
  const fromRepo = resolve(inputRoot(), "..", rel);
  const fromJob = resolve(dir, rel);
  const legacy = rel.startsWith(".");
  const order = legacy ? [fromJob, fromRepo] : [fromRepo, fromJob];
  return order.find((p) => existsSync(p)) ?? order[0];
}

export async function readJson<T>(file: string, schema?: z.ZodType<T>): Promise<T> {
  const raw = JSON.parse(await readFile(file, "utf8"));
  return schema ? schema.parse(raw) : (raw as T);
}
export async function writeJson(file: string, data: unknown): Promise<void> {
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

/** Phân tích argv: positional + --cờ giá trị / --cờ bool. */
export function parseArgs(argv: string[]): { pos: string[]; flags: Record<string, string | true> } {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[a.slice(2)] = next;
        i++;
      } else flags[a.slice(2)] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}

// ---------- run.json ----------

export async function loadRun(job: string): Promise<Run> {
  const f = join(jobDir(job), "run.json");
  if (existsSync(f)) return readJson(f, RunSchema);
  const now = new Date().toISOString();
  return { version: 1, job, createdAt: now, updatedAt: now, steps: {} };
}

/** Chạy một bước và ghi trạng thái/thời gian/lỗi vào run.json. */
export async function withStep<T>(job: string, step: string, fn: () => Promise<{ result: T; outputs?: string[] }>): Promise<T> {
  const t0 = Date.now();
  const save = async (run: Run) => {
    run.updatedAt = new Date().toISOString();
    await writeJson(join(jobDir(job), "run.json"), run);
  };
  let run = await loadRun(job);
  run.steps[step] = { status: "running", startedAt: new Date(t0).toISOString() };
  await save(run);
  try {
    const { result, outputs } = await fn();
    run = await loadRun(job);
    run.steps[step] = {
      status: "done",
      startedAt: new Date(t0).toISOString(),
      finishedAt: new Date().toISOString(),
      durationSec: +((Date.now() - t0) / 1000).toFixed(1),
      outputs,
    };
    markStale(run, step);
    await save(run);
    return result;
  } catch (e) {
    run = await loadRun(job);
    run.steps[step] = {
      status: "failed",
      startedAt: new Date(t0).toISOString(),
      finishedAt: new Date().toISOString(),
      durationSec: +((Date.now() - t0) / 1000).toFixed(1),
      error: String((e as Error).message ?? e).slice(0, 2000),
    };
    await save(run);
    throw e;
  }
}

// ---------- cổng duyệt ----------

export async function loadApproval(job: string): Promise<Approval> {
  const f = join(jobDir(job), "th-approval.json");
  return existsSync(f) ? readJson(f, ApprovalSchema) : {};
}

/** File được duyệt theo từng cổng; hash ghi lúc th:approve và so lại ở các bước sau. */
const APPROVED_FILES: Record<"outline" | "cut", string[]> = {
  outline: ["outline.json", "transcript.edited.json"],
  cut: ["cuts.json"],
};

export async function sha256File(file: string): Promise<string> {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

/** Hash các file của cổng (bỏ qua file chưa tồn tại, vd. chưa hiệu đính thì không có transcript.edited.json). */
export async function approvalHashes(job: string, stage: "outline" | "cut"): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of APPROVED_FILES[stage]) {
    const p = join(jobDir(job), f);
    if (existsSync(p)) out[f] = await sha256File(p);
  }
  return out;
}

/** Từ chối nếu chưa duyệt, hoặc file đã duyệt bị đổi/xoá/thêm mới kể từ lần duyệt. */
export async function requireApproval(job: string, stage: "outline" | "cut"): Promise<void> {
  const a = (await loadApproval(job))[stage];
  const redo = `chạy lại th:approve -- ${job} --stage ${stage}`;
  if (!a) throw new Error(`Chưa duyệt "${stage}". Chạy: npm run th:approve -- ${job} --stage ${stage}`);
  if (!a.hashes) return; // bản duyệt cũ chưa có hash
  const now = await approvalHashes(job, stage);
  for (const f of new Set([...Object.keys(a.hashes), ...Object.keys(now)])) {
    if (a.hashes[f] !== now[f]) throw new Error(`${f} đã thay đổi sau lần duyệt — ${redo}`);
  }
}

// ---------- stale: bước sau lỗi thời khi đầu vào đổi ----------

const DOWNSTREAM: Record<string, string[]> = {
  transcribe: ["align-edits", "cut-plan", "cut", "audio", "project"],
  "align-edits": ["cut-plan", "cut", "audio", "project"],
  "cut-plan": ["cut", "audio", "project"],
  cut: ["audio", "project", "intro"],
  audio: ["project", "intro"],
  project: ["intro"],
};

/** Đánh dấu "stale" các bước phía sau (đã done) của bước vừa chạy xong. */
export function markStale(run: Run, step: string): void {
  for (const d of DOWNSTREAM[step] ?? []) {
    const st = run.steps[d];
    if (st?.status === "done") run.steps[d] = { ...st, status: "stale" };
  }
}

export async function staleSteps(job: string): Promise<string[]> {
  const run = await loadRun(job);
  return Object.entries(run.steps).filter(([, v]) => v.status === "stale").map(([k]) => k);
}

/** In cảnh báo nếu các bước tiên quyết đang stale (editor/th:render có thể gọi cùng hàm này). */
export async function warnStale(job: string, prerequisites: string[]): Promise<void> {
  const stale = (await staleSteps(job)).filter((s) => prerequisites.includes(s));
  if (stale.length) console.warn(`CẢNH BÁO: bước ${stale.join(", ")} đã lỗi thời (đầu vào đổi sau khi chạy) — chạy lại trước khi dùng kết quả.`);
}

/** th:cut / th:audio / th:intro / th:project --force bị từ chối trên job có videoClips: cut.mp4 & audio.wav là sản phẩm dựng từ clips. */
export function assertNoClips(job: string, what: string): void {
  const f = join(jobDir(job), "project.json");
  if (!existsSync(f)) return;
  const raw = JSON.parse(readFileSync(f, "utf8")) as { videoClips?: unknown[] };
  if (raw.videoClips?.length) {
    throw new Error(`${what} bị từ chối: job ${job} có videoClips (cut.mp4/audio.wav là sản phẩm dựng từ clips). Sửa clips trong editor rồi chạy th:render hoặc th:clips-build.`);
  }
}

export function requireFile(file: string, hint: string): string {
  if (!existsSync(file)) throw new Error(`Thiếu ${file}. ${hint}`);
  return file;
}
