#!/usr/bin/python3 -I
"""Fixed WWW evidence reader and two owner-approved catalog actions. Never handles a private key."""
import base64
import binascii
import glob
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import grp
import re
import stat
import subprocess
import sys
import urllib.request

USER = 'arcade-www-read'
HOME = '/var/lib/arcade-www-read'
WRAPPER = '/usr/local/sbin/arcade-www-read'
VPS_READ = 'readlink -e /opt/ws-server/current && cat /opt/ws-server/current/release-metadata.json && echo && cat /opt/ws-server/current/../.deployed-at && systemctl show ws-server.service -p ActiveState -p ExecMainStartTimestamp --timestamp=unix'
REPO = 'https://api.github.com/repos/krzysztofcal/arcadePlatform/'
SHA = re.compile(r'[a-f0-9]{40}')


class Refused(Exception):
    pass


def require(ok, reason):
    if not ok:
        raise Refused(reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run_fixed(argv, expected=(0,)):
    result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            timeout=20, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'})
    require(result.returncode in expected and len(result.stdout) <= 1048576, 'command_failed')
    return result.stdout.decode()


def metadata(path, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), 'metadata_not_regular')
        data = stream.read(maximum + 1)
    require(len(data) <= maximum, 'metadata_too_large')
    return data.decode()


