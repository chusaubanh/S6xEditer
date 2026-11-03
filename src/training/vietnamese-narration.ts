const DIGITS = [
  "không",
  "một",
  "hai",
  "ba",
  "bốn",
  "năm",
  "sáu",
  "bảy",
  "tám",
  "chín",
] as const;

const SCALES = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"] as const;

export interface NarrationIssue {
  code:
    | "empty"
    | "url"
    | "emoji"
    | "digit"
    | "forbidden-symbol"
    | "too-short"
    | "too-long"
    | "filler-phrase"
    | "missing-terminal-punctuation";
  message: string;
}

function readTwoDigits(value: number): string {
  if (value < 10) return DIGITS[value];
  if (value < 20) {
    if (value === 10) return "mười";
    if (value === 15) return "mười lăm";
    return `mười ${DIGITS[value - 10]}`;
  }

  const tens = Math.floor(value / 10);
  const ones = value % 10;
  if (ones === 0) return `${DIGITS[tens]} mươi`;
  if (ones === 1) return `${DIGITS[tens]} mươi mốt`;
  if (ones === 5) return `${DIGITS[tens]} mươi lăm`;
  return `${DIGITS[tens]} mươi ${DIGITS[ones]}`;
}

function readThreeDigits(value: number, forceHundreds: boolean): string {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  const parts: string[] = [];

  if (hundreds > 0 || forceHundreds) {
    parts.push(`${DIGITS[hundreds]} trăm`);
    if (rest > 0 && rest < 10) parts.push("linh");
  }
  if (rest > 0) parts.push(readTwoDigits(rest));
  return parts.join(" ");
}

