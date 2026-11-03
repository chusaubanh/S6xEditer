$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$projects = @(Get-ChildItem -Path (Join-Path $repo 'output') -Directory -Recurse |
  Where-Object { Test-Path (Join-Path $_.FullName 'studio\project.json') })

Write-Host ''
Write-Host '========================================'
Write-Host '       S6X STUDIO - CHON PROJECT'
Write-Host '========================================'
if ($projects.Count -eq 0) {
  Write-Host 'Chua co project nao duoc package vao Studio.' -ForegroundColor Yellow
  Read-Host 'Nhan Enter de dong'
  exit 1
}

for ($i = 0; $i -lt $projects.Count; $i++) {
  Write-Host "[$($i + 1)] $($projects[$i].FullName)"
}

$choice = Read-Host 'Nhap so project'
$number = 0
if (-not [int]::TryParse($choice, [ref]$number) -or $number -lt 1 -or $number -gt $projects.Count) {
  Write-Host 'Lua chon khong hop le.' -ForegroundColor Red
  Read-Host 'Nhan Enter de dong'
  exit 1
}

$job = $projects[$number - 1].FullName
Write-Host "Dang mo: $job" -ForegroundColor Cyan
$port = 4319
if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { $port = 4319 }
Write-Host "Studio se chay tai http://127.0.0.1:$port" -ForegroundColor DarkGray
Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', "cd /d `"$repo`" && npm run editor -- `"$job`" --port $port"
Start-Sleep -Seconds 3
Start-Process "http://127.0.0.1:$port/"
