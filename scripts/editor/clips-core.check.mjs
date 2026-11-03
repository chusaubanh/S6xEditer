// Chạy: node --import tsx scripts/editor/clips-core.check.mjs   (so khớp công thức khung với backend src/talking-head/clips-render.ts)
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import * as C from "./public/clips-core.js";

const REPO = resolve(import.meta.dirname, "..", "..");
const fps = 30, DURATION = 120.9; // fixture: 15 clip của tcvbh-clips-test (1 hold + 14 nguồn)
const clips = [{"id":"C-0001","kind":"hold","srcIn":243.733333,"dur":0.6},{"id":"C-0002","kind":"source","srcIn":243.733333,"srcOut":250.3},{"id":"C-0003","kind":"source","srcIn":177.866667,"srcOut":189.6},{"id":"C-0004","kind":"source","srcIn":189.866667,"srcOut":192.833333},{"id":"C-0005","kind":"source","srcIn":193.8,"srcOut":225.966667},{"id":"C-0006","kind":"source","srcIn":226.233333,"srcOut":229.333333},{"id":"C-0007","kind":"source","srcIn":229.866667,"srcOut":230.5},{"id":"C-0008","kind":"source","srcIn":231.766667,"srcOut":233.566667},{"id":"C-0009","kind":"source","srcIn":233.766667,"srcOut":242.8},{"id":"C-0010","kind":"source","srcIn":243.7,"srcOut":250.533333},{"id":"C-0011","kind":"source","srcIn":251.166667,"srcOut":283.1},{"id":"C-0012","kind":"source","srcIn":283.533333,"srcOut":284.5},{"id":"C-0013","kind":"source","srcIn":284.833333,"srcOut":290.3},{"id":"C-0014","kind":"source","srcIn":291.066667,"srcOut":295.433333},{"id":"C-0015","kind":"source","srcIn":295.733333,"srcOut":298.466667}];
const be = await import(pathToFileURL(resolve(REPO, "src/talking-head/clips-render.ts")).href);
const bf = be.clipFrames(clips, fps);
assert.equal(C.totalFrames(clips, fps), be.totalFrames(bf), "tổng khung = backend");
assert.ok(Math.abs(C.totalSec(clips, fps) - DURATION) <= 1 / fps, "tổng = project.duration");
C.layout(clips, fps).forEach((k, i) => { assert.equal(k.n, bf[i].n); assert.equal(k.startF, bf[i].startF); });

// split: tổng khung không đổi; hai nửa liền nhau
const L = C.layout(clips, fps), k = L[3];
const sp = C.splitAt(clips, k.s + 1.0, fps);
assert.equal(sp.clips.length, clips.length + 1);
assert.equal(C.totalFrames(sp.clips, fps), C.totalFrames(clips, fps));
assert.equal(sp.clips[3].srcOut, sp.clips[4].srcIn);
assert.equal(C.splitAt(clips, k.s, fps), null, "sát biên → không tách");
// split hold
const h = C.splitAt(clips, 0.3, fps);
assert.equal(h.clips[0].kind, "hold"); assert.equal(h.clips[1].kind, "hold");
assert.equal(C.totalFrames(h.clips, fps), C.totalFrames(clips, fps));
// trim + ripple: tổng đổi đúng d
const tr = C.trimClip(clips, 4, "R", -0.5, fps, 1496.94);
assert.equal(C.totalFrames(tr, fps), C.totalFrames(clips, fps) - Math.round(0.5 * fps));
const tl = C.trimClip(clips, 4, "L", 1, fps, 1496.94);
assert.equal(C.totalFrames(tl, fps), C.totalFrames(clips, fps) - fps);
// trim vượt nguồn bị kẹp
assert.ok(C.trimClip(clips, 4, "R", 1e6, fps, 1496.94)[4].srcOut <= 1496.94 + 1e-6);
// xoá / đổi thứ tự / chèn
assert.equal(C.removeClip(clips, 2).length, clips.length - 1);
const mv = C.moveClip(clips, 2, 5); assert.equal(mv[5].id, clips[2].id); assert.equal(C.totalFrames(mv, fps), C.totalFrames(clips, fps));
const ins = C.insertSource(clips, 10, 500, 502, fps);
assert.equal(C.totalFrames(ins.clips, fps), C.totalFrames(clips, fps) + 2 * fps);
assert.equal(ins.clips[ins.index].srcIn, 500);
const app = C.insertSource(clips, 1e6, 500, 502, fps); assert.equal(app.index, clips.length);
// id duy nhất
assert.equal(new Set(ins.clips.map((c) => c.id)).size, ins.clips.length);
// peaks ánh xạ
const pk = { rate: 100, peaks: Array.from({ length: 2 * 150000 }, (_, i) => (i % 2 ? 7 : -7)) };
const mp = C.mapPeaks(clips, pk, fps);
assert.equal(mp.peaks.length, Math.round(C.totalSec(clips, fps) * 100) * 2);
assert.equal(mp.peaks[2 * 30], 0, "hold im lặng"); assert.equal(mp.peaks[2 * 100 + 1], 7);
console.log("clips-core: ĐẠT", { clips: clips.length, frames: C.totalFrames(clips, fps) });
