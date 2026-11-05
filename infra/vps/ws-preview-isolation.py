#!/usr/bin/python3
"""Fixed Preview-only catalog implementation. Never stops/starts a service or handles a private key."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import posixpath
import pwd
import grp
import re
import shlex
import stat
import subprocess
import sys

_spec = importlib.util.spec_from_file_location('preview_secure', Path(__file__).with_name('prepare-ws-preview-v3.py'))
secure = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(secure)
require = secure.require
DEPLOY, RUNTIME = 'arcade-preview-deploy', 'arcade-preview'
ROOTS = ('ws-server', 'shared', 'netlify', 'node_modules')
SYNC = ('ws-server', 'shared', 'netlify/functions/_shared', 'netlify/functions/_generated', 'node_modules')
UNIT = 'ws-server-preview.service'
DROPIN = (Path(__file__).parent / 'ws-server-preview.service.d/99-preview-isolation.conf').read_bytes()
SUDO = b'''# Preview-only deployment identity, not the copilot/Production command alias.
arcade-preview-deploy ALL=(root) NOPASSWD: /usr/local/sbin/arcade-ws-preview-env-preflight "", /usr/bin/systemctl restart ws-server-preview.service
'''
SSH = b'''Match User arcade-preview-deploy
    AuthorizedKeysFile /etc/ssh/arcade-preview-authorized-key
    AuthorizedKeysCommand none
    PubkeyAcceptedAlgorithms ssh-ed25519
    AuthenticationMethods publickey
    PasswordAuthentication no
    KbdInteractiveAuthentication no
    DisableForwarding yes
    PermitTTY no
    PermitUserRC no
Match all
'''


def public_key(data):
    # Empty until OWNER supplies a dedicated PUBLIC key in a separately reviewed commit.
    parts = data.decode('ascii').strip().split()
    require(len(parts) == 2 and parts[0] == 'ssh-ed25519', 'owner_public_key_missing_or_invalid')
    try:
        wire = base64.b64decode(parts[1], validate=True)
    except ValueError:
        raise secure.Refused('owner_public_key_missing_or_invalid') from None
    require(len(wire) == 51 and wire[:19] == b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20', 'invalid_ed25519_key')
    return ('restrict ' + ' '.join(parts) + '\n').encode()


def copy_tree(source, destination, uid, gid, relative='.', budget=None):
    """Read through pinned descriptors; create only NEW files under a root-private staging directory.

    Never chmod/chown a source inode. Never follow symlinks, devices, sockets or hardlinks.
    Relative links may refer only to one of the four copied Preview roots.
    """
    budget = budget if budget is not None else [0, 0]
    require(len(Path(relative).parts) < 80, 'tree_too_deep')
    destination.mkdir(mode=0o700)
    for name in os.listdir(source):
        if relative == 'netlify' and name != 'functions':
            continue
        if relative == 'netlify/functions' and name not in ('_shared', '_generated'):
            continue
        budget[0] += 1
        require(budget[0] <= 250000, 'tree_too_large')
        entry = os.stat(name, dir_fd=source, follow_symlinks=False)
        target = destination / name
        rel = posixpath.normpath(posixpath.join(relative, name))
        if stat.S_ISLNK(entry.st_mode):
            link = os.readlink(name, dir_fd=source)
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(rel), link))
            require(not posixpath.isabs(link) and resolved.split('/')[0] in ROOTS
                    and not resolved.startswith('../'), 'symlink_outside_preview')
            target.symlink_to(link)
            os.chown(target, uid, gid, follow_symlinks=False)
        elif stat.S_ISDIR(entry.st_mode):
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=source)
            try:
                require(os.fstat(fd).st_dev == entry.st_dev and os.fstat(fd).st_ino == entry.st_ino, 'source_changed')
                copy_tree(fd, target, uid, gid, rel, budget)
            finally:
                os.close(fd)
        else:
            require(stat.S_ISREG(entry.st_mode) and entry.st_nlink == 1, 'unsupported_source_entry')
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=source)
            with os.fdopen(fd, 'rb') as src, target.open('xb') as dst:
                before = os.fstat(src.fileno())
                require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                        and (before.st_dev, before.st_ino) == (entry.st_dev, entry.st_ino), 'source_changed')
                while chunk := src.read(1024 * 1024):
                    budget[1] += len(chunk)
                    require(budget[1] <= 4 * 1024**3, 'tree_too_large')
                    dst.write(chunk)
                after = os.fstat(src.fileno())
                require((before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                        (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'source_changed')
                os.fchown(dst.fileno(), uid, gid)
                os.fchmod(dst.fileno(), 0o755 if entry.st_mode & 0o111 else 0o644)
                dst.flush()
                os.fsync(dst.fileno())
    os.chown(destination, uid, gid)
    destination.chmod(0o2755)
    fd = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


class Isolation:
    def __init__(self):
        self.files = secure.SecureFiles()
        self.base = Path('/opt/arcade-ws-preview')
        self.backup = Path('/var/lib/arcade-admin/ws-preview-isolation')
        self.key = Path(__file__).with_name('ws-preview-owner.pub')
        self.targets = {
            Path('/etc/systemd/system/ws-server-preview.service.d/99-preview-isolation.conf'): DROPIN,
            Path('/etc/sudoers.d/arcade-preview-deploy'): SUDO,
            Path('/etc/ssh/sshd_config.d/90-arcade-preview.conf'): SSH,
        }
        self.auth = Path('/etc/ssh/arcade-preview-authorized-key')

    def run(self, argv, expected=(0,)):
        result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}, timeout=180)
        require(result.returncode in expected, 'command_failed')
        return result.stdout.decode().strip()

    def stopped(self):
        value = self.run(['/usr/bin/systemctl', 'show', UNIT, '-p', 'ActiveState', '-p', 'MainPID'])
        require(set(value.splitlines()) == {'ActiveState=inactive', 'MainPID=0'}, 'preview_must_be_stopped')

    def clean_accounts(self):
        for name in (DEPLOY, RUNTIME):
            try:
                pwd.getpwnam(name)
            except KeyError:
                pass
            else:
                raise secure.Refused('account_already_exists')
            try:
                grp.getgrnam(name)
            except KeyError:
                pass
            else:
                raise secure.Refused('group_already_exists')

    def preflight(self):
        self.stopped()
        key = public_key(self.files.read(self.key, 0o644))
        self.files.parents(self.base / '.env.preview')
        env = secure.parse_env(self.files.read(self.base / '.env.preview', 0o600))
        env_files = self.run(['/usr/bin/systemctl', 'show', UNIT, '-p', 'EnvironmentFiles', '--value'])
        paths = re.findall(r'(/[^ ]+) \(ignore_errors=no\)', env_files)
        require(paths and paths[0] == str(self.base / '.env.preview') and
                len(paths) == len(set(paths)) and
                all(p in (str(self.base / '.env.preview'), '/etc/arcadeplatform/ws-preview-signing.env') for p in paths),
                'unexpected_environment_files')
        for path in paths[1:]:
            env.update(secure.parse_env(self.files.read(Path(path), 0o600)))
        inline = self.run(['/usr/bin/systemctl', 'show', UNIT, '-p', 'Environment', '--value'])
        # systemd EnvironmentFile values override Environment assignments; reject financial file state anywhere.
        assignments = dict(item.split('=', 1) for item in shlex.split(inline))
        require(not assignments.get('WS_PERSISTED_STATE_FILE'), 'local_financial_state_requires_separate_migration')
        env = {**assignments, **env}
        secure.validate_stage(env)
        require(not env.get('WS_PERSISTED_STATE_FILE'), 'local_financial_state_requires_separate_migration')
        require(not self.backup.exists() and not self.backup.is_symlink(), 'backup_already_exists_use_rollback')
        self.files.parents(self.backup)
        self.clean_accounts()
        for target in [*self.targets, self.auth]:
            self.files.parents(target)
            require(not target.exists() and not target.is_symlink(), 'target_already_exists')
        for name in ROOTS:
            meta = (self.base / name).lstat()
            require(stat.S_ISDIR(meta.st_mode) and meta.st_uid == self.files.uid, 'untrusted_preview_root')
        require(self.run(['/usr/local/sbin/arcade-ws-preview-env-preflight', '--config-only']).startswith('PASS CONFIG ONLY'), 'stage_preflight_failed')
        self.run(['/usr/sbin/sshd', '-t'])
        self.run(['/usr/sbin/visudo', '-c'])
        return key

    def save(self, state):
        self.files.atomic(self.backup / 'manifest.json', json.dumps(state, sort_keys=True).encode(), 0o600)

    def provision(self, run_id):
        key = self.preflight()  # no mutation before all prerequisites, including a dedicated OWNER public key
        self.backup.mkdir(mode=0o700)
        self.files.sync_dir(self.backup.parent)
        state = {'version': 1, 'phase': 'preparing', 'run': run_id, 'original': {}, 'installed': {},
                 'desired': {str(p): secure.digest(v) for p, v in {**self.targets, self.auth: key}.items()}}
        self.save(state)
        for name, home, shell in [(DEPLOY, '/var/lib/arcade-preview-deploy', '/bin/bash'),
                                  (RUNTIME, '/nonexistent', '/usr/sbin/nologin')]:
            self.run(['/usr/sbin/groupadd', '--system', name])
            self.run(['/usr/sbin/useradd', '--system', '--no-create-home', '--home-dir', home,
                      '--shell', shell, '--gid', name, '--password', '*', name])
        deploy = pwd.getpwnam(DEPLOY)
        runtime = pwd.getpwnam(RUNTIME)
        require(deploy.pw_uid != runtime.pw_uid and deploy.pw_gid != runtime.pw_gid, 'identities_not_separate')
        # Root-owned home and key policy: a deployer cannot replace its authorization by editing its home.
        home = Path(deploy.pw_dir)
        self.files.parents(home)
        require(not home.exists() and not home.is_symlink(), 'home_already_exists')
        home.mkdir(mode=0o755)
        for name in ROOTS:
            fd = os.open(self.base / name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                meta = os.fstat(fd)
                state['original'][name] = [meta.st_dev, meta.st_ino]
                copy_tree(fd, self.backup / ('new-' + name), deploy.pw_uid, deploy.pw_gid, name)
            finally:
                os.close(fd)
            installed = (self.backup / ('new-' + name)).lstat()
            state['installed'][name] = [installed.st_dev, installed.st_ino]
        self.save(state)
        # netlify ancestors stay root-controlled. Only the five existing rsync destinations are writable.
        for rel in ['netlify', 'netlify/functions']:
            p = self.backup / 'new-netlify' / Path(rel).relative_to('netlify')
            os.chown(p, self.files.uid, self.files.gid)
            p.chmod(0o755)
        for rel in SYNC:
            require((self.backup / ('new-' + rel.split('/')[0]) / Path(rel).relative_to(rel.split('/')[0])).is_dir(), 'missing_sync_root')
        state['phase'] = 'switching'
        self.save(state)
        self.stopped()
        for name in ROOTS:
            current = (self.base / name).lstat()
            require([current.st_dev, current.st_ino] == state['original'][name], 'source_root_changed')
            os.rename(self.base / name, self.backup / ('before-' + name))
            self.files.sync_dir(self.base)
            self.files.sync_dir(self.backup)
            os.rename(self.backup / ('new-' + name), self.base / name)
            self.files.sync_dir(self.base)
            self.files.sync_dir(self.backup)
        for target, contents in self.targets.items():
            self.files.atomic(target, contents, 0o440 if target.parent.name == 'sudoers.d' else 0o644)
        self.run(['/usr/sbin/visudo', '-c'])
        self.run(['/usr/sbin/sshd', '-t'])
        self.run(['/usr/bin/systemctl', 'daemon-reload'])
        effective = self.run(['/usr/bin/systemctl', 'show', UNIT, '-p', 'User', '-p', 'Group', '-p', 'SupplementaryGroups'])
        require(set(effective.splitlines()) == {'User=' + RUNTIME, 'Group=' + RUNTIME, 'SupplementaryGroups='}, 'effective_unit_mismatch')
        policy = self.run(['/usr/sbin/sshd', '-T', '-C', 'user=arcade-preview-deploy,host=localhost,addr=127.0.0.1'])
        policy = dict(line.split(' ', 1) for line in policy.splitlines())
        for name, value in {'authorizedkeysfile': str(self.auth), 'authorizedkeyscommand': 'none',
                            'pubkeyacceptedalgorithms': 'ssh-ed25519', 'authenticationmethods': 'publickey',
                            'passwordauthentication': 'no', 'kbdinteractiveauthentication': 'no',
                            'disableforwarding': 'yes', 'permittty': 'no', 'permituserrc': 'no'}.items():
            require(policy.get(name) == value, 'effective_ssh_policy_mismatch')
        for name in (DEPLOY, RUNTIME):
            account = pwd.getpwnam(name)
            require(self.run(['/usr/bin/id', '-G', name]) == str(account.pw_gid), 'unexpected_account_groups')
        sudo = self.run(['/usr/bin/sudo', '-n', '-l', '-U', DEPLOY])
        marker = 'User ' + DEPLOY + ' may run the following commands on '
        require(sudo.count(marker) == 1, 'unexpected_sudo_policy')
        entries = sudo.split(marker, 1)[1].split('\n', 1)[1]
        entries = ' '.join(line.strip() for line in entries.splitlines() if line.strip())
        require(entries == '(root) NOPASSWD: /usr/local/sbin/arcade-ws-preview-env-preflight \"\", /usr/bin/systemctl restart ws-server-preview.service',
                'unexpected_sudo_policy')
        runtime_sudo = self.run(['/usr/bin/sudo', '-n', '-l', '-U', RUNTIME], expected=(1,))
        require('not allowed to run sudo' in runtime_sudo or 'may not run sudo' in runtime_sudo,
                'unexpected_runtime_sudo_policy')
        self.files.atomic(self.auth, key, 0o644)  # enabled only after the unit uses the isolated runtime
        self.run(['/usr/bin/systemctl', 'reload', 'ssh.service'])
        state['phase'] = 'provisioned_runtime_not_started'
        self.save(state)
        return state['phase']

    def rollback(self):
        self.stopped()
        state = json.loads(self.files.read(self.backup / 'manifest.json', 0o600))
        require(state.get('version') == 1 and state.get('phase') in
                ('preparing', 'switching', 'provisioned_runtime_not_started'), 'unknown_backup_phase')
        # Revoke the new key before restoring a unit that runs as the shared identity.
        for target in [self.auth, *self.targets]:
            if target.exists() or target.is_symlink():
                mode = 0o440 if target.parent.name == 'sudoers.d' else 0o644
                require(secure.digest(self.files.read(target, mode)) == state['desired'][str(target)], 'target_changed')
        if self.auth.exists():
            self.auth.unlink()
            self.files.sync_dir(self.auth.parent)
        self.run(['/usr/bin/systemctl', 'reload', 'ssh.service'])
        for name in (DEPLOY, RUNTIME):
            try:
                user = pwd.getpwnam(name)
            except KeyError:
                continue
            self.run(['/usr/bin/pgrep', '-u', str(user.pw_uid)], expected=(1,))
        for name in ROOTS:
            old = self.backup / ('before-' + name)
            if old.exists():
                meta = old.lstat()
                require(stat.S_ISDIR(meta.st_mode) and [meta.st_dev, meta.st_ino] == state['original'].get(name), 'backup_identity_mismatch')
                current = self.base / name
                if current.exists() or current.is_symlink():
                    require(not current.is_symlink() and [current.lstat().st_dev, current.lstat().st_ino] == state['installed'].get(name)
                            and not (self.backup / ('after-' + name)).exists(), 'unexpected_live_tree')
                    os.rename(current, self.backup / ('after-' + name))
                os.rename(old, current)
                self.files.sync_dir(self.base)
                self.files.sync_dir(self.backup)
        for target in self.targets:
            if target.exists():
                target.unlink()
                self.files.sync_dir(target.parent)
        self.run(['/usr/sbin/visudo', '-c'])
        self.run(['/usr/sbin/sshd', '-t'])
        self.run(['/usr/bin/systemctl', 'daemon-reload'])
        self.run(['/usr/bin/systemctl', 'reload', 'ssh.service'])
        state['phase'] = 'rolled_back_not_started'
        self.save(state)
        return state['phase']


def main():
    # No path/key/identity input, environment override or new privileged entry point.
    require(os.geteuid() == 0 and len(sys.argv) == 3 and
            sys.argv[1] in ('preflight', 'provision', 'rollback') and
            re.fullmatch(r'[1-9][0-9]{0,19}', sys.argv[2]), 'unexpected_arguments')
    task = Isolation()
    if sys.argv[1] == 'preflight':
        task.preflight()
        result = 'ready_stopped_only'
    else:
        result = task.provision(sys.argv[2]) if sys.argv[1] == 'provision' else task.rollback()
    print('PREVIEW_OK ' + result)


if __name__ == '__main__':
    try:
        main()
    except secure.Refused as error:
        print('PREVIEW_BLOCKED ' + str(error))
        sys.exit(1)
    except Exception:
        print('PREVIEW_FAILED inspect_protected_manifest_no_automatic_retry')
        sys.exit(1)
