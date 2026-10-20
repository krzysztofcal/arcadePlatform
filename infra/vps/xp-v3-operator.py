#!/usr/bin/python3
"""One-time protected WS credential/configuration operation. No reset/deploy/restart.
SecureFiles is reused from the reviewed Preview preparation (fe49197b...).
"""
import fcntl
import contextlib
import grp
import getpass
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request
import urllib.error

BACKUP = Path('/var/backups/arcade-xp-v3-cutover')
EXPORT = Path('/var/lib/arcade-xp-v3')
TARGETS = {
    'stage': (Path('/opt/arcade-ws-preview/.env.preview'), 0o600),
    'prod': (Path('/etc/arcadeplatform/ws-server.env'), 0o600),
    'approval': (Path('/var/backups/arcade-ws-preview-v3/manifest.json'), 0o600),
    'helper': (Path('/usr/local/sbin/arcade-ws-production-env-preflight'), 0o755),
}
REFS = {'stage': 'krydukthwdvccggbyjfw', 'prod': 'otbqfijerkieoxwpxjnm'}
ENDPOINT_HASH = 'c6e6a1508c51ef4c6cc22e035d54487a1afe36123a8f4610224c848d4b21e762'
PROD_HELPER_HASH = '6595b12674328d1dd4554a1dc1aed380afb9037760be964175ad3221a64680a2'
STAGE_HELPER_HASH = '87f1fd25ca5db2ce0203b2dc438deb2bca43ab615514fdb478ca03589305cde8'
REDIS_KEYS = ('UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN')

class Refused(Exception):
    pass

def require(condition, reason):
    if not condition:
        raise Refused(reason)

def digest(data):
    return hashlib.sha256(data).hexdigest()

def parse_env(data):
    result = {}
    for raw in data.decode('utf8').splitlines():
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'([A-Z][A-Z0-9_]*)=(.*)', line)
        require(match is not None and match[1] not in result, 'ambiguous_environment')
        value = match[2].strip()
        if value.startswith(('"', "'")):
            require(len(value) > 1 and value[-1] == value[0], 'invalid_quote')
            value = value[1:-1]
        result[match[1]] = value
    return result

def validate_credentials(credentials, check_endpoint=True):
    require(set(credentials) == set(REDIS_KEYS), 'unexpected_credential_fields')
    url, token = (credentials[key] for key in REDIS_KEYS)
    require(isinstance(url, str) and isinstance(token, str), 'invalid_credentials')
    require(re.fullmatch(r'[A-Za-z0-9._~-]+', token or '') is not None, 'invalid_token_format')
    parsed = urllib.parse.urlsplit(url)
    require(parsed.scheme == 'https' and (parsed.hostname or '').endswith('.upstash.io')
            and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment
            and parsed.path in ('', '/') and parsed.port in (None, 443), 'invalid_endpoint')
    if check_endpoint:
        require(digest(url.rstrip('/').encode()) == ENDPOINT_HASH, 'wrong_existing_database')

def render(original, target, credentials, check_endpoint=True):
    validate_credentials(credentials, check_endpoint)
    values = parse_env(original)
    ref = REFS[target]
    require(values.get('SUPABASE_URL', values.get('SUPABASE_URL_V2', '')).rstrip('/')
            == 'https://' + ref + '.supabase.co', 'wrong_supabase_origin')
    db = urllib.parse.urlsplit(values.get('SUPABASE_DB_URL', ''))
    user = urllib.parse.unquote(db.username or '')
    require(db.scheme in ('postgres', 'postgresql') and
            ((db.hostname == 'db.' + ref + '.supabase.co' and user == 'postgres') or
             ((db.hostname or '').endswith('.pooler.supabase.com') and user == 'postgres.' + ref)), 'wrong_database')
    require(values.get('ACCOUNT_DELETION_ENABLED', '0') == '0' and values.get('XP_TEST_MODE') != '1', 'unsafe_feature_flags')
    require(values.get('XP_KEY_NS', '') in ('', 'kcswh:xp:v2', f'kcswh:{target}:xp:v3')
            and values.get('XP_REDIS_ENV', '') in ('', target)
            and values.get('XP_REDIS_VERSION', '') in ('', '2', '3'), 'foreign_namespace')
    contexts = ('production',) if target == 'prod' else ('deploy-preview', 'branch-deploy', 'development', 'dev')
    require(all(not values.get(key) or values[key] in contexts for key in
                ('ARCADE_DEPLOY_TARGET', 'CONTEXT', 'NETLIFY_CONTEXT')), 'wrong_deployment_context')
    patch = {**credentials, 'XP_REDIS_VERSION': '3', 'XP_REDIS_ENV': target,
             'XP_KEY_NS': f'kcswh:{target}:xp:v3', 'ACCOUNT_DELETION_ENABLED': '0'}
    kept = ''.join(line for line in original.decode().splitlines(keepends=True)
                   if line.split('=', 1)[0].strip() not in patch)
    if kept and not kept.endswith('\n'):
        kept += '\n'
    return (kept + ''.join(key + '=' + value + '\n' for key, value in patch.items())).encode()

