import { approve, resolveJob, type ApprovalStep } from "./job";

/** npm run approve -- "<tài liệu>" script|visual --by "<tên>" : chỉ chạy khi người dùng đã duyệt. */
const [input, step, flag, by] = process.argv.slice(2);
if (!input || (step !== "script" && step !== "visual") || flag !== "--by" || !by) {
  console.error('Sử dụng: npm run approve -- "<tài liệu>" script|visual --by "<tên>"');
  process.exit(1);
}
approve(resolveJob(input), step as ApprovalStep, by);
console.log(`Đã ghi: ${by} duyệt bước ${step}.`);
