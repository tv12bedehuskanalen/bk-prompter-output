#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
DEST="$PWD/BK-AES-PROMPTER.img.xz"
if [[ -e "$DEST" || -e "$DEST.partial" ]]; then
  echo 'A backup or unfinished backup already exists. Rename it before making another.'
  exit 1
fi
INFO=$(/usr/sbin/diskutil info -plist /Volumes/bootfs)
DISK=$(printf '%s' "$INFO" | /usr/bin/plutil -extract ParentWholeDisk raw -o - -)
[[ "$DISK" =~ ^disk[0-9]+$ ]] || exit 1
/usr/sbin/diskutil info "/dev/$DISK"
echo 'Creating a compressed backup. The source card will only be read.'
sudo -v
/usr/sbin/diskutil unmountDisk "/dev/$DISK"
trap '/usr/sbin/diskutil mountDisk "/dev/$DISK" >/dev/null || true' EXIT
sudo /bin/dd if="/dev/r$DISK" bs=4m | /opt/homebrew/bin/xz -T2 -1 -c > "$DEST.partial"
echo 'Checking compressed image integrity…'
/opt/homebrew/bin/xz -t "$DEST.partial"
mv "$DEST.partial" "$DEST"
/usr/bin/shasum -a 256 "$DEST" > "$DEST.sha256"
echo "Backup complete: $DEST"
/bin/ls -lh "$DEST"
