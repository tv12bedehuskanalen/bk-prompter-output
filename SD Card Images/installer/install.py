#!/usr/bin/env python3
"""Interactive macOS writer for this verified kiosk master image."""
import hashlib
from contextlib import contextmanager
import lzma
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import time

from first_boot import TOKENS, update_cloud_text, validate_hostname

BASE = Path(__file__).resolve().parent.parent
IMAGE = BASE / 'BK-AES-PROMPTER.img.xz'
IMAGE_SIZE = 31266439168
IMAGE_SHA256 = 'd4b4b7515d93d84310df33509a7b7a355af660e3e31cab64fda9fb0eb2b99a9a'
CHUNK = 4 * 1024 * 1024


def diskutil(*args):
    result = subprocess.run(['/usr/sbin/diskutil', *args], check=True, capture_output=True)
    return plistlib.loads(result.stdout)


def run(*args):
    subprocess.run(args, check=True)


def eligible(info):
    return (info.get('Internal') is False and info.get('WholeDisk') is True
            and info.get('VirtualOrPhysical') == 'Physical'
            and info.get('WritableMedia') is True
            and info.get('DeviceBlockSize') == 512
            and info.get('TotalSize', 0) >= IMAGE_SIZE
            and re.fullmatch(r'disk[0-9]+', info.get('DeviceIdentifier', '')) is not None)


def fingerprint(info):
    return tuple(info.get(k) for k in ('DeviceIdentifier', 'DeviceTreePath', 'MediaName', 'TotalSize', 'DeviceBlockSize'))


