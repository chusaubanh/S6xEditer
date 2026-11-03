import { readFileSync, writeFileSync } from "node:fs";
import { checkScript, renderScriptReview } from "./script-checks";
import { loadScript, resolveJob } from "./job";

/** npm run script:validate -- "<tài liệu>" : kiểm kịch bản và xuất bảng duyệt. */
function main(): void {
  const input = process.argv[2];
  if (!input) throw new Error('Sử dụng: npm run script:validate -- "<tài liệu>"');
  const job = resolveJob(input);
  const script = loadScript(job);
  const issues = checkScript(script, readFileSync(job.inputPath, "utf8"));

  for (const issue of issues) {
    console.log(`${issue.level === "error" ? "LỖI" : "CẢNH BÁO"} [${issue.where}] ${issue.message}`);
  }
  const errors = issues.filter((issue) => issue.level === "error").length;
  console.log(`Kiểm kịch bản: ${errors} lỗi, ${issues.length - errors} cảnh báo.`);
  if (errors > 0) process.exit(1);

  writeFileSync(job.reviewPath, renderScriptReview(script));
  console.log(`Bảng duyệt: ${job.reviewPath}`);
}

main();
