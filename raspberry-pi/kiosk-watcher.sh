#!/bin/bash
set -euo pipefail

URL_FILE="$HOME/prompter_url.txt"
APP_DIR="$HOME/bk-prompter"
DEFAULT_URL="${BK_PROMPTER_DEFAULT_URL:-http://10.144.144.162:7890/output}"

if [[ ! -s "$URL_FILE" ]]; then
  printf '%s\n' "$DEFAULT_URL" > "$URL_FILE"
fi

cd "$APP_DIR"
/usr/bin/python3 app.py >> "$APP_DIR/webserver.log" 2>&1 &
WEB_PID=$!
trap 'kill "$WEB_PID" 2>/dev/null || true' EXIT

load_url() {
  local target_url
  target_url=$(<"$URL_FILE")
  pkill -x chromium 2>/dev/null || true
  chromium --kiosk --noerrdialogs --disable-infobars --no-first-run \
    --ozone-platform=wayland --enable-features=WebUIDarkMode --force-dark-mode \
    --password-store=basic "$target_url" &
}

load_url
while inotifywait --quiet -e close_write,move "$URL_FILE"; do
  load_url
done
