/**
 * Nhân sự #04 - Satori: vẽ thẻ và ảnh bìa ra SVG, chạy trong Node.
 * Dùng font cục bộ để đúng dấu tiếng Việt và không cần mạng.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type React from "react";
import satori from "satori";

const font = (file: string, weight: 400 | 600 | 700 | 800 | 900) => ({
  name: "Be Vietnam Pro",
  data: readFileSync(resolve("public/fonts", file)),
  weight,
  style: "normal" as const,
});

const loadFonts = () => [
  font("BeVietnamPro-Regular.ttf", 400),
  font("BeVietnamPro-SemiBold.ttf", 600),
  font("BeVietnamPro-Bold.ttf", 700),
  font("BeVietnamPro-ExtraBold.ttf", 800),
  font("BeVietnamPro-Black.ttf", 900),
];

export function renderCardSvg(element: React.ReactNode, width: number, height: number): Promise<string> {
  return satori(element, { width, height, fonts: loadFonts() });
}
