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
import tempfile

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


def public_key(data):
    # Empty until OWNER supplies a dedicated PUBLIC key in a separately reviewed commit.
    try:
        lines = data.decode('ascii').strip().splitlines()
        require(len(lines) == 1, 'owner_public_key_missing_or_invalid')
        parts = lines[0].split()
    except UnicodeDecodeError:
        raise secure.Refused('owner_public_key_missing_or_invalid') from None
    require(len(parts) >= 2 and parts[0] == 'ssh-ed25519', 'owner_public_key_missing_or_invalid')
    parts = parts[:2]  # ignore the optional public comment; never copy it into authorization
    try:
        wire = base64.b64decode(parts[1], validate=True)
    except ValueError:
        raise secure.Refused('owner_public_key_missing_or_invalid') from None
    require(len(wire) == 51 and wire[:19] == b'\x00\x00\x00\x0bssh-ed25519\x00\x00\x00\x20', 'invalid_ed25519_key')
    # The pinned scp-action uploads its outer archive to a relative remote path. Keep the home and
    # authorization root-owned, but start every unprivileged SSH command in its private work directory.
    command = session_command()
    quoted = command.replace('"', '\\"')
    return ('restrict,command="' + quoted + '" ' + ' '.join(parts) + '\n').encode()


def session_command():
    return 'cd /var/lib/arcade-preview-deploy/staging && exec /bin/bash --noprofile --norc -c "$SSH_ORIGINAL_COMMAND"'


