import { existsSync } from "node:fs";
import { copyFile, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

// ---------- project.json v1 (xem docs/CHE-DO-C-SPEC.md) ----------

export const LayerStyleSchema = z.object({
  fontFamily: z.string().default("Be Vietnam Pro"),
  fontSize: z.number().positive().default(64),
  fontWeight: z.number().default(800),
  color: z.string().default("#EDEDED"),
  accentColor: z.string().default("#C5A059"),
  background: z.string().default("rgba(12,12,12,0.72)"),
  align: z.enum(["left", "center", "right"]).default("center"),
  radius: z.number().min(0).default(16),
  padding: z.number().min(0).default(24),
  strokeColor: z.string().nullable().default(null),
  strokeWidth: z.number().min(0).default(0),
  shadow: z.boolean().default(true),
});

export const WordSchema = z.object({
  text: z.string(),
  start: z.number(),
  end: z.number(),
  score: z.number().optional(),
});

export const AnimInSchema = z.object({
  kind: z.enum(["rise", "drop", "left", "right", "pop", "bounce", "zoom", "soft", "stamp", "fade", "none"]),
  dur: z.number().min(0),
});
export const AnimOutSchema = z.object({
  kind: z.enum(["fade", "shrink", "up", "down", "none"]),
  dur: z.number().min(0),
});
/** Chuyển động lặp trong lúc layer hiển thị (asset): hàm của t, không theo thời gian thực. */
export const AnimLoopSchema = z.object({
  kind: z.enum(["float", "pulse", "wiggle", "spin", "bob", "none"]),
  period: z.number().positive().default(2.4),
  amp: z.number().default(1),
});
export const TransitionKindSchema = z.enum(["flash", "wipe", "panel", "iris", "shutter"]);
/** Chuyển cảnh dạng phủ (không làm mờ video). `dur` = thời gian hiệu ứng; layer.duration = thời gian layer tồn tại (thường bằng nhau). */
export const TransitionSchema = z.object({
  kind: TransitionKindSchema,
  dur: z.number().positive().default(0.4),
  color: z.string().default("#C5A059"),
  dir: z.enum(["left", "right", "up", "down"]).default("left"),
});

export const LayerSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["text", "subtitle", "lowerThird", "callout", "scene", "image", "shape", "audio", "asset", "transition"]),
  start: z.number().min(0),
  duration: z.number().positive(),
  x: z.number().default(0), // layer audio không có hình học
  y: z.number().default(0),
  w: z.number().default(0),
  h: z.number().default(0),
  rotation: z.number().default(0),
  opacity: z.number().min(0).max(1).default(1),
  text: z.string().optional(),
  subtext: z.string().optional(),
  words: z.array(WordSchema).optional(),
  style: LayerStyleSchema.default(() => LayerStyleSchema.parse({})),
  animation: z
    .object({
      in: AnimInSchema.default({ kind: "fade", dur: 0.3 }),
      out: AnimOutSchema.default({ kind: "fade", dur: 0.3 }),
      subtitleMode: z.enum(["line", "word"]).optional(),
      loop: AnimLoopSchema.optional(), // chỉ asset
    })
    .default(() => ({ in: { kind: "fade" as const, dur: 0.3 }, out: { kind: "fade" as const, dur: 0.3 } })),
  templateId: z.string().optional(),
  inputs: z.record(z.string(), z.unknown()).optional(),
  src: z.string().optional(),
  // chỉ layer asset (SVG trong assets/th-assets/)
  tint: z.string().optional(), // đổi màu chính của SVG đơn sắc
  draw: z.object({ dur: z.number().positive() }).optional(), // vẽ nét SVG dần (stroke-dashoffset)
  // chỉ layer transition: dạng lồng `transition` (chuẩn) hoặc dạng phẳng kind/color/dir (chấp nhận khi đọc)
  transition: TransitionSchema.optional(),
  kind: TransitionKindSchema.optional(),
  color: z.string().optional(),
  dir: z.enum(["left", "right", "up", "down"]).optional(),
  // chỉ layer audio
  offset: z.number().min(0).optional(),
  gainDb: z.number().optional(),
  fadeIn: z.number().min(0).optional(),
  fadeOut: z.number().min(0).optional(),
  meta: z
    .object({
      outlineId: z.string().optional(),
      source: z.enum(["auto", "ai", "user"]).optional(),
      presetId: z.string().optional(),
      variantId: z.string().optional(),
      category: z.string().optional(),
      linkedLayerId: z.string().optional(),
      linkEdge: z.enum(["in", "out"]).optional(),
      loop: z.boolean().optional(), // layer nhạc: false = phát một lần rồi fade-out
      autoAvoid: z.boolean().optional(), // phụ đề tự tránh thẻ scene (16:9)
      overlay: z.boolean().optional(), // scene: nền trong suốt, chồng lên video (không che người nói)
    })
    .passthrough() // giữ trường meta mới chưa khai báo thay vì zod lặng lẽ bỏ đi
    .optional(),
});