def update_approval(original, before, after):
    record = json.loads(original)
    require(record.get('version') == 1 and record.get('phase') == 'complete'
            and record.get('desired', {}).get('env') == digest(before), 'stage_approval_drift')
    record['desired']['env'] = digest(after)
    return json.dumps(record, sort_keys=True).encode()

class SecureFiles:
    """All CLI calls use root ownership and the actual filesystem root.

    Tests use an unprivileged temporary boundary, never real VPS paths.
    """
    def __init__(self, uid=0, gid=0, boundary=Path('/')):
        self.uid, self.gid, self.boundary = uid, gid, boundary

    def parents(self, path):
        current = path.parent
        require(current.is_relative_to(self.boundary), 'path_outside_boundary')
        while True:
            meta = current.lstat()
            require(stat.S_ISDIR(meta.st_mode) and meta.st_uid == self.uid
                    and meta.st_gid == self.gid and not meta.st_mode & 0o022,
                    'untrusted_parent_directory')
            if current == self.boundary:
                break
            current = current.parent

    def check_fd(self, fd, mode):
        meta = os.fstat(fd)
        require(stat.S_ISREG(meta.st_mode) and meta.st_nlink == 1
                and meta.st_uid == self.uid and meta.st_gid == self.gid
                and stat.S_IMODE(meta.st_mode) == mode, 'unsafe_file_metadata')

    def read(self, path, mode):
        self.parents(path)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            self.check_fd(stream.fileno(), mode)
            data = stream.read(1048577)
            require(len(data) <= 1048576, 'file_too_large')
            return data

    def sync_dir(self, directory):
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def atomic(self, path, data, mode, allowed=None):
        self.parents(path)
        if allowed is not None:
            require(digest(self.read(path, mode)) in allowed, 'target_changed')
        else:
            try:
                self.read(path, mode)
            except FileNotFoundError:
                require(not path.is_symlink(), 'unsafe_file_metadata')
        fd, temporary = tempfile.mkstemp(prefix='.1117-', dir=path.parent)
        try:
            with os.fdopen(fd, 'wb') as stream:
                os.fchown(stream.fileno(), self.uid, self.gid)
                os.fchmod(stream.fileno(), mode)
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            if allowed is not None:
                require(digest(self.read(path, mode)) in allowed, 'target_changed')
            os.replace(temporary, path)
            self.sync_dir(path.parent)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def once(self, path, data):
        self.parents(path)
        try:
            existing = self.read(path, 0o600)
        except FileNotFoundError:
            # Protected directory + operation lock; a crash cannot expose a partial backup.
            self.atomic(path, data, 0o600)
        else:
            require(existing == data, 'backup_differs')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Refused('redirect_forbidden')

def redis(credentials, command):
    validate_credentials(credentials)
    request = urllib.request.Request(credentials[REDIS_KEYS[0]].rstrip('/'),
        data=json.dumps(command).encode(), headers={'Authorization': 'Bearer ' + credentials[REDIS_KEYS[1]],
        'Content-Type': 'application/json'})
    client = urllib.request.build_opener(NoRedirect)
    try:
        with client.open(request, timeout=15) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        # Do not print body, URL, credential or underlying exception.
        return error.code, json.loads(error.read(8192))

def verify_new(old, new):
    require(old[REDIS_KEYS[1]] != new[REDIS_KEYS[1]], 'credential_not_rotated')
    status, value = redis(old, ['PING'])
    require(status == 401 and re.search(r'WRONGPASS|unauthoriz|invalid.*token',
            str(value.get('error', '')), re.I), 'old_credential_not_revoked')
    require(redis(new, ['PING']) == (200, {'result': 'PONG'}), 'new_credential_failed')
    require(redis(new, ['EVAL', 'return 1', 0]) == (200, {'result': 1}), 'new_lua_permission_failed')

