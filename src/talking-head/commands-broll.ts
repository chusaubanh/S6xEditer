import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildBroll, BrollPlanSchema, type AssetInfo } from "./broll-plan.js";
import { ASR_PYTHON, REPO_ROOT, jobDir, readJson, requireFile, withStep, writeJson } from "./jobs.js";
import { loadProject, saveProject, TranscriptSchema, type VideoTransform } from "./project-schema.js";
import { planSfx, relinkSfx, type Density } from "./sfx-plan.js";
import { runCapture } from "./ffmpeg-util.js";

/** Đọc assets/th-assets/manifest.json (mảng hoặc {assets:[...]}); chưa có thư viện thì trả undefined. */
export function loadAssetManifest(root = REPO_ROOT): Map<string, AssetInfo> | undefined {
  const f = join(root, "assets", "th-assets", "manifest.json");
  if (!existsSync(f)) return undefined;
  const raw = JSON.parse(readFileSync(f, "utf8")) as AssetInfo[] | { assets: AssetInfo[] };
  const list = Array.isArray(raw) ? raw : raw.assets;
  return new Map(list.map((a) => [a.id, a]));
}

type Face = { x: number; y: number; w: number; h: number };
const sameVt = (a: VideoTransform, b: VideoTransform) => Math.abs(a.scale - b.scale) < 1e-6 && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/**
 * Quy đổi vùng mặt (% canvas) từ khung `ref` (lúc đo subject.json) sang khung `cur` (hiện tại), cùng công thức dựng khung với editor/render:
 * tâm' = 50 + cur.x + cur.scale·u, u = (tâm − 50 − ref.x)/ref.scale (toạ độ chuẩn hoá theo video nguồn); kích thước' = kích thước·cur.scale/ref.scale.
 */
export function convertFace(face: Face, ref: VideoTransform, cur: VideoTransform): Face {
  const k = cur.scale / ref.scale;
  const cx = face.x + face.w / 2, cy = face.y + face.h / 2;
  const nx = 50 + cur.x + ((cx - 50 - ref.x) / ref.scale) * cur.scale, ny = 50 + cur.y + ((cy - 50 - ref.y) / ref.scale) * cur.scale;
  const w = face.w * k, h = face.h * k;
  return { x: +(nx - w / 2).toFixed(2), y: +(ny - h / 2).toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2) };
}

export async function broll(job: string, opts: { dry?: boolean; pack?: string; density?: Density }): Promise<void> {
  const dir = jobDir(job);
  const planFile = requireFile(join(dir, "broll-plan.json"), "AI viết broll-plan.json trước (docs/BROLL-GUIDE.md).");
  const plan = BrollPlanSchema.parse(await readJson(planFile));
  const projectFile = requireFile(join(dir, "project.json"), "Chạy th:project trước.");
  const tr = await readJson(requireFile(join(dir, "transcript.cut.json"), "Chạy th:cut trước."), TranscriptSchema);
  const subjFile = join(dir, "subject.json");
  const subj = existsSync(subjFile) ? await readJson<{ face?: Face; transform?: VideoTransform }>(subjFile) : undefined;
  let face = subj?.face;
  const brand = await readJson<{ palette: { accent: string } }>(join(REPO_ROOT, "assets", "brand", "brand-guideline.json"));
  const project = await loadProject(projectFile);
  // Người dùng tự reframe trong editor sau khi đo subject.json → quy đổi vùng mặt theo khung hiện tại (subject.json ghi khung lúc đo trong "transform")
  if (face && subj?.transform && !sameVt(subj.transform, project.videoTransform)) {
    const f2 = convertFace(face, subj.transform, project.videoTransform);
    console.log(`subject.json đo ở khung scale ${subj.transform.scale} (${subj.transform.x},${subj.transform.y}); khung hiện tại scale ${project.videoTransform.scale} (${project.videoTransform.x},${project.videoTransform.y}) → quy đổi mặt ${JSON.stringify(face)} → ${JSON.stringify(f2)}`);
    face = f2;
  }
  const nOwn = project.videoClips?.filter((c) => c.transform).length ?? 0;
  if (nOwn) console.warn(`CẢNH BÁO: ${nOwn} clip có khung riêng (videoClips[].transform) — vị trí mặt/zoom/dịch do AI tính theo khung CHUNG; kiểm tra tay các beat nằm trong những clip đó (hoặc tắt máy quay tự động).`);

  const run = async () => {
    const res = buildBroll(project, plan, { words: tr.segments.flatMap((s) => s.words), segments: tr.segments.map((s) => ({ start: s.start, end: s.end })), face, assets: loadAssetManifest(), accent: brand.palette.accent, introOffset: plan.introOffset });
    let out = res.project;
    if (!opts.dry) {
      const pack = opts.pack ?? (project as unknown as { sfxPack?: string }).sfxPack ?? "corporate";
      try {
        out = relinkSfx(planSfx(out, { pack, density: opts.density ?? "mid" }));
      } catch (e) {
        res.warnings.push(`Bỏ qua SFX tự động: ${(e as Error).message}`);
      }
    }
    console.log("| Thời điểm | Loại | Nội dung |\n|---|---|---|");
    for (const s of res.summary) console.log(`| ${s.start.toFixed(2)}–${s.end.toFixed(2)} | ${s.kind} | ${s.what} |`);
    for (const w of res.warnings) console.warn(`CẢNH BÁO: ${w}`);
    if (opts.dry) {
      console.log(`(dry) ${res.summary.length} beat, ${res.warnings.length} cảnh báo, chưa ghi project.json`);
      return;
    }
    await saveProject(projectFile, out);
    console.log(`project.json: ${projectFile} (${res.summary.length} beat, ${res.warnings.length} cảnh báo)`);
  };
  if (opts.dry) await run();
  else await withStep(job, "broll", async () => ({ result: await run(), outputs: ["project.json"] }));
}

/** Khung (videoTransform) tại thời điểm đo subject.json, để th:broll quy đổi khi người dùng reframe sau đó. */
async function measuredTransform(dir: string): Promise<{ transform?: VideoTransform }> {
  const f = join(dir, "project.json");
  return existsSync(f) ? { transform: (await loadProject(f)).videoTransform } : {};
}

/** th:subject: dò mặt người nói (cần cv2/mediapipe trong .venv-asr) hoặc nhập tay --face x,y,w,h (% canvas). */
export async function subject(job: string, faceArg?: string): Promise<void> {
  const dir = jobDir(job);
  const out = join(dir, "subject.json");
  if (faceArg) {
    const [x, y, w, h] = faceArg.split(",").map(Number);
    if ([x, y, w, h].some((n) => !Number.isFinite(n))) throw new Error('--face phải dạng "x,y,w,h" (% canvas)');
    await writeJson(out, { face: { x, y, w, h }, source: "manual", ...(await measuredTransform(dir)) });
    console.log(`subject.json (nhập tay): ${out}`);
    return;
  }
  requireFile(ASR_PYTHON, "Chạy npm run th:setup trước.");
  const cut = requireFile(join(dir, "cut.mp4"), "Chạy th:cut trước.");
  const { stdout } = await runCapture(ASR_PYTHON, [join(REPO_ROOT, "scripts", "asr", "subject.py"), "--video", cut, "--out", out], { inherit: true });
  void stdout;
  // subject.py đo trên cut.mp4 CHƯA reframe → khung lúc đo là mặc định (1,0,0); th:broll sẽ quy đổi sang khung hiện tại
  await writeJson(out, { ...(await readJson<Record<string, unknown>>(out)), transform: { scale: 1, x: 0, y: 0 } });
  console.log(`subject.json: ${out}`);
}
