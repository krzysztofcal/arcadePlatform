#!/usr/bin/python3
"""Fixed Production deletion window. Files only; no SQL, providers or restarts."""
import fcntl
import grp
import importlib.util
import json
import os
from pathlib import Path
import pwd
import stat
import sys
import urllib.parse
import urllib.request
import base64
import time
import math

BUNDLE = Path('/usr/local/libexec/arcade-production-deletion-window')
SECURE_SHA256 = '63787466ec6e4163f60e09510777df04c38cd2e8d20cb26d6257bcb550173740'
OLD_HELPER = '6595b12674328d1dd4554a1dc1aed380afb9037760be964175ad3221a64680a2'
HELPER_SHA256 = 'e73fc3f7bdb52465be3a02d9fbee2cfa119dd0bdf2ac93c346002da468069f18'
ENV = Path('/etc/arcadeplatform/ws-server.env')
HELPER = Path('/usr/local/sbin/arcade-ws-production-env-preflight')
APPROVAL = Path('/var/backups/arcade-xp-v3-cutover/state.json')
DIRECTORY = Path('/var/backups/arcade-production-deletion-window')
MARKER = 'prod-avatar-authority-20261022'
PROJECT = 'otbqfijerkieoxwpxjnm'
LEGACY_WINDOW_HELPER = 'af861b5eb2d63429114fd064c88ff575179df6d955293e24a458f3c65cc00562'
SERVICE_KEY = 'SUPABASE_SERVICE_ROLE_KEY'


def validate_service_key(key):
    require(isinstance(key, str) and 40 < len(key) < 8192
            and all(c.isalnum() or c in '-_.' for c in key), 'invalid_service_role_format')
    try:
        parts = key.split('.')
        require(len(parts) == 3, 'invalid_service_role_format')
        claims = json.loads(base64.urlsafe_b64decode(parts[1] + '==='))
        require(claims.get('ref') == PROJECT and claims.get('role') == 'service_role'
                and isinstance(claims.get('exp'), (int, float)) and math.isfinite(claims['exp'])
                and claims['exp'] > time.time(),
                'foreign_or_expired_service_role')
    except secure.Refused:
        raise
    except Exception:
        raise secure.Refused('invalid_service_role_format')


def verify_service_key(key):
    # Claims alone are not authenticity proof: validate against the pinned provider.
    validate_service_key(key)
    request = urllib.request.Request('https://' + PROJECT + '.supabase.co/storage/v1/bucket',
                                    headers={'apikey': key, 'Authorization': 'Bearer ' + key})
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            require(response.status == 200, 'service_role_provider_denied')
            buckets = json.loads(response.read(1048576))
        require(isinstance(buckets, list) and {'profile-avatar-uploads', 'profile-avatars'}
                <= {b.get('id') for b in buckets}, 'service_role_provider_identity')
    except Exception:
        raise secure.Refused('service_role_provider_verification_failed')


def export_service_role():
    require(os.geteuid() != 0 and not sys.stdout.isatty(), 'unprivileged_pipe_required')
    settings = json.loads((Path.home() / '.config/netlify/config.json').read_text())
    token = settings['users'][settings['userId']]['auth']['token']
    def get(path):
        request = urllib.request.Request('https://api.netlify.com/api/v1/' + path,
                                         headers={'Authorization': 'Bearer ' + token})
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.load(response)
    site_id = 'f7e19a84-28f7-41f7-978a-f3b4552a404d'
    site = get('sites/' + site_id)
    require(site.get('name') == 'playkcswh', 'wrong_netlify_site')
    entries = get('accounts/' + site['account_id'] + '/env?site_id=' + site_id)
    values = {}
    for entry in entries:
        if entry['key'] in ('SUPABASE_URL', SERVICE_KEY):
            selected = [v for v in entry['values'] if v['context'] == 'production']
            require(len(selected) == 1 and 'functions' in entry['scopes'], 'explicit_production_source_required')
            values[entry['key']] = selected[0]['value']
    require(values.get('SUPABASE_URL') == 'https://' + PROJECT + '.supabase.co', 'foreign_source_project')
    verify_service_key(values.get(SERVICE_KEY))
    sys.stdout.write(json.dumps({SERVICE_KEY: values[SERVICE_KEY]}))

