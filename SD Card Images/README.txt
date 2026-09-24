TO MAKE A NEW KIOSK CARD:
Double-click Install Kiosk SD Card.command.
It asks for a destination card and hostname, writes and verifies the complete
compressed image, and installs automatic hostname setup for the first Pi boot.

Read INSTALL INSTRUCTIONS.md for details, verification status and troubleshooting.
No 32 GB temporary image is created on the Mac.
The destination must have at least 31,266,439,168 bytes of capacity.

Create Kiosk Backup.command is the older launcher for capturing a fresh backup;
it is not needed to make copies of the completed image already in this folder.

BK-AES-PROMPTER.img.xz is the completed master image (about 2.6 GB).
failed-empty-backup.xz and backup.log are leftovers from the first failed
in-app backup attempt; they are not used by the installer.
