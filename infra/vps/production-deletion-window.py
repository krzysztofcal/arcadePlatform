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

BUNDLE = Path('/usr/local/libexec/arcade-production-deletion-window')
SECURE_SHA256 = '63787466ec6e4163f60e09510777df04c38cd2e8d20cb26d6257bcb550173740'
OLD_HELPER = '6595b12674328d1dd4554a1dc1aed380afb9037760be964175ad3221a64680a2'
HELPER_SHA256 = 'af861b5eb2d63429114fd064c88ff575179df6d955293e24a458f3c65cc00562'
ENV = Path('/etc/arcadeplatform/ws-server.env')
HELPER = Path('/usr/local/sbin/arcade-ws-production-env-preflight')
APPROVAL = Path('/var/backups/arcade-xp-v3-cutover/state.json')
DIRECTORY = Path('/var/backups/arcade-production-deletion-window')
MARKER = 'prod-avatar-authority-20261022'
PROJECT = 'otbqfijerkieoxwpxjnm'

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


def operate(mode, env, helper, approval, directory, helper_bytes, files=None):
    files = files or secure.SecureFiles()
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
        phase = operate(sys.argv[1], ENV, HELPER, APPROVAL, DIRECTORY, helper, files)
    print(json.dumps({'phase': phase, 'restart': False, 'providerOperations': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        reason = str(error) if isinstance(error, secure.Refused) else 'protected_operation_failed_preserve_evidence'
        sys.stderr.write('NO-GO: ' + reason + '\n')
        sys.exit(1)