def serve(original, argv, root=Path('/'), run=run_fixed):
    require(not argv and original == VPS_READ and os.geteuid() != 0, 'exact_read_command_required')
    account = pwd.getpwnam(USER)
    require(os.geteuid() == account.pw_uid and set(os.getgroups()) <= {account.pw_gid}, 'reader_identity_required')
    target = (root/'opt/ws-server/current').resolve(strict=True)
    relative = str(target.relative_to(root))
    require(re.fullmatch(r'opt/ws-server/releases/[a-f0-9]{40}/ws-server', relative), 'unexpected_release_path')
    release = json.loads(metadata(target/'release-metadata.json', 65536))
    require(release.get('releaseSha') == target.parent.name and release.get('environment') == 'production'
            and release.get('deployRef') == 'main', 'unexpected_release_metadata')
    installed = metadata(target.parent/'.deployed-at', 128).strip()
    require(re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ', installed), 'unexpected_release_timestamp')
    service = run(['/usr/bin/systemctl', 'show', 'ws-server.service', '-p', 'ActiveState', '-p', 'ExecMainStartTimestamp', '--timestamp=unix'])
    props = dict(line.split('=', 1) for line in service.splitlines())
    require(set(props) == {'ActiveState', 'ExecMainStartTimestamp'}, 'unexpected_service_properties')
    # Same fields consumed by vpsWsRelease; whitelist output instead of exposing extra metadata fields.
    return '\n'.join(['/'+relative, json.dumps({k: release[k] for k in ['releaseSha', 'environment', 'deployRef']}),
                      '', installed, 'ActiveState='+props['ActiveState'], 'ExecMainStartTimestamp='+props['ExecMainStartTimestamp']])+'\n'


def authorization(data):
    if not data.strip():
        return b''  # Reviewed empty source explicitly disables this one owned authorization slot.
    try:
        parts = data.decode('ascii').strip().split()
    except UnicodeError:
        raise Refused('invalid_public_key')
    require(len(parts) >= 2 and parts[0] == 'ssh-ed25519' and len(data.splitlines()) == 1, 'invalid_public_key')
    try:
        wire = base64.b64decode(parts[1], validate=True)
    except binascii.Error:
        raise Refused('invalid_public_key')
    require(len(wire) == 51 and wire[:19] == b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20', 'invalid_public_key')
    return ('restrict,no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-pty,no-user-rc,command="'
            +WRAPPER+'" '+' '.join(parts[:2])+'\n').encode()


class Preparation:
    def __init__(self, root=Path('/'), files=None):
        spec = importlib.util.spec_from_file_location('www_secure', Path(__file__).with_name('prepare-ws-preview-v3.py'))
        secure = importlib.util.module_from_spec(spec); spec.loader.exec_module(secure)
        self.files = files or secure.SecureFiles()
        self.root = root
        self.source = root/'usr/local/libexec/arcade-vps-admin/www-ws-read.py'
        self.key_source = root/'usr/local/libexec/arcade-vps-admin/www-ws-read-owner.pub'
        self.base = root/'var/lib/arcade-admin/www-ws-read'
        self.home = root/HOME.lstrip('/')
        self.wrapper = root/WRAPPER.lstrip('/')
        self.auth = self.home/'.ssh/authorized_keys'
        self.auth2 = self.home/'.ssh/authorized_keys2'
        self.manifest = self.base/'manifest.json'
        self.run = run_fixed
        self.mutated = False

    def api(self, route):
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                raise Refused('github_redirect')
        request = urllib.request.Request(REPO+route, headers={'Accept':'application/vnd.github+json', 'User-Agent':'arcade-www-read'})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(request, timeout=20) as response:
            data = response.read(1048577)
        require(len(data) <= 1048576, 'github_response_too_large')
        return json.loads(data)

    def current_main(self):
        sha = self.api('commits/main').get('sha', '')
        require(SHA.fullmatch(sha), 'unverified_main')
        return sha

    def approved(self, action, run_id):
        run = self.api('actions/runs/'+run_id)
        require(str(run.get('id')) == run_id and run.get('path') == '.github/workflows/vps-admin-operation.yml'
                and run.get('event') == 'workflow_dispatch' and run.get('head_branch') == 'main'
                and run.get('status') == 'in_progress', 'not_main_admin_run')
        sha = run.get('head_sha', '')
        require(SHA.fullmatch(sha) and self.current_main() == sha, 'main_advanced')
        sources = [(self.source, 'infra/vps/www-ws-read.py')]
        if action == 'key-sync': sources.append((self.key_source, 'infra/vps/www-ws-read-owner.pub'))
        for path, rel in sources:
            data = self.files.read(path, 0o644)
            entry = self.api('contents/'+rel+'?ref='+sha)
            blob = hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
            require(entry.get('type') == 'file' and entry.get('path') == rel and entry.get('sha') == blob, 'staged_source_mismatch')
        return sha

    def account(self):
        try:return pwd.getpwnam(USER)
        except KeyError:return None

    def group_exists(self):
        try:grp.getgrnam(USER);return True
        except KeyError:return False

    def ssh_policy(self):
        seen = set()
        def inspect(path):
            require(len(seen) < 24 and path not in seen, 'sshd_include_limit')
            seen.add(path); self.files.parents(path)
            require(path.is_relative_to(self.root/'etc/ssh'), 'sshd_include_outside_config')
            info = path.lstat()
            require(stat.S_ISREG(info.st_mode) and info.st_uid == self.files.uid and info.st_gid == self.files.gid
                    and not info.st_mode & 0o022, 'untrusted_sshd_config')
            for line in self.files.read(path, stat.S_IMODE(info.st_mode)).decode().splitlines():
                tokens = line.split('#', 1)[0].split()
                if not tokens:continue
                keyword = tokens[0].lower().split('=', 1)[0]
                require(keyword != 'match', 'sshd_match_requires_review')
                if keyword == 'include':
                    require(tokens[0].lower() == 'include', 'sshd_include_requires_review')
                    for pattern in tokens[1:]:
                        require(pattern.startswith('/etc/ssh/') and '%' not in pattern, 'sshd_include_requires_review')
                        for item in sorted(glob.glob(str(self.root/pattern.lstrip('/')))):inspect(Path(item))
        inspect(self.root/'etc/ssh/sshd_config')
        policy = dict(line.split(' ', 1) for line in self.run(['/usr/sbin/sshd','-T','-C','user='+USER+',host=localhost,addr=127.0.0.1']).splitlines())
        expected = {'authorizedkeysfile':'.ssh/authorized_keys .ssh/authorized_keys2', 'authorizedkeyscommand':'none',
            'authorizedprincipalscommand':'none','authorizedprincipalsfile':'none','trustedusercakeys':'none',
            'forcecommand':'none','permituserenvironment':'no','passwordauthentication':'no',
            'kbdinteractiveauthentication':'no','hostbasedauthentication':'no','strictmodes':'yes','pubkeyauthentication':'yes','usepam':'yes'}
        require(all(policy.get(k) == v for k,v in expected.items()), 'effective_ssh_policy_mismatch')
        require(all(v in ['LANG', 'LC_*'] for v in policy.get('acceptenv', '').split()), 'unsafe_acceptenv')

    def check_account(self):
        account = self.account()
        require(account and 0 < account.pw_uid < 1000 and account.pw_gid != 0
                and account.pw_dir == HOME and account.pw_shell == '/bin/sh', 'reader_account_drift')
        require(self.run(['/usr/bin/id','-G',USER]).split() == [str(account.pw_gid)], 'reader_groups_drift')
        group = self.run(['/usr/bin/getent','group',USER]).strip().split(':')
        require(len(group) == 4 and group[0] == USER and group[2] == str(account.pw_gid) and group[3] == '', 'reader_group_drift')
        require(self.run(['/usr/bin/passwd','-S',USER]).split()[1] == 'L', 'reader_password_not_locked')
        listing = self.run(['/usr/bin/sudo','-n','-l','-U',USER], expected=(1,))
        require('not allowed to run sudo' in listing or 'may not run sudo' in listing, 'reader_sudo_not_verified')

    def check_reads(self):
        for rel in ['opt/ws-server/current/release-metadata.json','opt/ws-server/current/../.deployed-at']:
            self.run(['/usr/sbin/runuser','-u',USER,'--','/usr/bin/test','-r','/'+rel])
        target = (self.root/'opt/ws-server/current').resolve(strict=True)
        require(re.fullmatch(r'opt/ws-server/releases/[a-f0-9]{40}/ws-server',str(target.relative_to(self.root))), 'unexpected_release_path')
        for path in [str(target.parent), '/opt/ws-server','/opt/ws-server/releases','/opt/ws-server/current', '/opt/ws-server/current/release-metadata.json', '/opt/ws-server/current/../.deployed-at']:
            self.run(['/usr/sbin/runuser','-u',USER,'--','/usr/bin/test','-w',path], expected=(1,))
        self.run(['/usr/sbin/runuser','-u',USER,'--','/usr/bin/systemctl','show','ws-server.service','-p','ActiveState','-p','ExecMainStartTimestamp','--timestamp=unix'])

    def state(self):
        data = json.loads(self.files.read(self.manifest, 0o600))
        require(data.get('phase') == 'prepared', 'partial_state_inspect_no_retry')
        return data

    def save(self, state):
        self.files.atomic(self.manifest, json.dumps(state, sort_keys=True).encode(), 0o600)

    def verify(self, state):
        self.check_account();self.ssh_policy();self.check_reads()
        require(self.files.read(self.wrapper,0o755) == self.files.read(self.source,0o644), 'wrapper_drift')
        require(digest(self.files.read(self.auth,0o644)) == state['auth_sha256'], 'authorization_drift')
        require(self.files.read(self.auth2,0o644) == b'', 'alternate_authorization')

    def execute(self, action, run_id):
        require(action in ['prepare','key-sync'] and re.fullmatch(r'[1-9][0-9]{0,19}',run_id), 'unexpected_arguments')
        sha = self.approved(action,run_id)
        self.ssh_policy()
        if self.base.exists() or self.base.is_symlink():
            state = self.state();self.verify(state)
            if action == 'prepare':return 'verified'
            desired = authorization(self.files.read(self.key_source,0o644))
            current = self.files.read(self.auth,0o644)
            if current == desired:return 'verified'
            require(self.current_main() == sha, 'main_advanced')
            self.mutated=True
            # Mark transition first. Any interrupted enrollment blocks retries until protected-state inspection.
            self.save({**state,'phase':'key_syncing','run':run_id})
            self.files.atomic(self.auth, desired, 0o644, allowed={state['auth_sha256']})
            state.update(auth_sha256=digest(desired),run=run_id)
            self.verify(state);self.save(state)
            return 'key_enabled' if desired else 'key_disabled'
        require(action == 'prepare', 'prepare_required')
        require(not self.account() and not self.group_exists(), 'existing_identity')
        for path in [self.home,self.wrapper]:
            self.files.parents(path)
            require(not path.exists() and not path.is_symlink(), 'existing_target')
        self.files.parents(self.base)
        require(self.current_main() == sha, 'main_advanced')
        self.mutated=True
        self.base.mkdir(mode=0o700);self.files.sync_dir(self.base.parent)
        state={'phase':'preparing','run':run_id,'source_sha':sha,'auth_sha256':digest(b'')}
        self.save(state)
        self.run(['/usr/sbin/groupadd','--system',USER])
        self.run(['/usr/sbin/useradd','--system','--no-create-home','--home-dir',HOME,'--shell','/bin/sh','--gid',USER,'--password','*',USER])
        self.home.mkdir(mode=0o755);(self.home/'.ssh').mkdir(mode=0o755)
        self.files.atomic(self.auth,b'',0o644);self.files.atomic(self.auth2,b'',0o644)
        self.files.atomic(self.wrapper,self.files.read(self.source,0o644),0o755)
        self.verify(state)
        require(self.current_main() == sha, 'main_advanced')
        state['phase']='prepared';self.save(state)
        return 'prepared'


if __name__ == '__main__':
    task=None
    try:
        if len(sys.argv) == 1:
            sys.stdout.write(serve(os.environ.get('SSH_ORIGINAL_COMMAND',''),[]))
        else:
            require(os.geteuid() == 0 and len(sys.argv) == 3, 'root_catalog_required')
            task=Preparation();print('WWW_READ_OK '+task.execute(sys.argv[1],sys.argv[2]))
    except Exception:
        # Never log source contents, raw subprocess errors, key material or request text.
        print('WWW_READ_FAILED inspect_protected_state_no_retry' if task and task.mutated else 'WWW_READ_BLOCKED preflight_or_read_refused',file=sys.stderr if not task else sys.stdout)
        sys.exit(1)
