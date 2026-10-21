#!/usr/bin/python3
"""Fixed Stage Preview feature window. Never restarts services or accesses providers."""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys

# Validate CLI code location before importing executable helper code. Never sudo a /tmp copy.
if __name__ == '__main__':
    bundle = Path('/usr/local/libexec/arcade-ws-preview-v3')
    if Path(__file__).absolute() != bundle / 'stage-deletion-window.py':
        sys.exit('NO-GO: protected_bundle_required')
    for path in [Path('/'), Path('/usr'), Path('/usr/local'), Path('/usr/local/libexec'), bundle]:
        meta = path.lstat()
        if not stat.S_ISDIR(meta.st_mode) or meta.st_uid or meta.st_gid or meta.st_mode & 0o022:
            sys.exit('NO-GO: untrusted_code_directory')
    for path in [Path(__file__), bundle / 'prepare-ws-preview-v3.py']:
        meta = path.lstat()
        if not stat.S_ISREG(meta.st_mode) or meta.st_nlink != 1 or meta.st_uid or meta.st_gid or stat.S_IMODE(meta.st_mode) != 0o644:
            sys.exit('NO-GO: untrusted_code_file')

# Reuse the reviewed filesystem primitives without changing the Redis operator.
spec = importlib.util.spec_from_file_location('preview_secure', Path(__file__).with_name('prepare-ws-preview-v3.py'))
secure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(secure)
require, digest = secure.require, secure.digest
ROOT = Path('/usr/local/libexec/arcade-ws-preview-v3')
WINDOW = Path('/var/backups/arcade-stage-deletion-window')
MARKER = 'stage-avatar-authority-20261021'
OLD_HELPER = '87f1fd25ca5db2ce0203b2dc438deb2bca43ab615514fdb478ca03589305cde8'
HELPER_SHA256 = '704dc9a8dd59fa96625f63199f3605b888b7eaecabd4a4dcb724a4862d22993e'


def render_on(source):
    values = secure.parse_env(source)
    secure.validate_stage(values)  # including OFF, Stage identity and service pins
    require(values.get('ACCOUNT_DELETION_ENABLED') == '0', 'explicit_off_required')
    require(values.get('XP_REDIS_VERSION') == '3' and values.get('XP_REDIS_ENV') == 'stage'
            and values.get('XP_KEY_NS') == 'kcswh:stage:xp:v3', 'v3_required')
    require(all(values.get(k) for k in secure.REDIS_KEYS), 'redis_required')
    require(values.get('ACCOUNT_DELETION_AVATAR_TRACKING_MARKER', '') in ('', MARKER), 'foreign_marker')
    lines = source.decode().splitlines(keepends=True)
    flag = 'ACCOUNT_DELETION_ENABLED'
    marker = 'ACCOUNT_DELETION_AVATAR_TRACKING_MARKER'
    lines = [line for line in lines if line.split('=', 1)[0].strip() not in (flag, marker)]
    kept = ''.join(lines)
    if kept and not kept.endswith('\n'):
        kept += '\n'
    return (kept + flag + '=1\n' + marker + '=' + MARKER + '\n').encode()


