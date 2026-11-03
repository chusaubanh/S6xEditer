import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inferMood, loadMusicLibrary, musicLayer, suggestMusic, type MusicEntry } from "./music.js";

const e = (id: string, mood: string, duration: number, extra: Partial<MusicEntry> = {}): MusicEntry =>
  ({ id, mood, file: `${mood}/${id}.wav`, title: id, duration, lufs: -20, truePeak: -8, energy: "low", ...extra });

describe("music", () => {
  const lib = [e("a", "doanh-nghiep", 100), e("b", "doanh-nghiep", 45), e("c", "doanh-nghiep", 300), e("d", "cong-nghe", 50), e("v", "doanh-nghiep", 50, { hasVocals: true })];

  it("ưu tiên đúng mood, bài vừa đủ dài, loại bài có giọng hát", () => {
    const r = suggestMusic({ duration: 40 }, null, { library: lib });
    expect(r[0].entry.id).toBe("b");
    expect(r.map((x) => x.entry.id)).not.toContain("v");
    expect(suggestMusic({ duration: 40 }, null, { library: lib, includeVocals: true }).map((x) => x.entry.id)).toContain("v");
    expect(suggestMusic({ duration: 40 }, null, { library: lib, mood: "cong-nghe" })[0].entry.id).toBe("d");
  });

  it("bài ngắn hơn video đánh dấu needsLoop và xếp sau bài đủ dài", () => {
    const r = suggestMusic({ duration: 120 }, null, { library: lib });
    expect(r.find((x) => x.entry.id === "b")!.needsLoop).toBe(true);
    expect(r[0].entry.id).toBe("c");
    expect(r.findIndex((x) => x.entry.id === "c")).toBeLessThan(r.findIndex((x) => x.entry.id === "a"));
  });

  it.skipIf(!existsSync("assets/music-th/manifest.json"))("suy mood từ dàn ý và thư viện thật có nhạc", () => {
    expect(inferMood({ summary: "Hướng dẫn dựng công cụ AI" })).toBe("cong-nghe");
    expect(inferMood({ summary: "Quy trình nội bộ" })).toBe("doanh-nghiep");
    const real = loadMusicLibrary();
    expect(real.length).toBeGreaterThanOrEqual(19);
    expect(real.every((x) => typeof x.hasVocals === "boolean")).toBe(true);
    expect(musicLayer(real[0], { duration: 30 }).src).toMatch(/^assets\/music-th\//);
  });
});
