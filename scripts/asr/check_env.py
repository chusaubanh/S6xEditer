"""Kiểm tra .venv-asr: torch thấy CUDA, ctranslate2 thấy CUDA."""
import sys
sys.path.insert(0, __file__.rsplit("\\", 1)[0] if "\\" in __file__ else ".")
from _common import setup_env
setup_env()
import torch, ctranslate2, whisperx  # noqa: F401
print("torch", torch.__version__, "cuda", torch.version.cuda, "available", torch.cuda.is_available())
n = ctranslate2.get_cuda_device_count()
print("ctranslate2", ctranslate2.__version__, "cuda devices", n)
ok = torch.cuda.is_available() and n > 0
print("OK" if ok else "FAIL")
sys.exit(0 if ok else 1)
