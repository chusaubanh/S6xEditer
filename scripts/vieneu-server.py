"""Local HTTP bridge for VieNeu-TTS preset voices."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import soundfile as sf
import numpy as np
from vieneu import Vieneu

try:  # phiên bản engine: đổi engine là đổi giọng, nên client phải biết để bỏ cache cũ
    from importlib.metadata import version as _pkg_version

    ENGINE_VERSION = _pkg_version("vieneu")
except Exception:  # pragma: no cover
    ENGINE_VERSION = "unknown"


def default_device() -> str:
    if os.getenv("S6X_FORCE_CPU") == "1":
        return "cpu"
    import torch
    return "cuda" if torch.cuda.is_available() else "cpu"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="VieNeu-TTS preset-voice server")
    parser.add_argument("--host", default=os.getenv("VIENEU_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.getenv("VIENEU_PORT", "8124")))
    # Có CUDA thì luôn chạy GPU; chỉ máy không có CUDA mới tự về CPU.
    parser.add_argument("--device", choices=("auto", "cuda", "cpu"), default=os.getenv("VIENEU_DEVICE") or default_device())
    parser.add_argument("--precision", choices=("int8", "fp32"), default="int8")  # chỉ áp cho ONNX/CPU
    parser.add_argument("--threads", type=int, default=0)
    return parser.parse_args()


def json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


def load_legacy_voices(tts) -> int:
    """Nạp thêm giọng preset đã được giữ lại trong repo (assets/voices/legacy-voices.json).

    Bản 3.8.3 thay hẳn speaker_emb của Trúc Ly / Mai Anh / Xuân Vĩnh: cùng tên
    nhưng là giọng khác, nên video dựng bằng bản cũ không tái lập được nữa.
    File trong repo giữ lại bản 3.3.0 dưới tên "<tên> cũ". Cách nạp bám đúng
    hình dạng dict mà Vieneu._load_v3_voices dựng ra, nên không phụ thuộc vào
    một API riêng nào của engine.
    """
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "assets", "voices", "legacy-voices.json")
    if not os.path.isfile(path):
        return 0
    try:
        from vieneu_utils.core_utils import strip_encoder_pad_frame
    except Exception:
        strip_encoder_pad_frame = lambda codes: codes  # noqa: E731

    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)

    added = 0
    for name, v in data.get("presets", {}).items():
        emb = v.get("speaker_emb")
        if emb is None:
            continue
        codes = v.get("codes")
        tts._preset_voices[name] = {
            "description": v.get("description", ""),
            "gender": v.get("gender", ""),
            "style": v.get("style", tts.default_style),
            "featured": None,
            "aliases": [],
            "speaker_emb": np.asarray(emb, dtype=np.float32),
            "codes": strip_encoder_pad_frame(np.asarray(codes, dtype=np.int64)) if codes is not None else None,
        }
        added += 1
    if added:
        print(f"Loaded {added} legacy voice(s) from assets/voices/legacy-voices.json", flush=True)
    return added


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

    args = parse_args()
    print(f"Loading VieNeu-TTS v3 Turbo (device={args.device})...", flush=True)
    tts = Vieneu(
        mode="v3turbo",
        device=args.device,
        backend="onnx" if args.device == "cpu" else "auto",  # auto: CUDA → PyTorch, không có CUDA → ONNX
        precision=args.precision,
        threads=args.threads,
    )
    load_legacy_voices(tts)
    voice_options = tts.list_preset_voices()
    voices = [voice_id for _, voice_id in voice_options]
    styles = ("tu_nhien", "tin_tuc", "doc_truyen")

    inference_lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        server_version = "VieNeuPresetVoice/2.0"

        def send_json(self, status: int, value: object) -> None:
            body = json_bytes(value)
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self) -> None:
            if self.path == "/health":
                self.send_json(
                    200,
                    {
                        "status": "ready",
                        "engine": "VieNeu-TTS v3 Turbo",
                        "engineVersion": ENGINE_VERSION,
                        "backend": tts.backend,
                        "precision": args.precision if tts.backend == "onnx" else "torch",
                        "voices": len(voices),
                        "styles": styles,
                        "sampling": "seeded-v1",
                        "sampleRate": tts.sample_rate,
                    },
                )
                return
            if self.path == "/voices":
                self.send_json(
                    200,
                    {
                        "voices": [
                            {"id": voice_id, "label": label}
                            for label, voice_id in voice_options
                        ],
                        "styles": styles,
                    },
                )
                return
            self.send_json(404, {"error": "Not found"})

        def do_POST(self) -> None:
            if self.path != "/synthesize":
                self.send_json(404, {"error": "Not found"})
                return
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
                if content_length <= 0 or content_length > 100_000:
                    self.send_json(400, {"error": "Invalid request size"})
                    return
                payload = json.loads(self.rfile.read(content_length))
                text = str(payload.get("text", "")).strip()
                voice = str(payload.get("voice", "")).strip()
                style = str(payload.get("style", "")).strip()
                if not text:
                    self.send_json(400, {"error": "text is required"})
                    return
                if voice not in voices:
                    self.send_json(
                        400,
                        {"error": "Unknown voice", "availableVoices": voices},
                    )
                    return
                if style not in styles:
                    self.send_json(
                        400,
                        {"error": "Unknown style", "availableStyles": styles},
                    )
                    return

                # Reset NumPy's sampler for every request. The seed is stable for
                # one voice/style pair, preserving natural preset output while
                # making repeated renders bit-identical.
                seed = int.from_bytes(
                    hashlib.sha256(f"{voice}\0{style}\0v1".encode("utf-8")).digest()[:4],
                    "big",
                )
                with inference_lock:
                    np.random.seed(seed)
                    audio = tts.infer(
                        text,
                        voice=voice,
                        style=style,
                        temperature=0.8,
                        top_k=25,
                        top_p=0.95,
                        repetition_penalty=1.2,
                        apply_watermark=True,
                    )
                output = io.BytesIO()
                sf.write(output, audio, tts.sample_rate, format="WAV", subtype="PCM_16")
                body = output.getvalue()
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as error:
                self.send_json(500, {"error": str(error)})

        def log_message(self, fmt: str, *values: object) -> None:
            print(f"{self.address_string()} - {fmt % values}", flush=True)

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(
        f"VieNeu ready at http://{args.host}:{args.port} "
        f"({len(voices)} preset voices, sampling=seeded-v1)",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
