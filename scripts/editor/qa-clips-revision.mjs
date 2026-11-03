// Kiểm thử rào revision với HAI tab: node scripts/editor/qa-clips-revision.mjs <url> <thư mục ảnh>
// CHẠY TRÊN BẢN SAO. Tab A lưu trước → tab B (revision cũ) phải nhận 409, dừng autosave, hiện banner "Tải lại", không ghi đè.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openPage, sleep } from "./cdp.mjs";
const [url = "http://localhost:4362/?theme=dark", out = "scripts/editor/public/design/screens"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const P = (f) => join(out, f).split(String.fromCharCode(92)).join("/");
const R = {}, fails = [];
const ok = (n, c, extra) => { R[n] = c ? "ĐẠT" : "KHÔNG ĐẠT" + (extra !== undefined ? " " + JSON.stringify(extra) : ""); if (!c) fails.push(n); };
const A = await openPage(url, { width: 1568, height: 880, gpu: true });
const B = await openPage(url, { width: 1568, height: 880, gpu: true });
const ready = async (pg) => { for (let i = 0; i < 100; i++) { if (await pg.evalJs("!!(window.__ed && window.__ed.project && window.__ed.cu)")) break; await sleep(200); } await sleep(1500); };
const disk = async (pg) => JSON.parse(await pg.evalJs("fetch('/api/project').then(r=>r.text())"));
const key = (pg, k, extra = "") => pg.evalJs(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',bubbles:true${extra}}))`);
try {
  await ready(A); await ready(B);
  const r0 = await A.evalJs("__ed.serverRev");
  ok("0_hai_tab_cùng_revision", r0 === (await B.evalJs("__ed.serverRev")), r0);
  const n0 = (await disk(A)).videoClips.length;
  // A: cắt + lưu
  await A.evalJs("__ed.setTime(7.0)"); await key(A, "s"); await sleep(200);
  ok("A_lưu_được", await A.evalJs("__ed.flush()"));
  const rA = await A.evalJs("__ed.serverRev");
  ok("A_revision_tăng", rA > r0, [r0, rA]);
  ok("A_đĩa_có_clip_mới", (await disk(A)).videoClips.length === n0 + 1);
  // A: hoàn tác rồi lưu tiếp — KHÔNG được tự 409 (ảnh chụp hoàn tác mang revision cũ)
  await key(A, "z", ",ctrlKey:true"); await sleep(200);
  ok("A_undo_rồi_lưu_không_409", (await A.evalJs("__ed.flush()")) && !(await A.evalJs("__ed.stale")));
  const rA2 = await A.evalJs("__ed.serverRev");
  const diskAfterA = JSON.stringify((await disk(A)).videoClips);
  ok("A_đĩa_khớp_sau_undo", (await disk(A)).videoClips.length === n0 && rA2 > rA, [rA, rA2]);
  // B (revision cũ r0): sửa rồi lưu → 409
  await B.evalJs("__ed.setTime(30.0)"); await key(B, "s"); await sleep(200);
  const saved = await B.evalJs("__ed.flush()");
  ok("B_flush_trả_false", saved === false, saved);
  ok("B_đánh_dấu_stale", await B.evalJs("__ed.stale"));
  ok("B_banner_Tải_lại", await B.evalJs("!!document.getElementById('staleBar') && /Tải lại/.test(document.getElementById('staleBar').textContent)"));
  ok("B_chip_Bản_cũ", (await B.evalJs("document.getElementById('saveState').textContent")) === "Bản cũ");
  await B.shot(P("integrated-v6-409.png"));
  // B: thêm sửa + Ctrl+S + chờ quá 2 s autosave: đĩa vẫn là bản của A
  await key(B, "s"); await sleep(100); await key(B, "s", ",ctrlKey:true"); await sleep(2800);
  ok("B_không_ghi_đè_đĩa", JSON.stringify((await disk(B)).videoClips) === diskAfterA && (await disk(B)).revision === rA2, (await disk(B)).revision);
  // B: bấm Tải lại → nạp bản mới, hết stale
  await B.evalJs("document.querySelector('#staleBar button').click()"); await sleep(1500);
  await ready(B);
  ok("B_sau_tải_lại_hết_stale", !(await B.evalJs("__ed.stale")) && (await B.evalJs("__ed.serverRev")) === rA2, await B.evalJs("__ed.serverRev"));
  ok("B_sau_tải_lại_lưu_được", (await B.evalJs("(__ed.setTime(9.0),window.dispatchEvent(new KeyboardEvent('keydown',{key:'s',bubbles:true})),__ed.flush())")) === true);
  R.logsB = B.logs.filter((l) => /EXC/i.test(l)).slice(0, 3);
} finally { await A.close(); await B.close(); }
console.log(JSON.stringify(R, null, 1));
console.log(fails.length ? "KHÔNG ĐẠT: " + fails.join(", ") : "TẤT CẢ ĐẠT");
