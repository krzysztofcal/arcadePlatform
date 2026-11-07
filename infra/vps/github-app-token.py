#!/usr/bin/python3 -I
"""Fixed on-demand GitHub App signer. Preparation is a separate OWNER-approved catalog action."""
import base64
import datetime
import grp
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import resource
import ssl
import stat
import subprocess
import sys
import time
import urllib.request

USER = 'arcade-github-token'
KEY = Path('/var/lib/arcade-github-app/app.pem')
PERMISSIONS = {'contents': 'write', 'pull_requests': 'write', 'issues': 'write',
               'metadata': 'read', 'actions': 'write', 'checks': 'read'}
POLICY = b'''# Only a fixed non-root signer; no shell, key/path/scope inputs or root access.
Defaults!/usr/local/sbin/arcade-github-app-token !log_input, !log_output
copilot ALL=(arcade-github-token) NOPASSWD: NOSETENV: /usr/local/sbin/arcade-github-app-token "", /usr/local/sbin/arcade-github-app-token --info
'''


class Refused(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise Refused(reason)


def no_acl(path):
    require(not any(name.startswith('system.posix_acl_') for name in os.listxattr(path, follow_symlinks=False)), 'unexpected_acl')


def trusted_parents(path):
    for parent in reversed(path.parents):
        meta = os.lstat(parent)
        require(stat.S_ISDIR(meta.st_mode) and meta.st_uid == 0 and not meta.st_mode & 0o022, 'untrusted_parent')
        no_acl(parent)


def validate_custody():
    require(os.geteuid() != 0 and pwd.getpwuid(os.geteuid()).pw_name == USER, 'wrong_signer_identity')
    require(set(os.getgroups()) <= {os.getgid()}, 'unexpected_signer_groups')
    trusted_parents(KEY)
    parent = os.lstat(KEY.parent)
    require(parent.st_gid == os.getgid() and stat.S_IMODE(parent.st_mode) == 0o750, 'unsafe_key_directory')
    meta = os.lstat(KEY)
    require(stat.S_ISREG(meta.st_mode) and meta.st_uid == 0 and meta.st_gid == os.getgid()
            and stat.S_IMODE(meta.st_mode) == 0o640 and meta.st_nlink == 1
            and 100 <= meta.st_size <= 16384, 'unsafe_key_metadata')
    no_acl(KEY)


def validate_response(body):
    require(isinstance(body, dict) and body.get('permissions') == PERMISSIONS, 'unexpected_token_permissions')
    repositories = body.get('repositories')
    require(body.get('repository_selection') == 'selected' and isinstance(repositories, list) and len(repositories) == 1
            and repositories[0].get('id') == 1076414433
            and repositories[0].get('full_name') == 'krzysztofcal/arcadePlatform', 'unexpected_token_repositories')
    expiry = datetime.datetime.fromisoformat(body.get('expires_at', '').replace('Z', '+00:00')).timestamp()
    require(0 < expiry - time.time() <= 3660, 'unexpected_token_expiry')
    require(re.fullmatch(r'ghs_[A-Za-z0-9._-]{20,16384}', body.get('token', '')) is not None, 'unexpected_token_format')
    return body['token']


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise Refused('redirect_refused')


def mint():
    validate_custody()
    encode = lambda data: base64.urlsafe_b64encode(data).rstrip(b'=')
    now = int(time.time())
    unsigned = encode(b'{"alg":"RS256","typ":"JWT"}') + b'.' + encode(json.dumps(
        {'iat': now - 60, 'exp': now + 540, 'iss': '5609023'}, separators=(',', ':')).encode())
    signed = subprocess.run(['/usr/bin/openssl', 'dgst', '-sha256', '-sign', str(KEY)], input=unsigned,
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10, check=False,
                            env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C'})
    require(signed.returncode == 0 and 128 <= len(signed.stdout) <= 1024, 'signing_failed')
    jwt = (unsigned + b'.' + encode(signed.stdout)).decode('ascii')
    request = urllib.request.Request('https://api.github.com/app/installations/178502493/access_tokens',
        data=json.dumps({'repository_ids': [1076414433], 'permissions': PERMISSIONS}).encode(),
        headers={'Authorization': 'Bearer ' + jwt, 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'arcade-code-agent-token'}, method='POST')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
        urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile='/etc/ssl/certs/ca-certificates.crt')))
    with opener.open(request, timeout=15) as response:
        require(response.status == 201, 'token_request_failed')
        data = response.read(65537)
    require(len(data) <= 65536, 'token_response_too_large')
    body = json.loads(data)
    validate_response(body)
    return body


