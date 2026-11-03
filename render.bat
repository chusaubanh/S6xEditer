@echo off
cd /d "%~dp0"
if "%~1"=="" (
  echo Cach dung: render.bat "ten tai lieu"
  exit /b 2
)
call npm run render -- %1
pause
