"""Non-destructive tests: all destination writes use temporary files/directories."""
import contextlib
from email import policy
from email.parser import Parser
import hashlib
import io
import lzma
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import first_boot
import install


CLOUD = '#cloud-config\nhostname: OLD-PI\nmanage_etc_hosts: true\nusers:\n- name: bkadmin\nruncmd:\n- [echo, unchanged]\n'
MIME = 'MIME-Version: 1.0\nContent-Type: multipart/mixed; boundary="bk-test"\n\n--bk-test\nContent-Type: text/cloud-config; charset="utf-8"\n\n' + CLOUD + '\n--bk-test\nContent-Type: text/x-shellscript\n\n#!/bin/sh\necho keep-me\n--bk-test--\n'


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.sync = patch('os.sync').start()
        self.addCleanup(patch.stopall)

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text)
        return target

    def fixture(self):
        self.write('etc/hostname', 'OLD-PI\n')
        self.write('etc/hosts', '127.0.0.1 localhost\n127.0.1.1 OLD-PI OLDER-PI\n::1 localhost ip6-localhost\n10.0.0.9 server\n')
        self.write('boot/firmware/cmdline.txt', 'root=PARTUUID=172b82dd-02 quiet\n')
        self.write('boot/firmware/user-data', CLOUD)
        for name, content in [('cloud-config.txt', CLOUD), ('user-data.txt', CLOUD), ('user-data.txt.i', MIME)]:
            self.write('var/lib/cloud/instances/test/' + name, content)
        for filename in ['Local State', 'Default/Preferences', 'Default/Bookmarks', 'Default/Cookies']:
            self.write('home/bkadmin/.config/chromium/' + filename, 'important: ' + filename)
        for name in ['kiosk_watcher.sh', 'launch_kiosk.sh', 'prompter_url.txt', 'kiosk_gui/app.py']:
            self.write('home/bkadmin/' + name, 'keep: ' + name)
        profile = self.root / 'home/bkadmin/.config/chromium'
        for name, target in [('SingletonLock','OLD-PI-1831'), ('SingletonCookie','123456'), ('SingletonSocket','/tmp/org.chromium.Chromium.abc/SingletonSocket')]:
            (profile / name).symlink_to(target)
        install.customize(self.root / 'boot/firmware', 'BK-AES-PROMPTER')

    def test_unmount_and_recheck_happen_before_opening_for_write(self):
        events = []
        info = {'DeviceIdentifier': 'disk4', 'TotalSize': install.IMAGE_SIZE}
        def mock_run(*args): events.append('unmount')
        def mock_info(*args):
            events.append('recheck')
            return info
        def mock_open(*args, **kwargs):
            events.append('open')
            self.assertEqual(args, ('/dev/rdisk4', 'r+b'))
            return io.BytesIO()
        with patch.object(install, 'run', side_effect=mock_run), patch.object(install, 'diskutil', side_effect=mock_info), patch('builtins.open', side_effect=mock_open):
            with install.open_destination('disk4', info):
                self.assertEqual(events, ['unmount', 'recheck', 'open'])

    def test_changed_disk_is_never_opened(self):
        with patch.object(install, 'run'), patch.object(install, 'diskutil', return_value={'TotalSize': 1}), patch('builtins.open') as mocked:
            with self.assertRaises(RuntimeError):
                with install.open_destination('disk4', {'TotalSize': install.IMAGE_SIZE}): pass
            mocked.assert_not_called()

    def test_hostname_validation(self):
        for name in ['BK-AES-PROMPTER', 'reception', 'a', 'a'*63]:
            self.assertEqual(first_boot.validate_hostname(name),name)
        for name in ['', '-bad', 'bad-', 'bad name', 'bad.local', 'a'*64, 'x\nreboot', '$(reboot)']:
            with self.assertRaises(ValueError): first_boot.validate_hostname(name)

    def test_cloud_mime_preserves_other_payloads(self):
        updated = first_boot.update_cloud_document(MIME, 'NEW-PI')
        message = Parser(policy=policy.default).parsestr(updated)
        parts = list(message.iter_parts())
        self.assertIn('hostname: NEW-PI', parts[0].get_content())
        self.assertEqual(parts[1].get_content(), '#!/bin/sh\necho keep-me')
        self.assertIn('- [echo, unchanged]',parts[0].get_content())

    def test_first_boot_preserves_kiosk_and_browser_settings(self):
        self.fixture()
        before = {p: p.read_bytes() for p in (self.root / 'home').rglob('*') if p.is_file() and not p.is_symlink()}
        with contextlib.redirect_stdout(io.StringIO()): first_boot.apply(self.root)
        self.assertEqual((self.root/'etc/hostname').read_text(), 'BK-AES-PROMPTER\n')
        hosts = (self.root/'etc/hosts').read_text()
        self.assertIn('127.0.1.1\tBK-AES-PROMPTER\n',hosts)
        self.assertNotIn('OLD-PI',hosts)
        self.assertIn('10.0.0.9 server',hosts)
        for p, content in before.items(): self.assertEqual(p.read_bytes(),content)
        for name in ['SingletonLock','SingletonCookie','SingletonSocket']:
            self.assertFalse(os.path.lexists(self.root/'home/bkadmin/.config/chromium'/name))
        self.assertEqual((self.root/'boot/firmware/cmdline.txt').read_text(),'root=PARTUUID=172b82dd-02 quiet\n')
        self.assertIn('preserve_hostname: true',(self.root/'var/lib/cloud/instances/test/cloud-config.txt').read_text())
        self.assertIn('manage_etc_hosts: false',(self.root/'var/lib/cloud/instances/test/cloud-config.txt').read_text())
        self.assertIn('BK-AES-PROMPTER',(self.root/'var/lib/cloud/instances/test/user-data.txt.i').read_text())
        self.assertTrue((self.root/'boot/firmware/bk-setup-complete.txt').exists())
        self.assertTrue((self.root/'etc/systemd/system/sockets.target.wants/bk-kiosk-http.socket').is_symlink())
        self.assertIn('ListenStream=0.0.0.0:80',(self.root/'etc/systemd/system/bk-kiosk-http.socket').read_text())
        self.assertIn('127.0.0.1:8443',(self.root/'etc/systemd/system/bk-kiosk-http.service').read_text())

    def test_unexpected_regular_lock_is_preserved_and_stops_before_changes(self):
        self.fixture()
        lock = self.root/'home/bkadmin/.config/chromium/SingletonLock'
        lock.unlink()
        lock.write_text('possibly important settings')
        with self.assertRaises(RuntimeError): first_boot.apply(self.root)
        self.assertEqual(lock.read_text(),'possibly important settings')
        self.assertEqual((self.root/'etc/hostname').read_text(),'OLD-PI\n')
        self.assertIn(first_boot.TOKENS[0],(self.root/'boot/firmware/cmdline.txt').read_text())

    def test_unexpected_symlink_is_preserved(self):
        self.fixture()
        lock = self.root/'home/bkadmin/.config/chromium/SingletonCookie'
        lock.unlink(); lock.symlink_to('Default/Preferences')
        with self.assertRaises(RuntimeError): first_boot.apply(self.root)
        self.assertTrue(lock.is_symlink())
        self.assertEqual((self.root/'etc/hostname').read_text(),'OLD-PI\n')

    def test_bad_cloud_data_fails_before_modification(self):
        self.fixture()
        self.write('var/lib/cloud/instances/test/user-data.txt.i','unexpected configuration')
        with self.assertRaises(RuntimeError): first_boot.apply(self.root)
        self.assertEqual((self.root/'etc/hostname').read_text(),'OLD-PI\n')

    def test_other_boot_action_not_overwritten(self):
        self.write('boot/cmdline.txt','root=x systemd.run=/other-script\n')
        self.write('boot/user-data',CLOUD)
        with self.assertRaises(RuntimeError): install.customize(self.root/'boot','NEW-PI')
        self.assertEqual((self.root/'boot/cmdline.txt').read_text(),'root=x systemd.run=/other-script\n')

    def test_disk_selection_rejects_unsafe_and_small_disks(self):
        info = dict(Internal=False, WholeDisk=True, VirtualOrPhysical='Physical', WritableMedia=True,
                    DeviceBlockSize=512, TotalSize=install.IMAGE_SIZE, DeviceIdentifier='disk5')
        self.assertTrue(install.eligible(info))
        for change in [dict(Internal=True),dict(WholeDisk=False),dict(VirtualOrPhysical='Virtual'),
                       dict(WritableMedia=False),dict(TotalSize=install.IMAGE_SIZE-1),
                       dict(DeviceIdentifier='disk5s1'),dict(DeviceBlockSize=4096)]:
            self.assertFalse(install.eligible(info | change))
        self.assertFalse(install.eligible({}))

    def test_streaming_write_and_readback(self):
        data = (b'kiosk data\x00'*10000)
        compressed = io.BytesIO(lzma.compress(data))
        target = io.BytesIO()
        with contextlib.redirect_stdout(io.StringIO()):
            with lzma.LZMAFile(compressed) as source:
                digest = install.write_stream(source,target,len(data))
            target.seek(0)
            self.assertEqual(install.hash_stream(target,len(data),'Test'),digest)
        self.assertEqual(target.getvalue(),data)
        self.assertEqual(digest,hashlib.sha256(data).hexdigest())
        corrupted = bytearray(data); corrupted[-1] ^= 1
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertNotEqual(install.hash_stream(io.BytesIO(corrupted),len(data),'Test'),digest)

    def test_write_handles_short_writes(self):
        class ShortWriter(io.BytesIO):
            def write(self,data): return super().write(data[:7])
        target = ShortWriter(); data = b'abcdef'*200
        with contextlib.redirect_stdout(io.StringIO()): install.write_stream(io.BytesIO(data),target,len(data))
        self.assertEqual(target.getvalue(),data)

    def test_short_and_oversized_streams_rejected(self):
        for data,size in [(b'a',2),(b'abc',2)]:
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(RuntimeError):
                install.write_stream(io.BytesIO(data),io.BytesIO(),size)
        with self.assertRaises(RuntimeError): install.hash_stream(io.BytesIO(b'a'),2,'test')


if __name__ == '__main__':
    unittest.main()
