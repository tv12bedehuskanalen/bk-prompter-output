# BK Prompter kiosk installer

This replaces SD-card cloning. It installs the small kiosk layer on an already configured Raspberry Pi OS Desktop card.

The running AES unit uses **Raspberry Pi OS Desktop (64-bit)** based on Debian 13/Trixie. In Raspberry Pi Imager, choose the current **Raspberry Pi OS (64-bit)** desktop image, not Lite. Configure a user, hostname, network and SSH in Imager before its first boot.

## Install from the Mac

With the Pi booted and reachable, run these from this project folder. Replace the hostname and URL as required:

```bash
scp -r raspberry-pi bkadmin@PI_ADDRESS:/tmp/
ssh -t bkadmin@PI_ADDRESS 'sudo bash /tmp/raspberry-pi/install-bk-prompter.sh --user bkadmin --url http://10.144.144.162:7890/output --resolution 1920x1080@60Hz'
```

The installer asks for the Pi user's password to install four packages: Chromium, Flask, `inotify-tools`, `unclutter`, plus `kanshi` when the optional display profile is used. Then restart the Pi.

## Result

At every graphical login, the user’s Labwc session starts a small watcher. It runs the Flask control page locally, opens Chromium in kiosk mode at the saved URL, and reloads Chromium whenever that URL changes.

The control page is available at `http://PI_ADDRESS/`. It uses the first two hyphen-separated parts of the hostname for its label: `BK-AES-PROMPTER` becomes **BK AES**, `BK-OSL-PROMPTER` becomes **BK OSL**. The page uses the same dark teal BK Prompter design language as the main application.

The footer displays the deployed kiosk version as `v1.0.0 // © Bedehuskanalen 2026`. To publish a new kiosk version, update `raspberry-pi/VERSION`, deploy the folder again, and restart the control app. The displayed value comes from the installed `VERSION` file, so it identifies what is actually deployed on that Pi.

The installer creates a port-80 system service which forwards to the local Flask page on port 8443. It also grants that Pi user permission to reboot only through `systemctl reboot`, so the page's reboot control works without a password prompt.

To change the output after deployment, open the control page from a phone or computer on the same network. The `prompter_url.txt` file in the user’s home folder is the only state the kiosk needs.

## Notes

Use `--resolution` only with displays that report that mode. Omit it to retain the display’s normal preferred resolution. The supplied 1080p profile targets the connected output generically; the existing AES Pi has its output locked to 1920x1080 at 60 Hz separately.

Re-running the installer refreshes the kiosk scripts and page but preserves an existing `prompter_url.txt`.
