import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, loadPresets, type SfxMapEntry, type SfxPack } from "./presets.js";
import { LayerSchema, type Layer, type Project, type Track } from "./project-schema.js";

export type Density = "low" | "mid" | "high";
export interface SfxEntry {
  id: string;
  category: string;
  file: string;
  duration: number;
  peakDb: number;
  lufs: number;
  tags: string[];
  energy: "low" | "mid" | "high";
  /** giây tính từ đầu file tới đỉnh/điểm chạm chính */
  hit?: number;
  source?: "synth" | "kenney";
  license?: string;
}
export interface PlanOptions {
  pack: string; // id hoặc tên gói
  density: Density;
  library?: SfxEntry[];
  packs?: SfxPack[];
}

/** Kiểu cục bộ cho B-roll (project-schema chưa/đang được thêm): đọc lỏng các trường asset/transition/videoMoves. */
type Loose = Layer & { kind?: string; dur?: number; draw?: { dur?: number } };
interface VideoMove { start: number; end: number; mode: string; beatId?: string; ease?: { in?: number; out?: number } }
const GRAPHIC_TYPES = new Set<string>(["text", "lowerThird", "callout", "scene", "image", "shape", "asset", "transition"]);
const SWEEP = /^(whoosh|swoosh|slide|transition|riser|reverse)/;
const MIN_GAP: Record<Density, number> = { low: 0.35, mid: 0.28, high: 0.2 };
const HIGH_WINDOW = 3; // giây: không 2 SFX năng lượng cao liền nhau trong cửa sổ này

/** Thư viện tự sinh (assets/sfx-th) + thu thật CC0 (assets/sfx-kenney) nếu đã nhập. */
export function loadSfxLibrary(root = REPO_ROOT): SfxEntry[] {
  const out: SfxEntry[] = [];
  for (const [dir, source] of [["sfx-th", "synth"], ["sfx-kenney", "kenney"]] as const) {
    const f = join(root, "assets", dir, "manifest.json");
    if (!existsSync(f)) continue;
    for (const e of JSON.parse(readFileSync(f, "utf8")) as SfxEntry[]) out.push({ source, ...e });
  }
  return out;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Thời điểm (giây, trên timeline) mà đỉnh của SFX phải rơi vào. */
function anchorTime(layer: Layer, edge: "in" | "out", category: string): number {
  const a = layer.animation;
  if (layer.type === ("transition" as Layer["type"])) {
    const d = (layer as Loose).dur ?? layer.duration;
    return layer.start + d * (category === "impact-soft" ? 0.35 : category === "camera-shutter" ? 0.4 : 0.5);
  }
  if (category === "scribble") return layer.start + a.in.dur * 0.5;
  if (edge === "in") {
    if (SWEEP.test(category)) return layer.start + a.in.dur * 0.75; // whoosh: đỉnh khi layer tới nơi
    const touch = a.in.kind === "pop" ? 0.3 : ["stamp", "drop", "bounce", "zoom"].includes(a.in.kind) ? 0.6 : 0.15;
    return layer.start + a.in.dur * touch;
  }
  return layer.start + layer.duration - a.out.dur * 0.5;
}

function pickEntry(lib: SfxEntry[], category: string, key: string, prefer: "synth" | "kenney", avoid?: string): SfxEntry | undefined {
  let c = lib.filter((e) => e.category === category);
  const pref = c.filter((e) => e.source === prefer);
  if (pref.length) c = pref;
  if (!c.length) return undefined;
  c = [...c].sort((a, b) => a.id.localeCompare(b.id));
  let i = hash(key) % c.length;
  if (c.length > 1 && c[i].id === avoid) i = (i + 1) % c.length;
  return c[i];
}

function sfxTrack(project: Project): Track {
  let t = project.tracks.find((x) => x.kind === "sfx");
  if (!t) {
    t = { id: "t-sfx", kind: "sfx", name: "SFX", hidden: false, locked: false, layers: [] };
    const mi = project.tracks.findIndex((x) => x.kind === "music");
    if (mi >= 0) project.tracks.splice(mi, 0, t);
    else project.tracks.push(t);
  }
  return t;
}

/** Mốc xuất hiện của từng phần tử trong scene-kit: delays (layer.inputs.delays, hoặc mặc định khai trong template) + mô tả beats.json -> loại SFX. */
const beatCache = new Map<string, { delays: number[]; desc: string[] } | null>();
export function sceneBeats(templateId: string, root = REPO_ROOT): { delays: number[]; desc: string[] } | null {
  const key = `${root}|${templateId}`;
  if (beatCache.has(key)) return beatCache.get(key)!;
  let out: { delays: number[]; desc: string[] } | null = null;
  try {
    const dir = join(root, "templates", templateId);
    const comp = join(dir, "compositions");
    const html = existsSync(comp) ? readdirSync(comp).find((f) => f.endsWith(".html")) : undefined;
    const m = html ? /inputs\.delays = \[([^\]]*)\]/.exec(readFileSync(join(comp, html), "utf8")) : null;
    const bf = join(dir, "beats.json");
    out = { delays: m ? m[1].split(",").map(Number).filter(Number.isFinite) : [], desc: existsSync(bf) ? (JSON.parse(readFileSync(bf, "utf8")) as string[]) : [] };
  } catch { out = null; }
  beatCache.set(key, out);
  return out;
}
const beatKind = (d = "") => (/đóng dấu/i.test(d) ? "stamp" : /vẽ|khoanh/i.test(d) ? "scribble" : /trượt/i.test(d) ? "slide" : "pop");
const POP_GAP = 0.25; // khoảng cách tối thiểu giữa hai pop

