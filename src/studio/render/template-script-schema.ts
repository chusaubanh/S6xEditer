import { z } from "zod";
import { VIENEU_STYLES, VIENEU_VOICE_IDS } from "../tts/vieneu-voices.js";

/**
 * Script schema for the HyperFrames template pipeline. Each scene names a
 * vendored template under templates/<templateId>/ and supplies `inputs` matching that template's
 * data-composition-variables. The agent only fills text — the template owns the
 * visual design. inputs are kept loose here; each template validates its own.
 */

const SfxSpec = z.object({
  name: z.string().min(1),
  volume: z.number().min(0).max(1).default(0.4),
  startOffsetSec: z.number().default(0),
});
export type TplSfxSpecType = z.infer<typeof SfxSpec>;

const TemplateScene = z.object({
  id: z.string().min(1),
  type: z.enum(["hook", "body", "outro"]),
  /** Spoken narration (Vietnamese, spelled-out numbers — see skill rules). */
  voiceText: z.string().min(1),
  /**
   * The narration split into sentences — exactly one sentence per entry
   * (chốt 30/09/2026: the picture changes with each spoken sentence). The
   * pipeline synthesizes each sentence as its own TTS call, concatenates them
   * with a short gap, and overwrites `inputs.delays` with each sentence's real
   * start time, so visual beat i lands exactly when sentence i starts.
   * Joined with spaces they must read as `voiceText`, which stays the source of
   * truth for validation, script.txt, and captions. Required when `voiceText`
   * has more than one sentence.
   */
  voiceSegments: z.array(z.string().min(1)).min(2).max(8).optional(),
  /** Source section/heading this scene covers ("Mục/Phần" in script-review.md). */
  section: z.string().min(1).optional(),
  /**
   * The illustration and motion shown while each sentence is spoken, drawn only
   * from the source — the "Nội dung trực quan" column the reviewer reads before
   * render. An array gives one entry per sentence (same order as
   * `voiceSegments`); a single string describes the whole scene. The screen
   * illustrates the narration; it never writes it out.
   */
  visual: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  /** Optional non-verbal cue supported by VieNeu-TTS. */
  voiceCue: z.enum(["cười", "thở dài", "hắng giọng"]).optional(),
  /** Folder name under templates/, e.g. "frame-modau-hook". */
  templateId: z.string().min(1),
  /** Text slots for the template's data-composition-variables. */
  inputs: z.record(z.string(), z.unknown()).default({}),
  /** Optional SFX override (else picked per scene.type + voiceText keywords). */
  sfx: SfxSpec.optional(),
  /** Optional array of precise SFX cues within the scene (for each motion/transition). */
  sfxCues: z.array(SfxSpec).optional(),
});
export type TemplateSceneType = z.infer<typeof TemplateScene>;

export const TemplateScriptSchema = z.object({
  version: z.literal("1.0"),
  /** Discriminator: marks this as a HyperFrames-template script. */
  renderer: z.literal("hyperframes"),
  metadata: z.object({
    title: z.string().min(1),
    source: z.object({
      url: z.string(),
      domain: z.string(),
      image: z.string().url().nullable(),
    }),
    channel: z.string().min(1),
  }),
  voice: z.object({
    provider: z.literal("vieneu").default("vieneu"),
    preset: z.enum(VIENEU_VOICE_IDS).default("Phạm Tuyên"),
    style: z.enum(VIENEU_STYLES).default("tin_tuc"),
    speed: z.number().min(0.5).max(2.0).default(1),
    /** Pause between sentences of one scene; default 0.12s. Longer = more time to think (chốt 15/10/2026). */
    sentenceGapSec: z.number().min(0).max(2).optional(),
  }),
  /** Output aspect for every scene (templates render a matching composition). */
  aspect: z.enum(["9:16", "16:9", "1:1", "4:5"]).default("9:16"),
  // Up to ~10 minutes per video at ~6-10s per scene.
  scenes: z
    .array(TemplateScene)
    .min(3)
    .max(60)
    .refine((s) => s[0]?.type === "hook", { message: "scenes[0] must be type=hook" })
    .refine((s) => s[s.length - 1]?.type === "outro", { message: "last scene must be type=outro" })
    .refine((s) => new Set(s.map((scene) => scene.id)).size === s.length, {
      message: "Mã cảnh (scene id) trong kịch bản phải là duy nhất, không được trùng lặp.",
    }),
});

export type TemplateScript = z.infer<typeof TemplateScriptSchema>;