@contextmanager
def open_destination(disk, selected):
    # macOS may refuse raw write access while any partition is mounted.
    run('/usr/sbin/diskutil', 'unmountDisk', '/dev/' + disk)
    if fingerprint(diskutil('info', '-plist', disk)) != fingerprint(selected):
        raise RuntimeError('Destination changed after unmounting. Nothing written.')
    try:
        target = open('/dev/r' + disk, 'r+b', buffering=0)
    except OSError:
        # No write has occurred: put the user's card back in Finder if possible.
        subprocess.run(['/usr/sbin/diskutil', 'mountDisk', '/dev/' + disk],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        raise
    with target:
        yield target


def progress(label, count, total):
    print(f'\r{label}: {100 * count / total:5.1f}% ({count / 1e9:.2f} / {total / 1e9:.2f} GB)', end='', flush=True)


def hash_stream(stream, size, label):
    digest = hashlib.sha256()
    count = 0
    last = 0
    while count < size:
        data = stream.read(min(CHUNK, size - count))
        if not data:
            raise RuntimeError(f'{label}: unexpected end after {count} bytes.')
        digest.update(data)
        count += len(data)
        if time.monotonic() - last > 1:
            progress(label, count, size)
            last = time.monotonic()
    progress(label, count, size)
    print()
    return digest.hexdigest()


def write_stream(source, target, size):
    count = 0
    last = 0
    digest = hashlib.sha256()
    while data := source.read(CHUNK):
        if count + len(data) > size:
            raise RuntimeError('Image is larger than expected. Do not use this card.')
        view = memoryview(data)
        while view:
            written = target.write(view)
            if not written:
                raise RuntimeError('Destination stopped accepting data.')
            view = view[written:]
        digest.update(data)
        count += len(data)
        if time.monotonic() - last > 1:
            progress('Writing card', count, size)
            last = time.monotonic()
    if count != size:
        raise RuntimeError('Image is shorter than expected. Do not use this card.')
    progress('Writing card', count, size)
    print()
    return digest.hexdigest()


def customize(boot, name):
    validate_hostname(name)
    cmdline = (boot / 'cmdline.txt').read_text().strip()
    if '\n' in cmdline or not cmdline:
        raise RuntimeError('Unexpected boot command line; hostname setup was not installed.')
    if any(t.startswith(('systemd.run=', 'systemd.run_success_action=', 'systemd.run_failure_action=', 'systemd.unit=')) for t in cmdline.split()):
        raise RuntimeError('This image already has a special boot action; refusing to replace it.')
    user_data = boot / 'user-data'
    if not user_data.read_text().startswith('#cloud-config'):
        raise RuntimeError('Unexpected user-data format.')
    if (boot / 'bk-original-cmdline.txt').exists():
        raise RuntimeError('A previous installer backup already exists.')
    (boot / 'bk-original-cmdline.txt').write_text(cmdline + '\n')
    (boot / 'hostname.txt').write_text(name + '\n')
    shutil.copyfile(BASE / 'installer/first_boot.py', boot / 'bk-first-boot.py')
    shutil.copyfile(BASE / 'installer/bk-first-boot.sh', boot / 'bk-first-boot.sh')
    os.chmod(boot / 'bk-first-boot.sh', 0o755)
    user_data.write_text(update_cloud_text(user_data.read_text(), name))
    os.sync()
    # Arm only after every required file has been written.
    (boot / 'cmdline.txt').write_text(cmdline + ' ' + ' '.join(TOKENS) + '\n')
    os.sync()
    if (boot / 'hostname.txt').read_text().strip() != name:
        raise RuntimeError('Hostname file failed verification.')
    if not all(t in (boot / 'cmdline.txt').read_text().split() for t in TOKENS):
        raise RuntimeError('Boot setup failed verification.')


def main():
    if sys.platform != 'darwin' or os.geteuid() != 0:
        raise RuntimeError('Run Install Kiosk SD Card.command on your Mac.')
    print('\nBK kiosk SD-card installer\n')
    print('This copies the full kiosk and applies a new hostname automatically on first boot.')
    print('Remove the ORIGINAL card. Connect only the destination card and leave it connected.')
    input('Press Return when the destination card is connected (Ctrl-C cancels): ')
    name = validate_hostname(input('New hostname (for example BK-AES-PROMPTER): ').strip())
    candidates = []
    listing = diskutil('list', '-plist', 'external', 'physical')
    for entry in listing.get('AllDisksAndPartitions', []):
        info = diskutil('info', '-plist', entry['DeviceIdentifier'])
        if eligible(info):
            # Do not offer a disk with a mounted filesystem holding this installer/image.
            image_device = IMAGE.stat().st_dev
            if any(p.get('MountPoint') and os.stat(p['MountPoint']).st_dev == image_device
                   for p in entry.get('Partitions', [])):
                continue
            candidates.append(info)
            volumes = ', '.join(p.get('VolumeName', '') for p in entry.get('Partitions', []) if p.get('VolumeName')) or 'no named volumes'
            print(f"  {info['DeviceIdentifier']}: {info.get('MediaName', 'External disk')} — {info['TotalSize']/1e9:.2f} GB — {volumes}")
    if not candidates:
        raise RuntimeError('No eligible external card found. It must have at least 31,266,439,168 bytes and 512-byte sectors.')
    disk = input('Type the destination disk identifier from the list (for example disk5): ').strip()
    matches = [i for i in candidates if i['DeviceIdentifier'] == disk]
    if len(matches) != 1:
        raise RuntimeError('Destination was not in the eligible list. Nothing written.')
    selected = matches[0]
    print('\nChecking the master image before erasing anything…')
    # Keep this same source descriptor open throughout validation and writing.
    with IMAGE.open('rb') as compressed:
        if hash_stream(compressed, IMAGE.stat().st_size, 'Checking master') != IMAGE_SHA256:
            raise RuntimeError('Master checksum does not match. Nothing written.')
        compressed.seek(0)
        phrase = 'ERASE'
        print(f"\nALL contents of {disk} ({selected['TotalSize']/1e9:.2f} GB) will be erased.")
        if input(f'Type exactly "{phrase}" to continue: ').strip() != phrase:
            print('Cancelled. Nothing written.')
            return
        current = diskutil('info', '-plist', disk)
        current_disks = diskutil('list', '-plist', 'external', 'physical').get('WholeDisks', [])
        if disk not in current_disks or not eligible(current) or fingerprint(current) != fingerprint(selected):
            raise RuntimeError('Destination changed. Nothing written; restart the installer.')
        raw = '/dev/r' + disk
        with open_destination(disk, selected) as target, lzma.LZMAFile(compressed, 'rb') as source:
            expected = write_stream(source, target, IMAGE_SIZE)
            # Remove a previous backup GPT on larger destination media, outside the image.
            tail = selected['TotalSize'] - 33 * 512
            if tail >= IMAGE_SIZE:
                target.seek(tail)
                zeros = memoryview(bytes(33 * 512))
                while zeros:
                    n = target.write(zeros)
                    if not n:
                        raise RuntimeError('Could not clear old trailing partition metadata.')
                    zeros = zeros[n:]
        run('/bin/sync')
        with open(raw, 'rb', buffering=0) as target:
            actual = hash_stream(target, IMAGE_SIZE, 'Verifying card')
        if actual != expected:
            raise RuntimeError('Read-back verification failed. Do not use this card; try another card or reader.')
    run('/usr/sbin/diskutil', 'mountDisk', '/dev/' + disk)
    part = diskutil('info', '-plist', disk + 's1')
    if part.get('ParentWholeDisk') != disk or part.get('FilesystemType') != 'msdos' or not part.get('MountPoint'):
        raise RuntimeError('Could not locate the written FAT boot partition. Hostname setup is incomplete.')
    customize(Path(part['MountPoint']), name)
    run('/usr/sbin/diskutil', 'eject', '/dev/' + disk)
    print(f'\nSUCCESS: card written, verified and ejected. Requested hostname: {name}')
    print('Insert it into the Pi. First boot applies the hostname and reboots once, then starts the existing kiosk.')
    print('Test the first card on your Pi before producing a batch.')


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nCancelled. If writing had started, rerun the installer before using this card.', file=sys.stderr)
        sys.exit(130)
    except Exception as error:
        print(f'\nINSTALLATION NOT COMPLETE: {error}', file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError) and error.stderr:
            print(error.stderr.decode(errors='replace').strip(), file=sys.stderr)
        if isinstance(error, PermissionError):
            print('Allow Terminal access to removable volumes in macOS Privacy & Security. If required, enable Full Disk Access for Terminal and reopen it.', file=sys.stderr)
        print('Do not use a partially written card. Fix the error and rerun the installer.', file=sys.stderr)
        sys.exit(1)
