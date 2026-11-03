import { countWords } from "./vietnamese-narration";

/**
 * Structure-aware document parser. Unlike the extractive generator, this
 * PRESERVES the document's own hierarchy (headings, bullets, real numbers)
 * so the AI author can plan videos that stay faithful to the source and
 * so validators can prove display stats exist in the document.
 */

export interface OutlineSection {
  /** Stable slug id, e.g. "phan-03-van-hoa-toc-do-va-chu-dong". */
  id: string;
  /** Heading depth (1-6); 0 for preamble text before the first heading. */
  level: number;
  /** Cleaned heading text; null for the preamble. */
  heading: string | null;
  paragraphs: string[];
  bullets: string[];
  wordCount: number;
  /** Seconds if this section were narrated in full at the baseline rate. */
  estimatedNarrationSec: number;
  /** Real numeric tokens found in this section (anti-fabrication source). */
  numbers: string[];
  /**
   * Heuristic content types (khái niệm, quy trình, danh sách…) — a starting
   * point for the author's own classification in plan.json `analysis`.
   */
  contentHints: ContentHint[];
}

/** Content types from the training-material instruction (chốt 30/09/2026). */
export const CONTENT_TYPES = [
  "khai-niem",
  "nguyen-tac",
  "quy-trinh",
  "danh-sach",
  "phan-loai",
  "so-sanh",
  "huong-dan",
  "dieu-kien",
  "luu-y",
  "vi-du",
  "so-lieu",
  "tinh-huong",
  "ket-luan",
] as const;
export type ContentHint = (typeof CONTENT_TYPES)[number];

export interface DocumentOutline {
  title: string;
  totalWordCount: number;
  /** Seconds if the whole document were narrated at the baseline rate. */
  estimatedFullNarrationSec: number;
  /** ceil(estimate / maxVideoSec) — starting point for series planning. */
  suggestedVideoCount: number;
  /** Images found in the source and dropped (templates own all visuals). */
  imageCount: number;
  sections: OutlineSection[];
}

/** Narration rate measured on the series voice (25/09/2026); previews report the live rate. */
export const NARRATION_WORDS_PER_MINUTE = 215;
/** Target length per video: about three minutes (chốt 30/09/2026). */
export const TARGET_VIDEO_DURATION_SEC = 180;
/** Hard cap per video: three minutes plus the allowed 15-second tolerance. */
export const MAX_VIDEO_DURATION_SEC = 195;

export function vietnameseSlug(value: string, maxLength = 60): string {
  const slug = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "phan";
}

