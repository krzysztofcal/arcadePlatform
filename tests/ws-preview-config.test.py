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


window_spec = importlib.util.spec_from_file_location('window', Path(__file__).parents[1] / 'infra/vps/stage-deletion-window.py')
window = importlib.util.module_from_spec(window_spec)
window_spec.loader.exec_module(window)


class DeletionWindow(unittest.TestCase):
    run_operation = Preparation.run_operation
    def setUp(self):
        Preparation.setUp(self)
        self.run_operation()
        self.env.write_bytes(self.env.read_bytes() + b'ACCOUNT_DELETION_AVATAR_TRACKING_ENABLED=1\n')
        record = json.loads((self.backup / 'manifest.json').read_bytes())
        record['desired']['env'] = config.digest(self.env.read_bytes())
        (self.backup / 'manifest.json').write_text(json.dumps(record))
        self.before = self.env.read_bytes()
        self.window = self.root / 'window'
        self.helper.write_bytes(b'new helper')
        self.old = window.OLD_HELPER
        window.OLD_HELPER = config.digest(b'new helper')
        self.addCleanup(setattr, window, 'OLD_HELPER', self.old)

    def action(self, operation, files=None):
        return window.operate(operation, self.env, self.helper, self.backup / 'manifest.json',
                              self.window, b'window helper', files or self.files)

    def test_reviewed_helper_pins_match_bundle(self):
        helper_bytes = (Path(__file__).parents[1] / 'infra/vps/ws-preview-env-preflight.mjs').read_bytes()
        self.assertEqual(config.digest(helper_bytes), config.HELPER_SHA256)
        self.assertEqual(config.digest(helper_bytes), window.HELPER_SHA256)

    def test_window_baseline_on_restore_and_drift(self):
        self.assertEqual(self.action('dry-run'), 'baseline')
        self.assertFalse(self.window.exists())
        with self.assertRaises(window.secure.Refused): self.action('activate')
        self.assertEqual(self.action('prepare'), 'prepared')
        self.assertEqual(self.env.read_bytes(), self.before)
        self.assertEqual(self.action('activate'), 'on')
        self.assertEqual(self.action('verify'), 'on')
        values = config.parse_env(self.env.read_bytes())
        self.assertEqual(values['ACCOUNT_DELETION_ENABLED'], '1')
        self.assertEqual(values['ACCOUNT_DELETION_AVATAR_TRACKING_MARKER'], window.MARKER)
        self.assertEqual(values['UPSTASH_REDIS_REST_TOKEN'], CREDS['UPSTASH_REDIS_REST_TOKEN'])
        on = self.env.read_bytes()
        self.env.write_bytes(on + b'DRIFT=1\n')
        with self.assertRaises(window.secure.Refused): self.action('restore')
        self.env.write_bytes(on)
        self.assertEqual(self.action('restore'), 'off')
        self.assertEqual(self.env.read_bytes(), self.before)
        self.assertEqual(self.action('restore'), 'off')

    def test_window_interrupted_activation_resumes_or_restores(self):
        self.action('prepare')
        outer = self
        class Interrupted(config.SecureFiles):
            def atomic(self, path, *args, **kwargs):
                super().atomic(path, *args, **kwargs)
                if path == outer.env: raise OSError('fixture interruption')
        with self.assertRaises(OSError):
            self.action('activate', Interrupted(os.getuid(), os.getgid(), self.root))
        with self.assertRaises(window.secure.Refused): self.action('verify')
        self.assertEqual(self.action('activate'), 'on')
        self.assertEqual(self.action('restore'), 'off')
        self.assertEqual(self.env.read_bytes(), self.before)

    def test_window_interrupted_restore_refuses_verify_then_restores_exact_off(self):
        self.action('prepare')
        self.action('activate')
        original_hash = config.digest(self.before)
        outer = self
        class Interrupted(config.SecureFiles):
            def atomic(self, path, *args, **kwargs):
                super().atomic(path, *args, **kwargs)
                if path == outer.env: raise OSError('fixture interruption after OFF replace')
        with self.assertRaises(OSError):
            self.action('restore', Interrupted(os.getuid(), os.getgid(), self.root))
        self.assertEqual(json.loads((self.window / 'manifest.json').read_bytes())['phase'], 'restoring')
        self.assertEqual(config.digest(self.env.read_bytes()), original_hash)
        with self.assertRaises(window.secure.Refused): self.action('verify')
        self.assertEqual(self.action('restore'), 'off')
        self.assertEqual(self.action('verify'), 'off')
        self.assertEqual(config.digest(self.env.read_bytes()), original_hash)

    def test_window_foreign_environment_and_permissions(self):
        for source in (self.before.replace(b'kcswh:stage:xp:v3', b'kcswh:prod:xp:v3'),
                       self.before.replace(b'krydukthwdvccggbyjfw', b'foreign')):
            with self.assertRaises(window.secure.Refused): window.render_on(source)
        self.root.chmod(0o770)
        with self.assertRaises(config.Refused): self.action('prepare')

    def test_window_prepare_interruption_preserves_off_and_resumes(self):
        outer = self
        class Interrupted(config.SecureFiles):
            def atomic(self, path, *args, **kwargs):
                super().atomic(path, *args, **kwargs)
                if path == outer.helper: raise OSError('fixture interruption')
        with self.assertRaises(OSError):
            self.action('prepare', Interrupted(os.getuid(), os.getgid(), self.root))
        self.assertEqual(self.env.read_bytes(), self.before)
        with self.assertRaises(window.secure.Refused): self.action('activate')
        self.assertEqual(self.action('prepare'), 'prepared')
        self.assertEqual(self.action('verify'), 'prepared')


