import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseDocumentOutline } from "./document-outline.js";
import { resolveDocumentWorkspace } from "./document-workspace.js";

/**
 * S6xEditer: CLI Lập Dàn Ý Bài Đào Tạo
 * npm run doc:outline -- "<tài-liệu>"
 */

async function main(): Promise<void> {
  const input = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!input) {
    console.log('Sử dụng: npm run doc:outline -- "<tên-thư-mục-tài-liệu>"');
    return;
  }

  const workspace = resolveDocumentWorkspace(input);
  const raw = await readFile(workspace.inputPath, "utf8");
  const outline = parseDocumentOutline(raw, { title: workspace.documentName });

  await mkdir(workspace.outputDir, { recursive: true });
  const outlinePath = join(workspace.outputDir, "outline.json");
  await writeFile(outlinePath, `${JSON.stringify(outline, null, 2)}\n`, "utf8");

  console.log("\n=======================================================");
  console.log("📑 S6xEditer • PHÂN TÍCH BÀI GIẢNG ĐÀO TẠO");
  console.log("=======================================================");
  console.log(`📁 File dàn ý: ${outlinePath}`);
  console.log(`🎯 Tiêu đề: ${outline.title}`);
  console.log(
    `📊 Thống kê: ${outline.sections.length} phần | ${outline.totalWordCount} từ | ` +
      `Thời lượng đọc ước tính: ~${Math.round(outline.estimatedFullNarrationSec)}s | ` +
      `Số video khuyến nghị: ${outline.suggestedVideoCount}`
  );

  console.log("\n📌 CHI TIẾT CÁC PHÂN ĐOẠN NỘI DUNG:");
  for (const section of outline.sections) {
    const label = section.heading ?? "(Mở đầu)";
    const numbers = section.numbers.length > 0 ? ` | số liệu: [${section.numbers.join(", ")}]` : "";
    const hints = section.contentHints.length > 0 ? ` | [${section.contentHints.join(", ")}]` : "";
    console.log(
      `  - [${section.id}] ${label} — ${section.wordCount} từ ≈ ${Math.round(section.estimatedNarrationSec)}s${hints}${numbers}`
    );
  }
  console.log("=======================================================\n");
}

main().catch((error) => {
  console.error("❌ Lỗi khi phân tích tài liệu:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
