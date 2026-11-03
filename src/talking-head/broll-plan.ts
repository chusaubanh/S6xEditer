import { z } from "zod";
import { normToken } from "./align-edits.js";
import type { Layer, Project, Track } from "./project-schema.js";
import type { Word } from "./types.js";
import { autoCameraMoves, CAMERA_DEFAULTS, CUTAWAY_MARGIN, faceShift, sentenceBoundaries, type CameraOptions } from "./camera-auto.js";

// ---------- schema broll-plan.json ----------

const Rect = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const Trans = z.object({ kind: z.enum(["flash", "wipe", "panel", "iris", "shutter"]), dur: z.number().positive().default(0.4), dir: z.enum(["left", "right", "up", "down"]).optional() });

export const BeatSchema = z
  .object({
    id: z.string().min(1),
    start: z.number().min(0).optional(), // giây trên timeline đã cắt
    end: z.number().min(0).optional(),
    anchor: z // hoặc neo theo từ: wordIndex (theo transcript.cut) hoặc phrase
      .object({ wordIndex: z.number().int().min(0).optional(), phrase: z.string().optional(), offset: z.number().default(0), dur: z.number().positive().default(3) })
      .optional(),
    kind: z.enum(["asset", "cutaway", "overlay", "zoom", "pip", "kenburns", "keyword", "transition"]),
    side: z.enum(["left", "right"]).optional(), // overlay/keyword: phía minh hoạ chiếm; người nói được dịch sang phía ngược lại (videoShifts)
    role: z.enum(["replace", "supplement"]).optional(), // vai trò của minh hoạ: thay lời nói hay bổ sung; chỉ ghi meta + bảng tóm tắt
    src: z.string().optional(), // asset: đường dẫn SVG trực tiếp (không cần manifest)
    cues: z.array(z.object({ phrase: z.string().optional(), wordIndex: z.number().int().min(0).optional() })).optional(), // mốc từ -> inputs.delays của scene
    assetId: z.string().optional(),
    presetId: z.string().optional(),
    variantId: z.string().optional(),
    templateId: z.string().optional(),
    inputs: z.record(z.string(), z.unknown()).optional(),
    text: z.string().optional(),
    position: z.union([z.enum(["left", "right", "top", "center", "auto"]), Rect]).optional(),
    tint: z.string().optional(),
    draw: z.union([z.boolean(), z.object({ dur: z.number().positive() })]).optional(),
    scale: z.number().min(1).max(2).optional(), // zoom/kenburns/pip (pip: bỏ qua)
    transitionIn: Trans.optional(),
    transitionOut: Trans.optional(),
    transition: Trans.optional(), // kind "transition": hiệu ứng đứng riêng tại start
    sfx: z.string().optional(), // "auto" | "none" | tên category
    note: z.string().optional(),
  })
  .refine((b) => b.start !== undefined || b.anchor, { message: "beat cần start/end hoặc anchor" });
const CameraSchema = z.object({
  auto: z.boolean().default(false),
  minGap: z.number().positive().default(3),
  maxGap: z.number().positive().default(6),
  scaleRange: z.tuple([z.number().min(1), z.number().min(1)]).default([1.0, 1.1]),
  punch: z.number().min(1).max(2).default(1.2),
});
// shifts: khoảng dịch người nói không gắn với beat (tiêu đề, lower third...): minh hoạ chiếm phía `side`
const ExtraShiftSchema = z.object({ id: z.string().default("shift"), start: z.number().min(0), end: z.number().positive(), side: z.enum(["left", "right"]) });
export const BrollPlanSchema = z.object({ version: z.literal(1), beats: z.array(BeatSchema), camera: CameraSchema.optional(), introOffset: z.number().min(0).optional(), shifts: z.array(ExtraShiftSchema).default([]) }); // introOffset: th:intro đã chèn intro dài ngần này giây vào đầu
export type Beat = z.infer<typeof BeatSchema>;
export type BrollPlan = z.infer<typeof BrollPlanSchema>;

// ---------- kiểu cục bộ (khớp spec; đổi sang import khi project-schema có đủ) ----------

