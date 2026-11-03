"""Giảm ồn bằng DeepFilterNet3 (GPU). Dùng cho `npm run th:audio`.

Dùng: denoise.py --in audio-raw.wav --out audio-denoised.wav   (wav 48 kHz mono)
"""
import argparse
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import MODELS, free_vram, setup_env  # noqa: E402

setup_env()


def patch_torchaudio() -> None:
    """deepfilternet 0.5.x import torchaudio.backend.common.AudioMetaData, đã bị gỡ ở torchaudio >= 2.1."""
    try:
        import torchaudio.backend.common  # noqa: F401
        return
    except Exception:  # noqa: BLE001
        pass
    import torchaudio

    backend = types.ModuleType("torchaudio.backend")
    common = types.ModuleType("torchaudio.backend.common")

    class AudioMetaData:  # chỉ cần tên để import; df không dùng thật
        pass

    common.AudioMetaData = AudioMetaData
    backend.common = common
    sys.modules["torchaudio.backend"] = backend
    sys.modules["torchaudio.backend.common"] = common
    torchaudio.backend = backend


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", dest="dst", required=True)
    a = ap.parse_args()

    patch_torchaudio()
    import soundfile as sf
    import torch
    from df.enhance import enhance, init_df

    # cache model DeepFilterNet3 trong models\ của repo (lần đầu: tải rồi chép từ cache mặc định của df)
    local = MODELS / "deepfilternet" / "DeepFilterNet3"
    if not local.exists():
        import shutil
        from df.enhance import maybe_download_model

        local.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(maybe_download_model("DeepFilterNet3"), local)
    model, df_state, _ = init_df(model_base_dir=str(local), log_file=None)  # tự dùng CUDA nếu có
    sr = df_state.sr()
    data, file_sr = sf.read(a.src, dtype="float32", always_2d=True)
    if file_sr != sr:
        raise SystemExit(f"Cần wav {sr} Hz, nhận {file_sr}")
    audio = torch.from_numpy(data.T.copy())  # [kênh, mẫu]
    # cuDNN GRU không chạy nổi chuỗi quá dài (file nguồn cả buổi): xử lý từng đoạn 30 s, mỗi đầu thêm 1 s ngữ cảnh rồi bỏ phần thêm
    n = audio.shape[1]
    chunk, ctx = 30 * sr, 1 * sr
    if n <= chunk + 2 * ctx:
        out = enhance(model, df_state, audio)
    else:
        parts = []
        for s0 in range(0, n, chunk):
            lo, hi = max(0, s0 - ctx), min(n, s0 + chunk + ctx)
            y = enhance(model, df_state, audio[:, lo:hi])
            parts.append(y[:, s0 - lo : s0 - lo + min(chunk, n - s0)])
        out = torch.cat(parts, dim=1)
    sf.write(a.dst, out.cpu().numpy().T, sr, subtype="PCM_16")
    del model
    free_vram()
    print(f"[denoise] {a.dst}", flush=True)


if __name__ == "__main__":
    main()
