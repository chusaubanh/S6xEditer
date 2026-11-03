/**
 * Đưa video ghép (scene-kit + quay màn hình) vào editor Chế độ C để chỉnh rồi xuất bằng th:render.
 *
 * Đầu vào (chạy trước): screencast-mix --render all --clean rồi --concat --clean
 *   → <docDir>/<finalName>-clean.mp4 (không in phụ đề/nhãn góc) + <docDir>/editor-overlays.json.
 * Đầu ra: output/<doc>/<slug>/ gồm media.json, source-audio.wav, transcript.raw.json, run.json, project.json
 *   (videoClips cắt theo từng phần của sequence, track phụ đề + nhãn góc chỉnh được, track nhạc/SFX trống).
 * Sau đó: npm run th:proxy -- "<doc>/<slug>" → npm run th:clips-build -- "<doc>/<slug>" → npm run editor -- "<doc>/<slug>".
 *
 *   npx tsx scripts/screencast/screencast-editor-job.ts "<docDir>/screencast.json" [--slug editor] [--force]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { getDurationSec } from "../../src/studio/audio/audio-tools.js";
import { runMediaCommand } from "../../src/studio/media/media-runner.js";
import { probe } from "../../src/talking-head/ffmpeg-util.js";
import { ProjectSchema, TranscriptSchema } from "../../src/talking-head/project-schema.js";

const args = process.argv.slice(2);
const cfgPath = resolve(args.find((a) => !a.startsWith("--")) ?? "");
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
if (!existsSync(cfgPath)) throw new Error('Dùng: npx tsx scripts/screencast/screencast-editor-job.ts "<docDir>/screencast.json" [--slug editor] [--force]');

const REPO = process.cwd();
const docDir = dirname(cfgPath);
const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as {
  finalName: string; sceneKitScript?: string;
  sequence: ({ sk: string[] } | { sc: string[] })[];
};
const doc = relative(join(REPO, "output"), docDir).replace(/\\/g, "/");
const job = `${doc}/${opt("slug") ?? "editor"}`;
const dir = join(REPO, "output", ...job.split("/"));
// revision > 0 = đã lưu từ editor; --force không đủ (29/10/2026: ghi đè khi người dùng đang chỉnh, may nhờ trình duyệt tự lưu lại)
if (existsSync(join(dir, "project.json")) && JSON.parse(readFileSync(join(dir, "project.json"), "utf8")).revision > 0 && !args.includes("--discard-edits")) {
  throw new Error(`${join(dir, "project.json")} đã được chỉnh trong editor (revision > 0) — không dựng lại. Chỉ dùng --discard-edits khi người dùng đồng ý bỏ các chỉnh sửa.`);
}
if (existsSync(join(dir, "project.json")) && !args.includes("--force")) {
  throw new Error(`Đã có ${join(dir, "project.json")} — người dùng có thể đã chỉnh trong editor. Thêm --force nếu chắc chắn dựng lại.`);
}
const raw = join(docDir, cfg.finalName.replace(/\.mp4$/i, "-clean.mp4"));
const overlaysFile = join(docDir, "editor-overlays.json");
for (const f of [raw, overlaysFile]) if (!existsSync(f)) throw new Error(`Thiếu ${f} — chạy screencast-mix --render all --clean rồi --concat --clean trước.`);
mkdirSync(dir, { recursive: true });

/* media.json: video nguồn là bản ghép sạch (nằm trong output/, không đụng input/) */
const { info, raw: probed } = await probe(raw);
const nbFrames = Number((probed as { streams: { codec_type: string; nb_frames?: string }[] }).streams.find((x) => x.codec_type === "video")?.nb_frames);
// avg_frame_rate của bản ghép đọc ra ~29.99 (âm thanh dài hơn hình vài ms); bản ghép luôn CFR 30 → dùng fps danh nghĩa, lệch fps làm mốc clip trượt 1 khung
info.fps = 30;
const rawRel = relative(REPO, raw).replace(/\\/g, "/");
writeFileSync(join(dir, "media.json"), JSON.stringify({ job, source: rawRel, info }, null, 2), "utf8");

