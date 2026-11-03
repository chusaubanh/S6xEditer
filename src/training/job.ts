import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { resolveDocumentWorkspace } from "./document-workspace";
import { TrainingScriptSchema, type TrainingScript } from "./training-contract";

export type ApprovalStep = "script" | "visual";

export interface Job {
  key: string;
  inputPath: string;
  outputDir: string;
  scriptPath: string;
  publicDir: string;
  timelinePath: string;
  propsPath: string;
  reviewPath: string;
  approvalsPath: string;
}

/** Tên thư mục dùng được trong staticFile: chỉ chữ thường, số và gạch nối. */
export const jobKeyOf = (outputDir: string): string =>
  basename(outputDir)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function resolveJob(input: string, cwd = process.cwd()): Job {
  const workspace = resolveDocumentWorkspace(input, cwd);
  const key = jobKeyOf(workspace.outputDir);
  const publicDir = resolve(cwd, "public", "jobs", key);
  return {
    key,
    inputPath: workspace.inputPath,
    outputDir: workspace.outputDir,
    scriptPath: workspace.scriptPath,
    publicDir,
    timelinePath: join(workspace.outputDir, "timeline.json"),
    propsPath: join(workspace.outputDir, "props.json"),
    reviewPath: join(workspace.outputDir, "script-review.md"),
    approvalsPath: join(workspace.outputDir, "approvals.json"),
  };
}

export function loadScript(job: Job): TrainingScript {
  if (!existsSync(job.scriptPath)) throw new Error(`Chưa có kịch bản: ${job.scriptPath}`);
  return TrainingScriptSchema.parse(JSON.parse(readFileSync(job.scriptPath, "utf8")));
}

const fingerprint = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

type Approvals = Partial<Record<ApprovalStep, { by: string; at: string; scriptHash: string }>>;

const readApprovals = (job: Job): Approvals =>
  existsSync(job.approvalsPath) ? JSON.parse(readFileSync(job.approvalsPath, "utf8")) : {};

export function approve(job: Job, step: ApprovalStep, by: string): void {
  const approvals = readApprovals(job);
  approvals[step] = { by, at: new Date().toISOString(), scriptHash: fingerprint(job.scriptPath) };
  writeFileSync(job.approvalsPath, `${JSON.stringify(approvals, null, 2)}\n`);
}

/** Sửa kịch bản sau khi duyệt thì phiếu duyệt mất hiệu lực. */
export function assertApproved(job: Job, step: ApprovalStep): void {
  const approval = readApprovals(job)[step];
  if (!approval) throw new Error(`Chưa được người dùng duyệt bước "${step}". Chạy: npm run approve -- "<tài liệu>" ${step} --by "<tên>"`);
  if (approval.scriptHash !== fingerprint(job.scriptPath)) {
    throw new Error(`Kịch bản đã đổi sau khi duyệt bước "${step}". Phải duyệt lại.`);
  }
}