# Check protected executable dependencies BEFORE importing any Python code as root.
if __name__ == '__main__':
    import hashlib
    try:
        if Path(__file__).absolute() != BUNDLE / 'production-deletion-window.py':
            raise ValueError()
        for path in [Path('/'), Path('/usr'), Path('/usr/local'), Path('/usr/local/libexec'), BUNDLE]:
            m = path.lstat()
            if not stat.S_ISDIR(m.st_mode) or m.st_uid or m.st_gid or m.st_mode & 0o022:
                raise ValueError()
        for path in [Path(__file__), BUNDLE / 'prepare-ws-preview-v3.py']:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as stream:
                m = os.fstat(stream.fileno())
                if not stat.S_ISREG(m.st_mode) or m.st_nlink != 1 or m.st_uid or m.st_gid or stat.S_IMODE(m.st_mode) != 0o644:
                    raise ValueError()
                if path.name == 'prepare-ws-preview-v3.py' and hashlib.sha256(stream.read()).hexdigest() != SECURE_SHA256:
                    raise ValueError()
    except Exception:
        sys.exit('NO-GO: protected_bundle_required')

spec = importlib.util.spec_from_file_location('secure_files', Path(__file__).with_name('prepare-ws-preview-v3.py'))
secure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(secure)
require, digest = secure.require, secure.digest


def render_on(source):
    v = secure.parse_env(source)
    require(v.get('ACCOUNT_DELETION_ENABLED') == '0', 'explicit_off_required')
    require(v.get('ACCOUNT_DELETION_AVATAR_TRACKING_MARKER', '') in ('', MARKER), 'foreign_marker')
    require(v.get('SUPABASE_URL') == 'https://' + PROJECT + '.supabase.co', 'wrong_production_origin')
    db = urllib.parse.urlsplit(v.get('SUPABASE_DB_URL', ''))
    user = urllib.parse.unquote(db.username or '')
    require(db.scheme in ('postgres', 'postgresql') and
            ((db.hostname == 'db.' + PROJECT + '.supabase.co' and user == 'postgres') or
             ((db.hostname or '').endswith('.pooler.supabase.com') and user == 'postgres.' + PROJECT)), 'wrong_production_database')
    require(v.get('XP_REDIS_VERSION') == '3' and v.get('XP_REDIS_ENV') == 'prod'
            and v.get('XP_KEY_NS') == 'kcswh:prod:xp:v3' and v.get('XP_TEST_MODE') != '1', 'production_v3_required')
    require(v.get('WS_AUTHORITATIVE_JOIN_ENABLED') == '1' and v.get('POKER_WS_INTERNAL_TOKEN')
            and v.get('PORT', '3000') == '3000', 'production_service_required')
    require(all(key not in v for key in ('SUPABASE_STAGE_PROJECT_REF', 'WS_BOT_REACTION_MIN_MS', 'WS_BOT_REACTION_MAX_MS')), 'foreign_service_configuration')
    require(all(v.get(key, 'production') == 'production' for key in ('CONTEXT', 'NETLIFY_CONTEXT', 'ARCADE_DEPLOY_TARGET')), 'foreign_context')
    endpoint = urllib.parse.urlsplit(v.get('UPSTASH_REDIS_REST_URL', ''))
    require(endpoint.scheme == 'https' and (endpoint.hostname or '').endswith('.upstash.io')
            and not endpoint.username and not endpoint.password and not endpoint.query and not endpoint.fragment
            and endpoint.path in ('', '/') and endpoint.port in (None, 443)
            and v.get('UPSTASH_REDIS_REST_TOKEN', '').strip(), 'redis_configuration_required')
    kept = ''.join(line for line in source.decode().splitlines(keepends=True)
                   if line.split('=', 1)[0].strip() not in ('ACCOUNT_DELETION_ENABLED', 'ACCOUNT_DELETION_AVATAR_TRACKING_MARKER'))
    if kept and not kept.endswith('\n'):
        kept += '\n'
    return (kept + 'ACCOUNT_DELETION_ENABLED=1\nACCOUNT_DELETION_AVATAR_TRACKING_MARKER=' + MARKER + '\n').encode()


