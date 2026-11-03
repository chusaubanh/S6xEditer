"""Phiên âm Chế độ C: WhisperX (large-v3 hoặc PhoWhisper-large) -> căn từ -> Silero VAD -> từ đệm.

Chạy bằng .venv-asr\\Scripts\\python.exe (gọi từ `npm run th:transcribe`).
Ghi vào --out-dir: transcript.raw<suffix>.json, vad<suffix>.json, fillers<suffix>.json
"""
import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import MODELS, free_vram, setup_env  # noqa: E402

setup_env()

import numpy as np  # noqa: E402
import soundfile as sf  # noqa: E402
import torch  # noqa: E402

PROMPT = "Ừm, à, ờ... thì là, nói chung là, kiểu như vậy. Xin chào các bạn, hôm nay mình chia sẻ một nội dung."
FILLER_WORDS = {"ừm", "ừ", "à", "ờ", "ơ", "kiểu", "ờm", "ầm"}
FILLER_PHRASES = [["thì", "là"], ["nói", "chung", "là"]]
VAD_FILLER_MIN = 0.15  # vùng có tiếng nhưng không có từ, dài tối thiểu (giây)
BATCH_SIZES = [8, 4, 2, 1]
ALIGN_MODEL_VI = "nguyenvulebinh/wav2vec2-base-vietnamese-250h"


def log(msg: str) -> None:
    print(f"[transcribe] {msg}", flush=True)


def load_audio(path: str) -> np.ndarray:
    data, sr = sf.read(path, dtype="float32", always_2d=True)
    if sr != 16000:
        raise SystemExit(f"Cần wav 16 kHz, nhận {sr}")
    return data.mean(axis=1)


def norm(s: str) -> str:
    return re.sub(r"[^\w]+", "", s.lower(), flags=re.UNICODE)


def is_oom(e: BaseException) -> bool:
    return isinstance(e, torch.cuda.OutOfMemoryError) or "out of memory" in str(e).lower()


def phowhisper_path() -> str:
    """Chuyển vinai/PhoWhisper-large sang CTranslate2 float16 vào models\\ (một lần)."""
    out = MODELS / "phowhisper-large-ct2"
    if (out / "model.bin").exists():
        return str(out)
    log("Chuyển PhoWhisper-large sang CTranslate2 float16 (lần đầu, tải ~3 GB)...")
    # ctranslate2 4.8 gọi from_pretrained(dtype=...) còn transformers 4.49 chỉ nhận torch_dtype -> đổi tên tham số
    code = (
        "import sys, transformers as t;"
        "o=t.PreTrainedModel.from_pretrained.__func__;"
        "t.PreTrainedModel.from_pretrained=classmethod(lambda c,*a,**k:o(c,*a,**{('torch_dtype' if x=='dtype' else x):v for x,v in k.items()}));"
        "from ctranslate2.converters.transformers import main;"
        f"sys.argv=['x','--model','vinai/PhoWhisper-large','--output_dir',r'{out}','--quantization','float16','--force'];main()"
    )
    subprocess.run([sys.executable, "-c", code], check=True)
    return str(out)


def run_asr(audio: np.ndarray, model_name: str):
    import whisperx

    path = "large-v3" if model_name == "large-v3" else phowhisper_path()
    opts = {"initial_prompt": PROMPT}
    kw = dict(compute_type="float16", language="vi", asr_options=opts, download_root=str(MODELS / "whisper"))
    try:
        model = whisperx.load_model(path, "cuda", vad_method="silero", **kw)
    except TypeError:  # bản whisperx cũ chưa có vad_method
        model = whisperx.load_model(path, "cuda", **kw)
    result = None
    for bs in BATCH_SIZES:
        try:
            log(f"transcribe batch_size={bs}")
            result = model.transcribe(audio, batch_size=bs, language="vi")
            break
        except Exception as e:  # noqa: BLE001
            if not is_oom(e):
                raise
            log(f"OOM ở batch_size={bs}, giảm xuống")
            free_vram()
    del model
    free_vram()
    if result is None:
        raise SystemExit("Hết VRAM ngay cả batch_size=1")

    log("căn từ (wav2vec2 vi)")
    # whisperx 3.4.2 mặc định trỏ vào wav2vec2-base-vi (chỉ pretrain, không có đầu CTC -> căn từ sai); dùng wav2vec2-base-vietnamese-250h (kiến trúc chuẩn, có đầu CTC; bản vlsp2020 dùng lớp tuỳ biến nên nạp sai)
    align_model, meta = whisperx.load_align_model(language_code="vi", device="cuda", model_name=ALIGN_MODEL_VI)
    aligned = whisperx.align(result["segments"], align_model, meta, audio, "cuda", return_char_alignments=False)
    del align_model
    free_vram()
    return aligned["segments"]


