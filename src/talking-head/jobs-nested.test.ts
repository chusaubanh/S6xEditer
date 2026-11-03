import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanSegment, docNameFromFile, intake, slugify } from "./commands-text.js";
import { runCapture } from "./ffmpeg-util.js";
import { approvalHashes, assertNoClips, docOf, inputDir, jobDir, loadRun, normalizeJobId, resolveSourceRaw, withStep, writeJson } from "./jobs.js";

const JOB = "Tiêu chuẩn video bán hàng/02-khung-hinh-vang";
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "th nested "));
  process.env.TH_OUTPUT_ROOT = join(root, "output");
  process.env.TH_INPUT_ROOT = join(root, "input");
});
afterEach(async () => {
  delete process.env.TH_OUTPUT_ROOT;
  delete process.env.TH_INPUT_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe("job id lồng, có dấu và khoảng trắng", () => {
  it("chuẩn hoá và từ chối id nguy hiểm", () => {
    expect(normalizeJobId("Tiêu chuẩn video bán hàng\\02-khung")).toBe("Tiêu chuẩn video bán hàng/02-khung");
    expect(normalizeJobId("th-test-01")).toBe("th-test-01");
    for (const bad of ["", "../x", "a/../../b", "C:\\x", "/abs/x", "a/b:c"]) expect(() => normalizeJobId(bad), bad).toThrow();
    expect(docOf(JOB)).toBe("Tiêu chuẩn video bán hàng");
    expect(docOf("th-test-01")).toBe("th-test-01");
  });

  it("jobDir/inputDir ra đúng thư mục lồng; run.json, hash duyệt, assertNoClips hoạt động trong đó", async () => {
    expect(jobDir(JOB)).toBe(join(root, "output", "Tiêu chuẩn video bán hàng", "02-khung-hinh-vang"));
    expect(inputDir(JOB)).toBe(join(root, "input", "Tiêu chuẩn video bán hàng"));
    await withStep(JOB, "demo", async () => ({ result: null }));
    expect(existsSync(join(jobDir(JOB), "run.json"))).toBe(true);
    expect((await loadRun(JOB)).steps.demo.status).toBe("done");
    await writeJson(join(jobDir(JOB), "cuts.json"), { mode: "remove", ranges: [] });
    expect(Object.keys(await approvalHashes(JOB, "cut"))).toEqual(["cuts.json"]);
    await writeJson(join(jobDir(JOB), "project.json"), { videoClips: [{ id: "C-1" }] });
    expect(() => assertNoClips(JOB, "th:cut")).toThrow(/videoClips/);
  });

  it("source.raw: dạng mới (tương đối gốc repo) và dạng cũ (tương đối thư mục job) đều tìm được file", async () => {
    const dir = jobDir(JOB);
    await mkdir(dir, { recursive: true });
    await mkdir(join(root, "input", "Tiêu chuẩn video bán hàng", "raw"), { recursive: true });
    const file = join(root, "input", "Tiêu chuẩn video bán hàng", "raw", "clip cut.mp4");
    await writeFile(file, "x");
    expect(resolveSourceRaw(dir, "input/Tiêu chuẩn video bán hàng/raw/clip cut.mp4")).toBe(file);
    expect(resolveSourceRaw(dir, "../../../input/Tiêu chuẩn video bán hàng/raw/clip cut.mp4")).toBe(file); // job lồng nên sâu hơn 1 cấp
    expect(resolveSourceRaw(dir, file)).toBe(file);
  });
});

describe("th:intake theo tài liệu gốc", () => {
  it("tên tài liệu: bỏ đuôi và hậu tố cut/final; slug ASCII", () => {
    expect(docNameFromFile("E:/x/Tiêu chuẩn của video bán hàng cut.mp4")).toBe("Tiêu chuẩn của video bán hàng");
    expect(docNameFromFile("Bài giảng 1 final cut.mov")).toBe("Bài giảng 1");
    expect(cleanSegment("a/b: c*d")).toBe("a b c d");
    expect(slugify("Tiêu chuẩn của video bán hàng")).toBe("tieu-chuan-cua-video-ban-hang");
  });

  it("tạo output/<doc>/<slug>/ và input/<doc>/raw/, ghi doc + slug vào run.json; video thứ hai cùng tài liệu dùng chung bản sao", async () => {
    const clip = join(root, "Tiêu chuẩn của video bán hàng cut.mp4");
    await runCapture("ffmpeg", ["-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=30:duration=1", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "1", "-c:v", "libx264", "-c:a", "aac", clip]);
    const job = await intake(clip);
    expect(job).toBe("Tiêu chuẩn của video bán hàng/01-tieu-chuan-cua-video-ban-hang");
    expect(existsSync(join(root, "input", "Tiêu chuẩn của video bán hàng", "raw", "Tiêu chuẩn của video bán hàng cut.mp4"))).toBe(true);
    const run = await loadRun(job);
    expect(run).toMatchObject({ doc: "Tiêu chuẩn của video bán hàng", slug: "01-tieu-chuan-cua-video-ban-hang" });
    const media = JSON.parse(await readFile(join(jobDir(job), "media.json"), "utf8"));
    expect(media.info.width).toBe(160);
    const job2 = await intake(clip, "02-khung-hinh-vang", "Tiêu chuẩn của video bán hàng"); // --name là slug, --doc giữ nguyên
    expect(job2).toBe("Tiêu chuẩn của video bán hàng/02-khung-hinh-vang");
    await expect(intake(clip, "02-khung-hinh-vang", "Tiêu chuẩn của video bán hàng")).rejects.toThrow(/đã có media.json/);
  }, 60000);
});