/* source-audio.wav: giọng TTS đã sạch, chỉ tách ra (không chạy giảm ồn) — mới hơn video nguồn nên th:source-audio bỏ qua */
await runMediaCommand("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", raw, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", join(dir, "source-audio.wav")]);

/* Mốc từng phần của sequence trên video ghép (cùng cách cộng dồn như --concat) */
const work = join(docDir, "build-screencast");
const parts: { id: string; start: number; end: number; sk?: string[] }[] = [];
let cursor = 0;
for (const [i, step] of cfg.sequence.entries()) {
  if ("sk" in step) {
    const d = await getDurationSec(join(work, `part-${String(i).padStart(2, "0")}-sk.mp4`));
    parts.push({ id: `sk-${step.sk[0]}`, start: cursor, end: cursor + d, sk: step.sk });
    cursor += d;
  } else {
    for (const id of step.sc) {
      const d = await getDurationSec(join(work, "clean", `${id}.mp4`));
      parts.push({ id, start: cursor, end: cursor + d });
      cursor += d;
    }
  }
}
const fps = 30;
const snap = (t: number) => +(Math.round(t * fps) / fps).toFixed(6);
// độ dài theo số khung hình thật (format duration tính cả phần âm thanh dư)
const total = Number.isFinite(nbFrames) && nbFrames > 0 ? +(nbFrames / fps).toFixed(6) : snap(info.duration);
if (Math.abs(cursor - info.duration) > 0.2) console.warn(`CẢNH BÁO: tổng các phần ${cursor.toFixed(2)}s ≠ video ${info.duration.toFixed(2)}s`);
const videoClips = parts.map((p, i) => ({
  id: `C-${String(i + 1).padStart(4, "0")}`, kind: "source" as const,
  srcIn: snap(p.start), srcOut: i === parts.length - 1 ? total : snap(p.end),
}));

/* Lớp phụ đề + nhãn góc (giống bản in cứng: chữ trắng nền tối, từ đang đọc tô vàng; nhãn vàng góc trái trên) */
const overlays = JSON.parse(readFileSync(overlaysFile, "utf8")) as {
  subs: { seg: string; start: number; end: number; words: { text: string; start: number; end: number }[] }[];
  callouts: { seg: string; text: string; start: number; end: number }[];
};
const base = { rotation: 0, opacity: 1 };
const subStyle = {
  fontFamily: "Be Vietnam Pro", fontSize: 46, fontWeight: 900, color: "#FFFFFF", accentColor: "#C5A059",
  background: "rgba(0,0,0,0.85)", align: "center", radius: 12, padding: 18, strokeColor: null, strokeWidth: 0, shadow: false,
};
const calloutStyle = {
  fontFamily: "Be Vietnam Pro", fontSize: 28, fontWeight: 900, color: "#FFFFFF", accentColor: "#C5A059",
  background: "#C5A059", align: "left", radius: 8, padding: 14, strokeColor: null, strokeWidth: 0, shadow: false,
};
/** Khung phụ đề ôm theo chữ (như bản in cứng), căn giữa; bề rộng ước ~0.6 em mỗi ký tự ở cỡ 46 px trên khung 1920 (46 px CSS ≈ cỡ 62 của ASS). */
const subBox = (text: string) => {
  const w = +Math.min(90, Math.max(16, ((text.length * 46 * 0.6 + 2 * 18 + 24) / 1920) * 100)).toFixed(2);
  return { x: +((100 - w) / 2).toFixed(2), w };
};
const subLayers = overlays.subs.map((s, i) => ({
  id: `L-${String(i + 1).padStart(4, "0")}`, type: "subtitle", start: s.start, duration: +(s.end - s.start).toFixed(3),
  ...subBox(s.words.map((w) => w.text).join(" ")), y: 86.5, h: 9, ...base, text: s.words.map((w) => w.text).join(" "), words: s.words, style: subStyle,
  animation: { in: { kind: "fade", dur: 0.08 }, out: { kind: "fade", dur: 0.08 }, subtitleMode: "word" },
  meta: { source: "auto", segment: s.seg },
}));
const calloutLayers = overlays.callouts.map((c, i) => ({
  id: `K-${String(i + 1).padStart(4, "0")}`, type: "callout", start: c.start, duration: +(c.end - c.start).toFixed(3),
  // bề rộng ước theo số ký tự (cỡ 28 px chữ hoa đậm trên khung 1920), dư để không xuống dòng
  x: 2.6, y: 4, w: +Math.min(60, (c.text.length * 28 * 0.78 + 2 * 14 + 24) / 19.2).toFixed(2), h: 6, ...base, text: c.text, style: calloutStyle,
  animation: { in: { kind: "pop", dur: 0.24 }, out: { kind: "fade", dur: 0.2 } },
  meta: { source: "auto", segment: c.seg },
}));
const track = (id: string, kind: string, name: string, layers: unknown[]) => ({ id, kind, name, hidden: false, locked: false, layers });
const project = ProjectSchema.parse({
  version: 1, job, fps, width: 1920, height: 1080, aspect: "16:9", duration: total,
  source: { video: "cut.mp4", audio: "audio.wav", raw: rawRel, rawAudio: "source-audio.wav", proxy: "source-proxy.mp4" },
  revision: 0, videoClips,
  tracks: [
    track("t-callout", "graphics", "Nhãn góc", calloutLayers),
    track("t-sub", "subtitle", "Phụ đề", subLayers),
    track("t-sfx", "sfx", "SFX", []),
    track("t-music", "music", "Nhạc", []),
  ],
  audio: { voice: { gainDb: 0, muted: false }, music: { duckDb: -14, attack: 0.15, release: 0.45 }, master: { lufs: -16, truePeak: -1.5 } },
});
writeFileSync(join(dir, "project.json"), JSON.stringify(project, null, 2), "utf8");

/* transcript.raw.json theo giây video nguồn: câu scene-kit (timeline.json) + khối phụ đề quay màn hình (có từng từ) */
const timeline = JSON.parse(readFileSync(join(docDir, "timeline.json"), "utf8")) as {
  scenes: { sceneId: string; start: number; duration: number; sentences?: { text: string; start: number }[] }[];
};
const segs: { start: number; end: number; text: string; words: { text: string; start: number; end: number }[] }[] = [];
for (const p of parts.filter((x) => x.sk)) {
  const scenes = timeline.scenes.filter((s) => p.sk!.includes(s.sceneId));
  const off = p.start - scenes[0].start;
  for (const sc of scenes) {
    const ss = sc.sentences?.length ? sc.sentences : [];
    ss.forEach((s, k) => segs.push({ start: s.start + off, end: (k + 1 < ss.length ? ss[k + 1].start : sc.start + sc.duration) + off, text: s.text, words: [] }));
  }
}
for (const s of overlays.subs) segs.push({ start: s.start, end: s.end, text: s.words.map((w) => w.text).join(" "), words: s.words });
segs.sort((a, b) => a.start - b.start);
const transcript = TranscriptSchema.parse({ language: "vi", model: "tts-timing", duration: total, segments: segs.map((s, i) => ({ id: i, ...s })) });
writeFileSync(join(dir, "transcript.raw.json"), JSON.stringify(transcript, null, 2), "utf8");

const now = new Date().toISOString();
if (!existsSync(join(dir, "run.json"))) {
  writeFileSync(join(dir, "run.json"), JSON.stringify({ version: 1, job, createdAt: now, updatedAt: now, aspect: "16:9", doc, slug: job.split("/").pop(), steps: {} }, null, 2), "utf8");
}
console.log(`Job editor: ${dir}`);
console.log(`  ${videoClips.length} clip · ${subLayers.length} phụ đề · ${calloutLayers.length} nhãn góc · ${total.toFixed(2)}s`);
console.log(`Tiếp: npm run th:proxy -- "${job}" → npm run th:clips-build -- "${job}" → npm run editor -- "${job}"`);
