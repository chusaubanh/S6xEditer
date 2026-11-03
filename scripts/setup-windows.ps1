# Cài pipeline lên máy Windows mới: npm run setup
# Chế độ C cài riêng bằng npm run th:setup vì cần NVIDIA.
[CmdletBinding()]
param([switch]$SkipValidation)

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
Set-Location -LiteralPath $root

function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }

function Require-Tool([string]$Name, [string]$WingetId) {
    if (Get-Command $Name -ErrorAction SilentlyContinue) { return }
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw "Thiếu $Name. Cài $WingetId rồi chạy lại." }
    & winget install --id $WingetId --exact --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "winget không cài được $WingetId." }
    Refresh-Path
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "Đã cài $WingetId nhưng chưa thấy $Name. Mở lại PowerShell rồi chạy lại." }
}

Write-Host "[1/4] Công cụ hệ thống"
Require-Tool "ffmpeg.exe" "Gyan.FFmpeg"
Require-Tool "uv.exe" "astral-sh.uv"

Write-Host "[2/4] Thư viện Node"
& npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw "npm ci thất bại." }

Write-Host "[3/4] Môi trường giọng đọc VieNeu"
& uv.exe venv .venv-vieneu --python 3.12 --allow-existing
if ($LASTEXITCODE -ne 0) { throw "Không tạo được .venv-vieneu." }
& uv.exe pip install --python .venv-vieneu/Scripts/python.exe -r requirements-vieneu.lock.txt --index-strategy unsafe-best-match --extra-index-url https://download.pytorch.org/whl/cu128
if ($LASTEXITCODE -ne 0) { throw "Không cài được VieNeu." }

Write-Host "[4/4] Cấu hình máy"
if (-not (Test-Path -LiteralPath ".env.local")) {
    "VIENEU_ENDPOINT=http://127.0.0.1:8124" | Set-Content -LiteralPath ".env.local" -Encoding ascii
}

if (-not $SkipValidation) {
    & powershell -ExecutionPolicy Bypass -File "scripts\doctor.ps1"
    if ($LASTEXITCODE -ne 0) { throw "Cài xong nhưng kiểm tra máy chưa đạt." }
}
Write-Host "Xong. Xem docs/QUY-TRINH.md để làm video đầu tiên."
