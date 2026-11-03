import { describe, expect, it } from "vitest";
import { analyzeSegment, isVoiced } from "./voicing.js";

const SR = 16000;

/** Tone có F0 cùng vài hài, envelope mềm: giả lập "ừm/à" kéo dài. */
function voicedTone(sec: number, f0: number): Float32Array {
  const n = Math.floor(sec * SR);
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.min(1, t / 0.03, (sec - t) / 0.03);
    x[i] = env * 0.2 * (Math.sin(2 * Math.PI * f0 * t) + 0.5 * Math.sin(2 * Math.PI * 2 * f0 * t) + 0.25 * Math.sin(2 * Math.PI * 3 * f0 * t));
  }
  return x;
}

/** Nhiễu hồng (Voss-McCartney đơn giản, hạt giống cố định) với envelope hơi thở. */
function breathNoise(sec: number): Float32Array {
  const n = Math.floor(sec * SR);
  const x = new Float32Array(n);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
  const rows = new Float32Array(8);
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < 8; r++) if (i % (1 << r) === 0) rows[r] = rnd();
    const pink = rows.reduce((a, b) => a + b, 0) / 8;
    const env = Math.sin((Math.PI * i) / n) ** 2; // phồng lên rồi xẹp xuống như một hơi thở
    x[i] = pink * env * 0.15;
  }
  return x;
}

describe("phân loại voiced / breath", () => {
  it("tone có F0 là voiced với f0 gần đúng", () => {
    const x = voicedTone(0.4, 140);
    const st = analyzeSegment(x, SR, 0, 0.4);
    expect(isVoiced(st)).toBe(true);
    expect(Math.abs(st.f0Median - 140)).toBeLessThan(8);
    expect(st.voicedRatio).toBeGreaterThan(0.7);
  });

  it("nhiễu hồng có envelope hơi thở không phải voiced", () => {
    const st = analyzeSegment(breathNoise(0.5), SR, 0, 0.5);
    expect(isVoiced(st)).toBe(false);
    expect(st.voicedRatio).toBeLessThan(0.3);
  });

  it("im lặng gần như tuyệt đối không phải voiced", () => {
    const st = analyzeSegment(new Float32Array(SR / 2), SR, 0, 0.5);
    expect(st.voicedRatio).toBe(0);
    expect(isVoiced(st)).toBe(false);
  });
});