# Production has its own fixed operator; only filesystem primitives are shared.
prod_spec = importlib.util.spec_from_file_location('prod_window', Path(__file__).parents[1] / 'infra/vps/production-deletion-window.py')
prod = importlib.util.module_from_spec(prod_spec)
prod_spec.loader.exec_module(prod)


class ProductionDeletionWindow(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.env, self.helper = self.root / 'env', self.root / 'helper'
        self.approval, self.directory = self.root / 'approval', self.root / 'window'
        self.before = BASE.replace(b'krydukthwdvccggbyjfw', b'otbqfijerkieoxwpxjnm').replace(b'SUPABASE_STAGE_PROJECT_REF=', b'FIXTURE_PROJECT_REF=').replace(b'PORT=3001', b'PORT=3000') + b'ACCOUNT_DELETION_ENABLED=0\nXP_REDIS_VERSION=3\nXP_REDIS_ENV=prod\nXP_KEY_NS=kcswh:prod:xp:v3\nUPSTASH_REDIS_REST_URL=https://fixture.upstash.io\nUPSTASH_REDIS_REST_TOKEN=fixture-token\n'
        self.env.write_bytes(self.before); self.env.chmod(0o600)
        self.old = b'fixture old protected production helper'
        self.helper.write_bytes(self.old); self.helper.chmod(0o755)
        self.previous_pin = prod.OLD_HELPER
        prod.OLD_HELPER = config.digest(self.old)
        self.addCleanup(setattr, prod, 'OLD_HELPER', self.previous_pin)
        # Actual preflight's old-helper pin is fixed; anchor pins the real reviewed hash.
        self.record = {'version':1,'phase':'committed','after':{'prod':config.digest(self.before),'helper':prod.OLD_HELPER}}
        self.approval.write_text(json.dumps(self.record)); self.approval.chmod(0o600)
        self.files = prod.secure.SecureFiles(os.getuid(), os.getgid(), self.root)
        self.new = (Path(__file__).parents[1] / 'infra/vps/ws-production-env-preflight.mjs').read_bytes()

    def action(self, mode, files=None):
        return prod.operate(mode,self.env,self.helper,self.approval,self.directory,self.new,files or self.files)

    def preflight(self, good=True, live=True):
        import subprocess
        # The old helper bytes are synthetic; the approved baseline record is protected,
        # while the new helper/module hash and all configuration derivation are real.
        script = """import {runPreflight} from './infra/vps/ws-production-env-preflight.mjs';
const [envFile,directory,anchor,helper,boundary]=process.argv.slice(1);
try {runPreflight({envFile,allowTestUid:true,requireRedisV3:true,queryRedisV3:()=>process.argv[6]==='1',querySystemIdentifier:()=> '7575202818581710058',protection:{directory,anchor,helper,boundary}});process.exit(0);}catch {process.exit(1);}"""
        result = subprocess.run(['node','--input-type=module','-e',script,str(self.env),str(self.directory),str(self.approval),str(self.helper),str(self.root),'1' if live else '0'],cwd=Path(__file__).parents[1],capture_output=True)
        self.assertEqual(result.returncode,0 if good else 1)

    def test_off_on_exact_restore_and_only_two_keys_change(self):
        self.assertEqual(self.action('dry-run'),'baseline'); self.assertFalse(self.directory.exists())
        self.assertEqual(self.action('prepare'),'prepared'); self.assertEqual(self.env.read_bytes(),self.before)
        self.preflight()
        self.assertEqual(self.action('activate'),'on'); self.preflight(); self.preflight(False,live=False)
        before, after = config.parse_env(self.before),config.parse_env(self.env.read_bytes())
        changed={key for key in before.keys()|after.keys() if before.get(key)!=after.get(key)}
        self.assertEqual(changed,{'ACCOUNT_DELETION_ENABLED','ACCOUNT_DELETION_AVATAR_TRACKING_MARKER'})
        self.assertEqual(self.action('activate'),'on'); self.assertEqual(self.action('restore'),'off')
        self.assertEqual(self.env.read_bytes(),self.before); self.preflight()
        self.assertEqual(self.action('restore'),'off')

    def test_missing_manifest_drift_and_forged_on_hash_are_denied(self):
        self.env.write_bytes(prod.render_on(self.before)); self.preflight(False)
        with self.assertRaises(prod.secure.Refused): self.action('activate')
        self.env.write_bytes(self.before); self.action('prepare'); self.action('activate')
        legitimate=self.env.read_bytes(); self.env.write_bytes(legitimate+b'OTHER=changed\n'); self.preflight(False)
        with self.assertRaises(prod.secure.Refused): self.action('restore')
        record=json.loads((self.directory/'manifest.json').read_text()); record['on']=config.digest(self.env.read_bytes())
        (self.directory/'manifest.json').write_text(json.dumps(record)); self.preflight(False)
        with self.assertRaises(prod.secure.Refused): self.action('verify')

    def test_interrupted_activation_and_restore_fail_closed_then_resume(self):
        self.action('prepare')
        outer=self
        class Interrupted(prod.secure.SecureFiles):
            def atomic(self,path,*args,**kwargs):
                super().atomic(path,*args,**kwargs)
                if path==outer.env: raise OSError('fixture response loss after replace')
        files=Interrupted(os.getuid(),os.getgid(),self.root)
        for mode,terminal in [('activate','on'),('restore','off')]:
            with self.assertRaises(OSError): self.action(mode,files)
            with self.assertRaises(prod.secure.Refused): self.action('verify')
            self.preflight(False)
            self.assertEqual(self.action(mode),terminal); self.preflight()
        self.assertEqual(config.digest(self.env.read_bytes()),config.digest(self.before))

    def test_foreign_environment_unsafe_paths_and_lock_are_denied(self):
        self.env.write_bytes(self.before.replace(b'kcswh:prod:xp:v3',b'kcswh:stage:xp:v3'))
        with self.assertRaises(prod.secure.Refused): self.action('prepare')
        self.env.write_bytes(self.before); self.env.chmod(0o644)
        with self.assertRaises(prod.secure.Refused): self.action('prepare')
        self.env.chmod(0o600); self.action('prepare')
        with (self.directory/'operation.lock').open('r+b') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError): self.action('activate')
        saved=self.directory/'env.before'; saved.unlink(); saved.symlink_to(self.env)
        self.preflight(False)
        with self.assertRaises((OSError,prod.secure.Refused)): self.action('activate')

    def test_interrupted_helper_install_stays_off_and_resumes(self):
        outer=self
        class Interrupted(prod.secure.SecureFiles):
            def atomic(self,path,*args,**kwargs):
                super().atomic(path,*args,**kwargs)
                if path==outer.helper: raise OSError('fixture helper install interrupted')
        with self.assertRaises(OSError): self.action('prepare',Interrupted(os.getuid(),os.getgid(),self.root))
        self.assertEqual(self.env.read_bytes(),self.before); self.preflight(False)
        with self.assertRaises(prod.secure.Refused): self.action('activate')
        self.assertEqual(self.action('prepare'),'prepared'); self.preflight()

    def test_reviewed_bundle_pins(self):
        self.assertEqual(config.digest(self.new),prod.HELPER_SHA256)
        self.assertEqual(config.digest((Path(__file__).parents[1]/'infra/vps/prepare-ws-preview-v3.py').read_bytes()),prod.SECURE_SHA256)


if __name__ == '__main__':
    unittest.main()
