// Kiểm thử tự động editor (B-roll) bằng CDP: node scripts/editor/qa-broll-editor.mjs <url> <thư mục ảnh>
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openPage, sleep } from "./cdp.mjs";
const [url = "http://localhost:4360/?theme=dark", out = "scripts/editor/public/design/screens"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const P = (f) => join(out, f).split(String.fromCharCode(92)).join("/");
const pg = await openPage(url, { width: 1568, height: 880, gpu: true });
const R = {};
try {
  for (let i = 0; i < 100; i++) { if (await pg.evalJs("!!(window.__ed && window.__ed.project)")) break; await sleep(200); }
  await sleep(2500);
  R.moves0 = await pg.evalJs("__ed.project.videoMoves.length");
  R.camClips = await pg.evalJs("document.querySelectorAll('.t-track--cam .t-clip').length");
  // trạng thái video tại giữa một zoom (4.6 s): video phải bị phóng
  await pg.evalJs("__ed.setTime(4.6)");
  R.zoomMid = await pg.evalJs("(()=>{const v=document.getElementById('vid');return {w:Math.round(parseFloat(v.style.width)),stageW:Math.round(document.getElementById('stage').clientWidth)}})()");
  await pg.evalJs("__ed.setTime(1)"); R.zoomOff = await pg.evalJs("Math.round(parseFloat(document.getElementById('vid').style.width))");
  await pg.shot(P("integrated-v5-zoom-mid.png"));
  // thêm Zoom nhấn bằng nút (playhead 60 s), rồi thử đè lên đoạn có sẵn
  await pg.evalJs("__ed.setTime(68.0)");
  await pg.evalJs("document.getElementById('btnZoom').click()"); await sleep(300);
  R.afterZoomBtn = await pg.evalJs("__ed.project.videoMoves.length");
  R.lastMove = await pg.evalJs("JSON.stringify(__ed.project.videoMoves.find(m=>m.start>=67.9&&m.start<=68.1))");
  await pg.evalJs("document.getElementById('btnZoom').click()"); await sleep(200);
  R.overlapRejected = await pg.evalJs("__ed.project.videoMoves.length") === R.afterZoomBtn;
  // kéo dời đoạn vừa thêm bằng sự kiện con trỏ
  R.drag = await pg.evalJs(`(async()=>{
    const m=__ed.project.videoMoves.find(m=>m.start>=67.9&&m.start<=68.1); const c=document.querySelector('.t-clip[data-id="'+m.id+'"]'); const r=c.getBoundingClientRect();
    const ev=(t,el,x,y)=>el.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:x,clientY:y,button:0,pointerId:7}));
    const s0=m.start; ev('pointerdown',c,r.left+r.width/2,r.top+8); ev('pointermove',window,r.left+r.width/2-6,r.top+8); ev('pointermove',window,r.left+r.width/2-14,r.top+8); ev('pointerup',window,r.left+r.width/2+90,r.top+8);
    await new Promise(r=>setTimeout(r,200)); const m2=__ed.project.videoMoves.find(x=>x.id===m.id); return {s0,s1:m2.start,e1:m2.end,dur:+(m2.end-m2.start).toFixed(2)}; })()`);
  // menu chuyển cảnh
  await pg.evalJs("document.getElementById('btnTrans').click()"); await sleep(250);
  await pg.shot(P("integrated-v5-trans-menu.png"));
  await pg.evalJs("document.querySelector('#transPop [data-tk=shutter]').click()"); await sleep(300);
  R.transitions = await pg.evalJs("__ed.project.tracks.flatMap(t=>t.layers).filter(l=>l.type==='transition').map(l=>l.transition&&l.transition.kind)");
  // tab Asset: kéo thẻ vào khung hình
  await pg.evalJs("document.querySelector('#libTabs [data-sub=asset]').click()"); await sleep(500);
  R.assetCards = await pg.evalJs("document.querySelectorAll('#libAsset .t-preset').length");
  R.assetDrop = await pg.evalJs(`(async()=>{
    const card=document.querySelector('#libAsset .t-preset'); const cr=card.getBoundingClientRect(); const st=document.getElementById('stage').getBoundingClientRect();
    const n0=__ed.project.tracks.flatMap(t=>t.layers).filter(l=>l.type==='asset').length; __ed.setTime(20);
    const ev=(t,el,x,y)=>el.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:x,clientY:y,button:0,pointerId:8}));
    ev('pointerdown',card,cr.left+20,cr.top+20); ev('pointermove',window,cr.left+60,cr.top+60); ev('pointermove',window,st.left+st.width/2,st.top+st.height/2); window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:st.left+st.width/2,clientY:st.top+st.height/2,button:0,pointerId:8}));
    await new Promise(r=>setTimeout(r,500)); const a=__ed.project.tracks.flatMap(t=>t.layers).filter(l=>l.type==='asset'); return {added:a.length-n0, src:a[a.length-1].src}; })()`);
  // inspector asset: bật vẽ nét + tint + loop
  R.assetProps = await pg.evalJs(`(async()=>{
    const a=__ed.project.tracks.flatMap(t=>t.layers).filter(l=>l.type==='asset').slice(-1)[0]; __ed.select([a.id]); await new Promise(r=>setTimeout(r,300));
    const labels=[...document.querySelectorAll('#propsBody .t-prop > label')].map(l=>l.textContent); return labels.filter(x=>/tint|Vẽ|lặp|Chu kỳ|Biên độ|Tệp/i.test(x)); })()`);
  await pg.evalJs("__ed.setTime(20.4)"); await pg.shot(P("integrated-v5-asset.png"));
  // overlay trong suốt: scene overlay tại 96.5 s
  await pg.evalJs("__ed.select([]); __ed.setTime(96.5)"); await sleep(1500);
  await pg.shot(P("integrated-v5-overlay-scene.png"));
  // undo/redo
  R.undo = await pg.evalJs(`(async()=>{const n=()=>__ed.project.videoMoves.length+__ed.project.tracks.flatMap(t=>t.layers).length; const a=n(); __ed.undo(); await new Promise(r=>setTimeout(r,150)); const b=n(); __ed.redo(); await new Promise(r=>setTimeout(r,150)); return {a,b,c:n()};})()`);
  R.errors = pg.logs.filter((l) => /^(error|EXC)/.test(l)).slice(0, 8);
  console.log(JSON.stringify(R, null, 2));
} catch (e) { console.log(JSON.stringify(R, null, 1), "logs:", pg.logs.slice(-6)); throw e; } finally { await pg.close(); }
