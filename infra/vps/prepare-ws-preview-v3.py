#!/usr/bin/python3
"""Reviewed Stage-only configuration operation. No restart or Redis commands."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import urllib.parse
import urllib.request

ENV = Path('/opt/arcade-ws-preview/.env.preview')
HELPER = Path('/usr/local/sbin/arcade-ws-preview-env-preflight')
BACKUP = Path('/var/backups/arcade-ws-preview-v3')
BUNDLE = Path('/usr/local/libexec/arcade-ws-preview-v3')
STAGE = 'krydukthwdvccggbyjfw'
SETTINGS = {'XP_REDIS_VERSION': '3', 'XP_REDIS_ENV': 'stage',
            'XP_KEY_NS': 'kcswh:stage:xp:v3', 'ACCOUNT_DELETION_ENABLED': '0'}
REDIS_KEYS = ('UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN')
# Updated only together with the reviewed helper. Does not contain credentials.
HELPER_SHA256 = '385f3f13aac76b8a6f611aeb6fb779ec9231915dfa24ad4d24f1bb2d3a444373'


class Refused(Exception):
    """Only fixed, non-secret reasons may be returned to an operator."""


def require(condition, reason):
    if not condition:
        raise Refused(reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def parse_env(data):
    values = {}
    for line in data.decode('utf-8').splitlines():
        text = line.strip()
        if not text or text.startswith('#'):
            continue
        match = re.fullmatch(r'([A-Z][A-Z0-9_]*)=(.*)', text)
        require(match is not None, 'invalid_environment_syntax')
        key, value = match.groups()
        require(key not in values, 'duplicate_environment_key')
        value = value.strip()
        if value.startswith(('"', "'")):
            require(len(value) >= 2 and value[-1] == value[0], 'invalid_environment_quote')
            value = value[1:-1]
        values[key] = value
    return values


def validate_stage(values):
    require(values.get('SUPABASE_STAGE_PROJECT_REF') == STAGE, 'wrong_stage_project')
    require(values.get('SUPABASE_URL', values.get('SUPABASE_URL_V2', '')).removesuffix('/')
            == 'https://' + STAGE + '.supabase.co', 'wrong_stage_origin')
    db = urllib.parse.urlsplit(values.get('SUPABASE_DB_URL', ''))
    user = urllib.parse.unquote(db.username or '')
    direct = db.hostname == 'db.' + STAGE + '.supabase.co' and user == 'postgres'
    pooled = (db.hostname or '').endswith('.pooler.supabase.com') and user == 'postgres.' + STAGE
    require(db.scheme in ('postgres', 'postgresql') and (direct or pooled), 'wrong_stage_database')
    require(values.get('ACCOUNT_DELETION_ENABLED', '0') == '0', 'deletion_must_remain_disabled')
    require(values.get('XP_TEST_MODE') != '1', 'test_mode_forbidden')
    require(values.get('XP_REDIS_ENV', '') in ('', 'stage')
            and values.get('XP_REDIS_VERSION', '') in ('', '2', '3')
            and values.get('XP_KEY_NS', '') in ('', 'kcswh:xp:v2', 'kcswh:stage:xp:v3'),
            'foreign_redis_configuration')
    for key in ('ARCADE_DEPLOY_TARGET', 'CONTEXT', 'NETLIFY_CONTEXT'):
        require(not values.get(key) or values[key] in
                ('deploy-preview', 'branch-deploy', 'development', 'dev'), 'wrong_stage_context')
    require(bool(values.get('POKER_WS_INTERNAL_TOKEN', '').strip()), 'missing_preview_internal_token')
    require(values.get('PORT') == '3001' and values.get('WS_AUTHORITATIVE_JOIN_ENABLED') == '1',
            'wrong_preview_service_configuration')
    require('WS_BOT_REACTION_MIN_MS' not in values and 'WS_BOT_REACTION_MAX_MS' not in values,
            'legacy_bot_configuration')


def render_env(original, credentials):
    values = parse_env(original)
    validate_stage(values)
    require(isinstance(credentials, dict) and set(credentials) == set(REDIS_KEYS), 'unexpected_credential_fields')
    endpoint, token = (credentials[k] for k in REDIS_KEYS)
    require(isinstance(endpoint, str) and isinstance(token, str), 'invalid_credentials')
    require(endpoint and all(33 <= ord(c) <= 126 for c in endpoint), 'invalid_redis_endpoint')
    url = urllib.parse.urlsplit(endpoint)
    require(url.scheme == 'https' and (url.hostname or '').endswith('.upstash.io')
            and not url.username and not url.password and not url.query and not url.fragment
            and url.path in ('', '/') and url.port in (None, 443), 'invalid_redis_endpoint')
    require(re.fullmatch(r'[A-Za-z0-9._~-]+', token or '') is not None, 'invalid_redis_token')
    for key in REDIS_KEYS:
        require(not values.get(key) or values[key] == credentials[key], 'existing_credentials_differ')
    patch = {**SETTINGS, **credentials}
    kept = [line for line in original.decode('utf-8').splitlines(keepends=True)
            if line.split('=', 1)[0].strip() not in patch]
    prefix = ''.join(kept)
    if prefix and not prefix.endswith('\n'):
        prefix += '\n'
    return (prefix + ''.join(key + '=' + value + '\n' for key, value in patch.items())).encode('utf-8')


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


def transaction(env_path, helper_path, backup, helper_bytes, credentials=None,
                rollback=False, files=None):
    files = files or SecureFiles()
    # Fail before creating even a backup/lock if live paths are not protected.
    current = {'env': files.read(env_path, 0o600), 'helper': files.read(helper_path, 0o755)}
    files.parents(backup)
    if not backup.exists():
        backup.mkdir(mode=0o700)
        files.sync_dir(backup.parent)
    meta = backup.lstat()
    require(stat.S_ISDIR(meta.st_mode) and meta.st_uid == files.uid and meta.st_gid == files.gid
            and stat.S_IMODE(meta.st_mode) == 0o700, 'unsafe_backup_directory')
    files.parents(backup / 'operation.lock')
    lock_fd = os.open(backup / 'operation.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    with os.fdopen(lock_fd, 'r+b') as lock:
        files.check_fd(lock.fileno(), 0o600)
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Re-read after obtaining the operation lock, not before.
        current = {'env': files.read(env_path, 0o600), 'helper': files.read(helper_path, 0o755)}
        manifest = backup / 'manifest.json'
        if manifest.exists():
            state = json.loads(files.read(manifest, 0o600))
            require(state.get('version') == 1 and state.get('phase') in ('prepared', 'complete', 'rolled_back'), 'unknown_backup_format')
            original = {key: files.read(backup / (key + '.before'), 0o600) for key in current}
            require(all(digest(original[k]) == state['original'][k] for k in current), 'backup_corrupt')
        else:
            require(not rollback, 'backup_missing')
            original = current
            desired = {'env': render_env(original['env'], credentials), 'helper': helper_bytes}
            state = {'version': 1, 'original': {k: digest(v) for k, v in original.items()},
                     'desired': {k: digest(v) for k, v in desired.items()}, 'phase': 'prepared'}
            for key, value in original.items():
                files.once(backup / (key + '.before'), value)
            files.atomic(manifest, json.dumps(state, sort_keys=True).encode(), 0o600)
        if rollback:
            desired = original
        else:
            desired = {'env': render_env(original['env'], credentials), 'helper': helper_bytes}
            require(all(digest(desired[k]) == state['desired'][k] for k in desired), 'approved_input_changed')
        allowed = {k: {state['original'][k], state['desired'][k]} for k in current}
        require(all(digest(current[k]) in allowed[k] for k in current), 'target_changed')
        for key, path, mode in [('env', env_path, 0o600), ('helper', helper_path, 0o755)]:
            if current[key] != desired[key]:
                files.atomic(path, desired[key], mode, allowed[key])
            require(files.read(path, mode) == desired[key], 'write_verification_failed')
        require(files.read(env_path, 0o600) == desired['env']
                and files.read(helper_path, 0o755) == desired['helper'], 'write_verification_failed')
        state['phase'] = 'rolled_back' if rollback else 'complete'
        files.atomic(manifest, json.dumps(state, sort_keys=True).encode(), 0o600)
        return state['phase']


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Refused('redirect_forbidden')


def export_existing_redis():
    # Must be piped directly to the root consumer, never a terminal or regular file.
    require(os.geteuid() != 0 and stat.S_ISFIFO(os.fstat(sys.stdout.fileno()).st_mode), 'credential_pipe_required')
    config_path = Path.home() / '.config/netlify/config.json'
    # This is the operator's existing CLI data, not privileged executable code.
    # Validate the opened inode; native CLI directories may be group-writable.
    fd = os.open(config_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        SecureFiles(os.getuid(), os.getgid()).check_fd(stream.fileno(), 0o600)
        raw = stream.read(1048577)
        require(len(raw) <= 1048576, 'credential_source_too_large')
        config = json.loads(raw)
    token = config['users'][config['userId']]['auth']['token']
    site_id = json.loads(Path('/home/copilot/work/arcadePlatform/.netlify/state.json').read_text())['siteId']
    require(re.fullmatch(r'[a-zA-Z0-9-]+', site_id) is not None, 'invalid_site_id')
    client = urllib.request.build_opener(NoRedirect)

    def api(path):
        request = urllib.request.Request('https://api.netlify.com/api/v1/' + path,
                                         headers={'Authorization': 'Bearer ' + token})
        with client.open(request, timeout=15) as response:
            data = response.read(1048577)
            require(len(data) <= 1048576, 'provider_response_too_large')
            return json.loads(data)

    site = api('sites/' + site_id)
    require(site['name'] == 'playkcswh', 'wrong_netlify_site')
    entries = api('accounts/' + site['account_id'] + '/env?' + urllib.parse.urlencode(
        {'site_id': site_id, 'context_name': 'deploy-preview', 'scope': 'functions'}))

    def value(key):
        entry = next(e for e in entries if e['key'] == key)
        values = entry['values']
        require(all(v['context'] in ('all', 'deploy-preview') for v in values), 'unexpected_provider_context')
        selected = [v['value'] for v in values if v['context'] == 'deploy-preview']
        if not selected:
            selected = [v['value'] for v in values if v['context'] == 'all']
        require(len(selected) == 1, 'ambiguous_provider_value')
        return selected[0]

    require(value('SUPABASE_URL').rstrip('/') == 'https://' + STAGE + '.supabase.co', 'wrong_netlify_stage')
    sys.stdout.write(json.dumps({key: value(key) for key in REDIS_KEYS}))
    sys.stdout.flush()


def main():
    require(len(sys.argv) == 2 and sys.argv[1] in ('export-redis', 'apply', 'rollback'), 'invalid_operation')
    operation = sys.argv[1]
    if operation == 'export-redis':
        export_existing_redis()
        return
    require(os.geteuid() == 0, 'root_required')
    os.umask(0o077)
    files = SecureFiles()
    # Executable code must already be installed by the operator in this protected bundle.
    require(Path(__file__).absolute() == BUNDLE / 'prepare-ws-preview-v3.py', 'protected_bundle_required')
    files.read(Path(__file__), 0o644)
    helper_bytes = files.read(BUNDLE / 'ws-preview-env-preflight.mjs', 0o644)
    require(digest(helper_bytes) == HELPER_SHA256, 'helper_content_changed')
    files.read(ENV, 0o600)
    files.read(HELPER, 0o755)
    credentials = None
    if operation == 'apply':
        require(stat.S_ISFIFO(os.fstat(sys.stdin.fileno()).st_mode), 'credential_pipe_required')
        raw = sys.stdin.buffer.read(8193)
        require(len(raw) <= 8192, 'credential_input_too_large')
        credentials = json.loads(raw)
    result = transaction(ENV, HELPER, BACKUP, helper_bytes, credentials,
                         rollback=operation == 'rollback', files=files)
    print('Stage Preview configuration ' + result + '; no restart, deployment or Redis operation')


if __name__ == '__main__':
    try:
        main()
    except Refused as error:
        sys.stderr.write('NO-GO: ' + str(error) + '\n')
        sys.exit(1)
    except Exception:
        sys.stderr.write('NO-GO: operation failed; preserve backups and retry/reconcile; no secrets printed\n')
        sys.exit(1)
