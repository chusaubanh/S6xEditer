import { countWords, inspectNarration, integerToVietnamese } from "./vietnamese-narration";
import { MAX_SINGLE_VIDEO_SEC, type TrainingScript } from "./training-contract";

export interface ScriptIssue {
  level: "error" | "warning";
  where: string;
  message: string;
}

const MAX_WORDS_PER_LABEL = 8;
const MAX_REPEATED_WORDS = 5;
/** Tốc độ đọc ở speed 1, hiệu chỉnh theo giọng đo thật của bài Mở đầu (31/10/2026). */
export const ESTIMATE_WORDS_PER_SEC = 250 / 60;

const normalize = (text: string): string =>
  text.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

const words = (text: string): string[] => normalize(text).split(" ").filter(Boolean);
const digits = (text: string): string[] => text.match(/\d+(?:[.,]\d+)*/g) ?? [];

export function estimateSentenceSec(text: string): number {
  return Math.max(1, countWords(text) / ESTIMATE_WORDS_PER_SEC);
}

export function estimateTotalSec(script: TrainingScript): number {
  return script.scenes
    .flatMap((scene) => scene.voiceSegments)
    .reduce((sum, text) => sum + estimateSentenceSec(text) / script.voice.speed + script.voice.sentenceGapSec, script.scenes.length * script.voice.sceneGapSec);
}

/** Máy chỉ bắt được từ và số lạ. Tính đúng nghĩa vẫn do S6 đọc đối chiếu. */
export function checkAgainstSource(script: TrainingScript, source: string): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  const sourceWords = new Set(words(source));
  const sourceDigits = new Set(digits(source));

  for (const scene of script.scenes) {
    for (const label of scene.labels) {
      const unknown = words(label).filter((word) => !sourceWords.has(word));
      if (unknown.length > 0) {
        issues.push({
          level: "error",
          where: `${scene.id} / nhãn "${label}"`,
          message: `Có từ không nằm trong tài liệu: ${unknown.join(", ")}`,
        });
      }
    }
    const spoken = [...scene.voiceSegments, ...scene.labels];
    for (const text of spoken) {
      for (const number of digits(text)) {
        if (!sourceDigits.has(number)) {
          issues.push({ level: "error", where: scene.id, message: `Số ${number} không có trong tài liệu: "${text}"` });
        }
      }
    }
  }
  return issues;
}

const NUMBER_WORDS = new Set("không một mốt hai ba bốn tư năm lăm sáu bảy tám chín mười mươi trăm linh lẻ nghìn ngàn triệu tỷ".split(" "));
const NUMBER_ANCHORS = new Set("mười mươi trăm nghìn ngàn triệu tỷ".split(" "));
const COUNT_UNITS = new Set("phút giờ giây ngày tuần tháng bước".split(" "));

/** Lời đọc phải viết số bằng chữ, nên số sai chỉ bắt được bằng cách đọc các cụm số. */
export function spokenNumbers(text: string): string[] {
  const tokens = words(text);
  const found: string[] = [];
  let run: string[] = [];
  const flush = (next?: string) => {
    const phrase = run.join(" ");
    const counted = next !== undefined && COUNT_UNITS.has(next) && phrase !== "một";
    if (run.length && (hasAnchor(phrase) || counted)) found.push(phrase);
    run = [];
  };
  for (const token of tokens) {
    if (NUMBER_WORDS.has(token)) run.push(token);
    else flush(token);
  }
  flush();
  return found;
}

const hasAnchor = (phrase: string): boolean => phrase.split(" ").some((word) => NUMBER_ANCHORS.has(word));

export function checkSpokenNumbers(script: TrainingScript, source: string): ScriptIssue[] {
  const allowed = normalize(source);
  const fromDigits = digits(source)
    .map((value) => Number(value.replace(/[.,]/g, "")))
    .filter(Number.isSafeInteger)
    .map((value) => normalize(integerToVietnamese(value)));
  return script.scenes.flatMap((scene) =>
    scene.voiceSegments.flatMap((text) =>
      spokenNumbers(text)
        .filter((phrase) => !fromDigits.includes(phrase) && !allowed.includes(phrase))
        .map((phrase) => ({ level: "error" as const, where: scene.id, message: `Số "${phrase}" không có trong tài liệu: "${text}"` })),
    ),
  );
}

