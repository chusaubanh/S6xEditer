import { parseArgs } from "./jobs.js";
import { alignEditsCmd, approve, cutPlan, intake, transcribe } from "./commands-text.js";
import { audio, buildProject, cut } from "./commands-media.js";
import { broll, subject } from "./commands-broll.js";
import { intro } from "./intro.js";
import { proxy, sourceAudio } from "./source-media.js";
import { clipsBuild, clipsInit } from "./clips.js";
import type { Density } from "./sfx-plan.js";

const USAGE = `Chế độ C — talking head. Dùng: npm run th:<lệnh> -- <đối số>
  th:intake -- "<clip>" [--doc "<tên tài liệu>"] [--name <slug video>]   (tạo output/<doc>/<slug>/ và input/<doc>/raw/)
  th:transcribe -- <job> [--model large-v3|phowhisper-large]
  th:align-edits -- <job>
  th:approve -- <job> --stage outline|cut [--note "<ghi chú>"]
  th:cut-plan -- <job>
  th:cut -- <job> --aspect 16:9|4:5|9:16|keep [--cpu]
  th:audio -- <job>
  th:project -- <job> [--force]
  th:subject -- <job> [--face x,y,w,h]   (vùng mặt người nói, % canvas)
  th:intro -- <job> --from <s> --to <e> [--gap 0.6] [--intro-sfx <id>] [--redo]   (cold open từ chính video, dời mọi thứ thêm D)
  th:source-audio -- <job> [--force]   (audio cả video gốc, DeepFilterNet3 một lần)
  th:proxy -- <job> [--force]           (proxy editor + thumbs + source-peaks.json)
  th:clips-init -- <job>                (migration cut-map → videoClips)
  th:clips-build -- <job> [--force] [--cpu]   (dựng cut.mp4/audio.wav/transcript.cut.json từ videoClips)
  th:broll -- <job> [--dry] [--pack <gói SFX>] [--density low|mid|high]`;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parseArgs(rest);
  const str = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string) : undefined);
  const job = pos[0];
  if (cmd !== "intake" && !job) throw new Error(`Thiếu tên job.\n${USAGE}`);
  switch (cmd) {
    case "intake":
      if (!job) throw new Error(`Thiếu đường dẫn clip.\n${USAGE}`);
      await intake(job, str("name"), str("doc"));
      return;
    case "transcribe": return transcribe(job, str("model"));
    case "align-edits": return alignEditsCmd(job);
    case "approve": return approve(job, str("stage") ?? "", str("note"));
    case "cut-plan": return cutPlan(job);
    case "cut": return cut(job, str("aspect"), flags.cpu === true);
    case "audio": return audio(job);
    case "project": return buildProject(job, flags.force === true);
    case "intro": {
      const from = Number(str("from"));
      const to = Number(str("to"));
      if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error("Thiếu --from/--to (giây trên timeline đã cắt).");
      return intro(job, { from, to, gap: str("gap") ? Number(str("gap")) : undefined, introSfx: str("intro-sfx"), redo: flags.redo === true });
    }
    case "source-audio": await sourceAudio(job, flags.force === true); return;
    case "proxy": return proxy(job, flags.force === true);
    case "clips-init": return clipsInit(job);
    case "clips-build": return clipsBuild(job, flags.force === true, flags.cpu === true);
    case "subject": return subject(job, str("face"));
    case "broll": return broll(job, { dry: flags.dry === true, pack: str("pack"), density: str("density") as Density | undefined });
    default: throw new Error(`Lệnh không rõ: ${cmd}\n${USAGE}`);
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`LỖI: ${(e as Error).message}`);
    process.exit(1);
  },
);
