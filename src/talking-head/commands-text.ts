import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { alignEdits } from "./align-edits.js";
import { fillerCandidates, mergeNearby, renderCutsMd, repeatCandidates, silenceCandidates, type Filler } from "./cut-plan.js";
import { probe, runCapture } from "./ffmpeg-util.js";
import { analyzeSegment, readWav16 } from "./voicing.js";
import { ASR_PYTHON, REPO_ROOT, approvalHashes, inputDir, jobDir, loadApproval, loadRun, readJson, requireApproval, requireFile, withStep, writeJson } from "./jobs.js";
import { CutsSchema, OutlineSchema, TranscriptSchema, type Cuts, type Transcript } from "./project-schema.js";

export interface MediaJson {
  job: string;
  source: string; // đường dẫn tương đối repo tới bản sao clip nguồn
  info: { duration: number; width: number; height: number; fps: number; hasAudio: boolean; videoCodec?: string };
  ffprobe: unknown;
}

export async function loadMedia(job: string): Promise<MediaJson> {
  return readJson<MediaJson>(requireFile(join(jobDir(job), "media.json"), "Chạy th:intake trước."));
}

/** Transcript dùng cho các bước sau: bản đã hiệu đính nếu có, không thì bản gốc. */
export async function loadBestTranscript(job: string): Promise<{ tr: Transcript; file: string }> {
  const dir = jobDir(job);
  const edited = join(dir, "transcript.edited.json");
  const file = existsSync(edited) ? edited : requireFile(join(dir, "transcript.raw.json"), "Chạy th:transcribe trước.");
  return { tr: await readJson(file, TranscriptSchema), file };
}

// ---------- 01 intake ----------

/** Tên tài liệu gốc từ tên file: bỏ đuôi, bỏ hậu tố " cut"/" final" (lặp được), gọn khoảng trắng. */
export function docNameFromFile(file: string): string {
  let n = basename(file).replace(/\.[^.]+$/, "");
  for (;;) {
    const m = n.replace(/[\s._-]+(cut|final)$/i, "");
    if (m === n) break;
    n = m;
  }
  return cleanSegment(n);
}