def operate(operation, env, helper, preparation, directory, helper_bytes, files=None):
    files = files or secure.SecureFiles()
    require(operation in ('preflight', 'dry-run', 'prepare', 'activate', 'verify', 'deactivate', 'restore'), 'invalid_operation')
    original_record = files.read(preparation, 0o600)
    record = json.loads(original_record)
    require(record.get('version') == 1 and record.get('phase') == 'complete', 'baseline_not_approved')
    current = files.read(env, 0o600)
    installed = files.read(helper, 0o755)
    files.parents(directory / 'manifest.json') if directory.exists() else files.parents(directory)
    if not directory.exists():
        require(digest(current) == record['desired']['env'], 'baseline_drift')
        render_on(current)
        require(digest(installed) in (OLD_HELPER, digest(helper_bytes)), 'unapproved_helper')
        if operation in ('preflight', 'dry-run'):
            return 'baseline'
        require(operation == 'prepare', 'prepare_required')
        directory.mkdir(mode=0o700)
        files.sync_dir(directory.parent)
    meta = directory.lstat()
    require(stat.S_ISDIR(meta.st_mode) and meta.st_uid == files.uid and meta.st_gid == files.gid
            and stat.S_IMODE(meta.st_mode) == 0o700, 'unsafe_window_directory')
    read_only = operation in ('preflight', 'dry-run', 'verify')
    fd = os.open(directory / 'operation.lock', (0 if read_only else os.O_CREAT) | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    with os.fdopen(fd, 'r+b') as lock:
        files.check_fd(lock.fileno(), 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(files.read(preparation, 0o600) == original_record, 'preparation_drift')
        current = files.read(env, 0o600)
        installed = files.read(helper, 0o755)
        manifest = directory / 'manifest.json'
        if not manifest.exists():
            require(operation == 'prepare' and digest(current) == record['desired']['env'], 'prepare_required')
            before = current
            on = render_on(before)
            require(digest(installed) in (OLD_HELPER, digest(helper_bytes)), 'unapproved_helper')
            files.once(directory / 'env.before', before)
            files.once(directory / 'helper.before', installed)
            state = {'version': 1, 'phase': 'preparing', 'baseline_record': digest(original_record),
                     'off': digest(before), 'on': digest(on), 'helper': digest(helper_bytes)}
            files.atomic(manifest, json.dumps(state, sort_keys=True).encode(), 0o600)
        state = json.loads(files.read(manifest, 0o600))
        before = files.read(directory / 'env.before', 0o600)
        on = render_on(before)
        require(state.get('version') == 1 and state.get('phase') in
                ('preparing', 'prepared', 'activating', 'on', 'restoring', 'off'), 'unknown_window_state')
        require(state.get('baseline_record') == digest(original_record)
                and state.get('off') == digest(before) == record['desired']['env']
                and state.get('on') == digest(on) and state.get('helper') == digest(helper_bytes), 'window_drift')
        require(current in (before, on), 'environment_drift')
        saved_helper = files.read(directory / 'helper.before', 0o600)
        require(digest(saved_helper) in (OLD_HELPER, digest(helper_bytes)), 'helper_backup_corrupt')
        require(installed in (saved_helper, helper_bytes), 'helper_drift')
        phase = state['phase']
        if operation in ('preflight', 'dry-run', 'verify'):
            require(installed == helper_bytes and ((phase in ('prepared', 'off') and current == before)
                    or (phase == 'on' and current == on)), 'incomplete_window_operation')
            return phase
        if operation == 'prepare':
            require(phase in ('preparing', 'prepared', 'off') and current == before, 'window_already_active')
            files.atomic(helper, helper_bytes, 0o755, {digest(installed)})
            state['phase'] = 'prepared'
        else:
            require(installed == helper_bytes, 'helper_install_incomplete')
            activating = operation == 'activate'
            require(phase != 'preparing', 'prepare_incomplete')
            require(not activating or phase in ('prepared', 'off', 'activating', 'on'), 'restore_in_progress')
            # Durable intent precedes the replace. Transitional states fail preflight.
            state['phase'] = 'activating' if activating else 'restoring'
            files.atomic(manifest, json.dumps(state, sort_keys=True).encode(), 0o600)
            target = on if activating else before
            files.atomic(env, target, 0o600, {state['off'], state['on']})
            require(files.read(env, 0o600) == target, 'write_verification_failed')
            state['phase'] = 'on' if activating else 'off'
        files.atomic(manifest, json.dumps(state, sort_keys=True).encode(), 0o600)
        return state['phase']


def main():
    require(os.geteuid() == 0, 'root_required')
    require(Path(__file__).absolute() == ROOT / 'stage-deletion-window.py', 'protected_bundle_required')
    os.umask(0o077)
    files = secure.SecureFiles()
    files.read(Path(__file__), 0o644)
    files.read(ROOT / 'prepare-ws-preview-v3.py', 0o644)
    helper = files.read(ROOT / 'ws-preview-env-preflight.mjs', 0o644)
    require(digest(helper) == HELPER_SHA256, 'helper_content_changed')
    require(len(sys.argv) == 2, 'invalid_arguments')
    phase = operate(sys.argv[1], secure.ENV, secure.HELPER, secure.BACKUP / 'manifest.json', WINDOW, helper, files)
    print(json.dumps({'phase': phase, 'restart': False, 'providerOperations': False}))


if __name__ == '__main__':
    try:
        main()
    except secure.Refused as error:
        sys.stderr.write('NO-GO: ' + str(error) + '\n')
        sys.exit(1)
    except Exception:
        sys.stderr.write('NO-GO: preserve evidence; reconcile interrupted operation; no secrets printed\n')
        sys.exit(1)
