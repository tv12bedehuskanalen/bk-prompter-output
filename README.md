# BK Prompter Output

Raspberry Pi kiosk control page for the BK Prompter output system.

The deployable files are in `raspberry-pi/`. The current release is recorded in `raspberry-pi/VERSION`.

## Install on Raspberry Pi OS

Use Raspberry Pi Imager to install the current Raspberry Pi OS Desktop (64-bit) image. Configure the user, hostname, network and SSH before first boot.

From this project folder on the Mac, copy and run the installer (replace `PI_ADDRESS` and the output URL as needed):

```bash
scp -r raspberry-pi bkadmin@PI_ADDRESS:/tmp/
ssh -t bkadmin@PI_ADDRESS 'sudo bash /tmp/raspberry-pi/install-bk-prompter.sh --user bkadmin --url http://10.144.144.162:7890/output --resolution 1920x1080@60Hz'
```

The installer installs Chromium, Flask, `inotify-tools`, `unclutter` and the kiosk service. Restart the Pi when it finishes. The control page is then available at `http://PI_ADDRESS/`.

At graphical login, the kiosk watcher runs the local Flask control page, opens Chromium at the saved output URL and reloads Chromium when that URL changes. The URL is stored in `prompter_url.txt` in the user's home folder.

The page derives its initial label from the first two hostname parts (`BK-AES-PROMPTER` becomes **BK AES**), while the title can be edited and saved. The footer shows the installed release version.

Re-running the installer refreshes the kiosk files while preserving the existing output URL.
