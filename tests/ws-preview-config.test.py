"""Fundamental configuration/rollback tests; only unprivileged temporary fixtures."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('preview_config', Path(__file__).parents[1] / 'infra/vps/prepare-ws-preview-v3.py')
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)

BASE = b'''# preserve original comments
SUPABASE_STAGE_PROJECT_REF=krydukthwdvccggbyjfw
SUPABASE_URL=https://krydukthwdvccggbyjfw.supabase.co
SUPABASE_DB_URL=postgres://postgres.krydukthwdvccggbyjfw@aws-0-eu-west-3.pooler.supabase.com/postgres
POKER_WS_INTERNAL_TOKEN=fixture-internal
WS_AUTHORITATIVE_JOIN_ENABLED=1
PORT=3001
UNRELATED_VALUE="preserve=a=b"
'''
CREDS = {'UPSTASH_REDIS_REST_URL': 'https://fixture.upstash.io', 'UPSTASH_REDIS_REST_TOKEN': 'fixture-token'}


class Preparation(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.env = self.root / 'env'
        self.helper = self.root / 'helper'
        self.backup = self.root / 'backup'
        self.env.write_bytes(BASE)
        self.env.chmod(0o600)
        self.helper.write_bytes(b'old helper')
        self.helper.chmod(0o755)
        self.files = config.SecureFiles(os.getuid(), os.getgid(), self.root)
        self.sentinel = self.root / 'production-do-not-touch'
        self.sentinel.write_bytes(b'unchanged')

    def run_operation(self, rollback=False, files=None, credentials=None):
        return config.transaction(self.env, self.helper, self.backup, b'new helper',
                                  CREDS if credentials is None else credentials,
                                  rollback=rollback, files=files or self.files)

    def test_apply_repeat_and_rollback_repeat_preserve_original(self):
        self.assertEqual(self.run_operation(), 'complete')
        first = self.env.read_bytes()
        manifest = (self.backup / 'manifest.json').read_bytes()
        self.assertEqual(self.run_operation(), 'complete')
        self.assertEqual(self.env.read_bytes(), first)
        self.assertEqual((self.backup / 'manifest.json').read_bytes(), manifest)
        values = config.parse_env(first)
        self.assertEqual(values['ACCOUNT_DELETION_ENABLED'], '0')
        self.assertEqual(values['XP_KEY_NS'], 'kcswh:stage:xp:v3')
        self.assertEqual(values['UNRELATED_VALUE'], 'preserve=a=b')
        self.assertEqual((self.backup / 'env.before').read_bytes(), BASE)
        for filename in ('env.before', 'helper.before', 'manifest.json', 'operation.lock'):
            self.assertEqual((self.backup / filename).stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.backup.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.run_operation(rollback=True), 'rolled_back')
        self.assertEqual(self.run_operation(rollback=True), 'rolled_back')
        self.assertEqual(self.env.read_bytes(), BASE)
        self.assertEqual(self.helper.read_bytes(), b'old helper')
        self.assertEqual(self.sentinel.read_bytes(), b'unchanged')

    def test_interruption_between_live_files_resumes_without_new_backup(self):
        outer = self

        class Interrupted(config.SecureFiles):
            def atomic(self, path, *args, **kwargs):
                super().atomic(path, *args, **kwargs)
                if path == outer.env:
                    raise OSError('injected termination after first replace')

        interrupted = Interrupted(os.getuid(), os.getgid(), self.root)
        with self.assertRaises(OSError):
            self.run_operation(files=interrupted)
        self.assertEqual(self.helper.read_bytes(), b'old helper')
        self.assertEqual(json.loads((self.backup / 'manifest.json').read_bytes())['phase'], 'prepared')
        self.assertEqual(self.run_operation(), 'complete')
        self.assertEqual((self.backup / 'env.before').read_bytes(), BASE)
        self.assertEqual(self.helper.read_bytes(), b'new helper')

    def test_interrupted_operation_can_be_rolled_back_directly(self):
        self.run_operation()
        self.helper.write_bytes(b'old helper')
        self.assertEqual(self.run_operation(rollback=True), 'rolled_back')
        self.assertEqual(self.env.read_bytes(), BASE)

    def test_changed_target_backup_or_requested_credentials_are_no_go(self):
        self.run_operation()
        original = self.env.read_bytes()
        self.env.write_bytes(original + b'OPERATOR_EDIT=keep\n')
        with self.assertRaises(config.Refused):
            self.run_operation(rollback=True)
        self.assertTrue(self.env.read_bytes().endswith(b'OPERATOR_EDIT=keep\n'))
        self.env.write_bytes(original)
        with self.assertRaises(config.Refused):
            self.run_operation(credentials={**CREDS, 'UPSTASH_REDIS_REST_TOKEN': 'different'})
        (self.backup / 'env.before').write_bytes(b'corrupt')
        with self.assertRaises(config.Refused):
            self.run_operation(rollback=True)
        self.assertEqual(self.env.read_bytes(), original)

    def test_symlinks_and_hardlinks_are_rejected_without_touching_target(self):
        self.env.unlink()
        self.env.symlink_to(self.sentinel)
        with self.assertRaises((OSError, config.Refused)):
            self.run_operation()
        self.assertEqual(self.sentinel.read_bytes(), b'unchanged')
        self.env.unlink()
        os.link(self.sentinel, self.env)
        self.env.chmod(0o600)
        with self.assertRaises(config.Refused):
            self.run_operation()
        self.assertFalse(self.backup.exists())

    def test_unsafe_parent_and_bad_mode_fail_before_backup(self):
        self.root.chmod(0o770)
        with self.assertRaises(config.Refused):
            self.run_operation()
        self.root.chmod(0o700)
        self.env.chmod(0o644)
        with self.assertRaises(config.Refused):
            self.run_operation()
        self.env.chmod(0o600)
        with self.assertRaises(config.Refused):
            self.run_operation(files=config.SecureFiles(os.getuid() + 1, os.getgid(), self.root))
        self.assertFalse(self.backup.exists())

    def test_concurrent_operation_is_rejected(self):
        self.run_operation()
        with (self.backup / 'operation.lock').open('r+b') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                self.run_operation()

    def test_render_refuses_duplicates_other_stage_activation_and_key_changes(self):
        for original in (BASE + b'PORT=3001\n', BASE.replace(b'krydukthwdvccggbyjfw', b'other-project'),
                         BASE + b'ACCOUNT_DELETION_ENABLED=1\n', BASE + b'UPSTASH_REDIS_REST_TOKEN=different\n',
                         BASE + b'XP_KEY_NS=kcswh:prod:xp:v3\n'):
            with self.assertRaises(config.Refused):
                config.render_env(original, CREDS)
        for credentials in ({**CREDS, 'UPSTASH_REDIS_REST_URL': 'https://fixture.upstash.io.evil.invalid'},
                            {**CREDS, 'UPSTASH_REDIS_REST_URL': 'http://fixture.upstash.io'},
                            {**CREDS, 'UPSTASH_REDIS_REST_URL': 'https://fixture.upstash.io/\n#'},
                            {**CREDS, 'UPSTASH_REDIS_REST_TOKEN': 'bad\nvalue'}):
            with self.assertRaises(config.Refused):
                config.render_env(BASE, credentials)


if __name__ == '__main__':
    unittest.main()