function cleanInline(text: string): string {
  return text
    .replace(/\\([^\s])/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\((?:https?:\/\/)?[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+|www\.\S+/gi, " ")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHeading(text: string): string {
  return cleanInline(text)
    .replace(/^[\p{Extended_Pictographic}\u{FE0E}\u{FE0F}\s]+/u, "")
    .trim();
}

const NUMBER_TOKEN =
  /[$]?\d+(?:[.,]\d+)*\s*(?:%|MP|mAh|GB|TB|MB|KB|GHz|MHz|Hz|km|kg|ms|triệu|tỷ|nghìn|đô la|USD|VND)?/gi;

function extractNumbers(text: string): string[] {
  const found = text.match(NUMBER_TOKEN) ?? [];
  const unique = new Set<string>();
  for (const token of found) {
    const compact = token.trim();
    // Skip bare list markers like "1." captured from ordered lists.
    if (/^\d+[.,]$/.test(compact)) continue;
    unique.add(compact);
  }
  return [...unique];
}

interface MutableSection {
  level: number;
  heading: string | null;
  paragraphs: string[];
  bullets: string[];
  orderedCount: number;
}

const HINT_PATTERNS: Array<[ContentHint, RegExp]> = [
  ["khai-niem", /là gì|khái niệm|định nghĩa|bản chất|hiểu đúng/i],
  ["nguyen-tac", /nguyên tắc|quy tắc|tiêu chuẩn|cam kết/i],
  ["quy-trinh", /quy trình|các bước|bước \d|trình tự|luồng/i],
  ["phan-loai", /phân loại|các loại|nhóm|phân biệt/i],
  ["so-sanh", /so sánh|khác nhau|khác biệt|\bvs\b|thay vì/i],
  ["huong-dan", /hướng dẫn|cách làm|cách thực hiện|thao tác|cách dùng/i],
  ["dieu-kien", /điều kiện|khi nào|trường hợp áp dụng|áp dụng khi/i],
  ["luu-y", /lưu ý|cảnh báo|chú ý|tránh|không được/i],
  ["vi-du", /ví dụ|minh họa|minh hoạ/i],
  ["tinh-huong", /tình huống|case|câu chuyện/i],
  ["ket-luan", /kết luận|tóm tắt|ghi nhớ|checklist|tổng kết|điểm cần nhớ/i],
];

function inferContentHints(
  section: MutableSection,
  numbers: string[],
): ContentHint[] {
  const text = [section.heading ?? "", ...section.paragraphs, ...section.bullets].join(" ");
  const hints = new Set<ContentHint>();
  for (const [hint, pattern] of HINT_PATTERNS) {
    if (pattern.test(section.heading ?? "") || (hint !== "luu-y" && pattern.test(text))) {
      hints.add(hint);
    }
  }
  if (section.orderedCount >= 2) hints.add("quy-trinh");
  if (section.bullets.length - section.orderedCount >= 3) hints.add("danh-sach");
  if (numbers.length > 0) hints.add("so-lieu");
  return CONTENT_TYPES.filter((type) => hints.has(type));
}

export function parseDocumentOutline(
  rawContent: string,
  options: { title?: string; maxVideoSec?: number } = {},
): DocumentOutline {
  const maxVideoSec = options.maxVideoSec ?? TARGET_VIDEO_DURATION_SEC;
  const lines = rawContent.replace(/^﻿/, "").replace(/\r/g, "").split("\n");

  let imageCount = 0;
  let title = options.title?.trim() ?? "";
  const sections: MutableSection[] = [];
  let current: MutableSection | null = null;
  let paragraphBuffer: string[] = [];

  const ensureSection = (): MutableSection => {
    if (!current) {
      current = { level: 0, heading: null, paragraphs: [], bullets: [], orderedCount: 0 };
      sections.push(current);
    }
    return current;
  };

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) return;
    const text = cleanInline(paragraphBuffer.join(" "));
    paragraphBuffer = [];
    if (countWords(text) >= 3) ensureSection().paragraphs.push(text);
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    imageCount += (line.match(/!\[[^\]]*]\([^)]*\)/g) ?? []).length;

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      const heading = cleanHeading(headingMatch[2]);
      const level = headingMatch[1].length;
      if (!heading) continue;
      if (!title && level === 1) {
        title = heading;
        continue;
      }
      current = { level, heading, paragraphs: [], bullets: [], orderedCount: 0 };
      sections.push(current);
      continue;
    }

    const bulletMatch = line.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      flushParagraph();
      const bullet = cleanInline(bulletMatch[1]);
      if (countWords(bullet) >= 2) ensureSection().bullets.push(bullet);
      continue;
    }

    const orderedMatch = line.match(/^\d+[.)]\s+(.*)$/);
    if (orderedMatch) {
      flushParagraph();
      const step = cleanInline(orderedMatch[1]);
      if (countWords(step) >= 2) {
        const section = ensureSection();
        section.bullets.push(step);
        section.orderedCount += 1;
      }
      continue;
    }

    if (!line || /^[-*_]{3,}$/.test(line)) {
      flushParagraph();
      continue;
    }

    paragraphBuffer.push(line);
  }
  flushParagraph();

  const outlineSections: OutlineSection[] = sections
    .filter((section) => section.paragraphs.length > 0 || section.bullets.length > 0)
    .map((section, index) => {
      const bodyText = [...section.paragraphs, ...section.bullets].join(" ");
      const wordCount = countWords(bodyText);
      const slugSource = section.heading ?? "mo-dau";
      const numbers = extractNumbers(bodyText);
      return {
        id: `phan-${String(index + 1).padStart(2, "0")}-${vietnameseSlug(slugSource)}`,
        level: section.level,
        heading: section.heading,
        paragraphs: section.paragraphs,
        bullets: section.bullets,
        wordCount,
        estimatedNarrationSec:
          Math.round((wordCount / NARRATION_WORDS_PER_MINUTE) * 60 * 10) / 10,
        numbers,
        contentHints: inferContentHints(section, numbers),
      };
    });

  if (outlineSections.length === 0) {
    throw new Error("Document has no readable content to outline.");
  }

  const totalWordCount = outlineSections.reduce(
    (sum, section) => sum + section.wordCount,
    0,
  );
  const estimatedFullNarrationSec =
    Math.round((totalWordCount / NARRATION_WORDS_PER_MINUTE) * 60 * 10) / 10;

  return {
    title: title || outlineSections[0].heading || "Tài liệu",
    totalWordCount,
    estimatedFullNarrationSec,
    suggestedVideoCount: Math.max(
      1,
      Math.ceil(estimatedFullNarrationSec / maxVideoSec),
    ),
    imageCount,
    sections: outlineSections,
  };
}
