import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/** Chữ viết thẳng trong JSX, không đi qua <Label />, nên không đối chiếu được với tài liệu. */
export function findRawJsxText(source: string): string[] {
  // Đọc bằng trình phân tích của TypeScript: dò bằng regex nhầm generic và phép so sánh thành thẻ JSX.
  const file = ts.createSourceFile("scene.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && /\p{L}/u.test(node.text)) found.push(node.text.trim());
    if (ts.isJsxExpression(node) && node.expression && ts.isStringLiteralLike(node.expression) && /\p{L}/u.test(node.expression.text) && !ts.isJsxAttribute(node.parent)) {
      found.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** Quét cảnh riêng của các video trong src/videos. */
export function scanVideoScenes(root = "src/videos"): string[] {
  if (!existsSync(root)) return [];
  const problems: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".tsx")) continue;
    const path = join(entry.parentPath, entry.name);
    for (const text of findRawJsxText(readFileSync(path, "utf8"))) {
      problems.push(`${path}: chữ viết thẳng "${text}", phải dùng <Label />.`);
    }
  }
  return problems;
}
