// Kiểm thử reframe TỰ DO + máy quay (vòng 7) bằng CDP, chuột/bàn phím thật: node scripts/editor/qa-reframe-editor.mjs <url> <thư mục ảnh>
// CHẠY TRÊN BẢN SAO (output/Tiêu chuẩn video bán hàng/_test/tcvbh-clips-test); autosave sẽ ghi project.json của bản sao (sao lưu trước: project.v7-original.json).
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openPage, sleep } from "./cdp.mjs";
const [url = "http://localhost:4360/?theme=dark", out = "scripts/editor/public/design/screens"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const P = (f) => join(out, f).split(String.fromCharCode(92)).join("/");
const R = {}, fails = [];
const ok = (n, c, extra) => { R[n] = c ? "ĐẠT" : "KHÔNG ĐẠT" + (extra !== undefined ? " " + JSON.stringify(extra) : ""); if (!c) fails.push(n); };
const near = (a, b, e = 0.6) => Math.abs(a - b) <= e;
const pixel = (file, x, y) => { const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vf", `crop=1:1:${x}:${y},format=rgb24`, "-f", "rawvideo", "-"], { encoding: "buffer" }); return [...r.stdout]; };
const meanDiff = (a, b, x, y, w, h) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", a, "-i", b, "-filter_complex", `[0][1]blend=all_mode=difference,crop=${w}:${h}:${x}:${y},format=gray,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`, "-f", "null", "-"], { encoding: "utf8" });
  const m = /YAVG=([\d.]+)/.exec(r.stdout); return m ? +m[1] : -1;
};

const pg = await openPage(url, { width: 1568, height: 880, gpu: true, autoplay: false }); // KHÔNG cờ autoplay: kiểm đúng chính sách autoplay như người dùng thật
const E = (x) => pg.evalJs(x);
const rect = (sel) => E(`(()=>{const r=document.querySelector('${sel}').getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height}})()`);
const state = () => E("JSON.stringify({vsel:__ed.vsel, t:__ed.t, g:__ed.project.videoTransform, own:(__ed.cu.clipAt(__ed.t)||{}).transform||null, id:(__ed.cu.clipAt(__ed.t)||{}).id})");
const S = async () => JSON.parse(await state());
try {
  for (let i = 0; i < 100; i++) { if (await E("!!(window.__ed && window.__ed.cu)")) break; await sleep(200); }
  await sleep(2500);
  ok("0_server_có_caps", (await E("JSON.stringify(__ed.meta.caps||[])")).includes("clipTransform"));
  const st = await rect("#stage");
  const at = (px, py) => [st.x + (px / 100) * st.w, st.y + (py / 100) * st.h];

  // ---- Hồi quy overlay hiển thị trên video ở chế độ clips: lấy mẫu điểm ảnh khi bật/tắt #ovRoot ----
  await E("__ed.setTime(14.5)"); await sleep(1200);
  await E("document.getElementById('ovRoot').style.visibility='visible'"); await sleep(200);
  await pg.shot(P("integrated-v7-ov-on.png"));
  await E("document.getElementById('ovRoot').style.visibility='hidden'"); await sleep(200);
  await pg.shot(P("integrated-v7-ov-off.png"));
  await E("document.getElementById('ovRoot').style.visibility='visible'");
  const sub = await E("(()=>{const e=document.querySelector('#ovRoot [data-layer], #ovRoot > *');return 1})()");
  void sub;
  // vùng phụ đề: nửa dưới khung xem
  const dOv = meanDiff(P("integrated-v7-ov-on.png"), P("integrated-v7-ov-off.png"), Math.round(st.x), Math.round(st.y + st.h * 0.7), Math.round(st.w), Math.round(st.h * 0.25));
  ok("0_overlay_hiện_trên_video(khác_biệt_pixel)", dOv > 0.8, dOv);

  // ---- 1. Chọn video bằng click (không trúng layer) ----
  await E("__ed.setTime(14.5)");
  let [cx, cy] = at(86, 24);
  await pg.click(cx, cy); await sleep(250);
  let s0 = await S();
  ok("1_click_chọn_Video_gốc", s0.vsel === true, s0);
  ok("1_có_tay_nắm_góc", (await E("document.querySelectorAll('.t-sel__h.vh').length")) === 4);
  const clipId = s0.id;
  // kéo = dời → khung riêng của clip
  await pg.dragMouse(cx, cy, cx + 50, cy + 30); await sleep(250);
  let s1 = await S();
  ok("1_kéo_tạo_khung_riêng_clip", !!s1.own && (Math.abs(s1.own.x) > 3 || Math.abs(s1.own.y) > 3) && s1.g.x === s0.g.x && s1.g.y === s0.g.y, s1);
  R.sauKeo = s1.own;
  ok("1_inspector_ghi_rõ_khung_riêng", (await E("document.getElementById('propsBody').textContent")).includes("Khung riêng của clip " + clipId));
  await pg.shot(P("integrated-v7-reframe-handles.png"));

  // ---- cuộn = zoom quanh con trỏ (điểm ảnh dưới con trỏ đứng yên) ----
  const [wx, wy] = at(30, 60);
  const underBefore = await E("(()=>{const v=__ed.vstate();return {s:v.scale,x:v.x,y:v.y}})()");
  const pc = (px, py, v) => [(px - 50 - v.x) / v.s, (py - 50 - v.y) / v.s]; // điểm ảnh (đơn vị nguồn, % canvas) dưới con trỏ
  const a0 = pc(30, 60, underBefore);
  await pg.wheel(wx, wy, -300); await sleep(200);
  const after = await E("(()=>{const v=__ed.vstate();return {s:v.scale,x:v.x,y:v.y}})()");
  const a1 = pc(30, 60, after);
  ok("1_cuộn_zoom_tăng", after.s > underBefore.s * 1.1, [underBefore.s, after.s]);
  ok("1_zoom_quanh_con_trỏ", near(a0[0], a1[0], 1.0) && near(a0[1], a1[1], 1.0), [a0, a1]);

  // ---- tay nắm góc: phóng; Shift giữ tâm ----
  const hse = await rect(".t-sel__h.vh[data-vh=se]");
  const sBefore = await E("JSON.stringify(__ed.vtView().vt)");
  await pg.dragMouse(hse.x + 5, hse.y + 5, hse.x - 40, hse.y - 40); await sleep(250);
  const sCorner = JSON.parse(await E("JSON.stringify(__ed.vtView().vt)"));
  ok("1_tay_nắm_góc_đổi_scale", !near(sCorner.scale, JSON.parse(sBefore).scale, 0.02), [sBefore, sCorner]);
  const hse2 = await rect(".t-sel__h.vh[data-vh=se]");
  await pg.dragMouse(hse2.x + 5, hse2.y + 5, hse2.x + 25, hse2.y + 25, { modifiers: 8 }); await sleep(250); // Shift
  const sShift = JSON.parse(await E("JSON.stringify(__ed.vtView().vt)"));
  ok("1_Shift_giữ_tâm", near(sShift.x, sCorner.x, 0.4) && near(sShift.y, sCorner.y, 0.4) && !near(sShift.scale, sCorner.scale, 0.005), [sCorner, sShift]);

  // ---- nhấp đúp = đặt lại ----
  [cx, cy] = at(86, 24);
  await pg.click(cx, cy, { clickCount: 1 }); await pg.mouse("mousePressed", cx, cy, { clickCount: 2 }); await pg.mouse("mouseReleased", cx, cy, { clickCount: 2 }); await sleep(250);
  const sReset = JSON.parse(await E("JSON.stringify(__ed.vtView().vt)"));
  ok("1_nhấp_đúp_đặt_lại", near(sReset.scale, 1, 0.001) && near(sReset.x, 0) && near(sReset.y, 0), sReset);

  // ---- 2. Tự do: scale 0.8 lộ nền ink; dịch quá mép ----
  await E("(()=>{const inp=[...document.querySelectorAll('#propsBody input[type=number]')];const sc=inp[2];sc.value='0.8';sc.dispatchEvent(new Event('input',{bubbles:true}))})()"); await sleep(300);
  const sc08 = await S();
  ok("2_scale_0.8_giữ_nguyên(không_kẹp)", near(sc08.own.scale, 0.8, 0.001), sc08.own);
  await pg.shot(P("integrated-v7-scale08-ink.png"));
  const shot08 = P("integrated-v7-scale08-ink.png");
  // góc trên-trái của khung xem phải là ink #0C0C0C (±2)
  const px = pixel(shot08, Math.round(st.x + 6), Math.round(st.y + 6));
  ok("2_nền_ink_#0C0C0C", px.every((v) => Math.abs(v - 12) <= 3), px);
  // dịch quá mép: x = +40
  await E("(()=>{const inp=[...document.querySelectorAll('#propsBody input[type=number]')];inp[0].value='40';inp[0].dispatchEvent(new Event('input',{bubbles:true}))})()"); await sleep(250);
  ok("2_dịch_quá_mép_giữ_nguyên", near((await S()).own.x, 40, 0.01));
  // snap về phủ kín khi gần: kéo tay nắm tới scale ≈ 1.02 → 1
  await E("(()=>{const inp=[...document.querySelectorAll('#propsBody input[type=number]')];inp[0].value='0';inp[0].dispatchEvent(new Event('input',{bubbles:true}));inp[2].value='1';inp[2].dispatchEvent(new Event('input',{bubbles:true}))})()"); await sleep(250);

  // ---- override một clip + Áp cho mọi clip ----
  await E("(()=>{const inp=[...document.querySelectorAll('#propsBody input[type=number]')];inp[2].value='1.25';inp[2].dispatchEvent(new Event('input',{bubbles:true}));inp[0].value='5';inp[0].dispatchEvent(new Event('input',{bubbles:true}))})()"); await sleep(250);
  const nOwn1 = await E("__ed.project.videoClips.filter(c=>c.transform).length");
  ok("3_chỉ_clip_này_có_khung_riêng", nOwn1 === 1, nOwn1);
  // clip khác (t=30) vẫn theo khung chung
  await E("__ed.setTime(30.5)"); await sleep(300);
  const sOther = await S();
  ok("3_clip_khác_theo_khung_chung", sOther.own === null && sOther.id !== clipId, sOther);
  await E("__ed.setTime(14.5)"); await sleep(300);
  await E("[...document.querySelectorAll('#propsBody button')].find(b=>b.textContent.includes('Áp cho mọi clip')).click()"); await sleep(300);
  const sApply = await S();
  ok("3_Áp_cho_mọi_clip", near(sApply.g.scale, 1.25, 0.001) && (await E("__ed.project.videoClips.filter(c=>c.transform).length")) === 0, sApply);
  // tạo lại khung riêng rồi "Về khung chung"
  await pg.dragMouse(cx, cy, cx + 30, cy + 10); await sleep(200);
  ok("3_khung_riêng_tạo_lại", !!(await S()).own);
  await E("[...document.querySelectorAll('#propsBody button')].find(b=>b.textContent.includes('Về khung chung')).click()"); await sleep(250);
  ok("3_Về_khung_chung", (await S()).own === null);

  // ---- Undo / redo ----
  const keyz = async (k, mod) => { await E(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',ctrlKey:true,bubbles:true}))`); await sleep(120); };
  const before = await E("JSON.stringify([__ed.project.videoTransform,__ed.project.videoClips.map(c=>c.transform||null)])");
  await keyz("z"); const afterUndo = await E("JSON.stringify([__ed.project.videoTransform,__ed.project.videoClips.map(c=>c.transform||null)])");
  await keyz("y"); const afterRedo = await E("JSON.stringify([__ed.project.videoTransform,__ed.project.videoClips.map(c=>c.transform||null)])");
  ok("4_undo_đổi_khung", before !== afterUndo); ok("4_redo_khôi_phục", before === afterRedo);

  // ---- Máy quay: toggle AI + kéo move/shift AI → user ----
  await E("(()=>{ if(!__ed.project.videoShifts.some(s=>s.source==='ai')){ __ed.project.videoShifts.push({start:20,end:23,x:12,ease:{in:.5,out:.5},source:'ai',beatId:'qa'}); __ed.touch(); __ed.renderTimeline(); } })()");
  await E("document.getElementById('tlScroll').scrollTop=9999"); await sleep(300);
  const aiMoveT = await E("(()=>{const m=__ed.project.videoMoves.find(m=>m.source==='ai'&&m.mode==='zoom');return (m.start+m.end)/2})()");
  await E(`__ed.setTime(${aiMoveT})`); await sleep(300);
  await E("__ed.select([])"); await E("(()=>{})()");
  const wOn = await E("parseFloat(document.getElementById('vid').style.width)");
  await E("document.querySelector('.t-tbtn--ai').click()"); await sleep(300);
  const wOff = await E("parseFloat(document.getElementById('vid').style.width)");
  ok("5_tắt_máy_quay_tự_động_bỏ_zoom_AI", wOff < wOn - 5 && (await E("__ed.project.camera.aiEnabled")) === false, [wOn, wOff]);
  await pg.shot(P("integrated-v7-camera-track.png"));
  await E("document.querySelector('.t-tbtn--ai').click()"); await sleep(250);
  ok("5_bật_lại", (await E("__ed.project.camera.aiEnabled")) === true && parseFloat(await E("document.getElementById('vid').style.width")) > wOff + 5);
  // kéo một shift AI
  const shiftBox = await E("(()=>{const e=[...document.querySelectorAll('.t-clip--shift')].find(x=>x.classList.contains('is-ai'));e.scrollIntoView({block:'nearest',inline:'center'});const r=e.getBoundingClientRect();return {x:r.left,y:r.top,w:r.width,h:r.height,id:e.dataset.id}})()");
  const srcBefore = await E(`__ed.project.videoShifts.find(s=>s.id==='${shiftBox.id}').source`);
  await pg.dragMouse(shiftBox.x + shiftBox.w / 2, shiftBox.y + shiftBox.h / 2, shiftBox.x + shiftBox.w / 2 + 40, shiftBox.y + shiftBox.h / 2); await sleep(250);
  const shAfter = JSON.parse(await E(`JSON.stringify(__ed.project.videoShifts.find(s=>s.id==='${shiftBox.id}'))`));
  ok("5_kéo_shift_AI_→_source_user", srcBefore === "ai" && shAfter.source === "user", [srcBefore, shAfter.source]);
  // chỉnh inspector một move AI → user
  const mvId = await E("__ed.project.videoMoves.find(m=>m.source==='ai').id");
  await E(`__ed.select(['${mvId}'])`); await sleep(250);
  await E("(()=>{const inp=document.querySelector('#propsBody input[type=number]:nth-of-type(1)');})()");
  await E(`(()=>{const inps=[...document.querySelectorAll('#propsBody input[type=number]')];const i=inps[2];i.value=(parseFloat(i.value)+0.05).toFixed(2);i.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(250);
  ok("5_sửa_move_AI_→_user", (await E(`__ed.project.videoMoves.find(m=>m.id==='${mvId}').source`)) === "user");
  await E("document.getElementById('tlScroll').scrollTop=9999");
  await pg.shot(P("integrated-v7-shift-track.png"));

  // ---- hold → nguồn bằng CLICK THẬT (đúng chỗ play() từng bị chính sách autoplay chặn) ----
  {
    const pb = await rect('#btnPlay');
    await E('__ed.setTime(0)'); await sleep(1200);
    await pg.click(pb.x + pb.w / 2, pb.y + pb.h / 2);
    await sleep(1800);
    const tH = await E('__ed.t'), rejH = await E('__ed.cu.player.stats.rejects'), ctH = await E('__ed.cu.player.active.currentTime'), c1 = await E('__ed.project.videoClips[1].srcIn');
    await pg.click(pb.x + pb.w / 2, pb.y + pb.h / 2); await sleep(300);
    ok('6a_hold→nguồn_click_thật_không_bị_từ_chối', rejH === 0, rejH);
    ok('6a_timeline_đã_qua_hold(>1.0s)', tH > 1.0, tH);
    ok('6a_video_nguồn_đã_chạy_qua_srcIn+0.3', ctH > c1 + 0.3, [ctH, c1]);
  }

  // ---- Phát bằng CLICK THẬT qua biên clip có khung riêng ----
  await E("__ed.select([])");
  const L = JSON.parse(await E("JSON.stringify((()=>{let a=0;const f=__ed.project.fps;return __ed.project.videoClips.map(c=>{const n=c.kind==='hold'?Math.round(c.dur*f):Math.round((c.srcOut-c.srcIn)*f);const r={id:c.id,s:a/f,e:(a+n)/f};a+=n;return r;});})())"));
  const k = 3; // đặt khung riêng cho clip k bằng API editor rồi phát qua biên k → k+1
  await E(`(()=>{__ed.project.videoClips[${k}].transform={scale:0.85,x:-8,y:6};__ed.touch();__ed.refreshAll();})()`);
  await E(`__ed.setTime(${L[k].e - 1.2})`); await sleep(1200);
  await E("window.__w=[];(function f(){window.__w.push([__ed.t,parseFloat(document.getElementById('vid').style.width),parseFloat(document.getElementById('vid').style.left)]);requestAnimationFrame(f)})()");
  const play = await rect("#btnPlay");
  await pg.click(play.x + play.w / 2, play.y + play.h / 2); // CLICK thật (không có cờ autoplay)
  await sleep(2800);
  await pg.click(play.x + play.w / 2, play.y + play.h / 2); await sleep(300);
  const rej = await E("__ed.cu.player.stats.rejects"), swaps = await E("__ed.cu.player.stats.swaps + __ed.cu.player.stats.cont");
  const w = JSON.parse(await E("JSON.stringify(window.__w)"));
  const crossed = w.some((x) => x[0] > L[k].e + 0.1);
  const wBefore = w.filter((x) => x[0] > L[k].e - 0.8 && x[0] < L[k].e - 0.1).map((x) => x[1]), wAfter = w.filter((x) => x[0] > L[k].e + 0.2 && x[0] < L[k].e + 0.9).map((x) => x[1]);
  ok("6_phát_bằng_click_thật_không_bị_từ_chối", rej === 0, rej);
  ok("6_qua_biên_clip_có_override", crossed && swaps >= 1, { crossed, swaps });
  ok("6_khung_đổi_tại_biên(override→chung)", wBefore.length > 3 && wAfter.length > 3 && Math.abs(wBefore[wBefore.length - 1] - wAfter[0]) > 20, [wBefore.slice(-1), wAfter.slice(0, 1)]);
  R.hoiQuy_log = pg.logs.filter((l) => /EXC|từ chối/i.test(l)).slice(0, 3);

  // ---- Lưu: đĩa có transform + camera ----
  await E("__ed.flush()");
  const saved = JSON.parse(await E("fetch('/api/project').then(r=>r.text())"));
  ok("7_đĩa_có_clip.transform", saved.videoClips[k].transform && near(saved.videoClips[k].transform.scale, 0.85, 0.001));
  ok("7_đĩa_có_camera", saved.camera && saved.camera.aiEnabled === true);
  ok("7_đã_lưu", (await E("document.getElementById('saveState').textContent")) === "Đã lưu");
  await E("document.getElementById('tlScroll').scrollTop=9999");
  await E(`__ed.setTime(${L[k].s + 1})`); await sleep(500);
  await pg.shot(P("integrated-v7-final.png"));
  R.logs = pg.logs.filter((l) => /EXC/i.test(l)).slice(0, 5);
} catch (e) { console.log(JSON.stringify(R, null, 1)); console.log("LỖI:", String(e.message).slice(0, 300)); fails.push("exception"); } finally { await pg.close(); }
console.log(JSON.stringify(R, null, 1));
console.log(fails.length ? "KHÔNG ĐẠT: " + fails.join(", ") : "TẤT CẢ ĐẠT");