class Preparation:
    def __init__(self):
        spec = importlib.util.spec_from_file_location('secure', Path(__file__).with_name('prepare-ws-preview-v3.py'))
        secure = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(secure)
        self.files = secure.SecureFiles()
        self.directory = KEY.parent
        self.backup = Path('/var/lib/arcade-admin/github-app-token')
        self.command = Path('/usr/local/sbin/arcade-github-app-token')
        self.policy = Path('/etc/sudoers.d/arcade-github-app-token')
        self.source = Path(__file__)
        self.mutated = False

    def run(self, argv, data=None, expected=(0,)):
        result = subprocess.run(argv, input=data, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                timeout=30, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'})
        require(result.returncode in expected, 'command_failed')
        return result.stdout.decode().strip()

    def preflight(self):
        for lookup in (pwd.getpwnam, grp.getgrnam):
            try:
                lookup(USER)
            except KeyError:
                continue
            raise Refused('signer_identity_already_exists')
        for target in (self.directory, self.backup, self.command, self.policy):
            trusted_parents(target)
            require(not target.exists() and not target.is_symlink(), 'target_already_exists_inspect_manifest')
        source = self.files.read(self.source, 0o644)
        for binary in ('/usr/bin/python3', '/usr/bin/openssl'):
            target = Path(binary).resolve(strict=True)
            trusted_parents(target)
            meta = os.lstat(target)
            require(stat.S_ISREG(meta.st_mode) and meta.st_uid == 0 and meta.st_mode & 0o111
                    and not meta.st_mode & 0o022, 'untrusted_binary')
            no_acl(target)
        self.run(['/usr/sbin/visudo', '-c'])
        self.run(['/usr/sbin/visudo', '-c', '-f', '-'], data=POLICY)
        return source

    def prepare(self, run_id):
        source = self.preflight()
        self.mutated = True
        self.backup.mkdir(mode=0o700)
        self.files.sync_dir(self.backup.parent)
        state = {'version': 1, 'run': run_id, 'phase': 'preparing', 'issuer_sha256': hashlib.sha256(source).hexdigest()}
        self.files.atomic(self.backup / 'manifest.json', json.dumps(state).encode(), 0o600)
        self.run(['/usr/sbin/groupadd', '--system', USER])
        self.run(['/usr/sbin/useradd', '--system', '--no-create-home', '--home-dir', '/nonexistent',
                  '--shell', '/usr/sbin/nologin', '--gid', USER, '--password', '*', USER])
        account = pwd.getpwnam(USER)
        require(0 < account.pw_uid < 1000 and 0 < account.pw_gid < 1000
                and account.pw_dir == '/nonexistent' and account.pw_shell == '/usr/sbin/nologin', 'unexpected_signer_account')
        require(self.run(['/usr/bin/id', '-G', USER]) == str(account.pw_gid), 'unexpected_signer_groups')
        self.run(['/usr/bin/sudo', '-n', '-l', '-U', USER], expected=(1,))
        self.directory.mkdir(mode=0o750)
        os.chown(self.directory, 0, account.pw_gid)
        self.directory.chmod(0o750)
        no_acl(self.directory)
        self.files.atomic(self.command, source, 0o755)
        self.files.atomic(self.policy, POLICY, 0o440)
        try:
            self.run(['/usr/sbin/visudo', '-c'])
        except Exception:
            require(self.files.read(self.policy, 0o440) == POLICY, 'changed_policy')
            self.policy.unlink()
            self.files.sync_dir(self.policy.parent)
            raise
        state['phase'] = 'prepared_no_key_no_client_switch'
        self.files.atomic(self.backup / 'manifest.json', json.dumps(state).encode(), 0o600)
        return state['phase']


def main():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    os.environ.clear()
    if os.geteuid() == 0:
        require(len(sys.argv) == 3 and sys.argv[1] == 'prepare' and re.fullmatch(r'[1-9][0-9]{0,19}', sys.argv[2]), 'unexpected_arguments')
        task = Preparation()
        try:
            print('GITHUB_TOKEN_OK ' + task.prepare(sys.argv[2]))
        except Exception:
            print('GITHUB_TOKEN_FAILED inspect_protected_manifest_no_retry')
            raise SystemExit(1) from None
    else:
        require(sys.argv[1:] in ([], ['--info']), 'unexpected_arguments')
        body = mint()
        if sys.argv[1:] == ['--info']:
            print(json.dumps({**{key: body[key] for key in ['expires_at', 'permissions', 'repository_selection']},
                              'repositories': [repo['full_name'] for repo in body['repositories']]}))
        else:
            print(body['token'])


if __name__ == '__main__':
    try:
        main()
    except Exception:
        sys.stderr.write('arcade-agent-token: refused; inspect custody, configuration and GitHub availability\n')
        sys.exit(1)
