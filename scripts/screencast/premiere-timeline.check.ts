// Tự kiểm lõi premiere-timeline: npx tsx scripts/screencast/premiere-timeline.check.ts
import assert from "node:assert/strict";
import { assignLanes, buildItems, clipToLength, nameScreenSpan, type Piece } from "./premiere-timeline.js";

const M = "master.mp4";
// video sạch: cảnh s01 [0,100) file riêng, quay màn hình m01 [100,250) + m02 [250,400) cùng file master, cảnh s02 [400,500)
const pieces: Piece[] = [
  { id: "s01", file: "s01.mp4", a: 0, b: 100, base: 0, kind: "scene" },
  ...nameScreenSpan(100, 400, ["m01", "m02"], [150, 149], M), // độ dài dự kiến hụt 1 khung → m02 ăn phần dư
  { id: "s02", file: "s02.mp4", a: 400, b: 500, base: 400, kind: "scene" },
];
assert.deepEqual(pieces.map((p) => [p.id, p.a, p.b]), [["s01", 0, 100], ["m01", 100, 250], ["m02", 250, 400], ["s02", 400, 500]]);

// 1) đoạn editor lệch ranh giới mảnh 1 khung: [0,101) rồi [101,401) → không được để mảnh 1 khung của master, nhưng giữ 1 khung của s02
const items = buildItems([{ a: 0, b: 101 }, { a: 101, b: 401 }], pieces);
assert.deepEqual(items.map((x) => [x.piece.id, x.piece.file, x.inF, x.outF, x.tl]), [
  ["s01", "s01.mp4", 0, 100, 0],
  ["m01–m02", M, 100, 400, 100], // m01 + m02 gộp, đọc thẳng khung master
  ["s02", "s02.mp4", 0, 1, 400], // khung đầu s02 là nội dung thật → giữ
]);

// 2) có đoạn bị cắt bỏ ở giữa quay màn hình: [120,200) + [260,300) → hai clip master KHÔNG gộp (không liền trong file)
const cut = buildItems([{ a: 120, b: 200 }, { a: 260, b: 300 }], pieces);
assert.deepEqual(cut.map((x) => [x.piece.id, x.inF, x.outF, x.tl]), [["m01", 120, 200, 0], ["m02", 260, 300, 80]]);

// 3) tổng độ dài timeline = tổng đoạn editor
const total = items.reduce((n, x) => n + x.outF - x.inF, 0);
assert.equal(total, 401);

// 4) cắt bản thử
assert.deepEqual(clipToLength(items, 150).map((x) => [x.piece.id, x.outF - x.inF]), [["s01", 100], ["m01–m02", 50]]);

// 5) mảnh không liền → báo lỗi
assert.throws(() => buildItems([{ a: 0, b: 10 }], [{ ...pieces[0], b: 90 }, pieces[1]]), /không liền/);

// 6) xếp làn SFX: không chồng trong một làn
const ev = [{ start: 0, dur: 1 }, { start: 0.5, dur: 1 }, { start: 1.2, dur: 0.2 }, { start: 1.6, dur: 0.1 }];
const { lanes, count } = assignLanes(ev);
assert.equal(count, 2);
for (let l = 0; l < count; l++) {
  const xs = ev.filter((_, i) => lanes[i] === l).sort((a, b) => a.start - b.start);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i].start >= xs[i - 1].start + xs[i - 1].dur, `làn ${l} chồng`);
}
console.log("premiere-timeline: đạt");
