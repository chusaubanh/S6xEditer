// Kiểm scene overlay trong suốt trong editor ở cả Tối và Sáng (video phải lộ ra qua iframe).
import { openPage, sleep } from "./cdp.mjs";
const base = process.argv[2] || "http://localhost:4361/";
for (const theme of ["dark", "light"]) {
  const pg = await openPage(`${base}?theme=${theme}`, { width: 1568, height: 880, gpu: true });
  try {
    for (let i = 0; i < 100; i++) { if (await pg.evalJs("!!(window.__ed && window.__ed.project)")) break; await sleep(200); }
    await sleep(1500);
    await pg.evalJs("__ed.setTime(96.5)");
    for (let i = 0; i < 40; i++) { if (await pg.evalJs("(()=>{const v=document.getElementById('vid');return v.readyState>=3&&Math.abs(v.currentTime-96.5)<0.2})()")) break; await sleep(200); }
    await sleep(1500);
    const info = await pg.evalJs(`(()=>{const f=document.querySelector('#ovRoot iframe');const c=document.createElement('canvas');return {iframe:!!f,scheme:f&&getComputedStyle(f).colorScheme,vt:document.getElementById('vid').currentTime}})()`);
    const file = `scripts/editor/public/design/screens/integrated-v5-overlay-${theme}.png`;
    await pg.shot(file);
    console.log(theme, JSON.stringify(info), file);
  } finally { await pg.close(); }
}