type AnyLayer = Record<string, unknown> & { id: string; type: string; start: number; duration: number; x: number; y: number; w: number; h: number; meta?: Record<string, unknown> };
type Rectangle = { x: number; y: number; w: number; h: number };
export interface AssetInfo {
  id: string;
  file: string;
  aspect?: number; // rộng / cao
  defaultSize?: { w: number; h?: number }; // % canvas nếu ≤ 100, ngược lại px
  drawable?: boolean;
  tintable?: boolean;
}
export interface BrollContext {
  words: Word[]; // transcript.cut
  segments?: Array<{ start: number; end: number }>; // transcript.cut, để tìm ranh giới câu cho camera auto
  introOffset?: number; // giây: vùng [0, introOffset) là intro, anchor/cues không giải vào đó, camera auto né
  face?: Rectangle; // % canvas, từ subject.json
  assets?: Map<string, AssetInfo>;
  accent?: string;
}
export interface BrollResult {
  project: Project;
  warnings: string[];
  summary: Array<{ start: number; end: number; kind: string; what: string }>;
}

const SAFE = { x0: 6, x1: 94, y0: 5, y1: 95 }; // title-safe (% canvas)
const FACE_MARGIN = 2;
const DEFAULT_FACE_ZONE: Rectangle = { x: 25, y: 8, w: 50, h: 45 }; // không có subject.json: tránh vùng giữa-trên
const OWN_TRACKS = ["t-trans", "t-broll", "t-overlay", "t-scene", "t-scene-below"];

