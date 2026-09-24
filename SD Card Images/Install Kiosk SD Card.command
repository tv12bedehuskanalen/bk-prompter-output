#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
PYTHON=$(command -v python3 || true)
if [[ -z "$PYTHON" ]]; then
  for candidate in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
    if [[ -x "$candidate" ]]; then PYTHON="$candidate"; break; fi
  done
fi
if [[ -z "$PYTHON" ]]; then
  echo 'Python 3 is required. It is already installed on the Mac this installer was prepared on.'
  read -r -p 'Press Return to close. ' unused
  exit 1
fi
echo 'Your Mac password is required to write the destination SD card.'
status=0
sudo "$PYTHON" "$PWD/installer/install.py" || status=$?
echo
read -r -p 'Press Return to close. ' unused
exit "$status"
