# Cài môi trường ASR cho Chế độ C (.venv-asr): PyTorch CUDA + WhisperX + DeepFilterNet + Silero VAD.
# Không đụng .venv-vieneu. Chạy: npm run th:setup
[CmdletBinding()]
param([switch]$Force)

$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Set-Location -LiteralPath $root


# --- Chọn bản CUDA hợp driver (driver mới chạy được cu124; driver cũ < 525 thì cu121) ---
$cuTag = "cu124"
$smi = Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue
if (-not $smi) { throw "Không thấy nvidia-smi: cần driver NVIDIA để chạy Chế độ C." }
$drv = (& $smi.Source --query-gpu=driver_version --format=csv,noheader | Select-Object -First 1).Trim()
Write-Host "Driver NVIDIA: $drv"
if ([double]($drv.Split(".")[0]) -lt 550) { throw "Driver NVIDIA $drv quá cũ: cần 550 trở lên." }
Write-Host "PyTorch index: $cuTag"

# --- Tạo venv: ưu tiên py -3.11, rồi py -3.12, cuối cùng uv (tự tải Python 3.11) ---
$venvDir = Join-Path $root ".venv-asr"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
if ((Test-Path -LiteralPath $venvPython) -and -not $Force) {
    Write-Host ".venv-asr đã có, dùng lại (thêm -Force để tạo lại)."
} else {
    if (Test-Path -LiteralPath $venvDir) { Remove-Item -Recurse -Force -LiteralPath $venvDir }
    $created = $false
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) {
        $list = (& $py.Source -0p 2>&1 | Out-String)
        foreach ($v in @("3.11", "3.12")) {
            if (-not $created -and ($list -match "3.$($v.Split(".")[1])")) {
                & $py.Source "-$v" -m venv $venvDir
                if ($LASTEXITCODE -eq 0) { $created = $true; Write-Host "venv từ py -$v" }
            }
        }
    }
    if (-not $created) {
        $uv = Get-Command uv.exe -ErrorAction SilentlyContinue
        if (-not $uv) { throw "Không có py -3.11/3.12 và không có uv. Cài Python 3.11 (winget install Python.Python.3.11)." }
        & $uv.Source venv --seed --python 3.11 $venvDir
        if ($LASTEXITCODE -ne 0) { throw "uv venv thất bại." }
        Write-Host "venv từ uv (Python 3.11)"
    }
}

function Pip { & $venvPython -m pip --disable-pip-version-check @args; if ($LASTEXITCODE -ne 0) { throw "pip $($args -join ' ') thất bại." } }

Pip install --upgrade pip
# Cài đúng các phiên bản đã chạy tốt; không tự giải dependency vì transformers 5.x và ctranslate2 <4.5 làm hỏng căn từ.
Pip install -r (Join-Path $root "requirements-asr.lock.txt") --no-deps --extra-index-url "https://download.pytorch.org/whl/$cuTag"

# --- Kiểm tra ---
$check = Join-Path $root "scripts\asr\check_env.py"
& $venvPython $check
if ($LASTEXITCODE -ne 0) { throw "Kiểm tra môi trường ASR thất bại." }

Write-Host "Xong."