interface Event { pop?: boolean; at: number; linkId?: string; edge: "in" | "out"; entry: SfxEntry; gainDb: number; prio: number; maxDur?: number; keyBase: string }

/**
 * Thêm layer SFX tự động (source "auto") vào track SFX. Giữ nguyên layer SFX khác "auto" (người dùng/AI đặt tay).
 * Trả về project mới, không ghi file.
 */
export function planSfx(input: Project, opts: PlanOptions): Project {
  const project = structuredClone(input);
  const lib = opts.library ?? loadSfxLibrary();
  const packs = opts.packs ?? loadPresets().sfxPacks;
  const pack = packs.find((p) => p.id === opts.pack || p.name === opts.pack);
  if (!pack) throw new Error(`Không có gói SFX "${opts.pack}"`);

  const track = sfxTrack(project);
  track.layers = track.layers.filter((l) => l.meta?.source !== "auto");
  const kept = track.layers.map((l) => ({ at: l.start + (libHit(lib, l) ?? 0), entry: undefined as SfxEntry | undefined, energy: energyOf(lib, l) }));

  const events: Event[] = [];
  const dens = opts.density;
  const offsetDb = (pack.in.rise?.gainDb ?? -14) + 14; // mức chung của gói so với -14 dB
  const push = (ev: Omit<Event, "entry" | "gainDb"> & { category: string; gainDb: number }) => {
    const entry = pickEntry(lib, ev.category, ev.keyBase, pack.prefer);
    if (entry) events.push({ ...ev, entry });
  };
  const consider = (layer: Layer, edge: "in" | "out", m: SfxMapEntry | null | undefined, prio: number, key: string) => {
    if (!m) return;
    const entry = pickEntry(lib, m.category, key, pack.prefer);
    if (!entry) return;
    events.push({ at: anchorTime(layer, edge, entry.category), linkId: layer.id, edge, entry, gainDb: m.gainDb, prio, keyBase: key });
  };

  const layers = project.tracks
    .filter((t) => t.kind !== "subtitle" && t.kind !== "sfx" && t.kind !== "music" && !t.hidden)
    .flatMap((t) => t.layers)
    .filter((l) => GRAPHIC_TYPES.has(l.type));
  const transitions = layers.filter((l) => (l.type as string) === "transition");
  const nearTransition = (t: number) => transitions.some((x) => Math.abs(x.start - t) < 0.6 || Math.abs(x.start + x.duration - t) < 0.6);
  const softBubble = pack.id === "social" || pack.id === "tech" ? "pop" : "pop-bubble";
  const sweepCat = pack.id === "corporate" || pack.id === "minimal" ? "transition-sweep" : "whoosh-fast";

  for (const l of layers) {
    const type = l.type as string;
    const ik = l.animation.in.kind;
    const ok = l.animation.out.kind;
    if (type === "transition") {
      const k = (l as Loose).kind ?? "flash";
      const category = k === "flash" ? "impact-soft" : k === "iris" || k === "shutter" ? "camera-shutter" : sweepCat;
      const gain = { "impact-soft": -14, "camera-shutter": -12, "transition-sweep": -14, "whoosh-fast": -12 }[category] ?? -14;
      push({ category, at: anchorTime(l, "in", category), linkId: l.id, edge: "in", gainDb: gain + offsetDb, prio: 3, keyBase: `${l.id}:tr` });
      continue;
    }
    if (type === "scene") {
      // cutaway vào/ra: transition-sweep (bỏ qua nếu đã có layer transition ngay cạnh)
      const inAt = l.start + l.animation.in.dur * 0.75, outAt = l.start + l.duration - l.animation.out.dur * 0.5;
      if (!nearTransition(l.start)) push({ category: "transition-sweep", at: inAt, linkId: l.id, edge: "in", gainDb: -15 + offsetDb, prio: 2, keyBase: `${l.id}:in` });
      if (!nearTransition(l.start + l.duration)) push({ category: "transition-sweep", at: outAt, linkId: l.id, edge: "out", gainDb: -16 + offsetDb, prio: 1, keyBase: `${l.id}:out` });
      // mỗi phần tử bật ra trong cảnh có một SFX nhẹ (không gắn linkedLayerId: mốc nằm giữa layer, relink sẽ kéo về đầu layer)
      const tb = l.templateId ? sceneBeats(l.templateId) : null;
      const given = l.inputs?.delays;
      const delays = Array.isArray(given) && given.length ? (given as unknown[]).map(Number) : tb?.delays ?? [];
      delays.forEach((d, i) => {
        const at = l.start + d;
        if (!Number.isFinite(d) || at > l.start + l.duration - 0.2) return;
        const kind = beatKind(tb?.desc[i]);
        const category = kind === "pop" ? softBubble : kind;
        if (!lib.some((e) => e.category === category)) return;
        const gain = { pop: -16, stamp: -15, scribble: -17, slide: -17 }[kind] + offsetDb;
        push({ category, at, edge: "in", gainDb: gain, prio: 1, pop: true, maxDur: kind === "scribble" ? 0.9 : undefined, keyBase: `${l.id}:beat${i}` });
      });
      continue;
    }
    if (type === "asset") {
      const draw = (l as Loose).draw;
      {
        if (ik === "pop" || ik === "bounce" || ik === "zoom" || ik === "stamp") {
          const g = pack.in.pop?.gainDb ?? -14;
          push({ category: softBubble, at: anchorTime(l, "in", softBubble), linkId: l.id, edge: "in", gainDb: g - 2, prio: 2, keyBase: `${l.id}:in` });
        } else if (ik !== "none" && ik !== "fade") consider(l, "in", pack.in[ik] && { ...pack.in[ik]!, gainDb: pack.in[ik]!.gainDb - 2 }, 2, `${l.id}:in`);
      }
      if (dens === "high" && draw) {
        const category = lib.some((e) => e.category === "scribble") ? "scribble" : "slide";
        push({ category, at: anchorTime(l, "in", category), linkId: l.id, edge: "in", gainDb: -17 + offsetDb, prio: 1, maxDur: (draw.dur ?? 0.8) + 0.1, keyBase: `${l.id}:draw` });
      }
      continue;
    }
    const inMap = ik === "none" ? null : pack.in[ik];
    // mọi phần tử hiện ra đều có SFX lúc vào (mọi mật độ): ưu tiên theo gói, không có thì pop nhẹ
    if (inMap && !(dens === "low" && (ik === "fade" || ik === "soft"))) consider(l, "in", inMap, 2, `${l.id}:in`);
    else push({ category: softBubble, at: l.start + l.animation.in.dur * 0.3, linkId: l.id, edge: "in", gainDb: -16 + offsetDb, prio: 2, pop: true, keyBase: `${l.id}:in` });
    if (dens !== "low" && ok !== "none") consider(l, "out", pack.out[ok], 1, `${l.id}:out`);
    if (dens === "high" && l.type === "text" && pack.emphasis) {
      const e = pickEntry(lib, pack.emphasis.category, `${l.id}:emph`, pack.prefer);
      if (e) events.push({ at: l.start + l.animation.in.dur + 0.15, linkId: l.id, edge: "in", entry: e, gainDb: pack.emphasis.gainDb, prio: 0, keyBase: `${l.id}:emph` });
    }
  }

  // project.videoMoves: zoom nhấn / pip vào-ra (không có layer để gắn -> không linkedLayerId)
  const moves = ((project as unknown as { videoMoves?: VideoMove[] }).videoMoves ?? []).filter((m) => m.end > m.start);
  moves.forEach((m, i) => {
    const ein = m.ease?.in ?? 0.35, eout = m.ease?.out ?? 0.35;
    if (m.mode === "zoom") {
      if (m.beatId?.startsWith("auto-")) return; // zoom nhẹ do camera auto: không SFX
      const touch = m.start + ein;
      if (dens === "high" && ein >= 0.9 && lib.some((e) => e.category === "riser-short")) {
        const probe = pickEntry(lib, "riser-short", `mv${i}:riser`, pack.prefer);
        // riser kết thúc đúng lúc chạm đỉnh zoom: hit ở cuối file
        if (probe && probe.hit! > 0.6 * probe.duration) events.push({ at: touch, edge: "in", entry: probe, gainDb: -18 + offsetDb, prio: 2, keyBase: `mv${i}:riser` });
      } else push({ category: "impact-soft", at: touch, edge: "in", gainDb: -20 + offsetDb, prio: 2, keyBase: `mv${i}:zoom` });
    } else if (m.mode === "pip" && dens !== "low") {
      push({ category: "swoosh-up", at: m.start + ein * 0.5, edge: "in", gainDb: -16 + offsetDb, prio: 2, keyBase: `mv${i}:pipin` });
      push({ category: "swoosh-down", at: m.end - eout * 0.5, edge: "out", gainDb: -17 + offsetDb, prio: 1, keyBase: `mv${i}:pipout` });
    }
  });

  // chống dày đặc: ưu tiên in > out > nhấn; xét theo thời gian
  const gap = MIN_GAP[opts.density];
  events.sort((a, b) => a.at - b.at || b.prio - a.prio);
  const placed: Event[] = [];
  const near = (t: number) => kept.some((k) => Math.abs(k.at - t) < gap);
  for (const ev of events) {
    const last = placed[placed.length - 1];
    if (near(ev.at)) continue;
    if (last && ev.at - last.at < (ev.pop && last.pop ? Math.min(gap, POP_GAP) : gap)) {
      if (ev.prio > last.prio) placed.pop(); // sự kiện quan trọng hơn thay thế
      else continue;
    }
    const prev = placed[placed.length - 1];
    if (ev.entry.energy === "high" && prev && prev.entry.energy === "high" && ev.at - prev.at < HIGH_WINDOW) continue;
    if (ev.entry.energy === "high" && kept.some((k) => k.energy === "high" && Math.abs(k.at - ev.at) < HIGH_WINDOW)) continue;
    placed.push(ev);
  }

  // đa dạng: không lặp cùng file 2 lần liên tiếp (đổi sang biến thể kế)
  let prevId = "";
  let n = nextAudioNumber(project);
  const dMax = project.duration;
  for (const ev of placed) {
    let entry = ev.entry;
    if (entry.id === prevId) {
      const alt = pickEntry(lib, entry.category, `${ev.keyBase}:alt`, pack.prefer, prevId);
      if (alt) entry = alt;
    }
    prevId = entry.id;
    const start = Math.max(0, +(ev.at - (entry.hit ?? 0)).toFixed(3));
    if (start >= dMax) continue;
    const duration = Math.min(entry.duration, dMax - start, ev.maxDur ?? Infinity);
    track.layers.push(
      LayerSchema.parse({
        id: `A-${String(n++).padStart(4, "0")}`,
        type: "audio",
        start,
        duration: +duration.toFixed(3),
        src: entry.file,
        offset: 0,
        gainDb: ev.gainDb,
        fadeIn: 0,
        fadeOut: Math.min(0.03, duration / 2),
        meta: { category: entry.category, ...(ev.linkId ? { linkedLayerId: ev.linkId, linkEdge: ev.edge } : {}), source: "auto" },
      }),
    );
  }
  track.layers.sort((a, b) => a.start - b.start);
  return project;
}