const overlapT = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;
const hit = (a: Rectangle, b: Rectangle, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
const inside = (r: Rectangle) => r.x >= SAFE.x0 && r.y >= SAFE.y0 && r.x + r.w <= SAFE.x1 && r.y + r.h <= SAFE.y1;

/** inputs cho scene: sceneDuration tự điền; delays tính từ cues (mốc tương đối so với start) nếu chưa có. */
export function sceneInputs(b: Beat, t: { start: number; end: number }, words: Word[]): Record<string, unknown> {
  const inputs: Record<string, unknown> = { sceneDuration: +(t.end - t.start).toFixed(3), ...(b.inputs ?? {}) };
  if (b.cues?.length && inputs.delays === undefined) {
    inputs.delays = b.cues.map((c) => {
      const w = resolveBeatTime({ id: "cue", kind: "keyword", anchor: { phrase: c.phrase, wordIndex: c.wordIndex, offset: 0, dur: 1 } }, words);
      return w ? +Math.max(0, w.start - t.start).toFixed(3) : 0;
    });
  }
  return inputs;
}

/** Giải thời gian của beat: start/end trực tiếp hoặc neo theo từ. */
export function resolveBeatTime(b: Beat, words: Word[]): { start: number; end: number } | null {
  if (b.start !== undefined) return { start: b.start, end: b.end ?? b.start + (b.anchor?.dur ?? 3) };
  const a = b.anchor!;
  let idx = a.wordIndex;
  if (idx === undefined && a.phrase) {
    const toks = a.phrase.split(/\s+/).map(normToken).filter(Boolean);
    const norm = words.map((w) => normToken(w.text));
    idx = norm.findIndex((_, i) => toks.every((t, k) => norm[i + k] === t));
    if (idx < 0) return null;
  }
  if (idx === undefined || !words[idx]) return null;
  const start = Math.max(0, words[idx].start + a.offset);
  return { start, end: start + a.dur };
}

function subtitleZones(project: Project, t0: number, t1: number): Rectangle[] {
  return project.tracks
    .flatMap((t) => t.layers)
    .filter((l) => l.type === "subtitle" && overlapT(l.start, l.start + l.duration, t0, t1))
    .map((l) => ({ x: l.x, y: l.y, w: l.w, h: l.h }));
}

function assetSize(info: AssetInfo | undefined, canvas: { w: number; h: number }, widthPct?: number): { w: number; h: number } {
  const ds = info?.defaultSize;
  let w = widthPct ?? (ds ? (ds.w <= 100 ? ds.w : (ds.w / canvas.w) * 100) : 28);
  const aspect = info?.aspect ?? (ds?.h ? ds.w / ds.h : 1);
  let h = ((w * canvas.w) / aspect / canvas.h);
  if (h > 40) { h = 40; w = (h * canvas.h * aspect) / canvas.w; } // không cho một asset chiếm quá nửa khung
  return { w: +w.toFixed(1), h: +h.toFixed(1) };
}

/** Chọn vị trí: tránh mặt, phụ đề, nằm trong title-safe. Trả về null nếu không có chỗ. */
export function placeAuto(size: { w: number; h: number }, face: Rectangle, subs: Rectangle[], taken: Rectangle[], prefer: string = "auto"): Rectangle | null {
  const left = SAFE.x0, right = SAFE.x1 - size.w, top = SAFE.y0 + 1;
  const cand: Record<string, Rectangle[]> = {
    left: [{ x: left, y: 30, w: size.w, h: size.h }, { x: left, y: 16, w: size.w, h: size.h }, { x: left, y: 44, w: size.w, h: size.h }],
    right: [{ x: right, y: 30, w: size.w, h: size.h }, { x: right, y: 16, w: size.w, h: size.h }, { x: right, y: 44, w: size.w, h: size.h }],
    top: [{ x: 50 - size.w / 2, y: top, w: size.w, h: size.h }],
    center: [{ x: 50 - size.w / 2, y: 50 - size.h / 2, w: size.w, h: size.h }],
  };
  const order = prefer === "auto" ? ["right", "left", "top"] : [prefer];
  for (const side of order) {
    for (const r of cand[side] ?? []) {
      if (inside(r) && !hit(r, face, FACE_MARGIN) && !subs.some((s) => hit(r, s, 1)) && !taken.some((t) => hit(r, t, 1))) return r;
    }
  }
  return null;
}

export interface SideItem { start: number; end: number; side: "left" | "right"; beatId: string }
export const SHIFT_CENTER = 70; // người nói nằm quanh 70% (minh hoạ bên trái) hoặc 30% (bên phải) chiều ngang
const SHIFT_EASE = 0.5;

/**
 * Dịch người nói sang phía đối diện minh hoạ. Gộp các mục liền nhau cùng phía (không có cutaway xen giữa);
 * khác phía thì chéo nhau mượt; bắt đầu trước minh hoạ 0.3 s, hoặc ẩn dưới cutaway vừa kết thúc.
 * Khoảng dịch kẹp theo room của crop (không lộ viền): |vt.x + d| ≤ (vt.scale − 1)·50.
 */
export function buildShifts(items: SideItem[], cutaways: Array<{ start: number; end: number }>, faceCx: number, vt: { scale: number; x: number }, duration: number, warnings: string[]): Array<Record<string, unknown>> {
  const groups: Array<SideItem & { ids: string[] }> = [];
  for (const it of [...items].sort((a, b) => a.start - b.start)) {
    const g = groups[groups.length - 1];
    if (g && g.side === it.side && it.start - g.end < 1 && !cutaways.some((c) => c.start < it.start && c.end > g.end)) { g.end = Math.max(g.end, it.end); g.ids.push(it.beatId); }
    else groups.push({ ...it, ids: [it.beatId] });
  }
  const room = Math.max(0, ((vt.scale || 1) - 1) * 50);
  const out: Array<Record<string, unknown>> = [];
  groups.forEach((g, i) => {
    const prev = groups[i - 1], next = groups[i + 1];
    let s = g.start - 0.3, easeIn = SHIFT_EASE;
    const pc = cutaways.find((c) => c.end <= g.start + 1e-6 && g.start - c.end < 1);
    if (pc) s = pc.end - SHIFT_EASE;
    if (prev && prev.side !== g.side && g.start - prev.end < 0.8) s = g.start - 0.25;
    if (s <= 0) { s = 0; easeIn = 0; } // mở đầu video: đã ở vị trí dịch ngay từ khung đầu
    let e = g.end + SHIFT_EASE;
    const nc = cutaways.find((c) => c.start >= g.end - 1e-6 && c.start - g.end < 0.7);
    if (nc) e = nc.start + SHIFT_EASE;
    if (next && next.side !== g.side && next.start - g.end < 0.8) e = next.start + 0.25;
    let d = (g.side === "left" ? SHIFT_CENTER : 100 - SHIFT_CENTER) - faceCx;
    const total = Math.max(-room, Math.min(room, (vt.x || 0) + d));
    if (Math.abs(total - ((vt.x || 0) + d)) > 0.01) { warnings.push(`Dịch người nói ${g.ids.join("+")}: crop không đủ room (|x| ≤ ${room.toFixed(1)}%) — kẹp lại.`); d = total - (vt.x || 0); }
    if (Math.abs(d) < 1) return;
    out.push({ start: +Math.max(0, s).toFixed(3), end: +Math.min(duration, e).toFixed(3), x: +d.toFixed(2), ease: { in: easeIn, out: SHIFT_EASE }, source: "ai", beatId: g.ids.join("+") });
  });
  return out;
}

/**
 * Dựng layer B-roll từ kế hoạch. Thuần: không ghi file. Xoá layer B-roll cũ (meta.source "ai") rồi dựng lại, giữ layer "user".
 * Cảnh báo (không tự sửa nội dung): cutaway ngoài 2–6 s, quay lại người nói < 2 s, không có chỗ đặt, videoMoves chồng nhau.
 */
export function buildBroll(input: Project, plan: BrollPlan, ctx: BrollContext): BrollResult {
  const project = structuredClone(input);
  const pm = project as unknown as { videoMoves?: Array<Record<string, unknown>> }; // khớp spec; đổi sang kiểu schema khi có
  const warnings: string[] = [];
  const summary: BrollResult["summary"] = [];
  const canvas = { w: project.width, h: project.height };
  const face = ctx.face ?? DEFAULT_FACE_ZONE;
  const accent = ctx.accent ?? "#C5A059";
  const io = plan.introOffset ?? ctx.introOffset ?? 0;
  const anchorWords = io > 0 ? ctx.words.filter((w) => w.start >= io - 1e-6) : ctx.words; // intro lặp lại từ trong thân bài: anchor chỉ tìm trong phần chính
  if (!ctx.face) warnings.push("Không có subject.json: tránh vùng giữa-trên mặc định (25,8,50x45%).");

  // giữ layer của người dùng trong track của B-roll, bỏ layer AI cũ
  const kept = new Map<string, Layer[]>();
  for (const t of project.tracks) if (OWN_TRACKS.includes(t.id)) kept.set(t.id, t.layers.filter((l) => l.meta?.source !== "ai"));
  const others = project.tracks.filter((t) => !OWN_TRACKS.includes(t.id));
  const keptMoves = (pm.videoMoves ?? []).filter((m) => (m as { source?: string }).source !== "ai");

  let n = 0;
  const nextId = (p: string) => `${p}-${String(++n).padStart(4, "0")}`;
  const used = new Set(project.tracks.flatMap((t) => t.layers.map((l) => l.id)));
  const id = (p: string) => { let x = nextId(p); while (used.has(x)) x = nextId(p); used.add(x); return x; };
  const mk = (over: Record<string, unknown>): AnyLayer => ({ rotation: 0, opacity: 1, x: 0, y: 0, w: 0, h: 0, ...over }) as unknown as AnyLayer;
  const broll: AnyLayer[] = [], scene: AnyLayer[] = [], overlay: AnyLayer[] = [], below: AnyLayer[] = [], trans: AnyLayer[] = [], moves: Record<string, unknown>[] = [];

  const beats = plan.beats
    .map((b) => ({ b, t: resolveBeatTime(b, anchorWords) }))
    .filter((x): x is { b: Beat; t: { start: number; end: number } } => {
      if (!x.t) warnings.push(`Beat ${x.b.id}: không tìm thấy neo từ/cụm từ — bỏ qua.`);
      return !!x.t;
    })
    .sort((p, q) => p.t.start - q.t.start);

  const sideItems: SideItem[] = plan.shifts.map((s) => ({ start: s.start, end: s.end, side: s.side, beatId: s.id }));
  const camera: CameraOptions = { ...CAMERA_DEFAULTS, ...(plan.camera ?? {}) };
  const taken: Array<{ start: number; end: number; rect: Rectangle }> = [];
  let lastCutawayEnd = -Infinity;
  const addTransition = (t: z.infer<typeof Trans>, at: number, beatId: string) => {
    trans.push(mk({ id: id("T"), type: "transition", start: Math.max(0, +(at - t.dur / 2).toFixed(3)), duration: t.dur, kind: t.kind, dir: t.dir, color: accent, animation: { in: { kind: "fade", dur: 0.3 }, out: { kind: "fade", dur: 0.3 } }, meta: { source: "ai", broll: true, beatId } }));
  };

  for (const { b, t } of beats) {
    const dur = +(t.end - t.start).toFixed(3);
    if (dur <= 0 || t.end > project.duration + 0.01) { warnings.push(`Beat ${b.id}: thời gian ${t.start.toFixed(2)}–${t.end.toFixed(2)} ngoài timeline (${project.duration}s) — bỏ qua.`); continue; }
    const base = { start: +t.start.toFixed(3), duration: dur };
    const meta = { source: "ai", broll: true, beatId: b.id, ...(b.presetId ? { presetId: b.presetId } : {}), ...(b.variantId ? { variantId: b.variantId } : {}), ...(b.sfx && b.sfx !== "auto" ? { sfx: b.sfx } : {}), ...(b.role ? { role: b.role } : {}), ...(b.kind === "overlay" ? { overlay: true } : {}) };

    if (b.kind === "asset" || b.kind === "keyword") {
      const concurrent = taken.filter((x) => overlapT(x.start, x.end, t.start, t.end));
      // đếm số lớp cùng lúc lớn nhất trong khoảng của beat
      const maxAt = Math.max(0, ...[t.start, ...concurrent.map((c) => c.start)].map((p) => taken.filter((x) => x.start <= p && p < x.end).length));
      if (maxAt >= 2) { warnings.push(`Beat ${b.id}: đã có 2 asset/keyword cùng lúc — bỏ beat này (giới hạn ≤ 2).`); continue; }
      const info = b.assetId ? ctx.assets?.get(b.assetId) : undefined;
      if (b.kind === "asset" && !b.assetId && !b.src) { warnings.push(`Beat ${b.id}: kind asset thiếu src/assetId — bỏ qua.`); continue; }
      if (b.kind === "asset" && !b.src && ctx.assets && !info) { warnings.push(`Beat ${b.id}: assetId "${b.assetId}" không có trong manifest — bỏ qua.`); continue; }
      const size = b.kind === "keyword" ? { w: 70, h: 9 } : assetSize(info, canvas);
      const subs = subtitleZones(project, t.start, t.end);
      const busy = taken.filter((x) => overlapT(x.start, x.end, t.start, t.end)).map((x) => x.rect);
      let rect: Rectangle | null;
      if (typeof b.position === "object") {
        rect = b.position;
        if (hit(rect, face, 0) || subs.some((s) => hit(rect!, s))) warnings.push(`Beat ${b.id}: vị trí chỉ định đè lên mặt/phụ đề.`);
      } else {
        rect = placeAuto(size, face, subs, busy, b.position ?? "auto");
        if (!rect) { warnings.push(`Beat ${b.id}: không có chỗ trống tránh mặt/phụ đề/title-safe — bỏ qua (thử kích thước nhỏ hơn hoặc vị trí khác).`); continue; }
      }
      taken.push({ start: t.start, end: t.end, rect });
      if (b.side && b.kind === "keyword") sideItems.push({ start: t.start, end: t.end, side: b.side, beatId: b.id });
      if (b.kind === "keyword") {
        broll.push(mk({ id: id("B"), type: "callout", ...base, ...rect, text: b.text ?? "", style: { fontFamily: "Be Vietnam Pro", fontSize: 54, fontWeight: 800, color: "#EDEDED", accentColor: accent, background: "rgba(12,12,12,0.72)", align: "center", radius: 16, padding: 24, strokeColor: null, strokeWidth: 0, shadow: true }, animation: { in: { kind: "pop", dur: 0.35 }, out: { kind: "fade", dur: 0.25 } }, meta }));
        summary.push({ start: t.start, end: t.end, kind: "keyword", what: b.text ?? "" });
      } else {
        const drawOk = b.draw && info?.drawable !== false;
        if (b.draw && !drawOk) warnings.push(`Beat ${b.id}: asset không vẽ nét được (drawable=false) — bỏ draw.`);
        const tintOk = b.tint && info?.tintable !== false;
        const file = b.src ?? info?.file ?? `${b.assetId}.svg`;
        broll.push(mk({ id: id("B"), type: "asset", ...base, ...rect, src: b.src || file.startsWith("assets/") ? file : `assets/th-assets/${file}`, animation: { in: { kind: "pop", dur: 0.45 }, out: { kind: "shrink", dur: 0.3 }, loop: { kind: "float", period: 2.4, amp: 1 } }, ...(drawOk ? { draw: { dur: typeof b.draw === "object" ? b.draw.dur : 0.8 } } : {}), ...(tintOk ? { tint: b.tint } : {}), meta }));
        summary.push({ start: t.start, end: t.end, kind: "asset", what: b.assetId ?? b.src ?? "" });
      }
    } else if (b.kind === "cutaway" || b.kind === "overlay" || b.kind === "pip") {
      if (b.kind === "cutaway") {
        if (dur < 2 || dur > 6) warnings.push(`Beat ${b.id}: cutaway ${dur.toFixed(1)}s ngoài khoảng 2–6 s.`);
        if (t.start - lastCutawayEnd < 2) warnings.push(`Beat ${b.id}: quay lại người nói chỉ ${(t.start - lastCutawayEnd).toFixed(1)}s trước cutaway này (cần ≥ 2 s).`);
        lastCutawayEnd = t.end;
      }
      if (!b.templateId) { warnings.push(`Beat ${b.id}: ${b.kind} thiếu templateId — bỏ qua.`); continue; }
      const layer = mk({ id: id("S"), type: "scene", ...base, x: 0, y: 0, w: 100, h: 100, templateId: b.templateId, inputs: sceneInputs(b, t, anchorWords), animation: { in: { kind: "fade", dur: 0.2 }, out: { kind: "fade", dur: 0.2 } }, meta });
      if (b.kind === "overlay") { overlay.push(layer); if (b.side) sideItems.push({ start: t.start, end: t.end, side: b.side, beatId: b.id }); }
      else if (b.kind === "cutaway") {
        scene.push(layer);
        if (b.transitionIn) addTransition(b.transitionIn, t.start, b.id);
        if (b.transitionOut) addTransition(b.transitionOut, t.end, b.id);
      } else {
        below.push(layer);
        moves.push({ start: base.start, end: t.end, mode: "pip", scale: 1, x: 0, y: 0, pip: { x: 62, y: 58, w: 34, radius: 24, shadow: true }, ease: { in: 0.35, out: 0.35 }, source: "ai", beatId: b.id });
      }
      summary.push({ start: t.start, end: t.end, kind: b.kind, what: `${b.templateId}${b.role ? ` [${b.role}]` : ""}` });
    } else if (b.kind === "zoom" || b.kind === "kenburns") {
      const scale = b.scale ?? (b.kind === "zoom" ? camera.punch : 1.12);
      moves.push({ start: base.start, end: t.end, mode: b.kind, scale, ...faceShift(ctx.face, scale), ease: { in: 0.5, out: 0.5 }, source: "ai", beatId: b.id });
      summary.push({ start: t.start, end: t.end, kind: b.kind, what: `×${scale}` });
    } else if (b.kind === "transition") {
      const tr = b.transition ?? b.transitionIn ?? { kind: "flash" as const, dur: 0.4 };
      addTransition(tr, t.start, b.id);
      summary.push({ start: t.start, end: t.start + tr.dur, kind: `transition:${tr.kind}`, what: b.note ?? "" });
    }
  }

  // máy quay tự động: zoom nhẹ xen kẽ ở ranh giới câu, né cutaway (±0.5 s) và zoom/kenburns do plan chỉ định
  if (camera.auto) {
    const blocked = [
      ...scene.map((l) => ({ start: l.start - CUTAWAY_MARGIN, end: l.start + l.duration + CUTAWAY_MARGIN })),
      ...(moves as Array<{ start: number; end: number }>).map((m) => ({ start: m.start - 0.3, end: m.end + 0.3 })),
      ...(keptMoves as Array<{ start: number; end: number }>),
      ...(io > 0 ? [{ start: 0, end: io + 0.5 }] : []), // không auto-zoom trong intro hay vắt qua điểm nối
    ];
    const segs = ctx.segments ?? [];
    if (!segs.length) warnings.push("Camera auto: thiếu transcript segments để tìm ranh giới câu.");
    const auto = autoCameraMoves({ boundaries: sentenceBoundaries(segs, ctx.words), duration: project.duration, blocked, camera, face: ctx.face });
    warnings.push(...auto.warnings);
    moves.push(...(auto.moves as unknown as Record<string, unknown>[]));
    if (auto.moves.length) summary.push({ start: auto.moves[0].start, end: auto.moves[auto.moves.length - 1].end, kind: "camera-auto", what: `${auto.moves.length} cửa sổ zoom nhẹ` });
  }

  // videoMoves không được chồng nhau (với cả move của người dùng)
  const allMoves = [...(keptMoves as Array<{ start: number; end: number }>), ...(moves as Array<{ start: number; end: number; beatId?: string }>)].sort((a, c) => a.start - c.start);
  const finalMoves: Array<{ start: number; end: number }> = [];
  for (const m of allMoves) {
    const last = finalMoves[finalMoves.length - 1];
    if (last && m.start < last.end) {
      warnings.push(`Camera move ${(m as { beatId?: string }).beatId ?? "người dùng"} (${m.start.toFixed(1)}–${m.end.toFixed(1)}s) chồng lên move trước — bỏ.`);
      continue;
    }
    finalMoves.push(m);
  }
  pm.videoMoves = finalMoves as Array<Record<string, unknown>>;
  const ps = project as unknown as { videoShifts?: Array<Record<string, unknown>> };
  const faceBox = ctx.face ?? DEFAULT_FACE_ZONE;
  ps.videoShifts = [
    ...(ps.videoShifts ?? []).filter((s) => s.source !== "ai"),
    ...buildShifts(sideItems, scene.map((l) => ({ start: l.start, end: l.start + l.duration })), faceBox.x + faceBox.w / 2, project.videoTransform, project.duration, warnings),
  ];

  const mkTrack = (tid: string, kind: Track["kind"], name: string, mine: AnyLayer[], extra: Record<string, unknown> = {}): Track | null => {
    const layers = [...(kept.get(tid) ?? []), ...(mine as unknown as Layer[])].sort((a, c) => a.start - c.start);
    if (!layers.length && !kept.has(tid)) return null;
    return { id: tid, kind, name, hidden: false, locked: false, layers, ...extra } as Track;
  };
  const tTrans = mkTrack("t-trans", "graphics", "Chuyển cảnh", trans);
  const tBroll = mkTrack("t-broll", "graphics", "B-roll", broll);
  const tOverlay = mkTrack("t-overlay", "scene", "Minh hoạ", overlay);
  const tScene = mkTrack("t-scene", "scene", "Cảnh", scene);
  const tBelow = mkTrack("t-scene-below", "scene", "Cảnh nền", below, { belowVideo: true });
  // phụ đề luôn trên cùng (vẽ sau cùng) để hiện trên cutaway/overlay/chuyển cảnh
  const subs = others.filter((t) => t.kind === "subtitle"), rest = others.filter((t) => t.kind !== "subtitle");
  project.tracks = [...subs, tTrans, tBroll, ...rest, tOverlay, tScene, tBelow].filter((t): t is Track => !!t);
  summary.sort((a, c) => a.start - c.start);
  return { project, warnings, summary };
}
