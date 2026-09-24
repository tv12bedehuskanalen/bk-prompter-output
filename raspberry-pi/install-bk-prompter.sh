#!/bin/bash
# Install the BK Prompter kiosk layer on Raspberry Pi OS Desktop (64-bit).
set -euo pipefail

if [[ ${EUID:-} -ne 0 ]]; then
  echo "Run with sudo: sudo bash install-bk-prompter.sh --user <Pi-user>"
  exit 1
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
TARGET_USER=""
DEFAULT_URL="http://10.144.144.162:7890/output"
RESOLUTION=""

usage() {
  cat <<'EOF'
Usage: sudo bash install-bk-prompter.sh --user USER [options]

Options:
  --url URL                  Initial URL shown by Chromium.
  --resolution WIDTHxHEIGHT  Optional default display mode, e.g. 1920x1080@60Hz.
  --user USER                Existing Raspberry Pi OS Desktop user to configure.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) TARGET_USER=${2:?}; shift 2 ;;
    --url) DEFAULT_URL=${2:?}; shift 2 ;;
    --resolution) RESOLUTION=${2:?}; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1"; usage; exit 2 ;;
  esac
done

[[ -n "$TARGET_USER" ]] || { usage; exit 2; }
id "$TARGET_USER" >/dev/null
TARGET_HOME=$(getent passwd "$TARGET_USER" | cut -d: -f6)
[[ -d "$TARGET_HOME" ]] || { echo "Home directory missing for $TARGET_USER"; exit 1; }

for required in app.py VERSION update-bk-prompter.sh launch-kiosk.sh kiosk-watcher.sh bk-kiosk-http.socket bk-kiosk-http.service templates/index.html; do
  [[ -f "$SCRIPT_DIR/$required" ]] || { echo "Installer is missing $required"; exit 1; }
done

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y chromium python3-flask inotify-tools unclutter kanshi

INSTALL_DIR="$TARGET_HOME/bk-prompter"
install -d -o "$TARGET_USER" -g "$TARGET_USER" -m 0755 "$INSTALL_DIR/templates"
install -o "$TARGET_USER" -g "$TARGET_USER" -m 0644 "$SCRIPT_DIR/app.py" "$INSTALL_DIR/app.py"
install -o "$TARGET_USER" -g "$TARGET_USER" -m 0644 "$SCRIPT_DIR/VERSION" "$INSTALL_DIR/VERSION"
install -o "$TARGET_USER" -g "$TARGET_USER" -m 0755 "$SCRIPT_DIR/update-bk-prompter.sh" "$INSTALL_DIR/update-bk-prompter.sh"
install -o "$TARGET_USER" -g "$TARGET_USER" -m 0644 "$SCRIPT_DIR/templates/index.html" "$INSTALL_DIR/templates/index.html"
install -o "$TARGET_USER" -g "$TARGET_USER" -m 0755 "$SCRIPT_DIR/launch-kiosk.sh" "$INSTALL_DIR/launch-kiosk.sh"
install -o "$TARGET_USER" -g "$TARGET_USER" -m 0755 "$SCRIPT_DIR/kiosk-watcher.sh" "$INSTALL_DIR/kiosk-watcher.sh"

if [[ ! -s "$TARGET_HOME/prompter_url.txt" ]]; then
  printf '%s\n' "$DEFAULT_URL" > "$TARGET_HOME/prompter_url.txt"
  chown "$TARGET_USER:$TARGET_USER" "$TARGET_HOME/prompter_url.txt"
fi

install -d -o "$TARGET_USER" -g "$TARGET_USER" -m 0755 "$TARGET_HOME/.config/labwc"
AUTOSTART="$TARGET_HOME/.config/labwc/autostart"
touch "$AUTOSTART"
chown "$TARGET_USER:$TARGET_USER" "$AUTOSTART"
sed -i '\|bk-prompter/launch-kiosk.sh|d; \|unclutter -idle 0.1|d' "$AUTOSTART"
printf '%s\n' \
  '"$HOME"/bk-prompter/launch-kiosk.sh &' \
  'sleep 5 && unclutter -idle 0.1 &' >> "$AUTOSTART"
chown "$TARGET_USER:$TARGET_USER" "$AUTOSTART"

if [[ -n "$RESOLUTION" ]]; then
  install -d -o "$TARGET_USER" -g "$TARGET_USER" -m 0755 "$TARGET_HOME/.config/kanshi"
  cat > "$TARGET_HOME/.config/kanshi/config" <<EOF
profile bk-prompter {
    output * enable mode $RESOLUTION position 0,0 scale 1
}
EOF
  chown "$TARGET_USER:$TARGET_USER" "$TARGET_HOME/.config/kanshi/config"
fi

install -m 0644 "$SCRIPT_DIR/bk-kiosk-http.socket" /etc/systemd/system/bk-kiosk-http.socket
install -m 0644 "$SCRIPT_DIR/bk-kiosk-http.service" /etc/systemd/system/bk-kiosk-http.service
install -m 0440 /dev/stdin /etc/sudoers.d/bk-prompter-reboot <<EOF
$TARGET_USER ALL=(root) NOPASSWD: /usr/bin/systemctl reboot, $INSTALL_DIR/update-bk-prompter.sh
EOF

systemctl daemon-reload
systemctl enable --now bk-kiosk-http.socket

echo
echo "BK Prompter installed for $TARGET_USER."
echo "Control page: http://$(hostname -I | awk '{print $1}')/"
echo "Restart the Pi to start Chromium in kiosk mode."
