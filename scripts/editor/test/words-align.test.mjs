import test from "node:test";
import assert from "node:assert/strict";
import { alignWords } from "../public/words-align.js";

const W = (arr) => arr.map(([text, start, end]) => ({ text, start, end }));
const old = W([["Xin", 0, 0.5], ["chào", 0.5, 1], ["các", 1, 1.4], ["bạn", 1.4, 2]]);

test("sửa 1 chữ: giữ mốc các từ khác, từ sửa chia theo khoảng", () => {
  const r = alignWords(old, "Xin chào các bạn");
  assert.deepEqual(r.map((w) => [w.start, w.end]), old.map((w) => [w.start, w.end]));
  const r2 = alignWords(old, "Xin chào những bạn");
  assert.equal(r2[2].text, "những");
  assert.equal(r2[2].start, 1); assert.equal(r2[2].end, 1.4);
  assert.deepEqual([r2[0].start, r2[1].start, r2[3].start], [0, 0.5, 1.4]);
});

test("thêm từ: nội suy giữa hai từ lân cận, không chồng chéo", () => {
  const r = alignWords(old, "Xin chào tất cả các bạn");
  assert.equal(r.length, 6);
  assert.deepEqual([r[0].start, r[5].end], [0, 2]);
  for (let k = 1; k < r.length; k++) assert.ok(r[k].start >= r[k - 1].end - 1e-9, "chồng chéo ở " + k);
  assert.ok(r[2].start >= 0.5 && r[3].end <= 1.4 + 1e-9);
  assert.ok(r[2].end > r[2].start && r[3].end > r[3].start);
});

test("xoá từ: bỏ từ, các từ còn lại giữ mốc", () => {
  const r = alignWords(old, "Xin chào bạn");
  assert.equal(r.length, 3);
  assert.deepEqual([r[2].start, r[2].end], [1.4, 2]);
});

test("viết lại toàn bộ: chia đều theo số ký tự trên toàn khoảng", () => {
  const r = alignWords(old, "aa bbbb");
  assert.equal(r.length, 2);
  assert.equal(r[0].start, 0); assert.equal(r[1].end, 2);
  assert.ok(Math.abs(r[0].end - 2 * (2 / 6)) < 0.01);
  assert.equal(r[0].end, r[1].start);
});

test("khác hoa/thường và dấu câu vẫn khớp", () => {
  const r = alignWords(old, "xin, chào các bạn!");
  assert.deepEqual(r.map((w) => w.start), [0, 0.5, 1, 1.4]);
});
