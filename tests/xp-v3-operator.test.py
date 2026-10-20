import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('operator_v3', 'infra/vps/xp-v3-operator.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class OperatorTests(unittest.TestCase):
    def test_stage_branch_inherits_only_explicit_preview_overrides(self):
        spec = importlib.util.spec_from_file_location('netlify_v3', 'scripts/ops/xp-redis-netlify-configure.py')
        adapter = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(adapter)
        rows = [
            {'key': 'SUPABASE_URL', 'values': [{'context':'all','value':'production'}, {'context':'deploy-preview','value':'stage'}]},
            {'key': 'EXISTING', 'values': [{'context':'branch','context_parameter':adapter.BRANCH,'value':'keep'}, {'context':'deploy-preview','value':'other'}]},
            {'key': 'COMMON', 'values': [{'context':'all','value':'keep-common'}]},
            {'key': 'UPSTASH_REDIS_REST_TOKEN', 'values': [{'context':'deploy-preview','value':'old'}]},
        ]
        self.assertEqual(adapter.stage_overrides(rows), [('SUPABASE_URL', {'context':'branch','context_parameter':adapter.BRANCH,'value':'stage'})])

    def env(self, target):
        ref = m.REFS[target]
        return (f'SUPABASE_URL=https://{ref}.supabase.co\nSUPABASE_DB_URL=postgresql://postgres.{ref}:synthetic@region.pooler.supabase.com:6543/postgres\nPOKER_SETTING=preserve\nACCOUNT_DELETION_ENABLED=0\n').encode()

    def test_render_only_changes_approved_keys_and_preserves_non_xp(self):
        credentials = {'UPSTASH_REDIS_REST_URL': 'https://fixture.upstash.io', 'UPSTASH_REDIS_REST_TOKEN': 'synthetic-new'}
        for target in ('stage', 'prod'):
            value = m.render(self.env(target), target, credentials, check_endpoint=False)
            fields = m.parse_env(value)
            self.assertEqual(fields['XP_KEY_NS'], f'kcswh:{target}:xp:v3')
            self.assertEqual(fields['POKER_SETTING'], 'preserve')
            self.assertIn(b'SUPABASE_DB_URL=postgresql://postgres.', value)
            self.assertEqual(value, m.render(value, target, credentials, check_endpoint=False))
        with self.assertRaises(m.Refused):
            m.render(self.env('prod'), 'stage', credentials, check_endpoint=False)
        with self.assertRaises(m.Refused):
            m.render(self.env('prod').replace(b'ENABLED=0', b'ENABLED=1'), 'prod', credentials, check_endpoint=False)

    def test_preview_approval_retains_original_evidence_and_binds_new_bytes(self):
        old = b'original stage config'
        approval = {'version': 1, 'phase': 'complete', 'original': {'env': 'preserve'}, 'desired': {'env': m.digest(old), 'helper': 'preserve-helper'}}
        changed = m.update_approval(json.dumps(approval).encode(), old, b'new config')
        self.assertEqual(json.loads(changed)['original'], approval['original'])
        self.assertEqual(json.loads(changed)['desired']['env'], m.digest(b'new config'))
        self.assertEqual(json.loads(changed)['desired']['helper'], 'preserve-helper')
        with self.assertRaises(m.Refused):
            m.update_approval(json.dumps(approval).encode(), b'foreign config', b'new')

    def test_old_credential_must_really_be_revoked_before_config_commit(self):
        original = m.redis
        old = {m.REDIS_KEYS[0]: 'https://fixture.upstash.io', m.REDIS_KEYS[1]: 'old'}
        new = {m.REDIS_KEYS[0]: 'https://fixture.upstash.io', m.REDIS_KEYS[1]: 'new'}
        try:
            m.redis = lambda credentials, command: (200, {'result': 'PONG'})
            with self.assertRaises(m.Refused):
                m.verify_new(old, new)
            m.redis = lambda credentials, command: (503, {'error': 'unavailable'})
            with self.assertRaises(m.Refused):
                m.verify_new(old, new)
            m.redis = lambda credentials, command: ((401, {'error': 'WRONGPASS invalid auth token'})
                if credentials is old else (200, {'result': 'PONG' if command == ['PING'] else 1}))
            m.verify_new(old, new)
        finally:
            m.redis = original

    def test_file_cas_recovers_partial_commit_and_rejects_symlinks_and_foreign_change(self):
        with tempfile.TemporaryDirectory() as directory:
            boundary = Path(directory)
            files = m.SecureFiles(uid=os.getuid(), gid=os.getgid(), boundary=boundary)
            target = boundary / 'env'
            files.atomic(target, b'before', 0o600)
            allowed = {m.digest(b'before'), m.digest(b'after')}
            files.atomic(target, b'after', 0o600, allowed)
            files.atomic(target, b'after', 0o600, allowed)
            target.write_bytes(b'foreign')
            with self.assertRaises(m.Refused):
                files.atomic(target, b'after', 0o600, allowed)
            target.unlink()
            target.symlink_to(boundary / 'unrelated')
            with self.assertRaises((m.Refused, OSError)):
                files.atomic(target, b'after', 0o600, allowed)

if __name__ == '__main__':
    unittest.main()