def copy_tree(source, destination, uid, gid, relative='.', budget=None, writers=None):
    """destination=None inventories only. Copy only new inodes, never follow source links.

    Do not widen permissions or silently convert runtime-writable state into executable code.
    """
    budget = budget if budget is not None else [0, 0]
    require(len(Path(relative).parts) < 80, 'tree_too_deep')
    directory = os.fstat(source)
    require(directory.st_mode & 0o005 == 0o005, 'runtime_cannot_read_source_directory')
    require(directory.st_mode & 0o200, 'deployer_requires_owner_write')
    if writers:
        runtime_uid, runtime_groups = writers
        require(not (directory.st_uid == runtime_uid and directory.st_mode & 0o200 or
                     directory.st_gid in runtime_groups and directory.st_mode & 0o020 or directory.st_mode & 0o002),
                'runtime_writable_directory_requires_inventory')
    if destination is not None:
        destination.mkdir(mode=0o700)
    for name in os.listdir(source):
        if relative == 'netlify' and name != 'functions':
            continue
        if relative == 'netlify/functions' and name not in ('_shared', '_generated'):
            continue
        budget[0] += 1
        require(budget[0] <= 250000, 'tree_too_large')
        entry = os.stat(name, dir_fd=source, follow_symlinks=False)
        target = destination / name if destination is not None else None
        rel = posixpath.normpath(posixpath.join(relative, name))
        if stat.S_ISLNK(entry.st_mode):
            link = os.readlink(name, dir_fd=source)
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(rel), link))
            require(not posixpath.isabs(link) and resolved.split('/')[0] in ROOTS
                    and not resolved.startswith('../'), 'symlink_outside_preview')
            if target is not None:
                target.symlink_to(link)
                os.chown(target, uid, gid, follow_symlinks=False)
        elif stat.S_ISDIR(entry.st_mode):
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=source)
            try:
                require(os.fstat(fd).st_dev == entry.st_dev and os.fstat(fd).st_ino == entry.st_ino, 'source_changed')
                copy_tree(fd, target, uid, gid, rel, budget, writers)
            finally:
                os.close(fd)
        else:
            require(stat.S_ISREG(entry.st_mode) and entry.st_nlink == 1, 'unsupported_source_entry')
            require(entry.st_mode & 0o004, 'private_file_requires_inventory')
            require(entry.st_mode & 0o200, 'deployer_requires_owner_write')
            if writers:
                runtime_uid, runtime_groups = writers
                writable = (entry.st_uid == runtime_uid and entry.st_mode & 0o200 or
                            entry.st_gid in runtime_groups and entry.st_mode & 0o020 or entry.st_mode & 0o002)
                require(not writable, 'runtime_writable_file_requires_inventory')
            budget[1] += entry.st_size
            require(budget[1] <= 4 * 1024**3, 'tree_too_large')
            if target is None:
                continue
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=source)
            with os.fdopen(fd, 'rb') as src, target.open('xb') as dst:
                before = os.fstat(src.fileno())
                require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
                        and (before.st_dev, before.st_ino) == (entry.st_dev, entry.st_ino), 'source_changed')
                copied = 0
                while chunk := src.read(1024 * 1024):
                    copied += len(chunk)
                    require(copied <= before.st_size, 'source_changed')
                    dst.write(chunk)
                after = os.fstat(src.fileno())
                require((before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                        (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'source_changed')
                os.fchown(dst.fileno(), uid, gid)
                os.fchmod(dst.fileno(), stat.S_IMODE(entry.st_mode) & 0o755)
                dst.flush()
                os.fsync(dst.fileno())
    if destination is not None:
        os.chown(destination, uid, gid)
        destination.chmod(stat.S_IMODE(directory.st_mode) & 0o2755)
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
        }
        self.home = Path('/var/lib/arcade-preview-deploy')
        self.auth = self.home / '.ssh/authorized_keys'

    def run(self, argv, expected=(0,)):
        result = subprocess.run(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL, env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}, timeout=180)
        require(result.returncode in expected, 'command_failed')
        return result.stdout.decode().strip()

    def stopped(self):
        value = self.run(['/usr/bin/systemctl', 'show', UNIT, '-p', 'ActiveState', '-p', 'MainPID', '-p', 'LoadState'])
        require(set(value.splitlines()) == {'ActiveState=inactive', 'MainPID=0', 'LoadState=loaded'}, 'preview_must_be_stopped')

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
        records = re.findall(r'(/[^ ]+) \(ignore_errors=(no|yes)\)', env_files)
        require(' '.join(re.findall(r'/[^ ]+ \(ignore_errors=(?:no|yes)\)', env_files)) == env_files, 'unexpected_environment_files')
        paths = [path for path, _ in records]
        require(paths and paths[0] == str(self.base / '.env.preview') and
                len(paths) == len(set(paths)) and
                all(p in (str(self.base / '.env.preview'), '/etc/arcadeplatform/ws-preview-signing.env') for p in paths),
                'unexpected_environment_files')
        for path, optional in records[1:]:
            try:
                signing = secure.parse_env(self.files.read(Path(path), 0o600))
            except FileNotFoundError:
                require(optional == 'yes' and not Path(path).is_symlink(), 'missing_environment_file')
                continue
            require(set(signing) <= {'WS_AUTH_HS256_SECRET'}, 'unexpected_signing_environment_keys')
            env.update(signing)
        inline = self.run(['/usr/bin/systemctl', 'show', UNIT, '-p', 'Environment', '--value'])
        # systemd EnvironmentFile values override Environment assignments; reject financial file state anywhere.
        assignments = dict(item.split('=', 1) for item in shlex.split(inline))
        require(not assignments.get('WS_PERSISTED_STATE_FILE'), 'local_financial_state_requires_separate_migration')
        env = {**assignments, **env}
        # The installed configuration preflight attests deletion-window ON/OFF; this reuse checks identity.
        secure.validate_stage({**env, 'ACCOUNT_DELETION_ENABLED': '0'})
        require(not env.get('WS_PERSISTED_STATE_FILE'), 'local_financial_state_requires_separate_migration')
        require(not self.backup.exists() and not self.backup.is_symlink(), 'backup_already_exists_use_rollback')
        self.files.parents(self.backup)
        self.files.parents(self.home)
        require(not self.home.exists() and not self.home.is_symlink(), 'home_already_exists')
        require(self.base.stat().st_dev == self.backup.parent.stat().st_dev, 'cross_device_backup')
        self.clean_accounts()
        for target in self.targets:
            self.files.parents(target)
            require(not target.exists() and not target.is_symlink(), 'target_already_exists')
        self.unit_dropins(False)
        self.unit_exec()
        self.unit_state_paths()
        for rel in (*SYNC, 'netlify/functions'):
            fd = os.open(self.base, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                for part in Path(rel).parts:
                    next_fd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                    os.close(fd)
                    fd = next_fd
            except OSError:
                raise secure.Refused('missing_or_symlinked_sync_root') from None
            finally:
                os.close(fd)
        self.writers = self.old_runtime()
        for name in ROOTS:
            meta = (self.base / name).lstat()
            require(stat.S_ISDIR(meta.st_mode) and meta.st_uid == self.files.uid
                    and meta.st_dev == self.base.stat().st_dev, 'untrusted_preview_root')
            fd = os.open(self.base / name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                copy_tree(fd, None, 0, 0, name, writers=self.writers)
            finally:
                os.close(fd)
        require(self.run(['/usr/local/sbin/arcade-ws-preview-env-preflight', '--config-only']).startswith('PASS CONFIG ONLY'), 'stage_preflight_failed')
        self.run(['/usr/sbin/sshd', '-t'])
        self.run(['/usr/sbin/visudo', '-c'])
        self.ssh_policy()
        with tempfile.TemporaryDirectory(prefix='.preview-policy-', dir=self.backup.parent) as directory:
            candidate = Path(directory) / 'sudoers'
            self.files.atomic(candidate, SUDO, 0o440)
            self.run(['/usr/sbin/visudo', '-c', '-f', str(candidate)])
        return key

    def old_runtime(self):
        name = self.run(['/usr/bin/systemctl', 'show', UNIT, '-p', 'User', '--value'])
        require(name == 'arcade', 'unexpected_original_runtime')
        account = pwd.getpwnam(name)
        return account.pw_uid, set(os.getgrouplist(name, account.pw_gid))

    def unit_exec(self):
        hooks = self.run(['/usr/bin/systemctl', 'show', '--all', UNIT, '-p', 'ExecStartEx', '-p', 'ExecStartPre',
                          '-p', 'ExecStartPost', '-p', 'ExecStop', '-p', 'ExecStopPost', '-p', 'ExecCondition', '-p', 'ExecReload'])
        hooks = dict(line.split('=', 1) for line in hooks.splitlines())
        require(re.match(r'^\{ path=/usr/bin/node ; argv\[\]=/usr/bin/node server\.mjs ; flags= ; ', hooks.pop('ExecStartEx', ''))
                and all(not value for value in hooks.values()), 'unexpected_exec_hooks')

    def unit_state_paths(self):
        properties = ['BindPaths', 'BindReadOnlyPaths', 'StateDirectory', 'RuntimeDirectory', 'CacheDirectory',
                      'LogsDirectory', 'ConfigurationDirectory', 'RootDirectory', 'RootImage']
        argv = ['/usr/bin/systemctl', 'show', '--all', UNIT]
        for prop in properties:
            argv += ['-p', prop]
        state = dict(line.split('=', 1) for line in self.run(argv).splitlines())
        require(state == dict.fromkeys(properties, ''), 'unreviewed_runtime_state_paths')

    def unit_dropins(self, installed):
        prefix = '/etc/systemd/system/ws-server-preview.service.d/'
        allowed = {prefix + x for x in ['20-stage-signing.conf', '50-new-hands-hold.conf']}
        if installed:
            allowed.add(prefix + '99-preview-isolation.conf')
        drops = set(self.run(['/usr/bin/systemctl', 'show', UNIT, '-p', 'DropInPaths', '--value']).split())
        require(drops <= allowed and (not installed or prefix + '99-preview-isolation.conf' in drops), 'unexpected_unit_dropins')

    def ssh_policy(self):
        # Use root-owned default authorized_keys instead of changing/reloading global SSH configuration.
        policy = self.run(['/usr/sbin/sshd', '-T', '-C', 'user=arcade-preview-deploy,host=localhost,addr=127.0.0.1'])
        policy = dict(line.split(' ', 1) for line in policy.splitlines())
        for name, value in {'authorizedkeysfile': '.ssh/authorized_keys .ssh/authorized_keys2',
                            'authorizedkeyscommand': 'none', 'trustedusercakeys': 'none',
                            'kbdinteractiveauthentication': 'no', 'hostbasedauthentication': 'no',
                            'strictmodes': 'yes', 'pubkeyauthentication': 'yes'}.items():
            require(policy.get(name) == value, 'effective_ssh_policy_mismatch')
        return policy

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
        require(deploy.pw_uid > 0 and runtime.pw_uid > 0 and deploy.pw_uid != runtime.pw_uid
                and deploy.pw_gid > 0 and runtime.pw_gid > 0 and deploy.pw_gid != runtime.pw_gid, 'identities_not_separate')
        # Root-owned home and key policy: a deployer cannot replace its authorization by editing its home.
        home = Path(deploy.pw_dir)
        require(home == self.home, 'unexpected_deploy_home')
        self.files.parents(home)
        require(not home.exists() and not home.is_symlink(), 'home_already_exists')
        home.mkdir(mode=0o755)
        home.chmod(0o755)
        (home / '.ssh').mkdir(mode=0o755)
        (home / '.ssh').chmod(0o755)
        staging = home / 'staging'
        staging.mkdir(mode=0o700)
        os.chown(staging, deploy.pw_uid, deploy.pw_gid)
        for name in ROOTS:
            fd = os.open(self.base / name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                meta = os.fstat(fd)
                state['original'][name] = [meta.st_dev, meta.st_ino]
                copy_tree(fd, self.backup / ('new-' + name), deploy.pw_uid, deploy.pw_gid, name, writers=self.writers)
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
        try:
            self.run(['/usr/sbin/visudo', '-c'])
        except Exception:
            sudo_file = next(p for p in self.targets if p.parent.name == 'sudoers.d')
            require(self.files.read(sudo_file, 0o440) == SUDO, 'target_changed')
            sudo_file.unlink()
            self.files.sync_dir(sudo_file.parent)
            raise
        self.run(['/usr/bin/systemctl', 'daemon-reload'])
        expected = {'User': RUNTIME, 'Group': RUNTIME, 'SupplementaryGroups': '', 'NoNewPrivileges': 'yes',
                    'ProtectSystem': 'strict', 'ProtectHome': 'yes', 'PrivateTmp': 'yes', 'ReadWritePaths': '',
                    'AmbientCapabilities': '', 'DynamicUser': 'no', 'CapabilityBoundingSet': '',
                    'WorkingDirectory': str(self.base / 'ws-server')}
        argv = ['/usr/bin/systemctl', 'show', '--all', UNIT]
        for prop in expected:
            argv += ['-p', prop]
        effective = dict(line.split('=', 1) for line in self.run(argv).splitlines())
        require(effective == expected, 'effective_unit_mismatch')
        self.unit_exec()
        self.unit_state_paths()
        self.unit_dropins(True)
        self.stopped()
        self.ssh_policy()
        for name in (DEPLOY, RUNTIME):
            account = pwd.getpwnam(name)
            require(self.run(['/usr/bin/id', '-G', name]) == str(account.pw_gid), 'unexpected_account_groups')
        sudo = self.run(['/usr/bin/sudo', '-n', '-l', '-U', DEPLOY])
        marker = 'User ' + DEPLOY + ' may run the following commands on '
        require(sudo.count(marker) == 1, 'unexpected_sudo_policy')
        defaults = sudo.split(marker, 1)[0]
        require('env_reset' in defaults and '!env_reset' not in defaults and 'env_keep' not in defaults
                and 'secure_path=' in defaults, 'unexpected_sudo_environment')
        entries = sudo.split(marker, 1)[1].split('\n', 1)[1]
        entries = ' '.join(line.strip() for line in entries.splitlines() if line.strip())
        require(entries == '(root) NOPASSWD: /usr/local/sbin/arcade-ws-preview-env-preflight \"\", /usr/bin/systemctl restart ws-server-preview.service',
                'unexpected_sudo_policy')
        runtime_sudo = self.run(['/usr/bin/sudo', '-n', '-l', '-U', RUNTIME], expected=(0, 1))
        require('not allowed to run sudo' in runtime_sudo or 'may not run sudo' in runtime_sudo,
                'unexpected_runtime_sudo_policy')
        self.files.atomic(self.auth, key, 0o644)  # enabled only after the unit uses the isolated runtime
        self.stopped()
        state['phase'] = 'provisioned_runtime_not_started'
        self.save(state)
        return state['phase']

    def rollback(self):
        self.stopped()
        try:
            state = json.loads(self.files.read(self.backup / 'manifest.json', 0o600))
        except FileNotFoundError:
            raise secure.Refused('backup_manifest_missing_requires_recovery') from None
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