export const TrackSchema = z
  .object({
  id: z.string().min(1),
  kind: z.enum(["graphics", "subtitle", "scene", "sfx", "music"]),
  name: z.string(),
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
  layers: z.array(LayerSchema).default([]),
  /** Vẽ DƯỚI video (nền cho chế độ pip). Thứ tự vẽ: track belowVideo → video (videoMoves) → các track còn lại. */
  belowVideo: z.boolean().optional(),
  })
  .refine((t) => !["sfx", "music"].includes(t.kind) || t.layers.every((l) => l.type === "audio"), {
    message: "Track sfx/music chỉ chứa layer type audio",
  });

export const VideoMoveSchema = z
  .object({
    id: z.string().optional(), // editor gán để chọn/kéo
    source: z.enum(["auto", "ai", "user"]).optional(), // "ai": do th:broll dựng, dựng lại sẽ xoá
    beatId: z.string().optional(), // "auto-N": zoom nhẹ do camera auto sinh
    start: z.number().min(0),
    end: z.number().positive(),
    mode: z.enum(["zoom", "pip", "kenburns"]),
    scale: z.number().positive().default(1),
    x: z.number().default(0),
    y: z.number().default(0),
    pip: z
      .object({
        x: z.number().default(62),
        y: z.number().default(58),
        w: z.number().positive().default(34),
        radius: z.number().min(0).default(24),
        shadow: z.boolean().default(true),
      })
      .optional(),
    ease: z.object({ in: z.number().min(0).default(0.35), out: z.number().min(0).default(0.35) }).default({ in: 0.35, out: 0.35 }),
  })
  .refine((m) => m.end > m.start, { message: "videoMoves: end phải lớn hơn start" })
  .transform((m) => (m.mode === "pip" && !m.pip ? { ...m, pip: { x: 62, y: 58, w: 34, radius: 24, shadow: true } } : m));

/** Các đoạn chuyển động không được chồng thời gian (đã/được sắp theo start). */
export const VideoMovesSchema = z.array(VideoMoveSchema).default([]).superRefine((arr, ctx) => {
  const a = [...arr].sort((m, n) => m.start - n.start);
  for (let i = 1; i < a.length; i++) {
    if (a[i].start < a[i - 1].end - 1e-6) {
      ctx.addIssue({ code: "custom", message: `videoMoves chồng thời gian: [${a[i - 1].start}, ${a[i - 1].end}] và [${a[i].start}, ${a[i].end}]` });
    }
  }
});

/** Dịch ngang khung hình (% canvas) cộng THÊM lên videoTransform + videoMoves, có ease vào/ra; được phép chồng thời gian với videoMoves (cộng dồn). */
export const VideoShiftSchema = z.object({
  id: z.string().optional(),
  start: z.number().min(0),
  end: z.number().positive(),
  x: z.number(),
  ease: z.object({ in: z.number().min(0).default(0.5), out: z.number().min(0).default(0.5) }).default({ in: 0.5, out: 0.5 }),
  source: z.enum(["auto", "ai", "user"]).optional(),
  beatId: z.string().optional(),
});

export const ProjectAudioSchema = z.object({
  voice: z.object({ gainDb: z.number().default(0), muted: z.boolean().default(false) }).default({ gainDb: 0, muted: false }),
  music: z
    .object({ duckDb: z.number().default(-12), attack: z.number().default(0.15), release: z.number().default(0.45) })
    .default({ duckDb: -12, attack: 0.15, release: 0.45 }),
  master: z.object({ lufs: z.number().default(-16), truePeak: z.number().default(-1.5) }).default({ lufs: -16, truePeak: -1.5 }),
});

