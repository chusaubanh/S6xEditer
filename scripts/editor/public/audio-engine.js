// Nghe thử âm thanh trong editor bằng WebAudio, đồng bộ với video.
//  - Giọng: phần tử <audio>/<video> đang phát, đi qua GainNode (gainDb, mute).
//  - SFX + nhạc: AudioBuffer, lên lịch theo playhead (gain, fade vào/ra, offset, mute/solo theo track).
//  - Ducking xấp xỉ: nhạc hạ duckDb khi có giọng (vùng có tiếng suy ra từ peaks của giọng), attack/release theo project.audio.music.
// Mọi seek/đổi dự án gọi lại schedule(t) — luôn dừng nguồn cũ trước nên không chồng tiếng khi bấm play nhiều lần.

export const dbToLin = (db) => Math.pow(10, db / 20);

export function createAudioEngine(host) {
  // host: { project(): Project, voiceEl(): HTMLMediaElement, soloSet: Set<string>, onBufferLoaded(): void }
  let ctx = null, master = null, voiceGain = null, duck = null, sfxBus = null, musicBus = null;
  const elSrc = new WeakMap(), elGain = new WeakMap(); // chế độ clips: mỗi <video> một GainNode riêng để đổi giọng đúng biên clip
  const buffers = new Map(); // url -> AudioBuffer | Promise
  const peaksCache = new Map(); // `${url}|${n}` -> Float32Array [min,max,...]
  let sources = [], trackGains = new Map();
  let playing = false, ctxStart = 0, t0 = 0, seq = 0;
  let voiceIv = [];
  const log = (...a) => console.log("[audio]", ...a);

  function ensure() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.connect(ctx.destination);
      voiceGain = ctx.createGain(); voiceGain.connect(master);
      sfxBus = ctx.createGain(); sfxBus.connect(master);
      duck = ctx.createGain(); duck.connect(master);
      musicBus = ctx.createGain(); musicBus.connect(duck);
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const multi = host.voiceEls ? host.voiceEls() : null;
    for (const el of multi || [host.voiceEl()]) {
      if (!el || elSrc.has(el)) continue;
      const s = ctx.createMediaElementSource(el);
      if (multi) { const g = ctx.createGain(); g.gain.value = el === multi[0] ? 1 : 0; s.connect(g); g.connect(voiceGain); elGain.set(el, g); }
      else s.connect(voiceGain);
      elSrc.set(el, s);
    }
    return ctx;
  }

  const urlFor = (l) => {
    const p = host.project();
    const src = l.src || "";
    if (/^(https?:|\/)/.test(src)) return src;
    const pre = `output/${p.job}/`;
    return src.startsWith(pre) ? "/job/" + src.slice(pre.length) : "/" + src;
  };

  function load(url) {
    const have = buffers.get(url);
    if (have) return have instanceof AudioBuffer ? Promise.resolve(have) : have;
    ensure();
    const pr = fetch(url).then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); })
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => { buffers.set(url, buf); host.onBufferLoaded(url); return buf; })
      .catch((e) => { buffers.set(url, null); log("không nạp được", url, e.message); return null; });
    buffers.set(url, pr);
    return pr;
  }
  const loaded = (url) => { const b = buffers.get(url); return b instanceof AudioBuffer ? b : null; };

  /** Tải trước mọi layer audio của dự án (giải mã nền). */
  function preload() {
    for (const tr of host.project().tracks) for (const l of tr.layers) if (l.type === "audio" && l.src) load(urlFor(l));
  }

  /** Đường bao [min,max]*n cho clip (từ AudioBuffer); null nếu chưa nạp (sẽ kích hoạt nạp). */
  function bufferPeaks(l, n) {
    const url = urlFor(l);
    const buf = loaded(url);
    if (!buf) { if (!buffers.has(url)) { ensureLater(); load(url); } return null; }
    const key = url + "|" + n;
    if (peaksCache.has(key)) return peaksCache.get(key);
    const ch = buf.getChannelData(0), out = new Float32Array(n * 2), step = Math.max(1, Math.floor(ch.length / n));
    for (let i = 0; i < n; i++) {
      let mn = 0, mx = 0;
      const a = i * step, b = Math.min(ch.length, a + step), inc = Math.max(1, Math.floor((b - a) / 64));
      for (let k = a; k < b; k += inc) { const v = ch[k]; if (v < mn) mn = v; if (v > mx) mx = v; }
      out[2 * i] = mn; out[2 * i + 1] = mx;
    }
    peaksCache.set(key, out);
    return out;
  }
  const ensureLater = () => { /* AudioContext chỉ tạo được sau cử chỉ người dùng; decode cần ctx */ try { ensure(); } catch (_) {} };
  const duration = (l) => { const b = loaded(urlFor(l)); return b ? b.duration : null; };

  /** Vùng có tiếng nói từ peaks giọng ([min,max] mỗi 10 ms): ngưỡng thích nghi, gộp khe < 0,25 s, bỏ đoạn < 0,1 s. */
  function setVoicePeaks(peaks) {
    if (!peaks || !peaks.peaks) { voiceIv = []; return voiceIv; }
    const P = peaks.peaks, n = P.length / 2, env = new Float32Array(n);
    let gmax = 1;
    for (let i = 0; i < n; i++) { env[i] = Math.max(Math.abs(P[2 * i]), Math.abs(P[2 * i + 1])); if (env[i] > gmax) gmax = env[i]; }
    const sorted = Array.from(env).sort((a, b) => a - b);
    const p95 = sorted[Math.floor(n * 0.95)] || gmax;
    const thr = Math.max(3, p95 * 0.18), rate = peaks.rate || 100;
    const iv = [];
    let s = -1;
    for (let i = 0; i < n; i++) {
      if (env[i] >= thr) { if (s < 0) s = i; }
      else if (s >= 0) { iv.push([s / rate, i / rate]); s = -1; }
    }
    if (s >= 0) iv.push([s / rate, n / rate]);
    const merged = [];
    for (const v of iv) {
      if (merged.length && v[0] - merged[merged.length - 1][1] < 0.25) merged[merged.length - 1][1] = v[1];
      else merged.push([...v]);
    }
    voiceIv = merged.filter((v) => v[1] - v[0] >= 0.1);
    return voiceIv;
  }
  const voiceIntervals = () => voiceIv;

  const audible = (key) => { const s = host.soloSet; return !s || s.size === 0 || s.has(key); };

  function applyVoice() {
    if (!ctx) return;
    const a = host.project().audio || {};
    const v = a.voice || { gainDb: 0, muted: false };
    voiceGain.gain.value = v.muted || !audible("voice") ? 0 : dbToLin(v.gainDb || 0);
  }

  /** Chỉ phần tử el nghe được (các phần tử giọng khác gain 0), đổi tại thời điểm ctx (mặc định ngay). */
  function setVoiceEl(el, at) {
    if (!ctx) return;
    const when = at != null && at > ctx.currentTime ? at : ctx.currentTime;
    for (const e of (host.voiceEls && host.voiceEls()) || []) { const g = elGain.get(e); if (g) { g.gain.cancelScheduledValues(when); g.gain.setValueAtTime(e === el ? 1 : 0, when); } }
  }
  const ctxTime = () => (ctx ? ctx.currentTime : null);
  /** Gain hiện tại của từng phần tử giọng (kiểm thử: đúng một phần tử nghe được). */
  const voiceGains = () => ((host.voiceEls && host.voiceEls()) || []).map((e) => { const g = elGain.get(e); return g ? +g.gain.value.toFixed(3) : null; });

  function stopSources() {
    seq++;
    for (const s of sources) { try { s.node.stop(); } catch (_) {} try { s.node.disconnect(); s.gain.disconnect(); } catch (_) {} }
    sources = [];
    for (const g of trackGains.values()) { try { g.disconnect(); } catch (_) {} }
    trackGains = new Map();
    if (duck) { duck.gain.cancelScheduledValues(0); duck.gain.value = 1; }
  }

  function trackGain(tr) {
    let g = trackGains.get(tr.id);
    if (!g) { g = ctx.createGain(); g.connect(tr.kind === "music" ? musicBus : sfxBus); trackGains.set(tr.id, g); }
    g.gain.value = audible("trk:" + tr.id) ? 1 : 0;
    return g;
  }

  function scheduleOne(tr, l, mySeq) {
    const url = urlFor(l), buf = loaded(url);
    if (!buf) {
      load(url).then((b) => { if (b && playing && mySeq === seq) { log("nạp xong, lên lịch trễ", l.id); scheduleLate(tr, l); } });
      return;
    }
    place(tr, l, buf, t0, ctxStart);
  }
  function scheduleLate(tr, l) {
    // buffer về sau khi đã phát: tính lại theo vị trí phát hiện tại
    const nowT = t0 + (ctx.currentTime - ctxStart);
    const buf = loaded(urlFor(l));
    if (buf) place(tr, l, buf, nowT, ctx.currentTime + 0.02);
  }
  function place(tr, l, buf, fromT, baseCtx) {
    const end = l.start + l.duration;
    if (end <= fromT) return;
    const fromClip = Math.max(l.start, fromT);
    const when = baseCtx + (fromClip - fromT);
    const inOff = (l.offset || 0) + (fromClip - l.start);
    const loop = !!(l.meta && l.meta.loop);
    const dur = loop ? end - fromClip : Math.min(end - fromClip, Math.max(0, buf.duration - inOff));
    if (dur <= 0) return;
    const G = dbToLin(l.gainDb || 0);
    const fi = l.fadeIn || 0, fo = l.fadeOut || 0;
    const node = ctx.createBufferSource(); node.buffer = buf;
    const g = ctx.createGain();
    const elapsed = fromClip - l.start;
    const g0 = fi > 0 && elapsed < fi ? G * (elapsed / fi) : G;
    g.gain.setValueAtTime(g0, when);
    if (fi > 0 && elapsed < fi) g.gain.linearRampToValueAtTime(G, when + (fi - elapsed));
    if (fo > 0) {
      const tOut = end - fo;
      if (tOut > fromClip) { g.gain.setValueAtTime(G, baseCtx + (tOut - fromT)); }
      g.gain.linearRampToValueAtTime(0, baseCtx + (end - fromT));
    }
    node.connect(g); g.connect(trackGain(tr));
    if (l.meta && l.meta.loop) { // nhạc lặp: phát vòng tới hết layer
      node.loop = true; node.loopStart = l.offset || 0; node.loopEnd = buf.duration;
      node.start(when, inOff); node.stop(when + (end - fromClip));
    } else node.start(when, inOff, dur);
    sources.push({ node, gain: g });
    log(`+${(when - ctx.currentTime).toFixed(3)}s ${l.id} ${tr.kind} ${l.src.split("/").pop()} offset=${inOff.toFixed(2)} dur=${dur.toFixed(2)} gain=${(l.gainDb || 0)}dB fade=${fi}/${fo}`);
  }

  function scheduleDuck() {
    const a = host.project().audio;
    const m = (a && a.music) || { duckDb: -12, attack: 0.15, release: 0.45 };
    const d = dbToLin(m.duckDb);
    const at = (x) => ctxStart + (x - t0);
    duck.gain.cancelScheduledValues(0);
    const inside = voiceIv.find((v) => v[0] <= t0 && v[1] > t0);
    duck.gain.setValueAtTime(inside ? d : 1, ctxStart);
    for (const [s, e] of voiceIv) {
      if (e <= t0) continue;
      if (s > t0) { duck.gain.setValueAtTime(1, Math.max(ctxStart, at(s))); duck.gain.linearRampToValueAtTime(d, at(s) + (m.attack || 0.15)); }
      duck.gain.setValueAtTime(d, Math.max(ctxStart, at(e)));
      duck.gain.linearRampToValueAtTime(1, at(e) + (m.release || 0.45));
    }
  }

  /** Lên lịch mọi nguồn từ thời điểm t (giây timeline). Gọi khi play, seek, hoặc dự án đổi lúc đang phát. */
  function schedule(t) {
    ensure();
    stopSources();
    playing = true; t0 = t; ctxStart = ctx.currentTime + 0.06;
    applyVoice();
    const mySeq = seq;
    const p = host.project();
    let n = 0;
    for (const tr of p.tracks) {
      if (!["sfx", "music"].includes(tr.kind) || tr.hidden) continue;
      for (const l of tr.layers) if (l.type === "audio" && l.src) { scheduleOne(tr, l, mySeq); n++; }
    }
    scheduleDuck();
    log(`schedule t0=${t.toFixed(3)}s clips=${n} voiceIntervals=${voiceIv.length} ctx=${ctx.currentTime.toFixed(3)}`);
  }
  function stop() { playing = false; stopSources(); }
  /** Thời điểm timeline mà engine cho rằng đang phát (để phát hiện lệch so với video). */
  const clock = () => (playing ? t0 + (ctx.currentTime - ctxStart) : null);

  // nghe thử trong thư viện (độc lập với timeline)
  let pv = null, pvUrl = null;
  function preview(url, onEnd) {
    stopPreview();
    pv = new Audio(url); pvUrl = url;
    pv.addEventListener("ended", () => { const u = pvUrl; stopPreview(); onEnd && onEnd(u); });
    pv.play().catch(() => {});
    return pv;
  }
  function stopPreview() { if (pv) { pv.pause(); pv = null; pvUrl = null; } }
  const previewing = () => pvUrl;

  return { ensure, setVoiceEl, ctxTime, voiceGains, preload, load, loaded, bufferPeaks, duration, setVoicePeaks, voiceIntervals, applyVoice, schedule, stop, clock, preview, stopPreview, previewing, urlFor, isPlaying: () => playing };
}