def fill_word_times(words: list[dict], seg_start: float, seg_end: float) -> list[dict]:
    """Từ không được căn (số, ký hiệu) thiếu mốc: nội suy giữa hai từ lân cận."""
    out, n = [], len(words)
    for i, w in enumerate(words):
        if "start" not in w or "end" not in w:
            prev_end = out[-1]["end"] if out else seg_start
            nxt = next((x["start"] for x in words[i + 1:] if "start" in x), seg_end)
            w = {**w, "start": prev_end, "end": max(prev_end, nxt)}
        out.append(w)
    return out


def build_transcript(segs: list[dict], model_name: str, duration: float) -> dict:
    segments = []
    for seg in segs:
        words = fill_word_times(seg.get("words", []), seg["start"], seg["end"])
        ws = [{"text": w["word"], "start": round(w["start"], 3), "end": round(w["end"], 3),
               **({"score": round(w["score"], 3)} if "score" in w else {})} for w in words]
        if not ws:
            continue
        segments.append({"id": len(segments), "start": ws[0]["start"], "end": ws[-1]["end"],
                         "text": seg["text"].strip(), "words": ws})
    return {"language": "vi", "model": model_name, "duration": round(duration, 3), "segments": segments}


def silero_vad(audio: np.ndarray) -> list[dict]:
    from silero_vad import get_speech_timestamps, load_silero_vad

    model = load_silero_vad()
    ts = get_speech_timestamps(torch.from_numpy(audio), model, sampling_rate=16000, return_seconds=True,
                               min_silence_duration_ms=100, speech_pad_ms=30)
    del model
    return [{"start": round(t["start"], 3), "end": round(t["end"], 3)} for t in ts]


def detect_fillers(transcript: dict, vad: list[dict]) -> list[dict]:
    words = [w for s in transcript["segments"] for w in s["words"]]
    out: list[dict] = []
    # 1) vùng VAD có tiếng nhưng không chứa từ đã căn nào, dài >= 0.15 s
    for v in vad:
        cur = v["start"]
        inside = sorted((w for w in words if w["end"] > v["start"] and w["start"] < v["end"]), key=lambda w: w["start"])
        gaps = []
        for w in inside:
            if w["start"] - cur >= VAD_FILLER_MIN:
                gaps.append((cur, w["start"]))
            cur = max(cur, w["end"])
        if v["end"] - cur >= VAD_FILLER_MIN:
            gaps.append((cur, v["end"]))
        for a, b in gaps:
            out.append({"start": round(a, 3), "end": round(b, 3), "text": "(tiếng đệm)", "source": "vad-gap"})
    # 2) từ khớp danh sách đệm
    toks = [norm(w["text"]) for w in words]
    for i, w in enumerate(words):
        if toks[i] in FILLER_WORDS:
            out.append({"start": w["start"], "end": w["end"], "text": w["text"].strip(",.?! "), "source": "list"})
    for ph in FILLER_PHRASES:
        n = len(ph)
        for i in range(len(words) - n + 1):
            if toks[i:i + n] == ph:
                out.append({"start": words[i]["start"], "end": words[i + n - 1]["end"],
                            "text": " ".join(ph), "source": "list"})
    out.sort(key=lambda x: x["start"])
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out-dir", required=True)
    ap.add_argument("--model", default="large-v3", choices=["large-v3", "phowhisper-large"])
    ap.add_argument("--suffix", default="")
    a = ap.parse_args()

    out = Path(a.out_dir)
    audio = load_audio(a.audio)
    duration = len(audio) / 16000
    log(f"audio {duration:.1f}s, model {a.model}, GPU {torch.cuda.get_device_name(0)}")
    t0 = time.time()
    segs = run_asr(audio, a.model)
    transcript = build_transcript(segs, a.model, duration)
    log(f"asr xong {time.time() - t0:.1f}s, VRAM đỉnh torch {torch.cuda.max_memory_allocated() / 2**20:.0f} MiB")
    free_vram()

    vad = silero_vad(audio)
    fillers = detect_fillers(transcript, vad)
    (out / f"transcript.raw{a.suffix}.json").write_text(json.dumps(transcript, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / f"vad{a.suffix}.json").write_text(json.dumps({"duration": round(duration, 3), "segments": vad}, ensure_ascii=False, indent=2), encoding="utf-8")
    (out / f"fillers{a.suffix}.json").write_text(json.dumps(fillers, ensure_ascii=False, indent=2), encoding="utf-8")
    nw = sum(len(s["words"]) for s in transcript["segments"])
    log(f"{len(transcript['segments'])} đoạn, {nw} từ, VAD {len(vad)} vùng, {len(fillers)} từ đệm")


if __name__ == "__main__":
    main()
