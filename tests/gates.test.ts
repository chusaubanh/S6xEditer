import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { bakePhysics } from "../scripts/bake-rapier";
// @ts-expect-error script .mjs không có khai báo kiểu
import { optimizeSvg } from "../scripts/optimize-svg.mjs";
import { panFilter } from "../scripts/pan-audio";
import { renderCardSvg } from "../src/engine/satori-cards";
import { findRawJsxText, scanVideoScenes } from "../src/gates/raw-text";
import { evaluateQc, measureCoverage, parseFreezeLog, parseIntegratedLufs, type MediaFacts } from "../src/gates/qc";

const good: MediaFacts = { width: 1920, height: 1080, fps: 30, videoCodec: "h264", audioCodec: "aac", durationSec: 60, lufs: -14.2 };

describe("chữ trên hình", () => {
  it("bắt chữ viết thẳng trong JSX, bỏ qua Label và biểu thức", () => {
    expect(findRawJsxText('<div style={{a: 1}}>Campaign Tết</div>')).toEqual(["Campaign Tết"]);
    expect(findRawJsxText("<div><Label i={0} />{value}</div>")).toEqual([]);
    expect(findRawJsxText('<div>{"Campaign"}</div>')).toEqual(["Campaign"]);
    expect(findRawJsxText("const A: React.FC<{ a: number }> = () => { const b = x >= 1 && y < 2; return <g />; };")).toEqual([]);
  });
  it("cảnh của các video không có chữ viết thẳng", () => {
    expect(scanVideoScenes()).toEqual([]);
  });
});

describe("QC", () => {
  it("đạt khi đúng hết", () => {
    expect(evaluateQc(good, { aspect: "16:9", durationSec: 60 })).toEqual([]);
  });
  it.each([
    [{ width: 1080, height: 1920 }, "Khổ"],
    [{ fps: 25 }, "khung"],
    [{ videoCodec: "hevc" }, "Codec hình"],
    [{ audioCodec: null }, "Codec tiếng"],
    [{ lufs: -20 }, "Độ to"],
    [{ lufs: null }, "độ to"],
    [{ durationSec: 90 }, "Thời lượng"],
  ])("bắt lỗi %j", (change, word) => {
    expect(evaluateQc({ ...good, ...change } as MediaFacts, { aspect: "16:9", durationSec: 60 }).join()).toContain(word);
  });
  it("đọc đúng LUFS tích hợp ở phần Summary", () => {
    expect(parseIntegratedLufs("I: -50 LUFS\nSummary:\n  Integrated loudness:\n    I:         -14.3 LUFS")).toBe(-14.3);
  });
  it("đọc khoảng đứng yên", () => {
    expect(parseFreezeLog("freeze_start: 3.5\nfreeze_duration: 9\n")).toEqual([{ start: 3.5, duration: 9 }]);
  });
  it("đo độ phủ và dải trống", () => {
    const gray = new Uint8Array(100 * 100);
    gray.fill(200, 0, 100 * 50);
    const result = measureCoverage(gray, 100, 100, 0);
    expect(result.rowCoverage).toBe(0.5);
    expect(result.largestGap).toBe(0.5);
  });
});

describe("nhân sự", () => {
  it("#14 tính vật lý hai lần cho kết quả giống hệt", async () => {
    const spec = { frames: 60, fps: 30, bodies: [{ name: "a", position: [0, 3, 0] as [number, number, number], halfExtents: [0.5, 0.5, 0.5] as [number, number, number], rotationZ: 0.3 }] };
    expect(JSON.stringify(await bakePhysics(spec))).toBe(JSON.stringify(await bakePhysics(spec)));
  });
  it("#16 pan đúng hai đầu", () => {
    expect(panFilter(-1)).toContain("c0=1.0000*c0|c1=0.0000*c0");
    expect(panFilter(1)).toContain("c0=0.0000*c0|c1=1.0000*c0");
    expect(() => panFilter(2)).toThrow();
  });
  it("#04 Satori vẽ được chữ tiếng Việt bằng font cục bộ", async () => {
    const svg = await renderCardSvg(createElement("div", { style: { display: "flex", color: "#fff", fontWeight: 800, fontSize: 60 } }, "Đệ ấn ữ ệ đ"), 600, 200);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<path");
  });
  it("#03 SVGO giữ id và viewBox", () => {
    const out = optimizeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><!-- c --><path id="net-mot" d="M0 0L10 10"/></svg>', "a.svg");
    expect(out).toContain('id="net-mot"');
    expect(out).toContain("viewBox");
    expect(out).not.toContain("<!--");
  });
});
