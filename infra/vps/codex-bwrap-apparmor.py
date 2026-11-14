#!/usr/bin/python3
"""Fixed AppArmor catalog support. Called only by the locked/audited VPS helper.

No package installation, sysctl writes, services, arbitrary paths or CLI fixtures.
The trusted OWNER stages this file and the byte-pinned Ubuntu asset together.
"""
import errno
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time

PROFILE_SHA256 = '11d39094f044f0cda0febb3ad517b830301da6b2ce929664af09ee9e4dd264f9'
ASSET = '/usr/local/libexec/arcade-vps-admin/bwrap-userns-restrict'
TARGET = '/etc/apparmor.d/bwrap-userns-restrict'
STATE = '/var/lib/arcade-admin/codex-bwrap-apparmor'
POLICY = '/sys/kernel/security/apparmor/policy'
NAMES = {'bwrap', 'unpriv_bwrap'}
PARSER = '/usr/sbin/apparmor_parser'


class Blocked(Exception):
    pass


def require(ok, reason):
    if not ok:
        raise Blocked(reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def attachment_matches(pattern, executable):
    # fnmatch wildcards deliberately overmatch slashes: false positives STOP,
    # never a false assurance. Expand AppArmor brace alternation before matching.
    require(pattern != '<unknown>' and not any(c in pattern for c in '\\@\x00\n'),
            'attachment_unverifiable')
    # AARE character classes include negation variants fnmatch does not share.
    # Overapproximate every well-formed class by '?' instead of risking a miss.
    pattern = re.sub(r'\[[^\[\]]+\]', '?', pattern)
    require(not any(c in pattern for c in '[]'), 'attachment_unverifiable')
    if not pattern.startswith('/'):

        require(re.fullmatch(r'[A-Za-z0-9_.:/-]+', pattern), 'attachment_unverifiable')
        return False  # named profile without an executable attachment
    require(re.fullmatch(r'[/A-Za-z0-9_.,{}*?! -]+', pattern), 'attachment_unverifiable')
    patterns = [pattern]
    for _ in range(16):
        expanded = []
        for item in patterns:
            match = re.search(r'\{([^{}]*)\}', item)
            if match:
                choices = match[1].split(',')
                require(len(choices) > 1, 'attachment_unverifiable')
                expanded.extend(item[:match.start()] + v + item[match.end():] for v in choices)
            else:
                require('{' not in item and '}' not in item, 'attachment_unverifiable')
                expanded.append(item)
        require(len(expanded) <= 256, 'attachment_unverifiable')
        if expanded == patterns:
            require(all(x.count('[') == x.count(']') for x in patterns), 'attachment_unverifiable')
            return any(fnmatch.fnmatchcase(executable, x) for x in patterns)
        patterns = expanded
    raise Blocked('attachment_unverifiable')


class Context:
    # Import-only fixtures use an isolated tree/runner. CLI accepts no overrides.
    def __init__(self, root=Path('/'), owner=(0, 0), runner=None):
        self.root = Path(root)
        self.owner = owner
        self.runner = runner or self.command
        self.deadline = time.monotonic() + 90
        self.mutated = False

    def p(self, name):
        return self.root / name.lstrip('/')

    def tick(self):
        require(time.monotonic() < self.deadline, 'inspection_timeout')

    def command(self, argv):
        self.tick()
        try:
            r = subprocess.run(argv, stdin=subprocess.DEVNULL, capture_output=True,
                               timeout=min(20, max(1, self.deadline-time.monotonic())),
                               env={'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C'},
                               check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise Blocked('command_unverifiable') from None
        require(r.returncode == 0, 'parser_failed')
        return r.stdout.decode('utf-8', errors='strict')

    def read(self, file, limit=1024*1024):
        self.tick()
        with open(file, 'rb') as f:
            data = f.read(limit+1)
        require(len(data) <= limit, 'inspection_size')
        return data

    def trusted(self, file, directory=False):
        """All mutable ancestors must be root-owned and non-writable; no symlinks."""
        parts = file.relative_to(self.root).parts
        current = self.root
        for part in ('', *parts):
            current = current / part
            s = current.lstat()
            require(not stat.S_ISLNK(s.st_mode) and (s.st_uid, s.st_gid) == self.owner
                    and not s.st_mode & 0o022, 'path_permissions')
        require(stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode), 'path_type')
        return s

    def environment(self):
        os_release = self.read(self.p('/etc/os-release')).decode()
        require(re.search(r'^ID=["\']?ubuntu["\']?$', os_release, re.M)
                and re.search(r'^VERSION_ID=["\']24\.04["\']$', os_release, re.M), 'ubuntu_version')
        require(self.read(self.p('/sys/module/apparmor/parameters/enabled')).strip() == b'Y', 'apparmor_disabled')
        require(self.read(self.p('/proc/sys/kernel/apparmor_restrict_unprivileged_userns')).strip() == b'1', 'restriction_changed')
        require(self.read(self.p('/proc/self/attr/current')).strip() == b'unconfined', 'caller_confined')
        require(self.read(self.p('/sys/kernel/security/apparmor/.ns_level')).strip() == b'0'
                and self.read(self.p('/sys/kernel/security/apparmor/.ns_stacked')).strip() == b'no',
                'caller_policy_namespace')
        for ns in ('user', 'mnt', 'pid'):
            a = self.p('/proc/self/ns/'+ns).stat()
            b = self.p('/proc/1/ns/'+ns).stat()
            require((a.st_dev, a.st_ino) == (b.st_dev, b.st_ino), 'caller_namespace')

    def policy(self):
        """Enumerate the kernel's attachments, not names guessed from source files."""
        base = self.p(POLICY)
        require(not list((base/'namespaces').iterdir()), 'policy_namespaces')
        found = {}

        def walk(directory, prefix=""):
            for d in sorted(directory.iterdir()):
                self.tick()
                require(d.is_dir() and not d.is_symlink(), 'policy_tree')
                row = {key: self.read(d/key, 8192).decode().strip()
                       for key in ('name', 'attach', 'mode', 'sha256')}
                local_name = row.pop('name')
                name = prefix+'//'+local_name if prefix else local_name
                require(name and name not in found and row['mode'] in ('enforce', 'complain', 'unconfined')
                        and re.fullmatch(r'[a-f0-9]{64}', row['sha256']), 'policy_unverifiable')
                found[name] = row
                if (d/'profiles').exists():
                    walk(d/'profiles', name)
        walk(base/'profiles')
        flat = self.read(self.p('/sys/kernel/security/apparmor/profiles')).decode().splitlines()
        require(sorted(flat) == sorted(f'{name} ({row["mode"]})' for name, row in found.items()),
                'policy_incomplete')
        return found

    def sources(self, installed=False):
        base = self.p('/etc/apparmor.d')
        self.trusted(base, True)
        for name in ('local/bwrap-userns-restrict', 'local/unpriv_bwrap',
                     'disable/bwrap-userns-restrict', 'force-complain/bwrap-userns-restrict'):
            require(not os.path.lexists(base/name), 'profile_override')
        records = []
        for directory, dirs, files in os.walk(base, followlinks=False, onerror=lambda e: (_ for _ in ()).throw(e)):
            for name in sorted(dirs+files):
                file = Path(directory)/name
                self.trusted(file, file.is_dir())
                if file == self.p(TARGET):
                    require(installed, 'target_exists')
                    continue
                if file.is_file():
                    data = self.read(file)
                    # Also refuse dormant vendor bwrap definitions and local tunables.
                    require(not re.search(rb'bwrap|bubblewrap', data, re.I), 'source_conflict')
                    records.append((str(file.relative_to(base)), digest(data)))
        return digest(json.dumps(sorted(records)).encode())

    def processes(self):
        proc = self.p('/proc')
        for d in proc.iterdir():
            if not d.name.isdigit():
                continue
            self.tick()
            try:
                status = self.read(d/'status')
                require(re.search(rb'^State:\s+[RSDTtXZPIW]\b', status, re.M), 'process_state')
                # A zombie leader can still have live threads. Skip only its
                # unavailable exe; inspect every remaining thread below.
                if not re.search(rb'^State:\s+Z\b', status, re.M):
                    comm = self.read(d/'comm', 8192).decode().strip()
                    try:
                        exe = os.readlink(d/'exe')
                    except FileNotFoundError:
                        if not d.exists():
                            continue
                        require(re.search(rb'^Kthread:\s+1$', status, re.M), 'process_exe')
                        exe = ''
                    require(comm != 'bwrap' and Path(exe.removesuffix(' (deleted)')).name != 'bwrap', 'bwrap_busy')
                for task in (d/'task').iterdir():
                    try:
                        task_status = self.read(task/'status')
                        require(re.search(rb'^State:\s+[RSDTtXZPIW]\b', task_status, re.M), 'thread_state')
                        if re.search(rb'^State:\s+Z\b', task_status, re.M):
                            continue  # only this individual dead thread
                        label = self.read(task/'attr/current', 8192).decode().strip()
                    except OSError as error:
                        if error.errno in (errno.ENOENT, errno.ESRCH) and not task.exists():
                            continue
                        raise
                    require(label and not re.search(r'(^|[^A-Za-z0-9_])(bwrap|unpriv_bwrap)([^A-Za-z0-9_]|$)', label),
                            'profile_busy')
            except OSError as error:
                if error.errno in (errno.ENOENT, errno.ESRCH) and not d.exists():
                    continue
                raise

    def inspect(self, installed=False, processes=True):
        self.environment()
        policy = self.policy()
        for name, row in policy.items():
            if installed and name in NAMES:
                continue
            require(name not in NAMES, 'profile_name_conflict')
            require(not attachment_matches(row['attach'], '/usr/bin/bwrap'), 'attachment_conflict')
        if installed:
            require(NAMES <= policy.keys(), 'owned_policy_missing')
        sources = self.sources(installed)
        if processes:
            self.processes()
        require(policy == self.policy(), 'policy_raced')
        return {'policy': policy, 'sources': sources}

    def asset(self):
        for name in ('/usr/bin/bwrap', PARSER):
            binary = self.p(name)
            info = self.trusted(binary)
            require(stat.S_IMODE(info.st_mode) == 0o755
                    and 'security.capability' not in os.listxattr(binary), 'binary_permissions')
        f = self.p(ASSET)
        self.trusted(f)
        data = self.read(f)
        require(digest(data) == PROFILE_SHA256, 'asset_hash')
        return data

    def syncdir(self, directory):
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def create(self, file, data, mode=0o600):
        fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
        try:
            os.fchmod(fd, mode)
            with os.fdopen(fd, 'wb', closefd=False) as f:
                f.write(data); f.flush(); os.fsync(fd)
        finally:
            os.close(fd)
        self.syncdir(file.parent)

    def event(self, data):
        fd = os.open(self.p(STATE)/'manifest.jsonl', os.O_WRONLY | os.O_APPEND | os.O_NOFOLLOW)
        try:
            line = (json.dumps(data, sort_keys=True)+'\n').encode()
            require(os.write(fd, line) == len(line), 'manifest_write')
            os.fsync(fd)
        finally:
            os.close(fd)

    def identity(self, file):
        s = self.trusted(file)
        require(stat.S_IMODE(s.st_mode) == 0o644 and s.st_nlink == 2, 'target_metadata')
        data = self.read(file)
        require(digest(data) == PROFILE_SHA256, 'target_hash')
        return [s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns]

    def execute(self, action, run_id):
        try:
            return self._execute(action, run_id)
        except (OSError, ValueError, UnicodeError):
            raise Blocked('inspection_unverifiable') from None

    def _execute(self, action, run_id):
        require(action in ('check', 'install', 'rollback') and re.fullmatch(r'[1-9][0-9]{0,19}', run_id), 'arguments')
        if action == 'check':
            baseline = self.inspect()
            return 'conflict_free profiles='+str(len(baseline['policy']))
        data = self.asset()
        target, state = self.p(TARGET), self.p(STATE)
        if action == 'install':
            baseline = self.inspect()
            require(not os.path.lexists(state), 'state_exists_no_retry')
            require(not os.path.lexists(target), 'target_exists')
            self.trusted(state.parent, True)
            # Compile the exact trusted asset without kernel or cache writes.
            self.runner([PARSER, '-Q', '-K', '-I', str(self.p('/etc/apparmor.d')), str(self.p(ASSET))])
            require(baseline == self.inspect(), 'baseline_raced')
            require(state.parent.stat().st_dev == target.parent.stat().st_dev, 'custody_cross_device')
            self.tick()
            state.mkdir(mode=0o700)
            self.mutated = True
            self.syncdir(state.parent)
            self.create(state/'manifest.jsonl', b'')
            self.event({'phase':'prepared', 'run':run_id, 'baseline':baseline, 'profile_sha256':PROFILE_SHA256})
            self.create(state/'profile', data, 0o644)
            # Load from protected custody first: a failed ADD must not leave
            # a persistent /etc policy that a later reload could activate.
            self.event({'phase':'loading'})
            self.runner([PARSER, '-a', '-K', '-I', str(self.p('/etc/apparmor.d')), str(state/'profile')])
            after = self.inspect(True, processes=False)
            require({k:v for k,v in after['policy'].items() if k not in NAMES} == baseline['policy']
                    and after['sources'] == baseline['sources'], 'postinstall_drift')
            require(after['policy']['bwrap']['attach'] == '/usr/bin/bwrap'
                    and after['policy']['unpriv_bwrap']['attach'] == 'unpriv_bwrap'
                    and all(after['policy'][n]['mode'] == 'enforce' for n in NAMES), 'loaded_policy_mismatch')
            self.event({'phase':'loaded', 'after':after})
            self.tick()
            self.event({'phase':'publishing'})
            # Atomic no-clobber publication after verified kernel ADD. The
            # protected second hardlink remains as provenance/custody evidence.
            os.link(state/'profile', target, follow_symlinks=False)
            self.syncdir(target.parent)
            identity = self.identity(target)
            require(after == self.inspect(True, processes=False), 'publication_drift')
            self.event({'phase':'installed', 'identity':identity, 'after':after})
            return 'installed_no_smoke sha256='+PROFILE_SHA256
        # Rollback only an entirely successful own install. Partial mutations
        # require OWNER inspection; never guess which kernel profile is ours.
        self.trusted(state, True)
        require(stat.S_IMODE(state.stat().st_mode) == 0o700, 'state_permissions')
        self.trusted(state/'manifest.jsonl')
        events = [json.loads(x) for x in self.read(state/'manifest.jsonl').splitlines()]
        require(len(events) == 5 and [x['phase'] for x in events] == ['prepared','loading','loaded','publishing','installed']
                and events[0]['profile_sha256'] == PROFILE_SHA256, 'manifest_incomplete')
        before = events[0]['baseline']
        last = events[-1]
        require(self.identity(target) == last['identity'] and self.identity(state/'profile') == last['identity'], 'target_drift')
        require(self.inspect(True) == last['after'], 'policy_or_source_drift')
        require(not os.path.lexists(state/'retired-profile'), 'rollback_exists')
        # Process and policy inspection repeats immediately before the mutation;
        # root/admin serialization cannot stop independent agent launches.
        self.processes()
        self.tick()
        self.mutated = True
        self.event({'phase':'retiring', 'run':run_id})
        os.rename(target, state/'retired-profile')
        self.syncdir(target.parent); self.syncdir(state)
        self.event({'phase':'removing'})
        self.runner([PARSER, '-R', '-K', '-I', str(self.p('/etc/apparmor.d')), str(state/'profile')])
        require(not os.path.lexists(target) and self.inspect(processes=False) == before, 'rollback_verification')
        self.event({'phase':'rolled_back', 'run':run_id})
        return 'rolled_back_evidence_retained'


def main():
    require(os.geteuid() == 0 and len(sys.argv) == 3, 'root_catalog_only')
    c = Context()
    try:
        print('BWRAP_OK '+c.execute(sys.argv[1], sys.argv[2]))
        return 0
    except Exception as e:
        reason = str(e) if isinstance(e, Blocked) else 'inspection_unverifiable'
        # A failed command after mutation is never described as unchanged.
        print(('BWRAP_FAILED ' if c.mutated else 'BWRAP_BLOCKED ')+reason)
        return 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('BWRAP_BLOCKED arguments_or_identity')
        sys.exit(1)
