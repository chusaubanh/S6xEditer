// Tiện ích điều khiển Chrome headless qua CDP (WebSocket có sẵn của Node) để kiểm thử editor tự động.
//   const pg = await openPage(url, { width: 1568, height: 880, gpu: true }); await pg.evalJs("1+1"); await pg.shot("a.png"); await pg.close();
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };
export async function openPage(url, { width = 1568, height = 880, gpu = false, autoplay = true } = {}) {
  const chrome = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => p && existsSync(p));
  if (!chrome) throw new Error("Không tìm thấy Chrome/Edge");
  const port = 9300 + Math.floor(Math.random() * 600), profile = mkdtempSync(join(tmpdir(), "th-cdp-"));
  const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, ...(autoplay ? ["--autoplay-policy=no-user-gesture-required"] : []), "--hide-scrollbars",
    ...(gpu ? ["--enable-gpu-rasterization", "--ignore-gpu-blocklist", "--use-angle=d3d11"] : ["--disable-gpu"]), "--no-first-run", "about:blank"], { stdio: "ignore" });
  const get = (p, init) => fetch(`http://127.0.0.1:${port}${p}`, init).then((r) => r.json());
  for (let i = 0; i < 50; i++) { try { await get("/json/version"); break; } catch { await sleep(200); } }
  const tgt = await get("/json/new?" + encodeURIComponent(url), { method: "PUT" });
  const ws = new WebSocket(tgt.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map(); const logs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    else if (d.method === "Runtime.consoleAPICalled") logs.push(d.params.type + ": " + d.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    else if (d.method === "Runtime.exceptionThrown") logs.push("EXC: " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  };
  const call = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await call("Runtime.enable"); await call("Page.enable");
  await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  const evalJs = async (expr) => { const r = await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500)); return r.result.result.value; };
  const shot = async (file) => { const r = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(file, Buffer.from(r.result.data, "base64")); return file; };
  const key = (k, mods = 0) => call("Input.dispatchKeyEvent", { type: "keyDown", key: k, modifiers: mods, text: k.length === 1 ? k : undefined }).then(() => call("Input.dispatchKeyEvent", { type: "keyUp", key: k, modifiers: mods }));
  const mouse = (type, x, y, o = {}) => call("Input.dispatchMouseEvent", { type, x, y, button: o.button ?? "left", buttons: type === "mouseReleased" || type === "mouseMoved" && !o.down ? 0 : 1, clickCount: o.clickCount ?? 1, modifiers: o.modifiers ?? 0, deltaX: o.dx ?? 0, deltaY: o.dy ?? 0 });
  const click = async (x, y, o = {}) => { await mouse("mouseMoved", x, y); await mouse("mousePressed", x, y, o); await mouse("mouseReleased", x, y, o); };
  const dragMouse = async (x0, y0, x1, y1, o = {}, steps = 8) => {
    await mouse("mouseMoved", x0, y0); await mouse("mousePressed", x0, y0, o);
    for (let i = 1; i <= steps; i++) await mouse("mouseMoved", x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, { ...o, down: true });
    await mouse("mouseReleased", x1, y1, o);
  };
  const wheel = (x, y, dy, o = {}) => mouse("mouseWheel", x, y, { ...o, dy });
  return {
    call, evalJs, shot, key, logs, mouse, click, dragMouse, wheel,
    async close() { try { ws.close(); } catch {} proc.kill(); await sleep(400); try { rmSync(profile, { recursive: true, force: true }); } catch {} },
  };
}
