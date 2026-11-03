import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approve, assertApproved, jobKeyOf, resolveJob } from "../src/training/job";

describe("duyệt", () => {
  const setup = () => {
    const cwd = mkdtempSync(join(tmpdir(), "labs-"));
    mkdirSync(join(cwd, "input", "Bài"), { recursive: true });
    writeFileSync(join(cwd, "input", "Bài", "Bài.md"), "# x");
    const job = resolveJob("Bài", cwd);
    mkdirSync(job.outputDir, { recursive: true });
    writeFileSync(job.scriptPath, "{}");
    return job;
  };
  it("chưa duyệt thì chặn, sửa kịch bản sau duyệt thì chặn lại", () => {
    const job = setup();
    expect(() => assertApproved(job, "script")).toThrow("Chưa được");
    approve(job, "script", "Phương");
    expect(() => assertApproved(job, "script")).not.toThrow();
    writeFileSync(job.scriptPath, '{"sua":1}');
    expect(() => assertApproved(job, "script")).toThrow("đã đổi");
  });
  it("khoá thư mục là chữ không dấu", () => {
    expect(jobKeyOf("Hướng dẫn Đào tạo 01")).toBe("huong-dan-dao-tao-01");
  });
});
