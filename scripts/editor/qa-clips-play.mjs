// Đo độ khựng khi phát qua biên clip (clip-player.js): node scripts/editor/qa-clips-play.mjs <url> [ảnh.png]
// Dùng requestVideoFrameCallback: khoảng cách thời gian thật giữa các khung HIỂN THỊ, và khung hiển thị có nằm trong [srcIn, srcOut] của clip hiện tại không.
import { openPage, sleep } from "./cdp.mjs";
const [url = "http://localhost:4362/?theme=dark"] = process.argv.slice(2);
const pg = await openPage(url, { width: 1568, height: 880, gpu: true });
const E = (x) => pg.evalJs(x);
const R = {}, fails = [];
const ok = (n, c, extra) => { R[n] = c ? "ĐẠT" : "KHÔNG ĐẠT" + (extra !== undefined ? " " + JSON.stringify(extra) : ""); if (!c) fails.push(n); };
try {
  for (let i = 0; i < 100; i++) { if (await E("!!(window.__ed && window.__ed.project && window.__ed.cu)")) break; await sleep(200); }
  await sleep(2500);
  const getL = async () => JSON.parse(await E("JSON.stringify((()=>{let a=0;const f=__ed.project.fps;return __ed.project.videoClips.map(c=>{const n=c.kind==='hold'?Math.round(c.dur*f):Math.round((c.srcOut-c.srcIn)*f);const r={id:c.id,kind:c.kind,srcIn:c.srcIn,srcOut:c.srcOut,s:a/f,e:(a+n)/f};a+=n;return r;});})())"));
  let L = await getL();
  const seam = L[3].s + 1.0;
  const runs = [
    { name: "hold→nguồn→nối_liền_từ_đầu", from: 0, to: 4.2 },
    { name: "qua_clip_ngắn_C0007_0.63s", from: L[5].e - 0.8, to: L[8].s + 1.0 },
    { name: "qua_clip_C0012_0.97s", from: L[10].e - 0.8, to: L[13].s + 0.8 },
    { name: "liền_mạch_sau_khi_cắt_S", from: seam - 0.8, to: seam + 0.8, cut: seam },
  ];
  await E("window.__tr = __ed.cu.player.enableTrace(); 1");
  for (const run of runs) {
    await E("__ed.pause(); window.__tr.length=0; __ed.cu.player.stats.swaps=0; __ed.cu.player.stats.notReady=0; __ed.cu.player.stats.cont=0; 1");
    if (run.cut) { await E(`__ed.setTime(${run.cut})`); await E("window.dispatchEvent(new KeyboardEvent('keydown',{key:'s',bubbles:true}))"); await sleep(300); L = await getL(); }
    await E(`__ed.setTime(${run.from})`);
    await sleep(900); // đợi seek giải mã khung đầu
    const samples = await E(`new Promise(res=>{const out=[];const w0=performance.now();window.__w0=w0;__ed.play();const f=()=>{out.push([performance.now()-w0,__ed.t]);if(performance.now()-w0<${(run.to - run.from) * 1000 + 300}&&__ed.t<${run.to})requestAnimationFrame(f);else{__ed.pause();res(out)}};requestAnimationFrame(f)})`);
    const tr = JSON.parse(await E("JSON.stringify(window.__tr)")), st = JSON.parse(await E("JSON.stringify(__ed.cu.player.stats)"));
    const w0 = await E("window.__w0");
    const vis = tr.filter((x) => x.vis && x.now >= w0).sort((a, b) => a.now - b.now);
    // (1) khoảng cách giữa các khung hiển thị CÙNG clip nguồn (bỏ hold: khung tĩnh không có sự kiện khung)
    let maxGap = 0, gapAt = null;
    for (let i = 1; i < vis.length; i++) {
      if (vis[i].ci !== vis[i - 1].ci || L[vis[i].ci].kind === "hold" || vis[i - 1].now < w0 + 250) continue; // bỏ độ trễ khởi động sau khi bấm phát
      const g = vis[i].now - vis[i - 1].now;
      if (g > maxGap) { maxGap = g; gapAt = { ci: vis[i].ci, mt: vis[i].mediaTime }; }
    }
    // (2) độ trễ qua biên: thời điểm (đồng hồ rAF) timeline vượt biên → khung hiển thị đầu tiên của clip mới
    const lat = [];
    for (let k = 1; k < L.length; k++) {
      if (L[k].kind === "hold" || L[k].s <= run.from + 0.05 || L[k].s >= run.to) continue;
      const cross = samples.find((q) => q[1] >= L[k].s);
      const fr = vis.find((x) => x.ci === k);
      if (cross && fr) lat.push({ clip: L[k].id, ms: +(fr.now - (w0 + cross[0])).toFixed(1) });
    }
    const maxLat = lat.length ? Math.max(...lat.map((x) => Math.abs(x.ms))) : 0;
    // khung hiển thị phải nằm trong clip hiện tại
    let bad = [];
    for (const x of vis) {
      const c = L[x.ci];
      if (!c || c.kind === "hold") continue;
      if (x.mediaTime < c.srcIn - 1.01 / 30 || x.mediaTime > c.srcOut + 1.01 / 30) bad.push({ ci: x.ci, mt: +x.mediaTime.toFixed(3), srcIn: c.srcIn, srcOut: c.srcOut });
    }
    // đồng hồ timeline tăng đều: độ dốc ≈ 1 và không nhảy lùi
    let back = 0, maxJump = 0;
    for (let i = 1; i < samples.length; i++) { const d = samples[i][1] - samples[i - 1][1]; if (d < -1e-6) back++; maxJump = Math.max(maxJump, d); }
    const slope = (samples.at(-1)[1] - samples[0][1]) / ((samples.at(-1)[0] - samples[0][0]) / 1000);
    const gains = await E("__ed.engine.voiceGains()"), actIdx = await E("__ed.cu.player.active===document.getElementById('vid')?0:1");
    ok(run.name + "_giọng_chỉ_một_phần_tử_nghe", gains[actIdx] === 1 && gains[1 - actIdx] === 0, { gains, actIdx });
    if (run.cut) ok(run.name + "_đi_thẳng_không_đổi_phần_tử", st.cont >= 1 && st.swaps === 0, st);
    R[run.name] = { khungHienThi: vis.length, khoangCachLonNhat_ms: +maxGap.toFixed(1), taiClip: gapAt, doTreQuaBien: lat, nhayLui: back, nhayLonNhat_ms: +(maxJump * 1000).toFixed(1), doDoc: +slope.toFixed(3), doiPhanTu: st.swaps, noiLien: st.cont, chuaSanSang: st.notReady, khungNgoaiClip: bad.slice(0, 4), soNgoaiClip: bad.length };
    ok(run.name + "_không_khựng_trong_clip(<2.5 khung)", maxGap < 2.5 * (1000 / 30), +maxGap.toFixed(1));
    ok(run.name + "_trễ_qua_biên(<=2 khung)", maxLat <= 2 * (1000 / 30), lat);
    ok(run.name + "_không_lộ_phần_đã_cắt", bad.length === 0, bad.slice(0, 3));
    ok(run.name + "_đồng_hồ_đều", back === 0 && Math.abs(slope - 1) < 0.08, { back, slope });
  }
  R.logs = pg.logs.filter((l) => /EXC|rror/i.test(l)).slice(0, 5);
} finally { await pg.close(); }
console.log(JSON.stringify(R, null, 1));
console.log(fails.length ? "KHÔNG ĐẠT: " + fails.join(", ") : "TẤT CẢ ĐẠT");
