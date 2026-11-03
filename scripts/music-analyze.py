"""Kiểm giọng hát + đoạn cao trào cho thư viện nhạc nền (assets/music-th/manifest.json).

  .venv-asr\\Scripts\\python.exe scripts\\music-analyze.py [--only id1,id2] [--dry]

- Giọng hát: faster-whisper large-v3 (language=None tự nhận) chạy trên từng bài, không tải mạng (HF_HUB_OFFLINE).
  Ghi hasVocals + vocals{...} (bằng chứng: số từ, số từ tin cậy cao, mẫu chữ, ngôn ngữ nhận). Không xoá bài nào.
- Cao trào: cửa sổ 5 s (bước 1 s) có loudness K-weighted cao hơn loudness cả bài >= 6 LU -> peaks:[giây bắt đầu].
"""
import json, os, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ.setdefault("HF_HUB_OFFLINE", "1")
sys.path.insert(0, str(ROOT / "scripts" / "asr"))
import _common  # noqa: E402

_common.setup_env()
import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
from scipy import signal  # noqa: E402

MUSIC = ROOT / "assets" / "music-th"
HALLU = ("thank you", "subtitle", "amara", "subscribe", "like and", "cảm ơn các bạn", "hãy subscribe", "đăng ký kênh")


def kw(x):
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1, -2, 1], [1, -1.99004745483398, 0.99007225036621]
    return signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=0), axis=0)


def peaks_of(x, sr, win=5.0, hop=1.0, over=6.0):
    k = kw(x)
    p = np.mean(k ** 2, axis=1)  # công suất K-weighted (cộng 2 kênh)
    n = int(win * sr)
    csum = np.concatenate([[0], np.cumsum(p)])
    starts = np.arange(0, len(p) - n, int(hop * sr))
    w = (csum[starts + n] - csum[starts]) / n
    lu = -0.691 + 10 * np.log10(2 * w + 1e-12)
    # tham chiếu: loudness cả bài, có gate tương đối -10 LU theo kiểu BS.1770 (bỏ cửa sổ quá nhỏ)
    gate = lu > (-0.691 + 10 * np.log10(2 * np.mean(p) + 1e-12)) - 10
    ref = -0.691 + 10 * np.log10(2 * np.mean(w[gate]) + 1e-12)
    hot = [(round(float(s / sr), 1), round(float(l - ref), 1)) for s, l in zip(starts, lu) if l - ref >= over]
    merged = []
    for s, d in hot:  # gộp cửa sổ liền nhau, giữ cửa sổ cao nhất
        if merged and s - merged[-1][0] <= win:
            if d > merged[-1][2]:
                merged[-1] = (merged[-1][0], s, d)
            else:
                merged[-1] = (merged[-1][0], merged[-1][1], merged[-1][2])
        else:
            merged.append((s, s, d))
    return [m[0] for m in merged], [m[2] for m in merged], round(float(ref), 1), round(float(np.max(lu) - ref), 1)


def main():
    only = None
    if "--only" in sys.argv:
        only = sys.argv[sys.argv.index("--only") + 1].split(",")
    mf = MUSIC / "manifest.json"
    manifest = json.loads(mf.read_text(encoding="utf-8"))
    from faster_whisper import WhisperModel

    model = WhisperModel("large-v3", device="cuda", compute_type="float16", download_root=str(ROOT / "models" / "whisper"))
    for e in manifest:
        if only and e["id"] not in only:
            continue
        t0 = time.time()
        x, sr = sf.read(MUSIC / e["file"], always_2d=True)
        mono16 = signal.resample_poly(x.mean(1), 16000, sr).astype(np.float32)
        # Ba lượt: (1) có VAD, (2) không VAD tự nhận ngôn ngữ, (3) không VAD ép tiếng Anh (nhận ngôn ngữ trên nhạc hay sai).
        # Whisper hay "ảo giác" câu tiếng Anh trên nhạc không lời -> chỉ tin khi lời đa dạng và phủ >= 10% bài.
        words, high, text, speech, info = 0, 0, [], 0.0, None
        forced = {"texts": set(), "speech": 0.0}
        for use_vad, lang in ((True, None), (False, None), (False, "en")):
            segs, inf = model.transcribe(mono16, language=lang, vad_filter=use_vad, word_timestamps=True, beam_size=1,
                                         condition_on_previous_text=False, temperature=0.0)
            info = info or inf
            for s in segs:
                if s.no_speech_prob > 0.6:
                    continue
                low = s.text.strip().lower()
                if any(h in low for h in HALLU):
                    continue
                letters = [c for c in s.text if c.isalpha()]
                if letters and sum(1 for c in letters if ord(c) < 0x250 or 0x1E00 <= ord(c) <= 0x1EFF) / len(letters) < 0.7:
                    continue  # chữ Khmer/Malayalam... trên nhạc không lời = ảo giác
                toks = [w.word.strip().lower() for w in (s.words or [])]
                if len(toks) >= 4 and len(set(toks)) / len(toks) < 0.35:
                    continue
                n_hi = sum(1 for w in (s.words or []) if w.probability >= 0.6)
                if s.avg_logprob <= -1.0 and not (use_vad and n_hi):
                    continue
                if lang == "en":
                    if low not in forced["texts"]:
                        forced["speech"] += s.end - s.start
                    forced["texts"].add(low)
                    text.append(f"[{s.start:.0f}s en] {s.text.strip()}")
                    continue
                speech += s.end - s.start
                for w in s.words or []:
                    words += 1
                    if w.probability >= 0.6:
                        high += 1
                text.append(f"[{s.start:.0f}s{'v' if use_vad else ''}] {s.text.strip()}")
        distinct_en = len(forced["texts"])
        has = high >= 12 or (distinct_en >= 8 and forced["speech"] / e["duration"] >= 0.10)
        pk, delta, ref, mx = peaks_of(x, sr)
        e["hasVocals"] = bool(has)
        e["vocals"] = {"detectedLanguage": info.language, "languageProb": round(info.language_probability, 2), "words": words,
                       "highConfidenceWords": high, "speechSeconds": round(speech, 1), "forcedEnglishDistinctLines": distinct_en, "forcedEnglishSeconds": round(forced["speech"], 1), "sample": " / ".join(text)[:200]}
        e["peaks"] = pk
        e["peaksOverLU"] = delta
        e["maxOverLU"] = mx
        print(f"{e['id']:22s} vocals={has!s:5s} words={words:3d} high={high:3d} speech={speech:5.1f}s lang={info.language}({info.language_probability:.2f}) peaks={pk} maxOver={mx}LU [{time.time() - t0:.0f}s]", flush=True)
        print("    ", e["vocals"]["sample"], flush=True)
        if "--dry" not in sys.argv:
            mf.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
