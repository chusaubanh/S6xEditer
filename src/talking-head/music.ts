import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./presets.js";
import type { Layer, Project } from "./project-schema.js";

export interface MusicEntry {
  id: string;
  mood: string;
  file: string;
  title: string;
  artist?: string;
  license?: string;
  attribution?: string;
  duration: number;
  lufs: number;
  truePeak: number;
  energy: "low" | "mid" | "high";
  hasVocals?: boolean;
  /** giây bắt đầu các cửa sổ 5 s cao hơn trung bình >= 6 LU (editor nên cảnh báo) */
  peaks?: number[];
  maxOverLU?: number;
}
export interface MusicRank {
  entry: MusicEntry;
  score: number;
  reason: string;
  needsLoop: boolean;
}

export function loadMusicLibrary(root = REPO_ROOT): MusicEntry[] {
  const f = join(root, "assets", "music-th", "manifest.json");
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as MusicEntry[]) : [];
}

/** Đoán mood từ tóm tắt dàn ý (mặc định "doanh-nghiep" cho video đào tạo nội bộ). */
export function inferMood(outline?: { summary?: string; items?: { title: string }[] }): string {
  const text = `${outline?.summary ?? ""} ${(outline?.items ?? []).map((i) => i.title).join(" ")}`.toLowerCase();
  if (/\bai\b|công nghệ|phần mềm|công cụ|dữ liệu|tự động|hệ thống|code|lập trình/.test(text)) return "cong-nghe";
  if (/cảm hứng|câu chuyện|hành trình|ước mơ|truyền cảm/.test(text)) return "truyen-cam-hung";
  if (/năng động|sự kiện|vui|khuấy động/.test(text)) return "nang-dong";
  return "doanh-nghiep";
}

/**
 * Xếp hạng bài nhạc cho project: khớp mood > ít/không lặp (bài dài gần bằng video) > energy thấp (nền cho giọng nói).
 * Bài có giọng hát (hasVocals) bị loại trừ trừ khi includeVocals.
 */
export function suggestMusic(
  project: Pick<Project, "duration">,
  outline?: { summary?: string; items?: { title: string }[] } | null,
  opts: { mood?: string; energy?: "low" | "mid" | "high"; includeVocals?: boolean; library?: MusicEntry[] } = {},
): MusicRank[] {
  const lib = opts.library ?? loadMusicLibrary();
  const mood = opts.mood ?? inferMood(outline ?? undefined);
  const want = opts.energy ?? "low";
  const D = Math.max(1, project.duration);
  const ranked = lib
    .filter((e) => opts.includeVocals || !e.hasVocals)
    .map((e) => {
      const needsLoop = e.duration < D;
      const r = e.duration / D;
      const lenPenalty = needsLoop ? 1 + 2 * (1 - r) : Math.min(1, Math.log(r) / 4); // vừa đủ dài là tốt nhất
      const moodScore = e.mood === mood ? 10 : 0;
      const energyScore = e.energy === want ? 2 : e.energy === "mid" || want === "mid" ? 1 : 0;
      const peakPenalty = (e.peaks?.length ?? 0) > 0 ? 1 : 0;
      const score = +(moodScore + energyScore - lenPenalty - peakPenalty).toFixed(2);
      const reason = [e.mood === mood ? `đúng mood ${mood}` : `mood ${e.mood}`, `energy ${e.energy}`, needsLoop ? `ngắn hơn video (${e.duration.toFixed(0)}s < ${D.toFixed(0)}s, sẽ lặp)` : `đủ dài (${e.duration.toFixed(0)}s)`, e.hasVocals ? "CÓ giọng hát" : null, peakPenalty ? "có đoạn cao trào" : null]
        .filter(Boolean)
        .join("; ");
      return { entry: e, score, reason, needsLoop };
    })
    .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id));
  return ranked;
}

/** Layer nhạc nền mặc định phủ toàn timeline (loop bật; gain -14 dB dưới giọng, duck thêm theo project.audio.music). */
export function musicLayer(entry: MusicEntry, project: Pick<Project, "duration">, id = "M-0001"): Layer {
  return {
    id, type: "audio", start: 0, duration: project.duration, x: 0, y: 0, w: 0, h: 0, rotation: 0, opacity: 1,
    style: { fontFamily: "Be Vietnam Pro", fontSize: 64, fontWeight: 800, color: "#EDEDED", accentColor: "#C5A059", background: "rgba(12,12,12,0.72)", align: "center", radius: 16, padding: 24, strokeColor: null, strokeWidth: 0, shadow: true },
    animation: { in: { kind: "fade", dur: 0.3 }, out: { kind: "fade", dur: 0.3 } },
    src: `assets/music-th/${entry.file}`, offset: 0, gainDb: -14, fadeIn: 1.5, fadeOut: 3,
    meta: { category: "music", source: "auto", loop: true } as Layer["meta"],
  };
}
