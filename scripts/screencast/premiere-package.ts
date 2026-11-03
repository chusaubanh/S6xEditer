/**
 * Đóng gói một job editor (screencast-editor-job) thành timeline Premiere (FCP7 XML). Chỉ ĐỌC job, không ghi lại editor.
 *
 *   npx tsx scripts/screencast/premiere-package.ts "<docDir>/screencast.json"
 *     [--job editor] [--snapshot <project.json>] [--until 45] [--name timeline]
 *     [--preview] [--import "<file.prproj>"] [--seq-name "<tên sequence>"]
 *
 * Ra <docDir>/premiere/ (media/ đặt tên theo băm nội dung: nội dung đổi → tên mới, không ghi đè file Premiere đang khoá):
 *   V1  15 cảnh scene-kit là clip riêng (file fit từng cảnh — thay bằng Replace Footage); quay màn hình đọc thẳng video sạch CFR
 *   V2  nhãn góc: PNG trong suốt chụp từ chính overlay của editor
 *   A1–A2 giọng: NGUYÊN từng file TTS gốc (mỗi cảnh / mỗi đoạn quay màn hình một file), đặt đúng chỗ đoạn bắt đầu, không cắt; xếp so le 2 track
 *   A2  nhạc đã hạ sẵn khi có lời (stem ducking của bộ trộn editor)
 *   A3+ SFX (giữ gainDb + fade; xếp làn không chồng)
 *   Mọi mức đã cộng bù loudnorm của bản trộn editor → tổng ≈ master.lufs như bản nghe thử.
 *   <name>-phu-de.srt (phần quay màn hình), <name>.json (tóm tắt), --preview: <name>-xem-truoc.mp4 dựng đúng theo XML.
 * Tự kiểm: dựng lại V1 từ danh sách clip, so từng khung với bản tham chiếu cắt theo thời gian trên video sạch → lệch là dừng.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { getDurationSec } from "../../src/studio/audio/audio-tools.js";
import { runMediaCommand } from "../../src/studio/media/media-runner.js";
import { resolveMediaBinary } from "../../src/studio/utils/media-binary.js";
import { loadProject, type Layer } from "../../src/talking-head/project-schema.js";
import { buildMixGraph, measureLoudness, probeForMix } from "../../src/talking-head/audio-mix.js";
import { assignLanes, buildItems, clipToLength, nameScreenSpan, type Item, type Piece } from "./premiere-timeline.js";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

/* ── Tham số ── */
const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const valueFlags = new Set(["job", "snapshot", "until", "name", "import", "seq-name"]);
const cfgPath = resolve(args.find((a, i) => !a.startsWith("--") && !(args[i - 1]?.startsWith("--") && valueFlags.has(args[i - 1].slice(2)))) ?? "");
if (!existsSync(cfgPath)) throw new Error('Dùng: npx tsx scripts/screencast/premiere-package.ts "<docDir>/screencast.json" [--job editor] [--snapshot …] [--until 45] [--preview] [--import "<prproj>"]');
const REPO = process.cwd();
const FPS = 30, W = 1920, H = 1080;
const docDir = dirname(cfgPath);
const jobDir = join(docDir, opt("job") ?? "editor");
const outDir = join(docDir, "premiere");
const mediaDir = join(outDir, "media");
const tmpDir = join(outDir, ".work");
const UNTIL = opt("until") ? Number(opt("until")) : Infinity;
const NAME = opt("name") ?? "timeline";
const BRIDGE = process.env.ADOBE_BRIDGE ?? "";
const BRIDGE_OUT = process.env.ADOBE_BRIDGE_OUT ?? join(outDir, "cau-noi"); // panel Premiere chỉ nhận XML nằm trong thư mục này
mkdirSync(mediaDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as { title?: string; finalName: string; sceneKitScript?: string; sequence: ({ sk: string[] } | { sc: string[] })[] };
const script = JSON.parse(readFileSync(join(docDir, cfg.sceneKitScript ?? "script.json"), "utf8")) as { scenes: { id: string }[] };
const snapFile = resolve(opt("snapshot") ?? join(jobDir, "project.json"));
const project = await loadProject(snapFile);
const work = join(docDir, "build-screencast");
const fr = (s: number) => Math.round(s * FPS);
const ffmpeg = resolveMediaBinary("ffmpeg"), ffprobe = resolveMediaBinary("ffprobe");
const ff = (a: string[]) => runMediaCommand("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...a]);
/** số khung HÌNH thật (độ dài file gồm cả âm thanh dư → không dùng để cộng dồn khung) */
const vFrames = (f: string) => Number(spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim());
const stamp = (f: string) => { const s = statSync(f); return `${f}|${s.size}|${s.mtimeMs}`; };
const hashed = (base: string, ext: string, key: unknown) => join(mediaDir, `${base}-${createHash("sha1").update(JSON.stringify(key)).digest("hex").slice(0, 8)}.${ext}`);
const log = (s: string) => console.log(s);

/* ── 1. Video sạch CFR 30 (đọc theo thời gian như editor/Premiere; bản ghép cũ có thể hụt PTS) ── */
const clean = join(docDir, cfg.finalName.replace(/\.mp4$/i, "-clean.mp4"));
const masterVideo = hashed("quay-man-hinh-cfr30", "mp4", stamp(clean));
if (!existsSync(masterVideo)) {
  log("Dựng video sạch CFR 30 (GPU)…");
  await ff(["-hwaccel", "cuda", "-i", clean, "-vf", `fps=${FPS}`, "-an", "-c:v", "h264_nvenc", "-preset", "p5", "-cq", "16", "-g", String(FPS), "-bf", "0", masterVideo]);
}
const masterF = vFrames(masterVideo);

/* ── 2. Mảnh nguồn: vị trí từng phần scene-kit trên video sạch (thử chỗ đoán trước, dò rộng chỉ khi lệch) ── */
const psnr = (fa: string, ia: number, fb: string, ib: number, n = 8) => {
  const r = spawnSync(ffmpeg, ["-hide_banner", "-ss", (ia / FPS).toFixed(4), "-i", fa, "-ss", (ib / FPS).toFixed(4), "-i", fb, "-lavfi",
    `[0:v]trim=end_frame=${n},setpts=PTS-STARTPTS,scale=480:270[x];[1:v]trim=end_frame=${n},setpts=PTS-STARTPTS,scale=480:270[y];[x][y]psnr`, "-f", "null", "-"], { encoding: "utf8" });
  const m = /average:([\d.]+|inf)/.exec(r.stderr);
  return m ? (m[1] === "inf" ? 99 : Number(m[1])) : 0;
};
const manifest = JSON.parse(readFileSync(join(work, "manifest.json"), "utf8")) as { id: string; durSec: number }[];
const segLen = (id: string) => { const m = manifest.find((x) => x.id === id); if (!m) throw new Error(`manifest thiếu ${id}`); return m.durSec; };
const pieces: Piece[] = [];
{
  let predSec = 0, cursor = 0, pendingScreens: string[] = [];
  const flushScreens = (until: number) => {
    if (until > cursor) pieces.push(...nameScreenSpan(cursor, until, pendingScreens.length ? pendingScreens : ["quay"], pendingScreens.map((id) => fr(segLen(id))), masterVideo));
    pendingScreens = [];
  };
  for (const [i, step] of cfg.sequence.entries()) {
    if ("sc" in step) { pendingScreens.push(...step.sc); for (const id of step.sc) predSec += segLen(id); continue; }
    const part = join(work, `part-${String(i).padStart(2, "0")}-sk.mp4`);
    const guess = fr(predSec), frames = vFrames(part);
    // Dò bằng 3 khung ĐẦU phần: chỗ nối là cắt cứng từ quay màn hình sang cảnh, lệch 1 khung là lẫn khung quay màn hình (~6 dB)
    // còn đúng chỗ là ~60+ dB. (So giữa cảnh không dùng được: hình scene-kit đứng yên, lệch 1–2 khung vẫn giống hệt.)
    const tryK = (k: number) => (guess + k < 0 ? 0 : psnr(part, 0, masterVideo, guess + k, 3));
    let best = { k: 0, v: -1 };
    for (let k = -3; k <= 3; k++) { const v = tryK(k); if (v > best.v) best = { k, v }; }
    if (best.v < 40) for (let k = -15; k <= 15; k++) { if (Math.abs(k) <= 3) continue; const v = tryK(k); if (v > best.v) best = { k, v }; }
    if (best.v < 35) throw new Error(`không dò được phần scene-kit ${i} trên video sạch (PSNR tốt nhất ${best.v.toFixed(1)} dB)`);
    const start = guess + best.k;
    log(`  phần scene-kit ${i}: đoán ${guess}, chọn ${start} (${best.v.toFixed(1)} dB)`);
    flushScreens(start);
    let off = start;
    for (const [k, id] of step.sk.entries()) {
      if (!script.scenes.some((s) => s.id === id)) throw new Error(`sequence có ${id} nhưng script.json không có`);
      const fit = join(docDir, "clips", `scene-${id}-fit.mp4`);
      const end = k === step.sk.length - 1 ? start + frames : off + vFrames(fit);
      pieces.push({ id, file: fit, a: off, b: end, base: off, kind: "scene" });
      off = end;
    }
    cursor = start + frames;
    predSec = cursor / FPS;
  }
  flushScreens(masterF);
}
log(`Mảnh nguồn: ${pieces.filter((p) => p.kind === "scene").length} cảnh + ${pieces.filter((p) => p.kind === "screen").length} đoạn quay · ${masterF} khung`);

/* ── 3. Clip V1 ── */
const spans = (project.videoClips ?? []).map((c) => {
  if (c.kind !== "source") throw new Error("clip 'hold' chưa hỗ trợ khi xuất Premiere");
  return { id: c.id, a: fr(c.srcIn), b: Math.min(masterF, fr(c.srcOut!)) };
});
const all = buildItems(spans, pieces);
const fullF = all.reduce((n, x) => n + x.outF - x.inF, 0);
const totalF = Math.min(fullF, Number.isFinite(UNTIL) ? fr(UNTIL) : fullF);
const v1: Item[] = clipToLength(all, totalF);
log(`V1: ${v1.length} clip · ${(totalF / FPS).toFixed(2)}s`);

/* ── 4. Tự kiểm khớp hình: V1 dựng từ danh sách clip ↔ tham chiếu cắt theo thời gian trên video sạch (480×270) ── */
async function concatTo(out: string, srcs: { file: string; inF: number; outF: number }[], w = 480, h = 270) {
  const graph = srcs.map((x, i) => `[${i}:v]trim=start_frame=${x.inF}:end_frame=${x.outF},setpts=PTS-STARTPTS,scale=${w}:${h},setsar=1[v${i}]`).join(";")
    + `;${srcs.map((_, i) => `[v${i}]`).join("")}concat=n=${srcs.length}:v=1:a=0[o]`;
  const gf = join(tmpDir, `${basename(out)}.graph.txt`);
  writeFileSync(gf, graph, "utf8");
  await ff([...srcs.flatMap((x) => ["-i", x.file]), "-/filter_complex", gf, "-map", "[o]", "-c:v", "h264_nvenc", ...(w === 480 ? ["-tune", "lossless"] : ["-preset", "p4", "-cq", "18"]), out]);
}
{
  const refSrcs: { file: string; inF: number; outF: number }[] = [];
  let t = 0;
  for (const s of spans) { if (t >= totalF) break; const len = Math.min(s.b - s.a, totalF - t); refSrcs.push({ file: masterVideo, inF: s.a, outF: s.a + len }); t += len; }
  const a = join(tmpDir, "check-v1.mp4"), b = join(tmpDir, "check-ref.mp4");
  await concatTo(a, v1.map((x) => ({ file: x.piece.file, inF: x.inF, outF: x.outF })));
  await concatTo(b, refSrcs);
  const stats = join(tmpDir, "psnr.log");
  spawnSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", a, "-i", b, "-lavfi", `[0:v][1:v]psnr=stats_file=${relative(process.cwd(), stats).replace(/\\/g, "/")}`, "-f", "null", "-"]);
  const rows = readFileSync(stats, "utf8").trim().split("\n").map((l) => Number(/psnr_avg:([\d.]+|inf)/.exec(l)?.[1] === "inf" ? 99 : /psnr_avg:([\d.]+)/.exec(l)?.[1]));
  // lệch khung trên đoạn có chuyển động cho 13–25 dB; khác biệt do nén lại nhiều lần giữa file cảnh và video sạch ở mức 30+ dB
  const bad = rows.map((v, i) => [i, v] as const).filter(([, v]) => !(v >= 30));
  if (rows.length !== totalF) throw new Error(`Tự kiểm: ${rows.length} khung so được ≠ ${totalF} khung timeline`);
  if (bad.length) throw new Error(`Tự kiểm KHÔNG ĐẠT: ${bad.length} khung lệch (đầu tiên ở khung ${bad[0][0]}, ${bad[0][1].toFixed(1)} dB)`);
  log(`Tự kiểm hình: đạt ${rows.length}/${totalF} khung (thấp nhất ${Math.min(...rows).toFixed(1)} dB)`);
}

/* ── 5. Âm thanh: bù loudnorm (G), nhạc đã ducking, giọng gốc ── */
const vol = (db: number) => `volume=${db.toFixed(2)}dB`;
const master = project.audio?.master ?? { lufs: -16, truePeak: -1.5 };
const mixCtx = { ...(await probeForMix(project, jobDir)), stems: true };
const mix = buildMixGraph(project, jobDir, mixCtx);
const mixKey = { graph: mix.graph, inputs: mix.inputs.map(stamp), master, totalF };
const musicFile = hashed("nhac-da-ha", "wav", mixKey);
const mixInfo = hashed("tron", "json", mixKey);
let G: number;
if (existsSync(musicFile) && existsSync(mixInfo)) G = JSON.parse(readFileSync(mixInfo, "utf8")).G;
else {
  log("Trộn thử để lấy mức bù loudnorm + stem nhạc đã hạ…");
  const pre = join(tmpDir, "mix-pre.wav"), gf = join(tmpDir, "mix-graph.txt");
  writeFileSync(gf, mix.graph, "utf8");
  await ff([...mix.inputs.flatMap((i) => ["-i", i]), "-/filter_complex", gf, "-map", "[out]", "-ar", "48000", "-ac", "2", "-c:a", "pcm_f32le", pre,
    ...mix.stems.flatMap((st) => ["-map", `[${st}]`, "-ar", "48000", "-c:a", "pcm_f32le", join(tmpDir, `stem-${st}.wav`)])]);
  G = +(master.lufs - (await measureLoudness(pre)).lufs).toFixed(2); // loudnorm tuyến tính = một mức khuếch đại cố định
  await ff(["-i", join(tmpDir, "stem-mduck.wav"), "-t", (totalF / FPS).toFixed(3), "-af", vol(G), "-ar", "48000", "-c:a", "pcm_s24le", musicFile]);
  writeFileSync(mixInfo, JSON.stringify({ G }), "utf8");
}
log(`Bù loudnorm: ${G >= 0 ? "+" : ""}${G} dB`);
const clipGain = new Map<string, number>();
const metaFile = join(jobDir, "clips.meta.json");
if (existsSync(metaFile)) for (const x of JSON.parse(readFileSync(metaFile, "utf8")).gains ?? []) clipGain.set(x.id, x.gainDb);
// Giọng = NGUYÊN từng file TTS gốc (mỗi cảnh scene-kit một file voice/scene-<id>.mp3, mỗi đoạn quay màn hình một file tts/…),
// đặt đúng chỗ đoạn đó bắt đầu, không cắt đầu/đuôi (cắt ra từ giọng đã ghép thì khựng ở chỗ nối và lẹm lời ở chỗ người dùng cắt).
// Mức: bản trộn editor có alimiter trước loudnorm, Premiere thì không → nướng (gain giọng + bù G + gain trung bình các đoạn editor)
// và bộ giới hạn đỉnh vào bản sao của từng file (file gốc giữ nguyên).
const gains = spans.map((s) => clipGain.get(s.id) ?? 0);
const meanGain = +(gains.reduce((a, b) => a + b, 0) / Math.max(1, gains.length)).toFixed(2);
const vGain = (project.audio?.voice.gainDb ?? 0) + G + meanGain;
const LIMIT_DB = -1.8;
const timelineScenes = JSON.parse(readFileSync(join(docDir, "timeline.json"), "utf8")).scenes as { sceneId: string; start: number }[];
const manifestFull = JSON.parse(readFileSync(join(work, "manifest.json"), "utf8")) as { id: string; durSec: number; audio: string }[];
// vị trí (giây trên video sạch) từng file giọng: âm thanh video sạch là các phần ghép nối tiếp → cộng dồn độ dài âm thanh từng phần
const voiceSrcs: { id: string; file: string; srcSec: number }[] = [];
{
  let cur = 0;
  for (const [i, step] of cfg.sequence.entries()) {
    if ("sk" in step) {
      const first = timelineScenes.find((s) => s.sceneId === step.sk[0])!;
      for (const id of step.sk) {
        const sc = timelineScenes.find((s) => s.sceneId === id);
        const f = join(docDir, "voice", `scene-${id}.mp3`);
        if (!sc || !existsSync(f)) throw new Error(`thiếu giọng/mốc cảnh ${id}`);
        voiceSrcs.push({ id, file: f, srcSec: cur + sc.start - first.start });
      }
      cur += await getDurationSec(join(work, `part-${String(i).padStart(2, "0")}-sk.mp4`));
    } else for (const id of step.sc) {
      const m = manifestFull.find((x) => x.id === id);
      if (!m || !existsSync(m.audio)) throw new Error(`thiếu file giọng đoạn ${id}`);
      voiceSrcs.push({ id, file: m.audio, srcSec: cur });
      cur += m.durSec;
    }
  }
}
// giây video sạch → giây timeline theo các đoạn editor; điểm rơi vào phần đã cắt bỏ thì neo theo đoạn giữ lại kế tiếp
const srcToTl = (s: number) => {
  let acc = 0;
  for (const c of project.videoClips ?? []) {
    if (s < c.srcIn) return acc - (c.srcIn - s);
    if (s < c.srcOut!) return acc + (s - c.srcIn);
    acc += c.srcOut! - c.srcIn;
  }
  return acc;
};
// Cộng dồn độ dài trôi dần (đệm AAC mỗi phần ghép ~vài chục ms; mốc timeline.json ≠ độ dài hình từng cảnh) → căn từng file
// bằng chính âm thanh: tương quan đường bao 1 kHz trong ±1.5 s quanh vị trí đoán, rồi tinh chỉnh từng mẫu 16 kHz trong ±4 ms.
const ASR = 16000, HOP = 16;
const pcm = (f: string) => {
  const b = spawnSync(ffmpeg, ["-v", "error", "-i", f, "-ac", "1", "-ar", String(ASR), "-f", "f32le", "-"], { maxBuffer: 1 << 30 }).stdout as Buffer;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};
const envelope = (x: Float32Array) => {
  const e = new Float32Array(Math.floor(x.length / HOP));
  for (let i = 0; i < e.length; i++) { let s = 0; for (let j = 0; j < HOP; j++) s += x[i * HOP + j] ** 2; e[i] = Math.sqrt(s / HOP); }
  return e;
};
const pearson = (a: Float32Array, ai: number, b: Float32Array, n: number) => {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < n; i++) { const x = a[ai + i], y = b[i]; sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y; }
  const cov = sab - (sa * sb) / n, va = saa - (sa * sa) / n, vb = sbb - (sb * sb) / n;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : -1;
};
const srcPcm = pcm(join(jobDir, "source-audio.wav"));
const srcEnv = envelope(srcPcm);
function alignVoice(file: string, predSec: number): { sec: number; score: number } {
  const x = pcm(file);
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
  let i0 = 0; while (i0 < x.length && Math.abs(x[i0]) < 0.05 * peak) i0++; // chỗ bắt đầu có tiếng trong file
  const tpl = x.subarray(i0, Math.min(x.length, i0 + 3 * ASR));
  const tEnv = envelope(tpl);
  const c = Math.round((predSec * ASR + i0) / HOP), W = Math.round(1.5 * ASR / HOP);
  let best = { k: 0, r: -2 };
  for (let k = -W; k <= W; k++) { const a = c + k; if (a < 0 || a + tEnv.length > srcEnv.length) continue; const r = pearson(srcEnv, a, tEnv, tEnv.length); if (r > best.r) best = { k, r }; }
  const coarse = (c + best.k) * HOP;
  let fine = { s: coarse, r: -2 };
  const n = Math.min(tpl.length, ASR);
  for (let s = coarse - 64; s <= coarse + 64; s++) { if (s < 0 || s + n > srcPcm.length) continue; const r = pearson(srcPcm, s, tpl, n); if (r > fine.r) fine = { s, r }; }
  return { sec: (fine.s - i0) / ASR, score: fine.r };
}
const voiceClips: { id: string; file: string; tl: number; durF: number; lane: number }[] = [];
let maxShift = 0, minScore = 1;
for (const v of voiceSrcs) {
  const out = hashed(`giong-${v.id}`, "wav", { src: stamp(v.file), vGain, LIMIT_DB });
  if (!existsSync(out)) await ff(["-i", v.file, "-af", `${vol(vGain)},alimiter=limit=${Math.pow(10, LIMIT_DB / 20).toFixed(4)}:attack=5:release=50:level=false`,
    "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le", out]);
  const al = alignVoice(v.file, v.srcSec);
  if (al.score < 0.6) throw new Error(`không căn được giọng ${v.id} vào video sạch (tương quan ${al.score.toFixed(2)})`);
  maxShift = Math.max(maxShift, Math.abs(al.sec - v.srcSec)); minScore = Math.min(minScore, al.score);
  v.srcSec = al.sec;
  const tl = Math.max(0, fr(srcToTl(v.srcSec)));
  if (tl >= totalF) continue;
  voiceClips.push({ id: v.id, file: out, tl, durF: Math.min(fr(await getDurationSec(out)), totalF - tl), lane: 0 });
}
{ const l = assignLanes(voiceClips.map((v) => ({ start: v.tl / FPS, dur: v.durF / FPS }))); voiceClips.forEach((v, i) => (v.lane = l.lanes[i])); }
const voiceLanes = Math.max(1, ...voiceClips.map((v) => v.lane + 1));
log(`Giọng: ${voiceClips.length} file gốc nguyên vẹn · ${voiceLanes} track · căn theo âm thanh (dời tối đa ${(maxShift * 1000).toFixed(0)} ms, tương quan thấp nhất ${minScore.toFixed(2)})`);

/* ── 6. SFX ── */
type AudioLayer = Layer & { src: string; offset?: number; gainDb?: number; fadeIn?: number; fadeOut?: number };
const sfxLayers = project.tracks.filter((t) => t.kind === "sfx" && !t.hidden).flatMap((t) => t.layers as AudioLayer[]).filter((l) => l.src && l.start < totalF / FPS).sort((a, b) => a.start - b.start);
const lanes = assignLanes(sfxLayers.map((l) => ({ start: l.start, dur: l.duration })));
const sfx = sfxLayers.map((l, i) => ({ id: l.id, file: resolve(REPO, l.src), start: l.start, dur: l.duration, offset: l.offset ?? 0,
  gainDb: (l.gainDb ?? 0) + G, fadeIn: l.fadeIn ?? 0, fadeOut: l.fadeOut ?? 0, lane: lanes.lanes[i] }));
for (const s of sfx) if (!existsSync(s.file)) throw new Error(`thiếu file SFX ${s.file}`);
log(`SFX: ${sfx.length} tiếng · ${lanes.count} làn`);

/* ── 7. Nhãn góc: PNG chụp từ overlay của editor (một server cho mọi nhãn) ── */
const callouts = project.tracks.filter((t) => t.id === "t-callout" && !t.hidden).flatMap((t) => t.layers).filter((l) => l.start < totalF / FPS).sort((a, b) => a.start - b.start);
const runtime = join(REPO, "scripts", "editor", "public", "overlay-runtime.js");
const shotOf = (c: Layer) => hashed("nhan-goc", "png", { layer: { ...c, id: "", start: 0, duration: 0 }, W, H, rt: existsSync(runtime) ? stamp(runtime) : "" });
// khung bắt đầu/độ dài nhãn trên timeline: không bao giờ chạy sang cảnh scene-kit kế tiếp (người dùng cắt bớt cuối đoạn quay màn hình
// thì nhãn của đoạn đó vẫn mang độ dài gốc) — tắt trước cảnh 6 khung như bản gốc (nhãn kết thúc 0.2 s trước hết đoạn)
const sceneStarts = v1.filter((x) => x.piece.kind === "scene").map((x) => x.tl);
const shots = callouts.map((c) => {
  const startF = fr(c.start);
  const nextScene = sceneStarts.find((t) => t > startF) ?? totalF;
  const endF = Math.min(startF + fr(c.duration), nextScene - 6, totalF);
  return { c, png: shotOf(c), startF, durF: Math.max(1, endF - startF) };
});
const todo = shots.filter((s) => !existsSync(s.png));
if (todo.length) {
  for (let i = 1; i < callouts.length; i++) if (callouts[i].start < callouts[i - 1].start + callouts[i - 1].duration - 1e-3) throw new Error(`nhãn góc ${callouts[i - 1].id} và ${callouts[i].id} chồng thời gian — chụp chung một trang sẽ lẫn nhau`);
  const chrome = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  if (!chrome) throw new Error("Không thấy Chrome/Edge để chụp nhãn góc");
  const tmpJob = join(docDir, "_callout-shots");
  mkdirSync(tmpJob, { recursive: true });
  for (const f of ["media.json"]) if (existsSync(join(jobDir, f))) copyFileSync(join(jobDir, f), join(tmpJob, f));
  writeFileSync(join(tmpJob, "project.json"), JSON.stringify({ ...project, revision: 0, videoClips: undefined,
    tracks: [{ id: "t-callout", kind: "graphics", name: "Nhãn góc", hidden: false, locked: false, layers: callouts }] }), "utf8");
  const proc = spawn(process.execPath, ["--import", "tsx", join(REPO, "scripts", "editor", "server.ts"), relative(join(REPO, "output"), tmpJob).replace(/\\/g, "/"), "--no-open", "--port", "4366"], { cwd: REPO, windowsHide: true });
  try {
    const url = await new Promise<string>((res, rej) => {
      const to = setTimeout(() => rej(new Error("server editor tạm không khởi động")), 30000);
      proc.stdout.on("data", (d) => { const m = /(http:\/\/localhost:\d+)/.exec(String(d)); if (m) { clearTimeout(to); res(m[1]); } });
      proc.on("exit", (code) => rej(new Error(`server editor tạm thoát (${code})`)));
    });
    for (const s of todo) {
      const raw = join(tmpDir, "shot.png");
      rmSync(raw, { force: true });
      spawnSync(chrome, ["--headless=new", "--disable-gpu", `--screenshot=${raw}`, `--window-size=${W},${H}`, "--default-background-color=00000000",
        "--virtual-time-budget=8000", "--hide-scrollbars", `${url}/parity.html?t=${(s.c.start + Math.min(1.2, s.c.duration / 2)).toFixed(3)}`], { windowsHide: true });
      if (!existsSync(raw)) throw new Error(`không chụp được nhãn góc ${s.c.id}`);
      // parity.html in khối số đo "[]" ở góc trên trái → xoá (nhãn góc bắt đầu từ ~50 px)
      await ff(["-i", raw, "-vf", "format=rgba,drawbox=x=0:y=0:w=40:h=32:color=black@0:t=fill:replace=1", s.png]);
    }
  } finally {
    proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(tmpJob, { recursive: true, force: true });
  }
}
log(`Nhãn góc: ${shots.length} PNG (${todo.length} chụp mới)`);

/* ── 8. Phụ đề SRT ── */
{
  const ts = (s: number) => { const ms = Math.round(s * 1000); const p = (n: number, w = 2) => String(n).padStart(w, "0"); return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`; };
  const rows = project.tracks.filter((t) => t.kind === "subtitle" && !t.hidden).flatMap((t) => t.layers)
    .map((l) => ({ a: l.start, b: l.start + l.duration, text: (l.text ?? "").replace(/\n/g, " ") }))
    .filter((r) => r.a < totalF / FPS).sort((x, y) => x.a - y.a);
  writeFileSync(join(outDir, `${NAME}-phu-de.srt`), rows.map((r, i) => `${i + 1}\n${ts(r.a)} --> ${ts(Math.min(r.b, totalF / FPS))}\n${r.text}\n`).join("\n"), "utf8");
}

/* ── 9. FCP7 XML (xmeml v4, không DOCTYPE: panel Premiere từ chối thực thể ngoài) ── */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fileUrl = (f: string) => pathToFileURL(f).href.replace("file:///", "file://localhost/");
const rate = `<rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>`;
const fileIds = new Map<string, string>();
const durCache = new Map<string, number>();
const fileEl = async (f: string, kind: "video" | "audio" | "still") => {
  if (fileIds.has(f)) return `<file id="${fileIds.get(f)}"/>`;
  const id = `file-${fileIds.size + 1}`;
  fileIds.set(f, id);
  if (!durCache.has(f)) durCache.set(f, kind === "still" ? 1 : fr(await getDurationSec(f)));
  const media = kind === "audio"
    ? `<media><audio><samplecharacteristics><depth>24</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio></media>`
    : `<media><video><samplecharacteristics>${rate}<width>${W}</width><height>${H}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></video></media>`;
  return `<file id="${id}"><name>${esc(basename(f))}</name><pathurl>${fileUrl(f)}</pathurl>${rate}<duration>${durCache.get(f)}</duration>${media}</file>`;
};
/** Audio Levels của FCP7: tuyến tính, 1 = 0 dB; fade bằng keyframe */
const levels = (db: number, durF: number, fadeInF = 0, fadeOutF = 0) => {
  const lin = Math.pow(10, db / 20).toFixed(5);
  const keys = !fadeInF && !fadeOutF ? "" :
    (fadeInF ? `<keyframe><when>0</when><value>0</value></keyframe><keyframe><when>${fadeInF}</when><value>${lin}</value></keyframe>` : `<keyframe><when>0</when><value>${lin}</value></keyframe>`)
    + (fadeOutF ? `<keyframe><when>${Math.max(0, durF - fadeOutF)}</when><value>${lin}</value></keyframe><keyframe><when>${durF}</when><value>0</value></keyframe>` : "");
  return `<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audiolevels</effecttype><mediatype>audio</mediatype>`
    + `<parameter><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>3.98109</valuemax><value>${lin}</value>${keys}</parameter></effect></filter>`;
};
let clipId = 0;
const clip = async (o: { name: string; file: string; kind: "video" | "audio" | "still"; start: number; durF: number; inF: number; filters?: string }) =>
  `<clipitem id="clip-${++clipId}"><name>${esc(o.name)}</name><enabled>TRUE</enabled>${rate}<start>${o.start}</start><end>${o.start + o.durF}</end><in>${o.inF}</in><out>${o.inF + o.durF}</out>`
  + `${o.kind === "still" ? `<duration>${o.durF}</duration>` : ""}${await fileEl(o.file, o.kind)}${o.filters ?? ""}</clipitem>`;
const track = (items: string[]) => `<track>${items.join("")}</track>`;
const seqName = opt("seq-name") ?? `${cfg.title ?? "Video"}${Number.isFinite(UNTIL) ? " (thử)" : ""}`;

const v1Track = [];
for (const x of v1) v1Track.push(await clip({ name: `${x.piece.id} · ${x.piece.kind === "scene" ? "cảnh" : "quay màn hình"}`, file: x.piece.file, kind: "video", start: x.tl, durF: x.outF - x.inF, inF: x.inF }));
const v2Track = [];
for (const [i, s] of shots.entries()) v2Track.push(await clip({ name: `Nhãn góc ${i + 1} · ${s.c.text ?? ""}`, file: s.png, kind: "still", start: s.startF, durF: s.durF, inF: 0 }));
const voiceTracks: string[][] = Array.from({ length: voiceLanes }, () => []);
for (const v of voiceClips) voiceTracks[v.lane].push(await clip({ name: `Giọng · ${v.id}`, file: v.file, kind: "audio", start: v.tl, durF: v.durF, inF: 0, filters: levels(0, v.durF) }));
const sfxTracks: string[][] = Array.from({ length: lanes.count }, () => []);
for (const s of sfx) {
  const d = Math.max(1, Math.min(fr(s.dur), totalF - fr(s.start)));
  sfxTracks[s.lane].push(await clip({ name: `SFX · ${basename(s.file, ".wav")}`, file: s.file, kind: "audio", start: fr(s.start), durF: d, inF: fr(s.offset), filters: levels(s.gainDb, d, fr(s.fadeIn), fr(s.fadeOut)) }));
}
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<xmeml version="4"><sequence id="seq-1"><name>${esc(seqName)}</name>${rate}<duration>${totalF}</duration>`
  + `<media><video><format><samplecharacteristics>${rate}<width>${W}</width><height>${H}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>${track(v1Track)}${track(v2Track)}</video>`
  + `<audio><numOutputChannels>2</numOutputChannels>${voiceTracks.map(track).join("")}${track([await clip({ name: "Nhạc (đã hạ sẵn khi có lời)", file: musicFile, kind: "audio", start: 0, durF: totalF, inF: 0, filters: levels(0, totalF) })])}${sfxTracks.map(track).join("")}</audio></media></sequence></xmeml>\n`;
const xmlFile = join(outDir, `${NAME}.xml`);
writeFileSync(xmlFile, xml, "utf8");
const summary = { voice: voiceClips.map((v) => ({ id: v.id, file: basename(v.file), tlSec: v.tl / FPS, durSec: v.durF / FPS, lane: v.lane })), snapshot: snapFile, revision: project.revision, seconds: totalF / FPS, loudnormGainDb: G, v1: v1.length, voiceClips: voiceClips.length, sfx: sfx.length, sfxLanes: lanes.count, callouts: shots.length,
  media: [masterVideo, ...voiceClips.map((v) => v.file), musicFile, ...shots.map((s) => s.png)].map((f) => basename(f)) };
writeFileSync(join(outDir, `${NAME}.json`), JSON.stringify(summary, null, 2), "utf8");
log(`✓ ${xmlFile}`);

/* ── 10. Xem trước: dựng đúng theo nội dung XML (hình V1 + PNG + giọng/nhạc/SFX với mức & fade) ── */
if (args.includes("--preview")) {
  log("Dựng bản xem trước theo XML…");
  const vid = join(tmpDir, "preview-v1.mp4");
  await concatTo(vid, v1.map((x) => ({ file: x.piece.file, inF: x.inF, outF: x.outF })), 960, 540); // 960×540: đủ để soát, nhẹ máy
  const inputs: string[] = [vid, ...shots.map((s) => s.png), ...voiceClips.map((v) => v.file), musicFile, ...sfx.map((s) => s.file)];
  const nPng = shots.length, iVoice0 = 1 + nPng, iMusic = iVoice0 + voiceClips.length, iSfx0 = iMusic + 1;
  const g: string[] = [];
  let last = "0:v";
  shots.forEach((s, k) => {
    const a = s.startF / FPS, b = (s.startF + s.durF) / FPS;
    g.push(`[${1 + k}:v]scale=960:540[p${k}]`);
    g.push(`[${last}][p${k}]overlay=0:0:enable='between(t,${a.toFixed(3)},${b.toFixed(3)})'[ov${k}]`);
    last = `ov${k}`;
  });
  const db = (x: number) => Math.pow(10, x / 20).toFixed(5);
  const aLabels: string[] = [];
  voiceClips.forEach((v, k) => {
    g.push(`[${iVoice0 + k}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=duration=${(v.durF / FPS).toFixed(4)},adelay=${Math.round(v.tl / FPS * 1000)}:all=1[vo${k}]`);
    aLabels.push(`[vo${k}]`);
  });
  g.push(`[${iMusic}:a]anull[mu]`); aLabels.push("[mu]");
  sfx.forEach((s, k) => {
    const d = Math.max(1, Math.min(fr(s.dur), totalF - fr(s.start))) / FPS;
    const fades = [s.fadeIn > 0 ? `afade=t=in:d=${s.fadeIn.toFixed(3)}` : "", s.fadeOut > 0 ? `afade=t=out:st=${Math.max(0, d - s.fadeOut).toFixed(3)}:d=${s.fadeOut.toFixed(3)}` : ""].filter(Boolean).join(",");
    g.push(`[${iSfx0 + k}:a]aformat=sample_rates=48000:channel_layouts=stereo,atrim=start=${s.offset.toFixed(3)}:duration=${d.toFixed(3)},asetpts=PTS-STARTPTS${fades ? "," + fades : ""},volume=${db(s.gainDb)},adelay=${Math.round(fr(s.start) / FPS * 1000)}:all=1[sx${k}]`);
    aLabels.push(`[sx${k}]`);
  });
  g.push(`${aLabels.join("")}amix=inputs=${aLabels.length}:normalize=0:dropout_transition=0,atrim=duration=${(totalF / FPS).toFixed(3)}[aout]`);
  const gf = join(tmpDir, "preview-graph.txt");
  writeFileSync(gf, g.join(";\n"), "utf8");
  const out = join(outDir, `${NAME}-xem-truoc.mp4`);
  await ff([...inputs.flatMap((f) => (f.endsWith(".png") ? ["-loop", "1", "-t", (totalF / FPS).toFixed(3), "-i", f] : ["-i", f])), "-/filter_complex", gf,
    "-map", `[${last}]`, "-map", "[aout]", "-c:v", "h264_nvenc", "-preset", "p5", "-cq", "20", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-t", (totalF / FPS).toFixed(3), "-movflags", "+faststart", out]);
  const L = await measureLoudness(out);
  log(`✓ Xem trước: ${out} · ${L.lufs} LUFS, đỉnh ${L.truePeak} dBTP (đích ${master.lufs} LUFS)`);
}

/* ── 11. Nhập vào Premiere qua cầu nối ── */
const prproj = opt("import");
if (prproj) {
  mkdirSync(BRIDGE_OUT, { recursive: true });
  const target = join(BRIDGE_OUT, `${NAME}.xml`);
  copyFileSync(xmlFile, target);
  if (!BRIDGE) throw new Error("Đặt ADOBE_BRIDGE trỏ tới adobe-bridge.cjs để dùng --import.");
  const r = spawnSync(process.execPath, [BRIDGE, "pr", "import", target, prproj], { encoding: "utf8" });
  const outText = `${r.stdout}${r.stderr}`;
  if (/Open Script Rough Cut Bridge/.test(outText)) throw new Error("Panel cầu nối trong Premiere đang tắt: mở project và bật panel Script Rough Cut Bridge rồi chạy lại.");
  if (!/"ok":\s*true/.test(outText)) throw new Error(`Nhập Premiere thất bại: ${outText.slice(-400)}`);
  log(`✓ Đã nhập vào Premiere: sequence "${seqName}"`);
}
rmSync(tmpDir, { recursive: true, force: true });
