import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GPU } from "../training/hardware";
import { assertApproved, loadScript, resolveJob } from "../training/job";
import { buildTimeline } from "../training/training-contract";

const ENDPOINT = process.env.VIENEU_ENDPOINT ?? "http://127.0.0.1:8124";

export function probeDurationSec(path: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
    { encoding: "utf8" },
  );
  const seconds = Number(out.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Không đo được thời lượng: ${path}`);
  return seconds;
}

async function synthesize(text: string, voice: string, style: string): Promise<Buffer> {
  const response = await fetch(`${ENDPOINT}/synthesize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "audio/wav" },
    body: JSON.stringify({ text, voice, style }),
  });
  if (!response.ok) throw new Error(`VieNeu trả ${response.status}: ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

function applySpeed(path: string, speed: number): void {
  if (speed === 1) return;
  const temp = `${path}.tmp.wav`;
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", path, "-filter:a", `atempo=${speed}`, temp]);
  rmSync(path);
  renameSync(temp, path);
}

/** npm run voice -- "<tài liệu>" : thu từng câu, đo thật, ghi timeline và props cho render. */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const input = args.find((arg) => !arg.startsWith("--"));
  if (!input) throw new Error('Sử dụng: npm run voice -- "<tài liệu>"');
  const job = resolveJob(input);
  assertApproved(job, "script");
  const script = loadScript(job);

  const health = await fetch(`${ENDPOINT}/health`).catch(() => null);
  if (!health?.ok) throw new Error(`VieNeu chưa chạy ở ${ENDPOINT}. Chạy: npm run tts:server`);
  const info = (await health.json()) as { engineVersion?: string; backend?: string };
  if (GPU && info.backend !== "pytorch") throw new Error(`VieNeu đang chạy backend "${info.backend}", không phải GPU. Khởi động lại bằng npm run tts:server.`);
  const engine = String(info.engineVersion ?? "unknown");

  const voiceDir = join(job.publicDir, "voice");
  mkdirSync(voiceDir, { recursive: true });
  const durations = new Map<string, number>();

  for (const scene of script.scenes) {
    for (const [i, text] of scene.voiceSegments.entries()) {
      const path = join(voiceDir, `${scene.id}-${i}.wav`);
      const hash = createHash("sha256")
        .update(JSON.stringify([text, script.voice.id, script.voice.tone, script.voice.speed, engine]))
        .digest("hex");
      const hashPath = `${path}.hash`;
      const cached = existsSync(path) && existsSync(hashPath) && readFileSync(hashPath, "utf8") === hash;
      if (!cached) {
        writeFileSync(path, await synthesize(text, script.voice.id, script.voice.tone));
        applySpeed(path, script.voice.speed);
        writeFileSync(hashPath, hash);
      }
      const seconds = probeDurationSec(path);
      durations.set(`${scene.id}-${i}`, seconds);
      console.log(`${cached ? "cache" : "thu  "} ${scene.id} câu ${i + 1}: ${seconds.toFixed(2)} giây`);
    }
  }

  const timeline = buildTimeline(script, job.key, (id, i) => durations.get(`${id}-${i}`)!);
  writeFileSync(job.timelinePath, `${JSON.stringify(timeline, null, 2)}\n`);
  writeFileSync(job.propsPath, JSON.stringify({ script, timeline, hideText: false }));
  console.log(`Tổng thời lượng đo được: ${timeline.totalSec} giây. Timeline: ${job.timelinePath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
