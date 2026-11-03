# Kiểm tra máy: npm run doctor. Thêm -RunTests để chạy cả test.
[CmdletBinding()]
param([switch]$RunTests)

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = "Continue"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Set-Location -LiteralPath $root
$failures = 0
function Pass([string]$m) { Write-Host "[ĐẠT] $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "[LƯU Ý] $m" -ForegroundColor Yellow }
function Fail([string]$m) { $script:failures += 1; Write-Host "[LỖI] $m" -ForegroundColor Red }

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if ($node -and [int]((& $node.Source --version).TrimStart("v").Split(".")[0]) -ge 22) { Pass "Node $(& $node.Source --version)" } else { Fail "Cần Node 22 trở lên" }
foreach ($tool in "ffmpeg.exe", "ffprobe.exe", "uv.exe") { if (Get-Command $tool -ErrorAction SilentlyContinue) { Pass $tool } else { Fail "Thiếu $tool trong PATH" } }
if (Test-Path -LiteralPath "node_modules\tsx") { Pass "Thư viện Node" } else { Fail "Chưa cài thư viện Node: npm run setup" }

$vieneu = Join-Path $root ".venv-vieneu\Scripts\python.exe"
if (Test-Path -LiteralPath $vieneu) {
    & $vieneu -c "import vieneu" 2>$null
    if ($LASTEXITCODE -eq 0) { Pass "VieNeu" } else { Fail "VieNeu không chạy được" }
} else { Fail "Thiếu .venv-vieneu: npm run setup" }

$gpu = $false
if (Get-Command nvidia-smi.exe -ErrorAction SilentlyContinue) {
    $name = & nvidia-smi.exe --query-gpu=name,driver_version --format=csv,noheader 2>$null
    $encoders = & ffmpeg.exe -hide_banner -encoders 2>$null | Out-String
    if ($LASTEXITCODE -eq 0 -and $encoders -match "h264_nvenc") { $gpu = $true; Pass "Chế độ GPU: $name" }
}
if (-not $gpu) { Warn "Chế độ CPU: không dùng được NVENC. Vẫn làm được video từ tài liệu nhưng chậm hơn nhiều." }

$asr = Join-Path $root ".venv-asr\Scripts\python.exe"
if (Test-Path -LiteralPath $asr) {
    & $asr "scripts\asr\check_env.py" *> $null
    if ($LASTEXITCODE -eq 0) { Pass "Chế độ C: phiên âm chạy được trên GPU" } else { Warn "Chế độ C: kiểm tra CUDA thất bại" }
} else { Warn "Chế độ C chưa cài. Cần NVIDIA: npm run th:setup" }

$free = (Get-Item -LiteralPath $root).PSDrive.Free / 1GB
if ($free -ge 30) { Pass ("Ổ đĩa còn {0:N0} GB" -f $free) } else { Warn ("Ổ đĩa còn {0:N0} GB; nên có từ 30 GB" -f $free) }

Warn "Remotion cần Company License nếu đơn vị vì lợi nhuận có trên 3 nhân viên: https://www.remotion.dev/license"

if ($RunTests) {
    & npm.cmd test; if ($LASTEXITCODE -eq 0) { Pass "Test" } else { Fail "Test lỗi" }
    & npm.cmd run typecheck; if ($LASTEXITCODE -eq 0) { Pass "Kiểm kiểu" } else { Fail "Kiểm kiểu lỗi" }
}

if ($failures -gt 0) { Write-Host "Còn $failures lỗi cần sửa." -ForegroundColor Red; exit 1 }
Write-Host "Máy đã sẵn sàng." -ForegroundColor Green