/** Khung hình video gốc: phóng (1 = vừa phủ kín canvas, < 1 để lộ nền ink), dịch % canvas. Tự do: được lộ nền, giới hạn chỉ để render không phình. */
export const VideoTransformSchema = z.object({
  scale: z.number().min(0.2).max(4).default(1),
  x: z.number().min(-200).max(200).default(0),
  y: z.number().min(-200).max(200).default(0),
});
export type VideoTransform = z.infer<typeof VideoTransformSchema>;

/** Đoạn video gốc trên timeline (tuần tự, không khoảng hở). source: [srcIn, srcOut) giây trên video gốc; hold: giữ khung tại srcIn trong dur giây. */
export const VideoClipSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["source", "hold"]),
    srcIn: z.number().min(0),
    srcOut: z.number().min(0).optional(),
    dur: z.number().positive().optional(),
    transform: VideoTransformSchema.optional(), // khung riêng của clip (ghi đè videoTransform toàn cục cho đúng đoạn này)
  })
  .refine((c) => c.kind !== "source" || (c.srcOut !== undefined && c.srcOut > c.srcIn), { message: 'clip "source" cần srcOut > srcIn' })
  .refine((c) => c.kind !== "hold" || (c.dur !== undefined && c.dur > 0), { message: 'clip "hold" cần dur > 0' });
export type VideoClip = z.infer<typeof VideoClipSchema>;

/** Phần của videoClips ảnh hưởng tới cut.mp4/audio.wav (id, loại, mốc nguồn, dur). transform và mọi trường chỉ thuộc khung hình bị loại: reframe không đổi video/audio dựng ra nên không được làm mất cache. */
export const clipsMediaKey = (clips: VideoClip[] | undefined): unknown =>
  clips?.map((c) => ({ id: c.id, kind: c.kind, srcIn: c.srcIn, srcOut: c.srcOut, dur: c.dur })) ?? null;

/** Độ dài một clip (giây). */
export const clipDuration = (c: VideoClip): number => (c.kind === "hold" ? c.dur! : c.srcOut! - c.srcIn);

export const ProjectSchema = z.object({
  version: z.literal(1),
  job: z.string().min(1),
  fps: z.number().positive().default(30),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspect: z.string(),
  duration: z.number().min(0),
  source: z.object({
    video: z.string(),
    audio: z.string().optional(),
    raw: z.string().optional(), // video gốc đầy đủ (tương đối thư mục job)
    rawAudio: z.string().optional(), // giọng đã giảm ồn cho CẢ nguồn (DeepFilter 1 lần, không loudnorm)
    proxy: z.string().optional(), // proxy editor: GOP ngắn + giọng đã giảm ồn
  }),
  revision: z.number().int().min(0).default(0), // tăng mỗi lần lưu; server từ chối PUT có revision cũ hơn bản trên đĩa
  videoClips: z.array(VideoClipSchema).optional(), // có = nguồn sự thật của cut.mp4/audio.wav/transcript.cut.json
  videoTransform: VideoTransformSchema.default({ scale: 1, x: 0, y: 0 }),
  camera: z.object({ aiEnabled: z.boolean().default(true) }).optional(), // aiEnabled=false: bỏ qua mọi videoMoves/videoShifts có source "ai" (preview + render)
  tracks: z.array(TrackSchema).default([]),
  videoMoves: VideoMovesSchema, // chuyển động máy quay trên video gốc (zoom/pip/kenburns); project cũ không có = []
  videoShifts: z.array(VideoShiftSchema).default([]), // dịch ngang người nói khi có overlay (th:broll, beat side)
  audio: ProjectAudioSchema.optional(), // project cũ không có vẫn hợp lệ
});

export type LayerStyle = z.infer<typeof LayerStyleSchema>;
export type Layer = z.infer<typeof LayerSchema>;
export type Track = z.infer<typeof TrackSchema>;
export type Project = z.infer<typeof ProjectSchema>;
export type VideoMove = z.infer<typeof VideoMoveSchema>;
export type VideoShift = z.infer<typeof VideoShiftSchema>;
export type Transition = z.infer<typeof TransitionSchema>;

