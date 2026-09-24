#!/bin/bash
set -euo pipefail
mount -o remount,rw /
mount -o remount,rw /boot/firmware
exec >> /boot/firmware/bk-first-boot.log 2>&1
echo "Starting kiosk hostname setup: $(date -Is)"
/usr/bin/python3 /boot/firmware/bk-first-boot.py