def directory(files, path, mode):
    files.parents(path)
    try:
        os.mkdir(path, mode)
        files.sync_dir(path.parent)
    except FileExistsError:
        pass
    meta = path.lstat()
    require(stat.S_ISDIR(meta.st_mode) and meta.st_uid == 0 and meta.st_gid == 0
            and stat.S_IMODE(meta.st_mode) == mode, 'unsafe_operator_directory')

def publish(files, name, data):
    # Root-owned parent prevents replacing the path. Only these two-field Redis
    # documents are exposed to copilot, never the env backups/Supabase credentials.
    directory(files, EXPORT, 0o755)
    actor = pwd.getpwnam('copilot')
    target = EXPORT / name
    try:
        fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        fd = None
    if fd is not None:
        with os.fdopen(fd, 'rb') as stream:
            meta = os.fstat(stream.fileno())
            require(stat.S_ISREG(meta.st_mode) and meta.st_nlink == 1 and meta.st_uid == actor.pw_uid
                    and stat.S_IMODE(meta.st_mode) == 0o600 and stream.read() == data, 'export_changed')
        return
    fd, temporary = tempfile.mkstemp(prefix='.redis-', dir=EXPORT)
    try:
        with os.fdopen(fd, 'wb') as stream:
            os.fchmod(stream.fileno(), 0o600)
            stream.write(data)
            stream.flush()
            os.fchown(stream.fileno(), actor.pw_uid, actor.pw_gid)
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        files.sync_dir(EXPORT)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

