#!/bin/bash
set -euo pipefail
INSTALL_DIR=${BK_INSTALL_DIR:-$HOME/bk-prompter}
CONFIG="$INSTALL_DIR/updater.conf"
STATUS_FILE="$INSTALL_DIR/update-status"
[[ -r "$CONFIG" ]] && . "$CONFIG"
: "${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY in $CONFIG (owner/repository)}"
mkdir -p "$INSTALL_DIR"
echo "Checking for updates…" > "$STATUS_FILE"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
api="https://api.github.com/repos/$GITHUB_REPOSITORY/releases/latest"
curl_args=(-fsSL -H 'Accept: application/vnd.github+json')
[[ -n "${GITHUB_TOKEN:-}" ]] && curl_args+=(-H "Authorization: Bearer $GITHUB_TOKEN")
release=$(curl "${curl_args[@]}" "$api")
tag=$(printf '%s' "$release" | python3 -c 'import json,sys; print(json.load(sys.stdin)["tag_name"])')
current=$(tr -d 'v[:space:]' < "$INSTALL_DIR/VERSION" 2>/dev/null || true)
latest=${tag#v}
if [[ "$current" == "$latest" ]]; then echo "Already up to date ($tag)." > "$STATUS_FILE"; exit 0; fi
archive="$tmp/release.tar.gz"
curl "${curl_args[@]}" -L "https://github.com/$GITHUB_REPOSITORY/archive/refs/tags/$tag.tar.gz" -o "$archive"
mkdir "$tmp/extract"; tar -xzf "$archive" -C "$tmp/extract"
source=$(find "$tmp/extract" -path '*/raspberry-pi/app.py' -print -quit); source=${source%/app.py}
[[ -f "$source/VERSION" ]] || { echo "Release has no raspberry-pi payload." > "$STATUS_FILE"; exit 1; }
backup="$INSTALL_DIR.backup.$(date +%Y%m%d%H%M%S)"; cp -a "$INSTALL_DIR" "$backup"
install -m 0644 "$source/app.py" "$INSTALL_DIR/app.py"
install -m 0644 "$source/VERSION" "$INSTALL_DIR/VERSION"
install -m 0644 "$source/templates/index.html" "$INSTALL_DIR/templates/index.html"
install -m 0755 "$source/kiosk-watcher.sh" "$INSTALL_DIR/kiosk-watcher.sh"
install -m 0755 "$source/update-bk-prompter.sh" "$INSTALL_DIR/update-bk-prompter.sh"
pkill -x python3 2>/dev/null || true; sleep 1
nohup python3 "$INSTALL_DIR/app.py" >> "$INSTALL_DIR/webserver.log" 2>&1 &
sleep 2
curl -fsS http://127.0.0.1:8443/ >/dev/null || { cp -a "$backup"/. "$INSTALL_DIR"/; exit 1; }
echo "Updated from v$current to $tag." > "$STATUS_FILE"