def operate_service_role(mode, env, helper, approval, directory, helper_bytes, files, credential=None,
                         verify_key=verify_service_key):
    require(mode in ('prepare-service-role', 'dry-run-service-role', 'dry-run', 'preflight', 'verify', 'activate', 'restore'), 'invalid_operation')
    files.parents(directory)
    m = directory.lstat()
    require(stat.S_ISDIR(m.st_mode) and m.st_uid == files.uid and m.st_gid == files.gid
            and stat.S_IMODE(m.st_mode) == 0o700, 'unsafe_window_directory')
    fd = os.open(directory / 'operation.lock', os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'r+b') as lock:
        files.check_fd(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        anchor = files.read(approval, 0o600)
        approved = json.loads(anchor)
        original = files.read(directory / 'env.before', 0o600)
        parent_bytes = files.read(directory / 'manifest.json', 0o600)
        parent = json.loads(parent_bytes)
        require(approved.get('version') == 1 and approved.get('phase') == 'committed'
                and approved.get('after', {}).get('helper') == OLD_HELPER
                and parent.get('version') == 1 and parent.get('phase') in ('on', 'off', 'prepared')
                and parent.get('helper') == LEGACY_WINDOW_HELPER
                and parent.get('anchor') == digest(anchor)
                and parent.get('off') == digest(original) == approved['after']['prod']
                and parent.get('on') == digest(render_on(original))
                and digest(files.read(directory / 'helper.before', 0o600)) in (OLD_HELPER, LEGACY_WINDOW_HELPER),
                'historical_window_drift')
        require(SERVICE_KEY not in secure.parse_env(original), 'credential_already_in_historical_baseline')
        current, installed = files.read(env, 0o600), files.read(helper, 0o755)
        manifest, secret = directory / 'service-role.json', directory / 'service-role.env'
        if mode in ('prepare-service-role', 'dry-run-service-role'):
            require(isinstance(credential, dict) and set(credential) == {SERVICE_KEY}, 'single_service_role_required')
            key = credential[SERVICE_KEY]
            verify_key(key)
            validate_service_key(key)
            if not manifest.exists():
                require(current == (render_on(original) if parent['phase'] == 'on' else original), 'environment_drift')
                require(digest(installed) in (LEGACY_WINDOW_HELPER, digest(helper_bytes)), 'helper_drift')
                if mode == 'dry-run-service-role':
                    require(digest(installed) == LEGACY_WINDOW_HELPER, 'interrupted_upgrade_requires_prepare')
                    return 'service-role-ready'
                if digest(installed) == LEGACY_WINDOW_HELPER:
                    files.once(directory / 'service-role.helper.before', installed)
                require(digest(files.read(directory / 'service-role.helper.before', 0o600)) == LEGACY_WINDOW_HELPER,
                        'missing_credential_helper_backup')
                files.once(secret, (SERVICE_KEY + '=' + key + '\n').encode())
                # Install fail-closed reader BEFORE a transition can change env bytes.
                # A crash before the new manifest now rejects the old helper hash.
                files.atomic(helper, helper_bytes, 0o755, {LEGACY_WINDOW_HELPER, digest(helper_bytes)})
                off = original + (b'' if original.endswith(b'\n') else b'\n') + files.read(secret, 0o600)
                state = {'version': 1, 'phase': 'preparing', 'anchor': digest(anchor), 'parent': digest(parent_bytes),
                         'credential': digest(files.read(secret, 0o600)), 'off': digest(off),
                         'on': digest(render_on(off)), 'helper': digest(helper_bytes),
                         'initialPhase': 'on' if parent['phase'] == 'on' else 'off'}
                files.atomic(manifest, json.dumps(state, sort_keys=True).encode(), 0o600)
            require(files.read(secret, 0o600) == (SERVICE_KEY + '=' + key + '\n').encode(), 'credential_change_not_authorized')
        require(manifest.exists(), 'service_role_prepare_required')
        installed = files.read(helper, 0o755)
        state = json.loads(files.read(manifest, 0o600))
        credential_bytes = files.read(secret, 0o600)
        values = secure.parse_env(credential_bytes)
        require(set(values) == {SERVICE_KEY}, 'single_service_role_required')
        validate_service_key(values[SERVICE_KEY])
        require(credential_bytes == (SERVICE_KEY + '=' + values[SERVICE_KEY] + '\n').encode(), 'noncanonical_credential')
        off = original + (b'' if original.endswith(b'\n') else b'\n') + credential_bytes
        on = render_on(off)
        require(state.get('version') == 1 and state.get('phase') in ('preparing', 'on', 'off', 'activating', 'restoring')
                and state.get('initialPhase') in ('on', 'off') and state.get('anchor') == digest(anchor)
                and state.get('parent') == digest(parent_bytes) and state.get('credential') == digest(credential_bytes)
                and state.get('off') == digest(off) and state.get('on') == digest(on)
                and state.get('helper') == digest(helper_bytes) and installed == helper_bytes
                and digest(files.read(directory / 'service-role.helper.before', 0o600)) == LEGACY_WINDOW_HELPER,
                'service_role_manifest_drift')
        if mode in ('dry-run-service-role', 'dry-run', 'preflight', 'verify'):
            require((state['phase'] == 'on' and current == on) or (state['phase'] == 'off' and current == off),
                    'incomplete_service_role_operation')
            return state['phase']
        if mode == 'prepare-service-role':
            require(state['phase'] in ('preparing', state['initialPhase']), 'service_role_already_transitioned')
            target_phase = state['initialPhase']
        else:
            require(state['phase'] != 'preparing', 'prepare_incomplete')
            require(mode != 'activate' or state['phase'] != 'restoring', 'restore_in_progress')
            target_phase = 'on' if mode == 'activate' else 'off'
            state['phase'] = 'activating' if mode == 'activate' else 'restoring'
            files.atomic(manifest, json.dumps(state, sort_keys=True).encode(), 0o600)
        allowed = {digest(off), digest(on)}
        if state['phase'] == 'preparing':
            allowed.add(digest(render_on(original) if state['initialPhase'] == 'on' else original))
        target = on if target_phase == 'on' else off
        files.atomic(env, target, 0o600, allowed)
        require(files.read(env, 0o600) == target, 'write_verification_failed')
        state['phase'] = target_phase
        files.atomic(manifest, json.dumps(state, sort_keys=True).encode(), 0o600)
        return target_phase


def operate(mode, env, helper, approval, directory, helper_bytes, files=None, credential=None,
            verify_key=verify_service_key):
    files = files or secure.SecureFiles()
    if mode in ('prepare-service-role', 'dry-run-service-role') or (directory / 'service-role.json').exists():
        return operate_service_role(mode, env, helper, approval, directory, helper_bytes, files, credential, verify_key)
    require(not (directory / 'service-role.env').exists(), 'incomplete_service_role_install')
    require(mode in ('dry-run', 'preflight', 'prepare', 'activate', 'verify', 'restore'), 'invalid_operation')
    anchor = files.read(approval, 0o600)
    approved = json.loads(anchor)
    require(approved.get('version') == 1 and approved.get('phase') == 'committed'
            and approved.get('after', {}).get('helper') == OLD_HELPER, 'unapproved_baseline_record')
    current, installed = files.read(env, 0o600), files.read(helper, 0o755)
    files.parents(directory)
    if not directory.exists():
        require(digest(current) == approved['after']['prod'], 'baseline_drift')
        render_on(current)
        require(digest(installed) in (OLD_HELPER, digest(helper_bytes)), 'unapproved_helper')
        if mode in ('dry-run', 'preflight'):
            return 'baseline'
        require(mode == 'prepare', 'prepare_required')
        directory.mkdir(mode=0o700)
        files.sync_dir(directory.parent)
    m = directory.lstat()
    require(stat.S_ISDIR(m.st_mode) and m.st_uid == files.uid and m.st_gid == files.gid
            and stat.S_IMODE(m.st_mode) == 0o700, 'unsafe_window_directory')
    read_only = mode in ('dry-run', 'preflight', 'verify')
    fd = os.open(directory / 'operation.lock', os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK | (0 if read_only else os.O_CREAT), 0o600)
    with os.fdopen(fd, 'r+b') as lock:
        files.check_fd(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(files.read(approval, 0o600) == anchor, 'baseline_record_drift')
        current, installed = files.read(env, 0o600), files.read(helper, 0o755)
        manifest = directory / 'manifest.json'
        if not manifest.exists():
            require(mode == 'prepare' and digest(current) == approved['after']['prod'], 'prepare_required')
            on = render_on(current)
            require(digest(installed) in (OLD_HELPER, digest(helper_bytes)), 'unapproved_helper')
            files.once(directory / 'env.before', current)
            files.once(directory / 'helper.before', installed)
            state = {'version': 1, 'phase': 'preparing', 'anchor': digest(anchor),
                     'off': digest(current), 'on': digest(on), 'helper': digest(helper_bytes)}
            files.atomic(manifest, json.dumps(state, sort_keys=True).encode(), 0o600)
        state = json.loads(files.read(manifest, 0o600))
        before = files.read(directory / 'env.before', 0o600)
        on = render_on(before)
        old_helper = files.read(directory / 'helper.before', 0o600)
        require(state.get('version') == 1 and state.get('phase') in
                ('preparing', 'prepared', 'activating', 'on', 'restoring', 'off'), 'unknown_window_state')
        require(state.get('anchor') == digest(anchor) and state.get('off') == digest(before) == approved['after']['prod']
                and state.get('on') == digest(on) and state.get('helper') == digest(helper_bytes), 'manifest_drift')
        require(digest(old_helper) in (OLD_HELPER, digest(helper_bytes)) and installed in (old_helper, helper_bytes), 'helper_drift')
        require(current in (before, on), 'environment_drift')
        phase = state['phase']
        if read_only:
            require(installed == helper_bytes and ((phase in ('prepared', 'off') and current == before)
                    or (phase == 'on' and current == on)), 'incomplete_window_operation')
            return phase
        if mode == 'prepare':
            require(phase in ('preparing', 'prepared', 'off') and current == before, 'window_not_off')
            files.atomic(helper, helper_bytes, 0o755, {digest(installed)})
            state['phase'] = 'prepared'
        else:
            require(installed == helper_bytes and phase != 'preparing', 'prepare_incomplete')
            if mode == 'activate':
                validate_service_key(secure.parse_env(before).get(SERVICE_KEY))
            require(mode != 'activate' or phase in ('prepared', 'off', 'activating', 'on'), 'restore_in_progress')
            state['phase'] = 'activating' if mode == 'activate' else 'restoring'
            files.atomic(manifest, json.dumps(state, sort_keys=True).encode(), 0o600)
            target = on if mode == 'activate' else before
            files.atomic(env, target, 0o600, {state['off'], state['on']})
            require(files.read(env, 0o600) == target, 'write_verification_failed')
            state['phase'] = 'on' if mode == 'activate' else 'off'
        files.atomic(manifest, json.dumps(state, sort_keys=True).encode(), 0o600)
        return state['phase']


def main():
    if len(sys.argv) == 2 and sys.argv[1] == 'export-service-role':
        export_service_role()
        return
    require(os.geteuid() == 0 and len(sys.argv) == 2, 'root_and_fixed_mode_required')
    os.umask(0o077)
    files = secure.SecureFiles()
    files.read(Path(__file__), 0o644)
    files.read(BUNDLE / 'prepare-ws-preview-v3.py', 0o644)
    helper = files.read(BUNDLE / 'ws-production-env-preflight.mjs', 0o644)
    require(digest(helper) == HELPER_SHA256, 'reviewed_helper_required')
    # Share the existing deploy lock; never create/chown/chmod it or expand sudo.
    fd = os.open('/opt/ws-server/.deploy-maintenance.lock', os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'r+b') as lock:
        m = os.fstat(lock.fileno())
        require(stat.S_ISREG(m.st_mode) and m.st_nlink == 1 and m.st_uid in (0, pwd.getpwnam('copilot').pw_uid)
                and m.st_gid == grp.getgrnam('arcade-deploy').gr_gid and stat.S_IMODE(m.st_mode) == 0o660, 'unsafe_deploy_lock')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current = Path('/opt/ws-server/.deploy-maintenance.lock').lstat()
        require((current.st_dev, current.st_ino) == (m.st_dev, m.st_ino), 'deploy_lock_replaced')
        credential = None
        if sys.argv[1] in ('prepare-service-role', 'dry-run-service-role'):
            require(not sys.stdin.isatty(), 'credential_pipe_required')
            credential = json.loads(sys.stdin.buffer.read(16385))
        phase = operate(sys.argv[1], ENV, HELPER, APPROVAL, DIRECTORY, helper, files, credential)
    print(json.dumps({'phase': phase, 'restart': False,
                      'providerOperations': sys.argv[1] in ('prepare-service-role', 'dry-run-service-role'),
                      'providerReads': sys.argv[1] in ('prepare-service-role', 'dry-run-service-role'), 'providerWrites': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        reason = str(error) if isinstance(error, secure.Refused) else 'protected_operation_failed_preserve_evidence'
        sys.stderr.write('NO-GO: ' + reason + '\n')
        sys.exit(1)
