// Đo hiệu năng editor trong Chrome thật (headless=new, điều khiển bằng CDP qua WebSocket có sẵn của Node):
//   node scripts/editor/perf-measure.mjs <url editor>   (server editor phải đang chạy, vd http://localhost:4340/)
// In: thời gian tải trang, FPS khi phát (rAF), chi phí kéo clip, thu phóng/cuộn timeline, long task khi tự lưu.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "http://localhost:4340/";
const chrome = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome"].find((p) => p && existsSync(p));
if (!chrome) throw new Error("Không tìm thấy Chrome/Edge (đặt CHROME_PATH)");
const port = 9300 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), "th-perf-"));
const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1568,880", "--autoplay-policy=no-user-gesture-required", ...(process.env.PERF_GPU ? ["--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--use-angle=d3d11"] : ["--disable-gpu"]), "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (p, init) => fetch(`http://127.0.0.1:${port}${p}`, init).then((r) => r.json());
try {
  for (let i = 0; i < 50; i++) { try { await get("/json/version"); break; } catch { await sleep(200); } }
  const tgt = await get("/json/new?" + encodeURIComponent(url), { method: "PUT" });
  const ws = new WebSocket(tgt.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const call = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expr) => { const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
  await call("Runtime.enable");
  for (let i = 0; i < 100; i++) { if (await evalJs("!!(window.__ed && window.__ed.project)")) break; await sleep(200); }
  if (process.env.PERF_CSS) await evalJs(`(()=>{const st=document.createElement("style");st.textContent=${JSON.stringify(process.env.PERF_CSS)};document.head.appendChild(st);return 1})()`);
  await sleep(1500);
  const out = await evalJs(`(async () => {
    const R = {};
    const nav = performance.getEntriesByType("navigation")[0], m = performance.getEntriesByName("ed-ui-ready")[0];
    const P = __ed.project;
    R.tai_trang = { domContentLoaded_ms: Math.round(nav.domContentLoadedEventEnd), uiSanSang_ms: Math.round(m ? m.startTime : -1), load_ms: Math.round(nav.loadEventEnd), clip: document.querySelectorAll(".t-clip").length, projectKB: Math.round(JSON.stringify(P).length / 1024) };
    const lt = []; new PerformanceObserver((l) => l.getEntries().forEach((e) => lt.push(e.duration))).observe({ type: "longtask", buffered: false });
    // FPS khi phát
    const d = []; let last = performance.now(), on = true; (function loop() { const n = performance.now(); d.push(n - last); last = n; if (on) requestAnimationFrame(loop); })();
    __ed.setTime(5); __ed.play(); await new Promise((r) => setTimeout(r, 7000)); const adv = __ed.t - 5; __ed.pause(); on = false;
    const dd = d.slice(5), s = [...dd].sort((a, b) => a - b), avg = dd.reduce((a, b) => a + b, 0) / dd.length;
    R.phat = { khung: dd.length, fps: +(1000 / avg).toFixed(1), p95_ms: +s[Math.floor(dd.length * 0.95)].toFixed(1), max_ms: +s[dd.length - 1].toFixed(1), khung_tre_hon_25ms: dd.filter((x) => x > 25).length, video_chay_giay: +adv.toFixed(2), longtask: lt.length };
    // kéo clip phụ đề 150 bước
    const clip = document.querySelector(".t-track .t-clip--subtitle"); const r = clip.getBoundingClientRect();
    const ev = (t, el, x, y) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 9 }));
    ev("pointerdown", clip, r.left + 20, r.top + 8); const tm = [];
    for (let i = 1; i <= 150; i++) { const a = performance.now(); ev("pointermove", window, r.left + 20 + i * 2, r.top + 8); tm.push(performance.now() - a); }
    const a0 = performance.now(); ev("pointerup", window, r.left + 320, r.top + 8); const up = performance.now() - a0; tm.sort((x, y) => x - y);
    R.keo_clip = { moi_buoc_tb_ms: +(tm.reduce((a, b) => a + b, 0) / tm.length).toFixed(2), p95_ms: +tm[Math.floor(tm.length * 0.95)].toFixed(2), tha_chuot_ms: +up.toFixed(1) };
    // thu phóng Ctrl+cuộn 60 sự kiện
    const sc = document.getElementById("tlScroll"); const z0 = __ed.zoom; const zt = [];
    for (let i = 0; i < 60; i++) { const a = performance.now(); sc.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: i % 2 ? 40 : -40, clientX: 600, clientY: 600 })); await new Promise((r) => requestAnimationFrame(r)); zt.push(performance.now() - a); }
    zt.sort((x, y) => x - y);
    R.thu_phong = { su_kien: 60, moi_su_kien_tb_ms: +(zt.reduce((a, b) => a + b, 0) / zt.length).toFixed(1), p95_ms: +zt[Math.floor(zt.length * 0.95)].toFixed(1), zoom_cuoi: +__ed.zoom.toFixed(1) };
    // cuộn ngang timeline
    const st = []; let lastS = performance.now();
    for (let i = 0; i < 90; i++) { sc.scrollLeft = i * 60; await new Promise((r) => requestAnimationFrame(r)); const n = performance.now(); st.push(n - lastS); lastS = n; }
    R.cuon = { khung: st.length, tb_ms: +(st.reduce((a, b) => a + b, 0) / st.length).toFixed(1), max_ms: +Math.max(...st).toFixed(1) };
    // tự lưu (PUT toàn bộ project)
    const lt0 = lt.length; __ed.touch(); const t0 = performance.now(); await __ed.save(); const sv = performance.now() - t0;
    R.tu_luu = { ms_ca_PUT: +sv.toFixed(1), longtask_them: lt.length - lt0 };
    return R;
  })()`);
  console.log(JSON.stringify(out, null, 2));
  ws.close();
} finally {
  proc.kill();
  await sleep(500);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome còn giữ file */ }
}
