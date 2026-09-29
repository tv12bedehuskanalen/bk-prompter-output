#!/bin/bash
set -euo pipefail

sleep 4

# Keep the desktop hidden while Chromium starts or restarts.
pkill -x wf-panel-pi 2>/dev/null || true
pkill -x swaybg 2>/dev/null || true
nohup swaybg -c '#000000' >/dev/null 2>&1 &

exec "$HOME/bk-prompter/kiosk-watcher.sh"
