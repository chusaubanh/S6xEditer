import { z } from "zod";
import { CONTENT_TYPES } from "./document-outline";

/**
 * Hợp đồng kịch bản. Mỗi câu thoại đi với một mô tả hành động của hình.
 * Chữ trên màn hình chỉ lấy từ `labels`, nên kiểm được với tài liệu nguồn.
 */

export const ASPECTS = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "4:5": { width: 1080, height: 1350 },
  "1:1": { width: 1080, height: 1080 },
} as const;

export type Aspect = keyof typeof ASPECTS;
export const ASPECT_NAMES = Object.keys(ASPECTS) as [Aspect, ...Aspect[]];

export const FPS = 30;
export const MAX_SINGLE_VIDEO_SEC = 195;

const ContentGroupSchema = z.object({
  title: z.string().min(1),
  contentType: z.enum(CONTENT_TYPES),
  learnerNeeds: z.string().min(1),
  mustKeep: z.array(z.string()).min(1),
  canDrop: z.array(z.string()),
  examples: z.array(z.string()),
  delivery: z.string().min(1),
});

export const AnalysisSchema = z.object({
  contentGroups: z.array(ContentGroupSchema).min(1),
  learningLogic: z.string().min(1),
  principles: z.array(z.string()).min(1),
  fitsOneVideo: z.boolean(),
  lossIfForced: z.string().optional(),
});

export const LengthDecisionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({
    status: z.enum(["single", "split"]),
    confirmedBy: z.string().min(1),
    /** Người dùng đã chấp nhận một video vượt mức, thay vì tách hoặc cắt nội dung. */
    overLimitAccepted: z.boolean().optional(),
  }),
]);

export const SfxCueSchema = z.object({
  src: z.string().min(1),
  sentence: z.number().int().min(0),
  fraction: z.number().min(0).max(1).default(0),
  volume: z.number().min(0).max(1).default(0.6),
  /** Giây trong file mà tiếng đập rõ nhất, để điểm đó trùng đúng nhịp hình. */
  hitSec: z.number().min(0).default(0),
});

export const MusicSchema = z.object({
  src: z.string().min(1),
  /** Mức nhạc khi có lời đọc và khi nghỉ giữa các cảnh. */
  underVoice: z.number().min(0).max(1),
  inGap: z.number().min(0).max(1),
  fadeInSec: z.number().min(0).default(1),
  fadeOutSec: z.number().min(0).default(2),
});

export const TrainingSceneSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    section: z.string().min(1),
    contentType: z.enum(CONTENT_TYPES),
    /** Khoá trong `src/videos/registry.ts`, mỗi video có cảnh riêng. */
    component: z.string().min(1),
    voiceSegments: z.array(z.string().min(2)).min(1),
    /** visual[i] là hành động của hình cho câu i. */
    visual: z.array(z.string().min(5)).min(1),
    /** Toàn bộ chữ được phép hiện trên màn hình trong cảnh này. */
    labels: z.array(z.string().min(1)).default([]),
    sfx: z.array(SfxCueSchema).default([]),
  })
  .superRefine((scene, ctx) => {
    if (scene.voiceSegments.length !== scene.visual.length) {
      ctx.addIssue({
        code: "custom",
        path: ["visual"],
        message: `Có ${scene.voiceSegments.length} câu nhưng ${scene.visual.length} mô tả hình.`,
      });
    }
    for (const cue of scene.sfx) {
      if (cue.sentence >= scene.voiceSegments.length) {
        ctx.addIssue({ code: "custom", path: ["sfx"], message: `SFX trỏ tới câu ${cue.sentence} không tồn tại.` });
      }
    }
  });

export type TrainingScene = z.infer<typeof TrainingSceneSchema>;

export const TrainingScriptSchema = z
  .object({
    version: z.literal("4.0"),
    documentName: z.string().min(1),
    title: z.string().min(1),
    aspect: z.enum(ASPECT_NAMES),
    voice: z.object({
      id: z.string().min(1),
      tone: z.enum(["tu_nhien", "tin_tuc", "doc_truyen"]),
      speed: z.number().min(0.5).max(2).default(1),
      sentenceGapSec: z.number().min(0).max(2).default(0.12),
      /** Khoảng lặng cuối mỗi cảnh, cho người nghe kịp tiếp thu. */
      sceneGapSec: z.number().min(0).max(3).default(0.4),
    }),
    targetAudience: z.string().min(1),
    analysis: AnalysisSchema,
    lengthDecision: LengthDecisionSchema,
    music: MusicSchema.optional(),
    scenes: z.array(TrainingSceneSchema).min(1),
  })
  .superRefine((script, ctx) => {
    const ids = new Set<string>();
    for (const scene of script.scenes) {
      if (ids.has(scene.id)) ctx.addIssue({ code: "custom", path: ["scenes"], message: `Trùng id cảnh: ${scene.id}` });
      ids.add(scene.id);
    }
    if (!script.analysis.fitsOneVideo && !script.analysis.lossIfForced) {
      ctx.addIssue({ code: "custom", path: ["analysis", "lossIfForced"], message: "Không đủ một video thì phải ghi sẽ mất gì nếu ép." });
    }
  });

export type TrainingScript = z.infer<typeof TrainingScriptSchema>;

export const SentenceTimingSchema = z.object({
  text: z.string(),
  audio: z.string(),
  startSec: z.number().min(0),
  durationSec: z.number().positive(),
});

export const SceneTimingSchema = z.object({
  id: z.string(),
  startSec: z.number().min(0),
  durationSec: z.number().positive(),
  sentences: z.array(SentenceTimingSchema).min(1),
});

export const TimelineSchema = z.object({
  totalSec: z.number().positive(),
  scenes: z.array(SceneTimingSchema).min(1),
});

export type SceneTiming = z.infer<typeof SceneTimingSchema>;
export type Timeline = z.infer<typeof TimelineSchema>;

export const secToFrames = (sec: number): number => Math.round(sec * FPS);

/** Dựng timeline từ thời lượng đo được của từng câu; mốc giờ trong cảnh tính từ đầu cảnh. */
export function buildTimeline(
  script: TrainingScript,
  jobKey: string,
  measuredSec: (sceneId: string, sentence: number) => number,
): Timeline {
  const gap = script.voice.sentenceGapSec;
  let cursor = 0;
  const scenes = script.scenes.map((scene) => {
    let inner = 0;
    const sentences = scene.voiceSegments.map((text, i) => {
      const durationSec = measuredSec(scene.id, i);
      const timing = {
        text,
        audio: `jobs/${jobKey}/voice/${scene.id}-${i}.wav`,
        startSec: round(inner),
        durationSec,
      };
      inner += durationSec + gap;
      return timing;
    });
    const durationSec = round(inner - gap + script.voice.sceneGapSec);
    const result = { id: scene.id, startSec: round(cursor), durationSec, sentences };
    cursor += durationSec;
    return result;
  });
  return { totalSec: round(cursor), scenes };
}

const round = (value: number): number => Math.round(value * 1000) / 1000;