@contextlib.contextmanager
def production_deploy_lock():
    # Reuse the deployment workflow's lock. Never create/chown/change its mode.
    path = Path('/opt/ws-server/.deploy-maintenance.lock')
    fd = os.open(path, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        meta = os.fstat(fd)
        require(stat.S_ISREG(meta.st_mode) and meta.st_nlink == 1
                and meta.st_uid in (0, pwd.getpwnam('copilot').pw_uid)
                and meta.st_gid == grp.getgrnam('arcade-deploy').gr_gid
                and stat.S_IMODE(meta.st_mode) == 0o660, 'unsafe_deploy_lock')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current = path.lstat()
        require((current.st_dev, current.st_ino) == (meta.st_dev, meta.st_ino), 'deploy_lock_replaced')
        yield
    finally:
        os.close(fd)

def run(mode):
    require(os.geteuid() == 0, 'root_required')
    files = SecureFiles()
    bundle = Path(__file__).resolve().parent
    files.read(Path(__file__), 0o600)  # Reject execution from user-writable/tmp paths.
    helper = files.read(bundle / 'ws-production-env-preflight.mjs', 0o600)
    require(digest(helper) == PROD_HELPER_HASH, 'bundle_helper_changed')
    require(digest(files.read(Path('/usr/local/sbin/arcade-ws-preview-env-preflight'), 0o755))
            == STAGE_HELPER_HASH, 'stage_helper_changed')
    directory(files, BACKUP, 0o700)
    lock_fd = os.open(BACKUP / 'operation.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    with os.fdopen(lock_fd, 'r+b') as lock, production_deploy_lock():
        files.check_fd(lock.fileno(), 0o600)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        state_path = BACKUP / 'state.json'
        try:
            state_bytes = files.read(state_path, 0o600)
        except FileNotFoundError:
            state_bytes = None
        if state_bytes is not None:
            state = json.loads(state_bytes)
            require(state.get('version') == 1 and state.get('phase') in ('prepared', 'committing', 'committed'), 'unknown_state')
            original = {key: files.read(BACKUP / (key + '.before'), 0o600) for key in TARGETS}
            require(all(digest(original[key]) == state['before'][key] for key in TARGETS), 'backup_corrupt')
        else:
            require(mode == 'prepare', 'prepare_required')
            original = {key: files.read(target, perms) for key, (target, perms) in TARGETS.items()}
            old = {key: parse_env(original['stage']).get(key) for key in REDIS_KEYS}
            validate_credentials(old)
            for target in ('stage', 'prod'):
                values = parse_env(original[target])
                require(not values.get(REDIS_KEYS[0]) or values[REDIS_KEYS[0]].rstrip('/') == old[REDIS_KEYS[0]].rstrip('/'), 'endpoint_mismatch')
                require(not values.get(REDIS_KEYS[1]) or values[REDIS_KEYS[1]] == old[REDIS_KEYS[1]], 'current_credential_mismatch')
                candidate = render(original[target], target, old)
                files.once(BACKUP / (target + '.candidate'), candidate)
            require(json.loads(original['approval']).get('desired', {}).get('helper') == STAGE_HELPER_HASH, 'stage_helper_approval_drift')
            update_approval(original['approval'], original['stage'], original['stage'])
            # Real Production system-identifier and Redis LIVE checks against the
            # staged candidate, without altering active configuration.
            code = "const m=await import('file://'+process.argv[2]);if(m.runPreflight({envFile:process.argv[3],requireRedisV3:true})!=='PASS LIVE Redis V3 prod')process.exit(1);"
            checked = subprocess.run(['/usr/bin/node', '--input-type=module', '-e', code,
                str(Path(__file__)), str(bundle / 'ws-production-env-preflight.mjs'), str(BACKUP / 'prod.candidate')],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
            require(checked.returncode == 0, 'production_candidate_preflight_failed')
            checked = subprocess.run(['/usr/local/sbin/arcade-ws-preview-env-preflight'], stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, timeout=30, check=False)
            require(checked.returncode == 0 and checked.stdout.startswith(b'PASS LIVE Redis V3 stage;'), 'stage_preflight_failed')
            for key, value in original.items():
                files.once(BACKUP / (key + '.before'), value)
            files.once(BACKUP / 'redis-old.json', json.dumps(old, sort_keys=True).encode())
            state = {'version': 1, 'phase': 'prepared', 'before': {key: digest(value) for key, value in original.items()}}
            files.atomic(state_path, json.dumps(state, sort_keys=True).encode(), 0o600)
        old_bytes = files.read(BACKUP / 'redis-old.json', 0o600)
        old = json.loads(old_bytes)
        publish(files, 'redis-old.json', old_bytes)
        if mode == 'prepare':
            expected = state.get('after', {**state['before'], 'helper': digest(helper)})
            current_helper = files.read(TARGETS['helper'][0], 0o755)
            require(digest(current_helper) in {state['before']['helper'], digest(helper)}, 'helper_drift')
            if current_helper != helper:
                files.atomic(TARGETS['helper'][0], helper, 0o755, {state['before']['helper']})
            require(all(digest(files.read(target, perms)) == expected[key] for key, (target, perms) in TARGETS.items()), 'active_configuration_drift')
            return {'phase': state['phase'], 'protectedPreflightInstalled': True, 'activeEnvironmentChanged': False, 'restart': False}
        if state['phase'] == 'prepared':
            try:
                new = json.loads(files.read(BACKUP / 'redis-new.json', 0o600))
            except FileNotFoundError:
                require(sys.stdin.isatty() and sys.stderr.isatty(), 'interactive_terminal_required')
                token = getpass.getpass('New STANDARD Upstash REST Token (hidden): ')
                new = {REDIS_KEYS[0]: old[REDIS_KEYS[0]], REDIS_KEYS[1]: token}
            verify_new(old, new)
            desired = {target: render(original[target], target, new) for target in ('stage', 'prod')}
            desired['approval'] = update_approval(original['approval'], original['stage'], desired['stage'])
            desired['helper'] = helper
            files.once(BACKUP / 'redis-new.json', json.dumps(new, sort_keys=True).encode())
            for key, value in desired.items():
                files.once(BACKUP / (key + '.after'), value)
            state.update(phase='committing', after={key: digest(value) for key, value in desired.items()})
            files.atomic(state_path, json.dumps(state, sort_keys=True).encode(), 0o600)
        new_bytes = files.read(BACKUP / 'redis-new.json', 0o600)
        verify_new(old, json.loads(new_bytes))
        for key, (target, perms) in TARGETS.items():
            after = files.read(BACKUP / (key + '.after'), 0o600)
            require(digest(after) == state['after'][key], 'candidate_corrupt')
            current = files.read(target, perms)
            require(digest(current) in {state['before'][key], state['after'][key]}, 'target_changed')
            if current != after:
                files.atomic(target, after, perms, {state['before'][key], state['after'][key]})
        state['phase'] = 'committed'
        files.atomic(state_path, json.dumps(state, sort_keys=True).encode(), 0o600)
        publish(files, 'redis-new.json', new_bytes)
        return {'phase': 'committed', 'activeConfigurationChanged': True, 'restart': False, 'redisDataChanged': False}

if __name__ == '__main__':
    os.umask(0o077)
    try:
        require(len(sys.argv) == 2 and sys.argv[1] in ('prepare', 'commit'), 'invalid_arguments')
        print(json.dumps(run(sys.argv[1])))
    except Exception as error:
        code = str(error) if isinstance(error, Refused) else 'operator_io_failed'
        sys.stderr.write(json.dumps({'status': 'NO-GO', 'code': code}) + '\n')
        sys.exit(1)
