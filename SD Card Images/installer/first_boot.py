#!/usr/bin/python3
"""One-time hostname setup, executed before the normal kiosk boot."""
import os
from email import policy
from email.parser import Parser
import re
from pathlib import Path

TOKENS = (
    'systemd.run=/boot/firmware/bk-first-boot.sh',
    'systemd.run_success_action=reboot',
    'systemd.run_failure_action=none',
    'systemd.unit=kernel-command-line.target',
)


HTTP_SOCKET = """[Unit]
Description=Kiosk web interface on standard HTTP port

[Socket]
ListenStream=0.0.0.0:80
NoDelay=true

[Install]
WantedBy=sockets.target
"""
HTTP_SERVICE = """[Unit]
Description=Forward kiosk HTTP requests to the existing web app
Requires=bk-kiosk-http.socket
After=network.target

[Service]
ExecStart=/usr/lib/systemd/systemd-socket-proxyd 127.0.0.1:8443
DynamicUser=yes
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
Restart=on-failure
RestartSec=2
"""


def validate_hostname(name):
    if not re.fullmatch(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?', name):
        raise ValueError('Use 1–63 letters, numbers or hyphens; start and end with a letter or number.')
    return name


def update_cloud_text(text, name):
    # These are top-level scalar keys in this image's cloud-config files.
    for key, value in [('hostname', name), ('preserve_hostname', 'true'), ('manage_etc_hosts', 'false')]:
        pattern = rf'^{key}:[^\n]*$'
        if re.search(pattern, text, re.M):
            text = re.sub(pattern, f'{key}: {value}', text, flags=re.M)
        else:
            text = text.rstrip('\n') + f'\n{key}: {value}\n'
    return text


def atomic_write(path, text):
    path = Path(path)
    temp = path.with_name(path.name + '.bk-new')
    temp.write_text(text)
    if path.exists():
        os.chmod(temp, path.stat().st_mode & 0o777)
    else:
        os.chmod(temp, 0o644)
    os.replace(temp, path)


def update_cloud_document(text, name):
    if text.startswith('#cloud-config'):
        return update_cloud_text(text, name)
    message = Parser(policy=policy.default).parsestr(text)
    count = 0
    for part in message.walk():
        if part.get_content_type() == 'text/cloud-config':
            part.set_content(update_cloud_text(part.get_content(), name), subtype='cloud-config', charset='utf-8')
            count += 1
    if not count:
        raise RuntimeError('Unexpected cloud-init data format.')
    return message.as_string()


def apply(root=Path('/')):
    boot = root / 'boot/firmware'
    name = validate_hostname((boot / 'hostname.txt').read_text().strip())
    cmdline = (boot / 'cmdline.txt').read_text().strip().split()
    if not all(token in cmdline for token in TOKENS):
        raise RuntimeError('Expected first-boot instructions are missing; refusing partial setup.')
    old = (root / 'etc/hostname').read_text().strip()
    updates = {root / 'etc/hostname': name + '\n'}
    units = root / 'etc/systemd/system'
    updates[units / 'bk-kiosk-http.socket'] = HTTP_SOCKET
    updates[units / 'bk-kiosk-http.service'] = HTTP_SERVICE
    enabled = units / 'sockets.target.wants/bk-kiosk-http.socket'
    if os.path.lexists(enabled) and (not enabled.is_symlink() or os.readlink(enabled) != '../bk-kiosk-http.socket'):
        raise RuntimeError('Unexpected existing HTTP socket enablement; refusing to overwrite it.')
    hosts = (root / 'etc/hosts').read_text()
    lines = []
    found = False
    for line in hosts.splitlines():
        words = line.split()
        if words and words[0] == '127.0.1.1':
            if not found:
                lines.append('127.0.1.1\t' + name)
                found = True
        else:
            lines.append(line)
    if not found:
        lines.append('127.0.1.1\t' + name)
    updates[root / 'etc/hosts'] = '\n'.join(lines) + '\n'

    # Preserve initialization state: do not clean cloud-init or rerun provisioning.
    config = root / 'etc/cloud/cloud.cfg.d/99-zz-bk-hostname.cfg'
    updates[config] = '# Keep the manually selected kiosk hostname.\n' + update_cloud_text('', name).lstrip()
    paths = [boot / 'user-data']
    for instance in (root / 'var/lib/cloud/instances').glob('*'):
        for filename in ('cloud-config.txt', 'user-data.txt', 'user-data.txt.i'):
            paths.append(instance / filename)
    for path in paths:
        if path.is_file():
            updates[path] = update_cloud_document(path.read_text(), name)

    # Validate all cleanup targets before making changes. Never follow links.
    locks = []
    for home in (root / 'home').iterdir():
        profile = home / '.config/chromium'
        for filename in ('SingletonLock', 'SingletonSocket', 'SingletonCookie'):
            lock = profile / filename
            if lock.is_symlink():
                target = os.readlink(lock)
                valid = ((filename == 'SingletonLock' and re.fullmatch(r'.+-[0-9]+', target))
                         or (filename == 'SingletonSocket' and target.startswith('/tmp/') and target.endswith('/SingletonSocket'))
                         or (filename == 'SingletonCookie' and target.isdigit()))
                if not valid:
                    raise RuntimeError('Unexpected Chromium link; left untouched: ' + str(lock))
                locks.append((lock, target))
            elif lock.exists():
                raise RuntimeError('Expected a temporary Chromium symlink, found a different file type: ' + str(lock))

    for path, text in updates.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write(path, text)
    enabled.parent.mkdir(parents=True, exist_ok=True)
    if not enabled.is_symlink():
        enabled.symlink_to('../bk-kiosk-http.socket')
    for lock, target in locks:
        print(f'Removing copied process link: {lock} -> {target}', flush=True)
        lock.unlink()
    atomic_write(boot / 'bk-setup-complete.txt', f'Hostname applied: {name}\nPrevious hostname: {old}\n')
    os.sync()
    # Disarm last. Any preceding failure leaves setup armed for a retry.
    atomic_write(boot / 'cmdline.txt', ' '.join(t for t in cmdline if t not in TOKENS) + '\n')
    os.sync()
    print(f'Hostname set to {name}. Rebooting into the existing kiosk.', flush=True)


if __name__ == '__main__':
    apply()