export function integerToVietnamese(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Only non-negative safe integers are supported, got ${value}`);
  }
  if (value === 0) return DIGITS[0];

  const groups: number[] = [];
  let remaining = value;
  while (remaining > 0) {
    groups.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }

  const parts: string[] = [];
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group === 0) continue;
    const forceHundreds = index < groups.length - 1 && group < 100;
    const scale = SCALES[index] ?? `10 mũ ${index * 3}`;
    parts.push(readThreeDigits(group, forceHundreds));
    if (scale) parts.push(scale);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function numericTokenToVietnamese(
  token: string,
  decimalWord: "chấm" | "phẩy" = "phẩy",
  forceDecimal = false,
): string {
  const compact = token.replace(/\s/g, "");
  if (!forceDecimal && /^\d{1,3}(?:[.,]\d{3})+$/.test(compact)) {
    return integerToVietnamese(Number.parseInt(compact.replace(/[.,]/g, ""), 10));
  }

  const normalized = compact.replace(/,/g, ".");
  const [integerPart, ...fractionParts] = normalized.split(".");
  const integerValue = Number.parseInt(integerPart, 10);
  if (!Number.isFinite(integerValue)) return token;

  const parts = [integerToVietnamese(integerValue)];
  if (fractionParts.length > 0) {
    for (const fraction of fractionParts) {
      parts.push(decimalWord);
      parts.push(
        forceDecimal
          ? integerToVietnamese(Number.parseInt(fraction, 10))
          : fraction
              .split("")
              .map((digit) => DIGITS[Number.parseInt(digit, 10)])
              .join(" "),
      );
    }
  }
  return parts.join(" ");
}

function replaceUnits(text: string): string {
  const units: Record<string, string> = {
    mp: "megapixel",
    mah: "miliampe giờ",
    gb: "gigabyte",
    tb: "terabyte",
    mb: "megabyte",
    kb: "kilobyte",
    ghz: "gigahertz",
    mhz: "megahertz",
    hz: "hertz",
    ms: "mili giây",
    km: "ki lô mét",
    kg: "ki lô gam",
    usd: "đô la",
    vnd: "đồng",
    token: "token",
    tokens: "token",
  };

  return text.replace(
    /(\d+(?:[.,]\d+)*)\s*(mAh|GHz|MHz|MP|GB|TB|MB|KB|ms|Hz|km|kg|USD|VND|tokens?)\b/gi,
    (_, rawNumber: string, rawUnit: string) =>
      `${numericTokenToVietnamese(rawNumber)} ${units[rawUnit.toLowerCase()]}`,
  );
}

export function normalizeVietnameseNarration(input: string): string {
  let text = input.normalize("NFC").replace(/\r?\n+/g, " ");

  text = text.replace(/https?:\/\/\S+|www\.\S+/gi, " ");
  text = text.replace(/\p{Extended_Pictographic}/gu, " ");
  text = text.replace(/[\uFE0E\uFE0F]/g, "");

  text = text.replace(
    /\b(GPT|iOS|Android|version|phiên bản|v)\s*(\d+(?:\.\d+)+)\b/gi,
    (_, label: string, version: string) =>
      `${label} ${numericTokenToVietnamese(version, "chấm", true)}`,
  );

  text = text.replace(
    /\b(version|phiên bản|v)\s*(\d+)\b/gi,
    (_, _label: string, version: string) =>
      `phiên bản ${integerToVietnamese(Number(version))}`,
  );

  text = text.replace(
    /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/g,
    (_, day: string, month: string, year: string) =>
      `ngày ${integerToVietnamese(Number(day))} tháng ${integerToVietnamese(Number(month))} năm ${integerToVietnamese(Number(year))}`,
  );

  text = text.replace(
    /\$\s*(\d+(?:[.,]\d+)*)/g,
    (_, amount: string) => `${numericTokenToVietnamese(amount)} đô la`,
  );
  text = text.replace(
    /-\s*(\d+(?:[.,]\d+)*)\s*%/g,
    (_, value: string) => `âm ${numericTokenToVietnamese(value)} phần trăm`,
  );
  text = text.replace(
    /(\d+(?:[.,]\d+)*)\s*%/g,
    (_, value: string) => `${numericTokenToVietnamese(value)} phần trăm`,
  );
  text = text.replace(
    /\b(\d+)\s*:\s*(\d+)\b/g,
    (_, left: string, right: string) =>
      `${integerToVietnamese(Number(left))} trên ${integerToVietnamese(Number(right))}`,
  );
  text = text.replace(
    /\b(\d+)\s*[-–]\s*(\d+)\b/g,
    (_, start: string, end: string) =>
      `từ ${integerToVietnamese(Number(start))} đến ${integerToVietnamese(Number(end))}`,
  );
  text = text.replace(/\b(\d+)\s*x\b/gi, (_, value: string) => {
    const number = Number(value);
    return number === 2 ? "gấp đôi" : `gấp ${integerToVietnamese(number)} lần`;
  });
  text = text.replace(
    /\b(\d+(?:[.,]\d+)*)\s*([KMB])\s+(tokens?)\b/gi,
    (_, value: string, scale: string) => {
      const scaleWords: Record<string, string> = {
        k: "nghìn",
        m: "triệu",
        b: "tỷ",
      };
      return `${numericTokenToVietnamese(value)} ${scaleWords[scale.toLowerCase()]} token`;
    },
  );

  text = replaceUnits(text);
  text = text.replace(
    /\b\d+(?:[.,]\d+)*\b/g,
    (value) => numericTokenToVietnamese(value),
  );

  text = text
    .replace(/&/g, " và ")
    .replace(/\+/g, " cộng ")
    .replace(/=/g, " bằng ")
    .replace(/[→➡]/g, " đến ")
    .replace(/[$#]/g, " ")
    .replace(/[()[\]{}<>]/g, " ")
    .replace(/\s*[/|]\s*/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/([,.;!?]){2,}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (text && !/[.!?]$/.test(text)) text += ".";
  return text;
}

/** Stock lead-ins the training-material instruction bans (chốt 30/09/2026). */
const FILLER_PHRASES: RegExp[] = [
  /như (?:chúng ta|chúng mình|các bạn|bạn|mọi người) (?:đã|đều) biết/iu,
  /tiếp theo,? (?:chúng ta|chúng mình|mình) sẽ/iu,
  /(?:hãy|chúng ta|mình) cùng (?:nhau )?(?:tìm hiểu|khám phá)/iu,
];

export function countWords(text: string): number {
  const words = text.trim().match(/\p{L}+(?:['’-]\p{L}+)*/gu);
  return words?.length ?? 0;
}

export function inspectNarration(
  text: string,
  options: { minWords?: number; maxWords?: number } = {},
): NarrationIssue[] {
  const minWords = options.minWords ?? 4;
  const maxWords = options.maxWords ?? 45;
  const issues: NarrationIssue[] = [];
  const wordCount = countWords(text);

  if (!text.trim()) issues.push({ code: "empty", message: "Lời đọc đang trống." });
  if (/https?:\/\/|www\./i.test(text)) {
    issues.push({ code: "url", message: "Lời đọc không được chứa URL." });
  }
  if (/\p{Extended_Pictographic}/u.test(text)) {
    issues.push({ code: "emoji", message: "Lời đọc không được chứa emoji." });
  }
  if (/\d/.test(text)) {
    issues.push({ code: "digit", message: "Số trong lời đọc phải được viết bằng chữ." });
  }
  if (/[→➡&%$#+=]/.test(text)) {
    issues.push({
      code: "forbidden-symbol",
      message: "Lời đọc còn ký hiệu dễ khiến TTS đọc sai.",
    });
  }
  if (wordCount > 0 && wordCount < minWords) {
    issues.push({ code: "too-short", message: `Lời đọc chỉ có ${wordCount} từ.` });
  }
  if (wordCount > maxWords) {
    issues.push({ code: "too-long", message: `Lời đọc có ${wordCount} từ.` });
  }
  for (const pattern of FILLER_PHRASES) {
    const match = text.match(pattern);
    if (match) {
      issues.push({
        code: "filler-phrase",
        message: `Câu dẫn sáo rỗng "${match[0]}" — bỏ đi hoặc nói thẳng ý tiếp theo.`,
      });
      break;
    }
  }
  if (text.trim() && !/[.!?…]["'”’)}\]]*$/.test(text.trim())) {
    issues.push({
      code: "missing-terminal-punctuation",
      message: "Lời đọc nên kết thúc bằng dấu câu.",
    });
  }
  return issues;
}