function libHit(lib: SfxEntry[], l: Layer): number | undefined {
  return lib.find((e) => e.file === l.src)?.hit;
}
function energyOf(lib: SfxEntry[], l: Layer): string | undefined {
  return lib.find((e) => e.file === l.src)?.energy;
}
function nextAudioNumber(p: Project): number {
  let max = 0;
  for (const t of p.tracks) for (const l of t.layers) if (l.type === "audio") max = Math.max(max, Number(/^A-(\d+)$/.exec(l.id)?.[1] ?? 0));
  return max + 1;
}

/**
 * Cập nhật start của SFX gắn (linkedLayerId/linkEdge) theo layer đồ hoạ hiện tại — gọi sau khi layer bị kéo/đổi animation.
 * SFX auto mà layer gắn đã bị xoá thì xoá luôn; SFX người dùng thì bỏ liên kết.
 */
export function relinkSfx(input: Project, library: SfxEntry[] = loadSfxLibrary()): Project {
  const project = structuredClone(input);
  const byId = new Map<string, Layer>();
  for (const t of project.tracks) for (const l of t.layers) byId.set(l.id, l);
  for (const t of project.tracks) {
    if (t.kind !== "sfx") continue;
    t.layers = t.layers.filter((a) => {
      const link = a.meta?.linkedLayerId;
      if (!link) return true;
      const target = byId.get(link);
      if (!target) {
        if (a.meta?.source === "auto") return false;
        delete a.meta!.linkedLayerId;
        delete a.meta!.linkEdge;
        return true;
      }
      const hit = library.find((e) => e.file === a.src)?.hit ?? 0;
      const at = anchorTime(target, a.meta!.linkEdge ?? "in", a.meta?.category ?? "");
      a.start = Math.max(0, +(at - hit).toFixed(3));
      return true;
    });
    t.layers.sort((x, y) => x.start - y.start);
  }
  return project;
}
