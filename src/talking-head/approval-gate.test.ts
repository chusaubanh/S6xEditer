import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { approvalHashes, jobDir, loadRun, requireApproval, staleSteps, withStep, writeJson } from "./jobs.js";
import { approve } from "./commands-text.js";

let root: string;
const JOB = "j1";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "th-gate-"));
  process.env.TH_OUTPUT_ROOT = root;
  await mkdir(jobDir(JOB), { recursive: true });
  await writeJson(join(jobDir(JOB), "outline.json"), { summary: "s", items: [] });
  await writeJson(join(jobDir(JOB), "cuts.json"), { mode: "remove", ranges: [] });
});
afterEach(async () => {
  delete process.env.TH_OUTPUT_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe("cổng duyệt có hash", () => {
  it("đổi cuts.json sau khi duyệt thì th:cut bị từ chối", async () => {
    await approve(JOB, "outline");
    await approve(JOB, "cut");
    await expect(requireApproval(JOB, "cut")).resolves.toBeUndefined();
    await writeJson(join(jobDir(JOB), "cuts.json"), { mode: "remove", ranges: [{ start: 0, end: 1, reason: "x", source: "user", approved: true }] });
    await expect(requireApproval(JOB, "cut")).rejects.toThrow(/cuts\.json đã thay đổi sau lần duyệt/);
  });

  it("outline: đổi outline.json hoặc thêm transcript.edited.json đều làm mất hiệu lực", async () => {
    await approve(JOB, "outline");
    expect(Object.keys(await approvalHashes(JOB, "outline"))).toEqual(["outline.json"]);
    await writeFile(join(jobDir(JOB), "transcript.edited.json"), "{}");
    await expect(requireApproval(JOB, "outline")).rejects.toThrow(/transcript\.edited\.json/);
  });

  it("chạy xong một bước thì các bước sau đã done chuyển sang stale", async () => {
    for (const s of ["cut", "audio", "project"]) await withStep(JOB, s, async () => ({ result: null }));
    expect(await staleSteps(JOB)).toEqual([]);
    await withStep(JOB, "cut", async () => ({ result: null }));
    expect(await staleSteps(JOB)).toEqual(["audio", "project"]);
    expect((await loadRun(JOB)).steps.cut.status).toBe("done");
    await withStep(JOB, "audio", async () => ({ result: null }));
    expect(await staleSteps(JOB)).toEqual(["project"]);
  });
});