// ---------- transcript / outline / cuts / approval / run ----------

export const TranscriptSchema = z.object({
  language: z.string().default("vi"),
  model: z.string().optional(),
  duration: z.number().optional(),
  segments: z.array(
    z.object({
      id: z.number().int(),
      start: z.number(),
      end: z.number(),
      text: z.string(),
      words: z.array(WordSchema).default([]),
    }),
  ),
});
export type Transcript = z.infer<typeof TranscriptSchema>;
export type Segment = Transcript["segments"][number];

export interface OutlineItem {
  id: string; // "1", "1.1"...
  title: string;
  level: number;
  start: number;
  end: number;
  children?: OutlineItem[];
}
export const OutlineItemSchema: z.ZodType<OutlineItem> = z.lazy(() =>
  z.object({
    id: z.string().regex(/^\d+(\.\d+)*$/),
    title: z.string(),
    level: z.number().int().min(1),
    start: z.number(),
    end: z.number(),
    children: z.array(OutlineItemSchema).optional(),
  }),
);
export const OutlineSchema = z.object({ summary: z.string(), items: z.array(OutlineItemSchema) });
export type Outline = z.infer<typeof OutlineSchema>;

export const CutRangeSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  reason: z.string(),
  source: z.enum(["auto", "user", "ai"]),
  approved: z.boolean().default(false),
  kind: z.enum(["filler-vad", "filler-word", "silence", "filler-voiced", "breath", "retake", "manual"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
  voicedRatio: z.number().optional(), // số đo âm học của vùng VAD không có từ
  f0Median: z.number().optional(),
  gainDb: z.number().optional(), // tuỳ chọn: hạ âm lượng đoạn thay vì cắt (vd. breath -6); th:cut hiện chưa áp dụng
  outlineId: z.string().optional(),
});
export const CutsSchema = z.object({
  mode: z.enum(["remove", "keep"]).default("remove"),
  ranges: z.array(CutRangeSchema),
});
export type CutRange = z.infer<typeof CutRangeSchema>;
export type Cuts = z.infer<typeof CutsSchema>;

const StageSchema = z.object({ approvedAt: z.string(), note: z.string().optional(), hashes: z.record(z.string(), z.string()).optional() }); // sha256 các file đã duyệt
export const ApprovalSchema = z.object({ outline: StageSchema.optional(), cut: StageSchema.optional() });
export type Approval = z.infer<typeof ApprovalSchema>;

export const RunStepSchema = z.object({
  status: z.enum(["pending", "running", "done", "failed", "stale"]),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  durationSec: z.number().optional(),
  error: z.string().optional(),
  outputs: z.array(z.string()).optional(),
});
export const RunSchema = z.object({
  version: z.literal(1).default(1),
  job: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  aspect: z.string().optional(), // khung hình đã chọn ở th:cut
  doc: z.string().optional(), // tên tài liệu gốc (thư mục output/<doc>/...)
  slug: z.string().optional(), // slug video trong tài liệu
  steps: z.record(z.string(), RunStepSchema).default({}),
});
export type Run = z.infer<typeof RunSchema>;

// ---------- load / save project ----------

const MAX_BACKUPS = 20;
const BACKUP_RE = /^project\.backup-.*\.json$/;

export async function loadProject(file: string): Promise<Project> {
  return ProjectSchema.parse(JSON.parse(await readFile(file, "utf8")));
}

/** Kiểm schema, sao lưu bản cũ thành project.backup-<ISO>.json (giữ 20 bản), rồi ghi nguyên tử. */
export async function saveProject(file: string, project: Project): Promise<void> {
  const data = ProjectSchema.parse(project);
  const dir = join(file, "..");
  if (existsSync(file)) {
    const stamp = new Date().toISOString().replace(/:/g, "-");
    await copyFile(file, join(dir, `project.backup-${stamp}.json`));
    const old = (await readdir(dir)).filter((f) => BACKUP_RE.test(f)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - MAX_BACKUPS))) await unlink(join(dir, f));
  }
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, file);
}
