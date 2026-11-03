// Phát xem trước theo videoClips: HAI thẻ <video> (cùng proxy, giọng mux sẵn) luân phiên. Phần tử đang hiện = a, phần tử chờ = b.
// b được đặt sẵn tại đầu clip kế (lùi LEAD giây), bắt đầu phát tắt tiếng ngay trước biên, tới biên thì đổi lớp hiển thị + đổi gain giọng
// trên đồng hồ AudioContext (engine.setVoiceEl) nên không nghe/thấy đoạn đã cắt. Hold = dừng khung (đồng hồ thời gian thực).
import { layout, locate } from "./clips-core.js";

const LEAD = 0.07; // s: b chạy trước biên
const SWAP_EPS = 0.017; // s: đổi hiển thị khi còn ≤ 1 nhịp rAF tới biên (sớm tối đa ~16 ms, không bao giờ trễ quá biên)

export function createClipPlayer(host) {
  // host: { clips(): VideoClip[], fps(): number, elA, elB, engine(): audio-engine | null }
  const els = [host.elA, host.elB];
  let L = [], a = host.elA, b = host.elB, ci = 0, playing = false, holdT0 = 0, pre = false, cont = false, bReady = false;
  const stats = { swaps: 0, notReady: 0, cont: 0, rejects: 0 }; // rejects: play() bị trình duyệt từ chối (chính sách autoplay)
  const guard = (pr) => { if (pr && pr.catch) pr.catch((e) => { stats.rejects++; console.warn("[clip-player] play() bị từ chối:", e && e.name); }); };
  let trace = null;

  const front = () => { a.style.zIndex = 2; b.style.zIndex = 1; };
  const engineSwap = (at) => { const e = host.engine && host.engine(); if (e && e.setVoiceEl) e.setVoiceEl(a, at); };
  const eps = () => 0.25 / host.fps(); // đặt vào GIỮA khung (tránh làm tròn nhảy về khung trước)
  const setT = (el, x) => { try { el.currentTime = Math.max(0, x); } catch (_) { /* chưa có metadata */ } };

  function refresh() { L = layout(host.clips(), host.fps()); if (ci >= L.length) ci = Math.max(0, L.length - 1); }

  /** Chuẩn bị b cho clip kế tiếp (đặt sẵn khung, tắt tiếng, dừng). */
  function prepStandby() {
    pre = false; bReady = false; b.pause();
    const cur = L[ci], nx = L[ci + 1];
    cont = !!(cur && nx && cur.c.kind === "source" && nx.c.kind === "source" && Math.abs(nx.c.srcIn - cur.c.srcOut) < 0.5 / host.fps());
    if (!nx || cont) return;
    // hold → nguồn: b đứng đúng khung srcIn (liền mạch với khung giữ), chỉ phát tại biên; nguồn → nguồn: b lùi LEAD rồi phát tắt tiếng trước biên
    setT(b, nx.c.kind === "source" && cur.c.kind === "source" ? nx.c.srcIn - Math.min(LEAD, nx.c.srcIn) : nx.c.srcIn + eps());
    bReady = true;
  }

  function startA(t) {
    const k = L[ci];
    if (k.c.kind === "source") { guard(a.play()); } else { a.pause(); holdT0 = performance.now() - (t - k.s) * 1000; }
  }

  /** Đặt vị trí timeline t (giây). Giữ trạng thái phát. */
  function seek(t) {
    refresh();
    if (!L.length) return;
    const i = locate(L, t), k = L[i], off = Math.max(0, t - k.s);
    ci = i; front();
    setT(a, k.c.srcIn + (k.c.kind === "hold" ? 0 : off) + eps());
    engineSwap();
    prepStandby();
    if (playing) startA(t);
  }
  function play(t) {
    refresh(); playing = true;
    if (!L.length) return;
    seek(t);
  }
  function pause() { playing = false; a.pause(); b.pause(); pre = false; }

  function timeNow() {
    const k = L[ci];
    if (!k) return 0;
    if (k.c.kind === "hold") return k.s + (performance.now() - holdT0) / 1000;
    return k.s + a.currentTime - k.c.srcIn;
  }
  /** Gọi mỗi khung rAF khi đang phát: xử lý biên clip, trả thời điểm timeline hiện tại. */
  function tick() {
    if (!L.length) return 0;
    let k = L[ci], t = timeNow(), rem = k.e - t;
    if (playing && rem <= LEAD && !pre && k.c.kind === "source") {
      pre = true;
      const nx = L[ci + 1];
      if (nx && !cont && nx.c.kind === "source") { if (!bReady || b.seeking) stats.notReady++; guard(b.play()); }
    }
    if (playing && rem <= SWAP_EPS) {
      const nx = L[ci + 1];
      if (!nx) { return L[L.length - 1].e; }
      if (cont) { ci++; pre = false; cont = false; stats.cont++; prepStandby(); k = L[ci]; return Math.max(k.s, timeNow()); }
      // đổi phần tử: gain giọng đổi đúng tại biên trên đồng hồ AudioContext
      const eng = host.engine && host.engine();
      const ctxAt = eng && eng.ctxTime && eng.ctxTime() != null ? eng.ctxTime() + Math.max(0, rem) : undefined;
      a.pause();
      [a, b] = [b, a];
      ci++; front();
      engineSwap(ctxAt);
      stats.swaps++;
      const nk = L[ci];
      if (nk.c.kind === "hold") { a.pause(); holdT0 = performance.now() + rem * 1000; }
      else if (k.c.kind === "hold") guard(a.play()); // hold → nguồn: bắt đầu phát đúng tại biên
      prepStandby();
      return Math.max(nk.s, timeNow());
    }
    return Math.max(k.s, t);
  }

  // dấu vết từng khung hình được trình chiếu (kiểm thử độ khựng)
  function enableTrace() {
    trace = [];
    els.forEach((el, n) => {
      const f = (now, md) => { trace.push({ n, now, mediaTime: md.mediaTime, ci, vis: a === el, presented: md.presentedFrames }); el.requestVideoFrameCallback(f); };
      el.requestVideoFrameCallback(f);
    });
    return trace;
  }

  return { seek, play, pause, tick, refresh, stats, enableTrace, get trace() { return trace; }, get index() { return ci; }, get active() { return a; }, get standby() { return b; }, get playing() { return playing; }, timeNow };
}
