#!/bin/sh
# usage: shot.sh name w h hash
C="/c/Program Files/Google/Chrome/Application/chrome.exe"
D="$(cd "$(dirname "$0")" && pwd -W)"
"$C" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --virtual-time-budget=3000 --window-size=$2,$3 --screenshot="$D/screens/$1.png" "file:///$D/mockup.html#$4" >/dev/null 2>&1