/** Nhãn phải ngắn và không chép lại lời đọc. */
export function checkLabels(script: TrainingScript): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  for (const scene of script.scenes) {
    const voice = normalize(scene.voiceSegments.join(" "));
    for (const label of scene.labels) {
      const labelWords = words(label);
      if (labelWords.length > MAX_WORDS_PER_LABEL) {
        issues.push({ level: "error", where: scene.id, message: `Nhãn quá ${MAX_WORDS_PER_LABEL} từ: "${label}"` });
      }
      for (let i = 0; i + MAX_REPEATED_WORDS <= labelWords.length; i++) {
        if (voice.includes(labelWords.slice(i, i + MAX_REPEATED_WORDS).join(" "))) {
          issues.push({ level: "error", where: scene.id, message: `Nhãn chép từ ${MAX_REPEATED_WORDS} từ liên tiếp của lời đọc: "${label}"` });
          break;
        }
      }
    }
    const allowed = 25 + Math.max(0, scene.voiceSegments.length - 3) * 5;
    const total = scene.labels.reduce((sum, label) => sum + words(label).length, 0);
    if (total > allowed) {
      issues.push({ level: "warning", where: scene.id, message: `Cảnh có ${total} từ trên màn hình, quá mức ${allowed}.` });
    }
  }
  return issues;
}

/** Câu chào tên thương hiệu ở màn kết đã được duyệt, ngắn là có chủ ý. */
const BRAND_SIGN_OFF = "Công ty Mẫu.";

export function checkNarration(script: TrainingScript): ScriptIssue[] {
  return script.scenes.flatMap((scene) =>
    scene.voiceSegments.flatMap((text, i) =>
      inspectNarration(text).filter((issue) => !(issue.code === "too-short" && text === BRAND_SIGN_OFF)).map((issue) => ({
        level: "error" as const,
        where: `${scene.id} / câu ${i + 1}`,
        message: `${issue.code}: ${issue.message}`,
      })),
    ),
  );
}

export function checkLength(script: TrainingScript): ScriptIssue[] {
  const issues: ScriptIssue[] = [];
  if (script.lengthDecision.status === "pending") {
    issues.push({ level: "error", where: "lengthDecision", message: "Đang chờ người dùng chốt phương án thời lượng." });
  }
  const estimate = estimateTotalSec(script);
  const accepted = script.lengthDecision.status === "split" || (script.lengthDecision.status === "single" && script.lengthDecision.overLimitAccepted === true);
  if (estimate > MAX_SINGLE_VIDEO_SEC && !accepted) {
    issues.push({
      level: "error",
      where: "thời lượng",
      message: `Ước tính ${Math.round(estimate)} giây, vượt ${MAX_SINGLE_VIDEO_SEC} giây. Phải trình phương án tách.`,
    });
  }
  return issues;
}

export function checkScript(script: TrainingScript, source: string): ScriptIssue[] {
  return [
    ...checkLength(script),
    ...checkNarration(script),
    ...checkLabels(script),
    ...checkAgainstSource(script, source),
    ...checkSpokenNumbers(script, source),
  ];
}

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** Bảng duyệt theo mẫu của brief: STT, Mục, Lồng tiếng, Trực quan, Thời lượng. */
export function renderScriptReview(script: TrainingScript): string {
  const { analysis } = script;
  const lines: string[] = [
    `# Kịch bản duyệt: ${script.title}`,
    "",
    "## Tóm tắt phân tích và phân loại nội dung",
    "",
    "| Nhóm | Loại | Người học cần hiểu | Bắt buộc giữ | Có thể lược | Ví dụ giữ lại | Cách truyền đạt |",
    "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
    ...analysis.contentGroups.map((group) =>
      `| ${[group.title, group.contentType, group.learnerNeeds, group.mustKeep.join("; "), group.canDrop.join("; ") || "—", group.examples.join("; ") || "—", group.delivery].map(cell).join(" | ")} |`,
    ),
    "",
    "## Tóm tắt logic tiếp nhận",
    "",
    analysis.learningLogic,
    "",
    `**Nguyên lý áp dụng:** ${analysis.principles.join(", ")}`,
    "",
    `**Khổ hình:** ${script.aspect}. **Giọng:** ${script.voice.id} (${script.voice.tone}, tốc độ ${script.voice.speed}).`,
    "",
    "## Kịch bản",
    "",
    "| STT | Mục/Phần | Nội dung lồng tiếng | Nội dung trực quan | Thời lượng ước tính |",
    "| :---: | :--- | :--- | :--- | :---: |",
  ];
  let index = 1;
  let total = script.scenes.length * script.voice.sceneGapSec;
  for (const scene of script.scenes) {
    scene.voiceSegments.forEach((text, i) => {
      const sec = estimateSentenceSec(text) / script.voice.speed;
      total += sec + script.voice.sentenceGapSec;
      lines.push(`| ${index++} | ${cell(scene.section)} | ${cell(text)} | ${cell(scene.visual[i] ?? "")} | ${sec.toFixed(1)} giây |`);
    });
  }
  const rounded = Math.round(total);
  lines.push("", `**Tổng thời lượng ước tính: ${Math.floor(rounded / 60)} phút ${rounded % 60} giây**`, "");
  return lines.join("\n");
}
