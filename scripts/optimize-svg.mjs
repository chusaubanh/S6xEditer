/**
 * Nhân sự #03 - SVGO: gọt SVG từ assets/ ra public/svg/, không bao giờ ghi đè file gốc.
 * Bỏ qua assets/brand/. Giữ nguyên id vì animation chọn phần tử theo id.
 */
import fs from "node:fs";
import path from "node:path";
import { optimize } from "svgo";

const ASSETS_DIR = path.resolve("assets");
const OUTPUT_DIR = path.resolve("public", "svg");
const SKIP = new Set([path.join(ASSETS_DIR, "brand")]);

export function optimizeSvg(source, filePath) {
  return optimize(source, {
    path: filePath,
    multipass: true,
    plugins: [
      { name: "preset-default", params: { overrides: { cleanupIds: false } } },
      "removeDimensions",
    ],
  }).data;
}

function walk(dir) {
  if (!fs.existsSync(dir) || SKIP.has(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.isFile() && entry.name.endsWith(".svg")) {
      const source = fs.readFileSync(fullPath, "utf8");
      const result = optimizeSvg(source, fullPath);
      const target = path.join(OUTPUT_DIR, path.relative(ASSETS_DIR, fullPath));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, result);
      console.log(`[SVGO] ${path.relative(ASSETS_DIR, fullPath)}: ${source.length} -> ${result.length} byte`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve("scripts/optimize-svg.mjs")) {
  walk(ASSETS_DIR);
}
