#!/bin/bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
CONFIG="$SCRIPT_DIR/updater.conf"
[[ -r "$CONFIG" ]] && . "$CONFIG"
INSTALL_DIR=${BK_INSTALL_DIR:-$SCRIPT_DIR}
STATUS_FILE="$INSTALL_DIR/update-status"
AVAILABLE_FILE="$INSTALL_DIR/update-available"
: "${GITHUB_REPOSITORY:?Set GITHUB_REPOSITORY in $CONFIG (owner/repository)}"
mkdir -p "$INSTALL_DIR"
echo "Checking for updates…" > "$STATUS_FILE"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
latest_url=$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$GITHUB_REPOSITORY/releases/latest")
tag=${latest_url##*/}
current=$(tr -d 'v[:space:]' < "$INSTALL_DIR/VERSION" 2>/dev/null || true)
latest=${tag#v}
if [[ "${1:-}" == "--check" ]]; then
  if [[ "$current" == "$latest" ]]; then rm -f "$AVAILABLE_FILE"; echo "Up to date ($tag)." > "$STATUS_FILE";
  else printf '%s\n' "$tag" > "$AVAILABLE_FILE"; echo "Update available: $tag." > "$STATUS_FILE"; fi
  exit 0
fi
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
install -d "$INSTALL_DIR/branding"
install -m 0644 "$source/branding/symbol.svg" "$INSTALL_DIR/branding/symbol.svg"
install -m 0755 "$source/kiosk-watcher.sh" "$INSTALL_DIR/kiosk-watcher.sh"
install -m 0755 "$source/update-bk-prompter.sh" "$INSTALL_DIR/update-bk-prompter.sh"
pkill -x python3 2>/dev/null || true; sleep 1
nohup python3 "$INSTALL_DIR/app.py" >> "$INSTALL_DIR/webserver.log" 2>&1 &
sleep 2
curl -fsS http://127.0.0.1:8443/ >/dev/null || { cp -a "$backup"/. "$INSTALL_DIR"/; exit 1; }
echo "Updated from v$current to $tag." > "$STATUS_FILE"
rm -f "$AVAILABLE_FILE"
