import { describe, expect, it } from "vitest";
import { computeClipGains, levelProxyAudio } from "./clip-loudness.js";
import { buildClipsAudioFilter, clipFrames } from "./clips-render.js";

describe("gain riêng từng clip", () => {
  it("gain = −18 − loudness, kẹp [−12, +30]; hold và clip im lặng lấy gain clip liền kề", () => {
    const kinds = [{ kind: "hold" as const }, { kind: "source" as const }, { kind: "source" as const }, { kind: "source" as const }, { kind: "source" as const }, { kind: "source" as const }];
    const g = computeClipGains(kinds, [null, -45.4, -28, null, -60.5, -10]);
    expect(g.map((x) => x.gainDb)).toEqual([27.4, 27.4, 10, 10, 30, -8]);
    expect(g[4].note).toContain("kẹp"); // −60.5 cần +42.5 → kẹp +30
    expect(g[0].note).toContain("hold");
    expect(computeClipGains([{ kind: "source" }], [-18])[0].gainDb).toBe(0);
    expect(computeClipGains([{ kind: "source" }], [-3])[0].gainDb).toBe(-12); // kẹp dưới
  });

  it("bộ lọc audio áp volume từng clip và chỉ thêm limiter −1 dBFS khi có gain dương", () => {
    const cf = clipFrames([{ id: "a", kind: "source", srcIn: 0, srcOut: 1 }, { id: "b", kind: "source", srcIn: 5, srcOut: 6 }], 30);
    const f = buildClipsAudioFilter(cf, 30, [10.5, -3]);
    expect(f).toContain("volume=10.50dB");
    expect(f).toContain("volume=-3.00dB");
    expect(f).toContain("alimiter=limit=0.8913");
    expect(buildClipsAudioFilter(cf, 30, [0, 0])).not.toContain("alimiter");
  });
});

describe("proxy nghe đều", () => {
  it("đường bao gain đưa đoạn nhỏ và đoạn to về gần cùng mức, đỉnh bị soft-limit dưới 0.9", () => {
    const sr = 48000;
    const x = new Float32Array(sr * 20);
    for (let i = 0; i < x.length; i++) x[i] = (i < x.length / 2 ? 0.005 : 0.2) * Math.sin(i * 0.05); // nửa đầu nhỏ hơn ~32 dB
    const M = Array.from({ length: 200 }, (_, k) => (k < 100 ? -50 : -20));
    const tM = Array.from({ length: 200 }, (_, k) => 0.4 + k * 0.1);
    const y = levelProxyAudio(x, { tM, M }, sr, -20);
    const rms = (a: number, b: number) => Math.sqrt(y.slice(a * sr, b * sr).reduce((s, v) => s + v * v, 0) / ((b - a) * sr));
    const quiet = 20 * Math.log10(rms(2, 8));
    const loud = 20 * Math.log10(rms(13, 19));
    expect(Math.abs(loud - quiet)).toBeLessThan(10); // trước đó chênh ~32 dB
    expect(Math.max(...y.slice(0, 2000))).toBeLessThan(0.9);
    let mx = 0;
    for (const v of y) mx = Math.max(mx, Math.abs(v));
    expect(mx).toBeLessThanOrEqual(1);
  });
});
