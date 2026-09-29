#!/bin/bash
set -euo pipefail

REPOSITORY="tv12bedehuskanalen/bk-prompter-output"
TARGET_USER=""
DEFAULT_URL="http://10.144.144.162:7890/output"
RESOLUTION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --user) TARGET_USER=${2:?}; shift 2 ;;
    --url) DEFAULT_URL=${2:?}; shift 2 ;;
    --resolution) RESOLUTION=${2:?}; shift 2 ;;
    *) echo "Unknown option: $1"; exit 2 ;;
  esac
done
if [[ -z "$TARGET_USER" ]]; then
  TARGET_USER="${SUDO_USER:-${USER:-}}"
fi
[[ -n "$TARGET_USER" ]] || { echo "Could not determine the Pi user; pass --user USER"; exit 2; }

latest_url=$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$REPOSITORY/releases/latest")
tag=${latest_url##*/}
workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT
archive="$workdir/release.tar.gz"
curl -fsSL "https://github.com/$REPOSITORY/archive/refs/tags/$tag.tar.gz" -o "$archive"
tar -xzf "$archive" -C "$workdir"
source=$(find "$workdir" -path '*/raspberry-pi/install-bk-prompter.sh' -print -quit)
[[ -n "$source" ]] || { echo "Release has no Raspberry Pi installer."; exit 1; }
script_dir=${source%/install-bk-prompter.sh}
args=(--user "$TARGET_USER" --url "$DEFAULT_URL")
[[ -n "$RESOLUTION" ]] && args+=(--resolution "$RESOLUTION")
if [[ ${EUID:-} -eq 0 ]]; then
  bash "$script_dir/install-bk-prompter.sh" "${args[@]}"
else
  sudo bash "$script_dir/install-bk-prompter.sh" "${args[@]}"
fi