/** Một đoạn tên thư mục an toàn: giữ chữ Unicode (có dấu), số, khoảng trắng, "-" và "_". */
export function cleanSegment(s: string): string {
  return s.replace(/[^\p{L}\p{N}_\- ]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** Slug ASCII viết thường (bỏ dấu) cho tên video. */
export function slugify(s: string, max = 40): string {
  return s.normalize("NFD").replace(/\p{M}+/gu, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
}

/**
 * Mặc định: output/<tài liệu gốc>/<slug>/ và input/<tài liệu gốc>/raw/ (bản sao clip gốc dùng chung cho mọi video của tài liệu).
 * Tài liệu = tên file bỏ đuôi và hậu tố " cut"/"final", hoặc --doc. --name là slug video (có "/" thì phần đầu là tài liệu).
 */
export async function intake(clip: string, name?: string, docArg?: string): Promise<string> {
  const src = resolve(clip);
  requireFile(src, "Không thấy clip nguồn.");
  let doc = cleanSegment(docArg ?? "");
  let slug = name ?? "";
  if (name?.includes("/") || name?.includes("\\")) {
    const parts = name.split(/[\\/]+/).filter(Boolean);
    slug = parts.pop() ?? "";
    doc = doc || cleanSegment(parts.join(" "));
  }
  doc = doc || docNameFromFile(src);
  slug = cleanSegment(slug) || `01-${slugify(doc) || "video"}`;
  if (!doc) throw new Error("Tên tài liệu rỗng, dùng --doc.");
  const job = `${doc}/${slug}`;
  const rawDir = join(inputDir(job), "raw");
  const dest = join(rawDir, basename(src));
  if (existsSync(join(jobDir(job), "media.json"))) throw new Error(`Job "${job}" đã có media.json. Dùng --name khác hoặc đổi tên thư mục cũ thành _archive-<ngày>.`);
  if (existsSync(dest) && statSync(dest).size !== statSync(src).size) throw new Error(`Đã có ${dest} nhưng khác kích thước. Dùng --doc khác hoặc đổi tên bản cũ.`);
  await withStep(job, "intake", async () => {
    await mkdir(rawDir, { recursive: true });
    if (!existsSync(dest)) await copyFile(src, dest); // chỉ sao chép, không di chuyển bản gốc; clip đã có (cùng tài liệu) thì dùng chung
    const { info, raw } = await probe(dest);
    const rel = relative(REPO_ROOT, dest);
    const media: MediaJson = { job, source: (rel.startsWith("..") || isAbsolute(rel) ? dest : rel).replace(/\\/g, "/"), info, ffprobe: raw };
    await writeJson(join(jobDir(job), "media.json"), media);
    return { result: null, outputs: ["media.json"] };
  });
  const run = await loadRun(job);
  run.doc = doc;
  run.slug = slug;
  await writeJson(join(jobDir(job), "run.json"), run);
  console.log(`Job: ${job}\nTài liệu: ${doc} | slug: ${slug}\nBản sao: ${dest}\nmedia.json: ${join(jobDir(job), "media.json")}`);
  return job;
}

// ---------- 02a transcribe ----------

/** Đo VRAM đỉnh bằng nvidia-smi mỗi giây trong lúc tiến trình chạy. */
function pollVram(): { stop: () => number } {
  let peak = 0;
  const t = setInterval(() => {
    const r = spawnSync("nvidia-smi", ["--query-gpu=memory.used", "--format=csv,noheader,nounits"], { encoding: "utf8", windowsHide: true });
    const v = parseInt(r.stdout?.trim().split("\n")[0] ?? "", 10);
    if (v > peak) peak = v;
  }, 1000);
  return { stop: () => (clearInterval(t), peak) };
}

export async function transcribe(job: string, model = "large-v3"): Promise<void> {
  if (!["large-v3", "phowhisper-large"].includes(model)) throw new Error(`--model chỉ nhận large-v3 | phowhisper-large (nhận: ${model})`);
  requireFile(ASR_PYTHON, "Chạy npm run th:setup trước.");
  const media = await loadMedia(job);
  const dir = jobDir(job);
  const suffix = model === "large-v3" ? "" : `.${model}`;
  await withStep(job, model === "large-v3" ? "transcribe" : `transcribe-${model}`, async () => {
    await mkdir(join(dir, "work"), { recursive: true });
    const wav = join(dir, "work", "audio16k.wav");
    await runCapture("ffmpeg", ["-y", "-i", resolve(REPO_ROOT, media.source), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
    const vram = pollVram();
    const t0 = Date.now();
    const code = await new Promise<number>((res, rej) => {
      const p = spawn(ASR_PYTHON, [join(REPO_ROOT, "scripts", "asr", "transcribe.py"), "--audio", wav, "--out-dir", dir, "--model", model, "--suffix", suffix], {
        stdio: "inherit",
        windowsHide: true,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
      p.on("error", rej);
      p.on("close", (c) => res(c ?? 1));
    });
    const peakVramMiB = vram.stop();
    if (code !== 0) throw new Error(`transcribe.py thoát mã ${code}`);
    const seconds = +((Date.now() - t0) / 1000).toFixed(1);
    await writeJson(join(dir, `transcribe.meta${suffix}.json`), { model, seconds, peakVramMiB, audioSeconds: media.info.duration });
    console.log(`Phiên âm xong: ${seconds}s, VRAM đỉnh ${peakVramMiB} MiB`);
    return { result: null, outputs: [`transcript.raw${suffix}.json`, `vad${suffix}.json`, `fillers${suffix}.json`] };
  });
}

// ---------- 02b align-edits ----------

export async function alignEditsCmd(job: string): Promise<void> {
  const dir = jobDir(job);
  const raw = await readJson(requireFile(join(dir, "transcript.raw.json"), "Chạy th:transcribe trước."), TranscriptSchema);
  const txt = requireFile(join(dir, "transcript.edited.txt"), "AI viết transcript.edited.txt (một đoạn/dòng) trước.");
  const lines = (await readFile(txt, "utf8")).replace(/^﻿/, "").split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  await withStep(job, "align-edits", async () => {
    const out: Transcript = { ...raw, segments: alignEdits(raw.segments, lines) };
    await writeJson(join(dir, "transcript.edited.json"), out);
    return { result: null, outputs: ["transcript.edited.json"] };
  });
  console.log(`transcript.edited.json: ${join(dir, "transcript.edited.json")}`);
}

// ---------- cổng duyệt ----------

export async function approve(job: string, stage: string, note?: string): Promise<void> {
  if (stage !== "outline" && stage !== "cut") throw new Error('--stage phải là "outline" hoặc "cut"');
  const dir = jobDir(job);
  if (stage === "outline") OutlineSchema.parse(await readJson(requireFile(join(dir, "outline.json"), "AI viết outline.json trước.")));
  else {
    await requireApproval(job, "outline");
    CutsSchema.parse(await readJson(requireFile(join(dir, "cuts.json"), "Chạy th:cut-plan trước.")));
  }
  const cur = await loadApproval(job);
  cur[stage] = { approvedAt: new Date().toISOString(), ...(note ? { note } : {}), hashes: await approvalHashes(job, stage) };
  await writeJson(join(dir, "th-approval.json"), cur);
  console.log(`Đã duyệt "${stage}": ${join(dir, "th-approval.json")}`);
}

// ---------- 02d cut-plan ----------

export async function cutPlan(job: string): Promise<void> {
  await requireApproval(job, "outline");
  const dir = jobDir(job);
  const media = await loadMedia(job);
  const { tr } = await loadBestTranscript(job);
  const fillersFile = join(dir, "fillers.json");
  const fillers: Filler[] = existsSync(fillersFile) ? await readJson<Filler[]>(fillersFile) : [];
  await withStep(job, "cut-plan", async () => {
    const wavFile = join(dir, "work", "audio16k.wav");
    if (existsSync(wavFile)) {
      const { samples, sampleRate } = await readWav16(wavFile);
      for (const f of fillers) if (f.source === "vad-gap") Object.assign(f, analyzeSegment(samples, sampleRate, f.start, f.end));
    }
    const auto = mergeNearby([
      ...fillerCandidates(fillers, tr.segments),
      ...silenceCandidates(tr.segments, media.info.duration),
      ...repeatCandidates(tr.segments),
    ]);
    const cutsFile = join(dir, "cuts.json");
    let keepOthers: Cuts["ranges"] = [];
    if (existsSync(cutsFile)) {
      // giữ phần AI/người dùng đã thêm; chỉ thay ứng viên auto. Bản cũ lưu lại.
      const old = await readJson(cutsFile, CutsSchema);
      keepOthers = old.ranges.filter((r) => r.source !== "auto");
      await copyFile(cutsFile, join(dir, `cuts.prev-${new Date().toISOString().replace(/:/g, "-")}.json`));
    }
    const cuts: Cuts = { mode: "remove", ranges: [...keepOthers, ...auto] };
    await writeJson(cutsFile, cuts);
    await writeFile(join(dir, "cuts.md"), renderCutsMd(cuts.ranges, tr.segments), "utf8");
    console.log(`cuts.json: ${auto.length} ứng viên (${auto.filter((r) => r.approved).length} đề xuất cắt, từ đệm thô ${fillers.length}), xem cuts.md, giữ ${keepOthers.length} đoạn của AI/người dùng.`);
    console.log(`Đánh dấu "approved": true cho các đoạn được duyệt rồi chạy th:approve --stage cut. File: ${cutsFile}`);
    return { result: null, outputs: ["cuts.json"] };
  });
}

