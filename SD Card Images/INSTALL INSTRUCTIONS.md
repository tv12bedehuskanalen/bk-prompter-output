# Make another kiosk SD card

1. Remove the original working SD card from the Mac. Insert the destination card.
2. Double-click **Install Kiosk SD Card.command** in this folder.
3. Enter your Mac password, then enter the hostname you want, such as `BK-AES-PROMPTER`.
4. Select the destination from the displayed external disks. Check its size and volume names. Type `ERASE` to confirm: **this erases that destination card**.
5. Wait for writing and verification to finish. The installer reports **SUCCESS** and ejects the card.
6. Put the card in the Pi and power on. It applies the hostname automatically, reboots once, then starts the existing kiosk. No keyboard or terminal commands are needed on the Pi.

Repeat with a different card and hostname. Keep the image, launcher and `installer` folder together. Internet access is not required for installation.

## What is preserved

The installer uses the complete `BK-AES-PROMPTER.img.xz` image: operating system, installed utilities, accounts, existing credentials, network configuration, saved URL, web server, startup scripts and Chromium profile. The master image is never modified.

The system changes on the new card are the hostname and its related configuration, plus a boot-enabled HTTP forwarding service so the existing web interface is accessible at `http://<Pi-address>/` as well as `http://<Pi-address>:8443/`. Both addresses use HTTP. A small first-boot helper is added to apply these changes automatically, including to the existing cloud-init cache. It does not reset cloud-init or rerun initial account provisioning.

Three copied Chromium process links are removed before the browser starts: `SingletonLock`, `SingletonSocket` and `SingletonCookie`. These are temporary process coordination links, not browser settings or website cookies. In the master image they refer to an old browser process, a temporary socket and a numeric token. The installer stops if these paths contain an unexpected file type or target. Browser preferences, bookmarks, cookies and extensions are not deleted.

This retains the image's other device identity settings, including existing SSH host keys. It is a faithful kiosk clone with a changed hostname, not a generalized OS image.

## Space and card size

The compressed master is about 2.6 GB (2.4 GiB). It is decompressed directly onto the card; the installer does not create a 32 GB file on the Mac.

Each destination must hold at least **31,266,439,168 bytes**, with 512-byte sectors. Some nominally 32 GB cards may be too small; the installer rejects them. Larger cards work, but this installer does not expand the Linux partition to use their extra capacity.

## Verification and first boot

Before writing, the installer verifies the master image against its recorded SHA-256 checksum. After writing, it reads back the full image from the destination and compares checksums. It then adds the hostname setup files, checks the boot instructions and ejects the card.

The installer and hostname conversion passed automated tests, including tests against files extracted from this actual image. The kiosk scripts, web app, saved URL, browser preferences and bookmarks were unchanged in that test. The original card has now booted successfully as BK-AES-PROMPTER, including the hostname setup and kiosk startup. A complete write to a spare card using this launcher has **not yet been tested**. Test the first new card before making a batch.

Hostname changes can still be made before the first Pi boot: reconnect the new card to the Mac, edit `hostname.txt` on its bootfs volume as plain text, then eject it. Use 1–63 letters, numbers or hyphens, starting and ending with a letter or number. This file is read by the newly installed helper; it is not a stock Raspberry Pi OS feature. After successful setup, the helper disarms itself, so later edits to that file do not automatically rename a running installation.

## If something goes wrong

- **Operation not permitted:** allow Terminal access to removable volumes in macOS System Settings → Privacy & Security → Files and Folders, if offered. If required, allow Terminal Full Disk Access, then quit and reopen Terminal.
- **Master checksum mismatch:** stop. The image may be incomplete or changed. This installer is pinned to the verified master supplied with it.
- **Write or read-back failure:** do not boot that card. Rerun the installer, or try another card/reader.
- **First Pi boot stops:** shut the Pi down before removing the card. Reconnect it to the Mac and inspect `bk-first-boot.log` on bootfs. A successful setup also writes `bk-setup-complete.txt` with the applied hostname. If setup failed, its first-boot action remains armed for retry. The original boot command line is saved as `bk-original-cmdline.txt` for recovery; restoring it bypasses setup but does not undo any hostname changes already applied.

## Technical basis

The one-time setup uses systemd's supported `systemd.run` kernel command-line mechanism, before the normal graphical kiosk target, followed by an automatic reboot. The inspected image has `/boot/firmware`, Python 3 and `systemd-run-generator` in place.

- [systemd run generator documentation](https://github.com/systemd/systemd/blob/main/man/systemd-run-generator.xml)
- [Chromium process-singleton implementation](https://chromium.googlesource.com/chromium/src/+/8c3eb804c56b7173f00e58e040f47fe867dabda7/chrome/browser/process_singleton_posix.cc)

The temporary tools used to inspect the Linux filesystem are not required to run this installer. It uses Python 3, already installed on this Mac, and built-in macOS disk tools.

## Live Pi verification — 24 September 2026

The AES Pi booted with hostname `BK-AES-PROMPTER`; its first-boot setup completed and its kiosk and web app started. The original app serves HTTP on port 8443 (not HTTPS). Port 80 forwarding was installed on that Pi and enabled at boot. The control page was verified remotely from the Mac on both ports. This forwarding change is now included in the installer for new cards; the compressed master remains unchanged.
