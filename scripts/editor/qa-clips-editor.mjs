// Kiểm thử editor "Video gốc chỉnh được" bằng CDP: node scripts/editor/qa-clips-editor.mjs <url> <thư mục ảnh>
// CHẠY TRÊN BẢN SAO (output/Tiêu chuẩn video bán hàng/_test/tcvbh-clips-test): autosave của editor sẽ ghi lại project.json của bản sao.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openPage, sleep } from "./cdp.mjs";
const [url = "http://localhost:4362/?theme=dark", out = "scripts/editor/public/design/screens"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const P = (f) => join(out, f).split(String.fromCharCode(92)).join("/");
const pg = await openPage(url, { width: 1568, height: 880, gpu: true });
const E = (x) => pg.evalJs(x);
const R = {}, fails = [];
const ok = (name, cond, extra) => { R[name] = cond ? "ĐẠT" : "KHÔNG ĐẠT" + (extra !== undefined ? " " + JSON.stringify(extra) : ""); if (!cond) fails.push(name); };
const snap = () => E("JSON.stringify(__ed.project.videoClips)");
const frames = () => E("(()=>{const f=__ed.project.fps;return __ed.project.videoClips.reduce((a,c)=>a+(c.kind==='hold'?Math.max(1,Math.round(c.dur*f)):Math.round((c.srcOut-c.srcIn)*f)),0)})()");
const layersSig = () => E("JSON.stringify(__ed.project.tracks.map(t=>t.layers.map(l=>[l.id,l.start,l.duration])))");
const key = (k, extra = "") => E(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',bubbles:true${extra}}))`);
const clipRect = (i) => E(`(()=>{const e=document.querySelectorAll('.t-clip--vclip')[${i}];e.scrollIntoView({block:'nearest',inline:'nearest'});const r=e.getBoundingClientRect();return {x:r.left,y:r.top+r.height/2,w:r.width,r:r.right,id:e.dataset.cid}})()`);
async function drag(el, x0, y0, dx, steps = 6) {
  await E(`(${el}).dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:${x0},clientY:${y0},button:0,pointerId:9}))`);
  for (let s = 1; s <= steps; s++) await E(`window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:${x0 + (dx * s) / steps},clientY:${y0},pointerId:9}))`);
  await E(`window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:${x0 + dx},clientY:${y0},pointerId:9}))`);
  await sleep(150);
}
try {
  for (let i = 0; i < 100; i++) { if (await E("!!(window.__ed && window.__ed.project)")) break; await sleep(200); }
  await sleep(2500);
  ok("0_chế_độ_clips", await E("!!__ed.cu"));
  const base = await snap(), baseF = await frames(), baseLayers = await layersSig(), baseDur = await E("__ed.project.duration");
  R.clipsGoc = JSON.parse(base).length; R.khungGoc = baseF;
  await E("document.getElementById('tlScroll').scrollTop=9999");

  // ---- A: cắt S tại playhead ----
  await E("__ed.setTime(5.0)");
  await key("s");
  await sleep(200);
  const a1 = JSON.parse(await snap());
  ok("A_cắt_thêm_1_clip", a1.length === JSON.parse(base).length + 1, a1.length);
  ok("A_tổng_khung_không_đổi", (await frames()) === baseF);
  ok("A_layer_đứng_yên", (await layersSig()) === baseLayers);
  await pg.shot(P("integrated-v6-cut.png"));
  await key("s"); await sleep(100); // cắt lần hai ngay tại biên: bị từ chối
  ok("A_cắt_tại_biên_bị_từ_chối", JSON.parse(await snap()).length === a1.length);
  R.toastCut = await E("document.getElementById('toastTxt').textContent");

  // ---- B: trim mép phải / trái bằng kéo ----
  const idxB = 5;
  const rb = await clipRect(idxB);
  const srcOutB = JSON.parse(await snap())[idxB].srcOut;
  await drag(`document.querySelectorAll('.t-clip--vclip')[${idxB}].querySelector('.t-clip__edge--r')`, rb.r - 3, rb.y, -80);
  const b1 = JSON.parse(await snap());
  ok("B_trim_phải_co_lại", b1[idxB].srcOut < srcOutB - 0.5, [srcOutB, b1[idxB].srcOut]);
  ok("B_ripple_video_tổng_giảm", (await frames()) < baseF);
  ok("B_duration_cập_nhật", Math.abs((await E("__ed.project.duration")) - (await frames()) / 30) < 1e-6);
  ok("B_layer_đứng_yên", (await layersSig()) === baseLayers);
  const rb2 = await clipRect(idxB), srcInB = b1[idxB].srcIn;
  await drag(`document.querySelectorAll('.t-clip--vclip')[${idxB}].querySelector('.t-clip__edge--l')`, rb2.x + 3, rb2.y, 50);
  const b2 = JSON.parse(await snap());
  ok("B_trim_trái_srcIn_tăng", b2[idxB].srcIn > srcInB + 0.3, [srcInB, b2[idxB].srcIn]);

  // ---- C: xoá clip (chọn + Delete) ----
  const nC = b2.length, idC = b2[2].id;
  const rc = await clipRect(2);
  await drag(`document.querySelectorAll('.t-clip--vclip')[2]`, rc.x + rc.w / 2, rc.y, 0, 1); // nhấp = chọn
  await key("Delete"); await sleep(150);
  const c1 = JSON.parse(await snap());
  ok("C_xoá_clip", c1.length === nC - 1 && !c1.some((c) => c.id === idC));
  ok("C_layer_đứng_yên", (await layersSig()) === baseLayers);

  // ---- D: đổi thứ tự ----
  const idD = c1[1].id, rd = await clipRect(1), rd2 = await clipRect(3);
  await drag(`document.querySelectorAll('.t-clip--vclip')[1]`, rd.x + rd.w / 2, rd.y, rd2.x + rd2.w - rd.x - rd.w / 2 + 6);
  const d1 = JSON.parse(await snap());
  ok("D_đổi_thứ_tự", d1.findIndex((c) => c.id === idD) > 1 && d1.length === c1.length, d1.map((c) => c.id));
  ok("D_duration_khớp_khung", (await frames()) === (await E("Math.round(__ed.project.duration*__ed.project.fps)")));

  // ---- E: chèn từ tab Nguồn ----
  await E("document.getElementById('tabSource').click()"); await sleep(600);
  await E("__ed.cu.setIO(500, 504.5)"); await sleep(300);
  const nE = JSON.parse(await snap()).length, fE = await frames();
  await E("__ed.setTime(20.0)");
  await E("document.getElementById('srcIns').click()"); await sleep(300);
  const e1 = JSON.parse(await snap());
  ok("E_chèn_tại_playhead", e1.some((c) => c.srcIn === 500 && c.srcOut === 504.5) && e1.length >= nE + 1, e1.length);
  ok("E_tổng_tăng_4.5s", (await frames()) - fE === 135, (await frames()) - fE);
  ok("E_layer_đứng_yên", (await layersSig()) === baseLayers);
  await E("document.getElementById('srcApp').click()"); await sleep(300);
  const e2 = JSON.parse(await snap());
  ok("E_nối_cuối", e2[e2.length - 1].srcIn === 500, e2[e2.length - 1]);
  R.srcText = (await E("document.getElementById('srcText').textContent")).slice(0, 80);
  await E("document.getElementById('tlScroll').scrollTop=9999");
  await pg.shot(P("integrated-v6-source-tab.png"));

  // ---- F: undo/redo đủ bước ----
  let steps = 0;
  while (steps < 40 && (await snap()) !== base) { await key("z", ",ctrlKey:true"); await sleep(60); steps++; }
  ok("F_undo_về_nguyên_trạng", (await snap()) === base, steps);
  ok("F_duration_khôi_phục", Math.abs((await E("__ed.project.duration")) - baseDur) < 1e-6);
  R.undoSteps = steps;
  for (let i = 0; i < steps; i++) { await key("y", ",ctrlKey:true"); await sleep(40); }
  ok("F_redo_lại_bản_cuối", JSON.parse(await snap()).length === e2.length, JSON.parse(await snap()).length);

  // ---- G: lưu + hợp lệ schema ----
  await E("__ed.flush()");
  const saved = JSON.parse(await E("fetch('/api/project').then(r=>r.text())"));
  ok("G_đã_lưu_clips_mới", saved.videoClips.length === e2.length && saved.revision >= 1, saved.revision);
  R.revision = saved.revision;
  R.state = await E("document.getElementById('saveState').textContent");
  ok("G_trạng_thái_Đã_lưu", R.state === "Đã lưu", R.state);
  await E("document.getElementById('tlScroll').scrollTop=9999");
  await pg.shot(P("integrated-v6-edited.png"));
  R.logs = pg.logs.filter((l) => /EXC|error/i.test(l)).slice(0, 5);
} finally { await pg.close(); }
console.log(JSON.stringify(R, null, 1));
console.log(fails.length ? "KHÔNG ĐẠT: " + fails.join(", ") : "TẤT CẢ ĐẠT");
