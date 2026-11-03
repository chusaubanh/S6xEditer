import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { VIENEU_STYLES } from "../tts/vieneu-voices.js";

/**
 * Single source of truth for S6X brand identity and editorial personas.
 * Everything that used to be hard-coded (channel name, outro URL, taglines,
 * CTA copy) must come from assets/brand/brand-guideline.json through here.
 */

const PersonaSchema = z.object({
  label: z.string().min(1),
  docTypes: z.array(z.string().min(1)).min(1),
  addressing: z.string().min(1),
  defaultVoiceStyle: z.enum(VIENEU_STYLES),
  voiceGuide: z.array(z.string().min(1)).min(1),
  hookGuide: z.string().min(1),
  ctaGuide: z.string().min(1),
});
export type BrandPersona = z.infer<typeof PersonaSchema>;

const BrandConfigSchema = z.object({
  brand: z.string().min(1),
  logo: z.string().min(1),
  watermark: z.string().optional(),
  identity: z.object({
    channel: z.string().min(1),
    shortName: z.string().min(1),
    url: z.string().min(1),
    /**
     * Brand slogan for the outro. Empty until leadership confirms one: "Kiến tạo
     * giá trị thật" was pulled on 30/09/2026 (not confirmed as the vision for S6x).
     */
    tagline: z.string().default(""),
    /** Slogans that must not appear in narration or on screen any more. */
    retiredTaglines: z.array(z.string().min(1)).default([]),
    outroCta: z.string().min(1),
  }),
  narration: z
    .object({
      /** Written form → spoken form, applied to voiceText on word boundaries. */
      replacements: z.record(z.string(), z.string()).default({}),
    })
    .default({ replacements: {} }),
  palette: z.record(z.string(), z.string()),
  semantic: z.record(z.string(), z.string()),
  personas: z.record(z.string(), PersonaSchema),
});
export type BrandConfig = z.infer<typeof BrandConfigSchema>;

const moduleDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_GUIDELINE_PATH = resolve(
  moduleDir,
  "../../../assets/brand/brand-guideline.json",
);

let cached: BrandConfig | null = null;
let cachedPath: string | null = null;

export function loadBrandConfig(guidelinePath = DEFAULT_GUIDELINE_PATH): BrandConfig {
  if (cached && cachedPath === guidelinePath) return cached;

  let raw: string;
  try {
    raw = readFileSync(guidelinePath, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read brand guideline at "${guidelinePath}". ` +
        `The pipeline requires assets/brand/brand-guideline.json. (${String(error)})`,
    );
  }

  const parsed = BrandConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Brand guideline is invalid: ${details}`);
  }

  cached = parsed.data;
  cachedPath = guidelinePath;
  return cached;
}

export function listPersonaIds(config = loadBrandConfig()): string[] {
  return Object.keys(config.personas);
}

export function getPersona(
  personaId: string,
  config = loadBrandConfig(),
): BrandPersona {
  const persona = config.personas[personaId];
  if (!persona) {
    throw new Error(
      `Unknown persona "${personaId}". Available: ${listPersonaIds(config).join(", ")}.`,
    );
  }
  return persona;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Rewrite written brand forms into their spoken forms for narration
 * (e.g. "S6x" → "Công ty Mẫu"). Longest keys win so overlapping
 * entries cannot partially rewrite each other. Display inputs keep the
 * original written form — this is for voiceText only.
 */
export function applyNarrationReplacements(
  text: string,
  config = loadBrandConfig(),
): string {
  const entries = Object.entries(config.narration.replacements).sort(
    ([left], [right]) => right.length - left.length,
  );
  let result = text;
  for (const [written, spoken] of entries) {
    result = result.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(written)}(?![\\p{L}\\p{N}])`, "gu"),
      spoken,
    );
  }
  return result;
}

/** Test hook: drop the memoized config so a different path can be loaded. */
export function resetBrandConfigCache(): void {
  cached = null;
  cachedPath = null;
}
