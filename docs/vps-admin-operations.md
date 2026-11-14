# VPS admin operations (root on demand, #1159)

Root work on the VPS is requested, approved and executed through one GitHub Actions workflow. Nobody gets a
standing root shell: the agent account `copilot` keeps its existing narrow root rules and, after separately
approved preparation, only the fixed non-root GitHub signer rule described below; the executor
account `arcade-admin` may run only the fixed catalog of one root helper.

| Role | Who | Mechanism |
|---|---|---|
| Requester | agent (release agent App, `vars.WS_RELEASE_AGENT`) or owner | `workflow_dispatch` of `VPS Admin Operation` on `main` |
| Approver | owner | required reviewer of the `vps-admin` environment (prevent self-review, `main` only, no admin bypass) |
| Executor | `arcade-admin` on the VPS | SSH key only in the `vps-admin` environment secrets; `sudo -n /usr/local/sbin/arcade-vps-admin <operation> <runId>` |

This reuses the T004 release pattern (`ws-server-deploy.yml` job `deploy`, `ws-production`, `arcade-release`,
`infra/vps/ws-restart-gate.mjs`); it is not a second approval system.

## Catalog

| Operation | Effect |
|---|---|
| `volume-workdir-prepare` | Verifies the fixed writable EXT4 `/dev/sdb` mount and Hetzner by-id identity, then creates only `/mnt/HC_Volume_107462648/copilot-work` as `copilot:copilot 0750`. Correct existing directory is a no-op; symlinks or conflicting ownership/modes block without repair. No mount/fstab/format/service/data changes. |
| `ledger-dispatchers-status` | Read-only: user, state, timer state and pending `daemon-reload` of both ledger dispatchers |
| `npm-cache-1240-check` | Read-only check of three fixed public npm archive blobs: owner, size, age, SHA-512, root device and process references. No move or deletion. |
| `npm-cache-1240-cleanup` | One-time eviction of exactly those three verified archive cache copies through existing protected custody. No installed package/session data or wildcard cleanup. See #1240 below. |
| `ledger-dispatchers-pause` | Stops both dispatcher timers, then waits until no dispatcher runs. One 5-minute deadline covers both dispatchers and every `systemctl` call, and a state read after it is a timeout even if idle; on timeout it reports `timeout_timers_left_stopped` with each service state and leaves the timers stopped for the owner's decision (no automatic resume) |
| `ledger-dispatchers-resume` | Refuses while any of the two services or two timers needs `daemon-reload`; otherwise starts both timers and checks they are active |
| `systemd-daemon-reload` | `systemctl daemon-reload` |
| `copilot-secret-snapshots-quarantine` | Moves the fixed list of `copilot` files that hold credentials or their recovery copies (`HOST.quarantine.files` in `infra/vps/vps-admin.mjs`; nothing else in the home) into `/var/lib/arcade-admin/quarantine/<runId>/` (`root:root 0700`) with `rename(2)`, so `copilot` can no longer read them. The home and every parent directory are opened with `O_NOFOLLOW`, each relative to the previous descriptor, and the move goes through these descriptors, so a symlink or rename in `copilot`'s tree cannot redirect it. Before the first move every file must exist as a single-link regular file of `copilot` in `copilot` directories, no process may refer to it (cwd, root, executable, descriptor or memory mapping, by device and inode), existing quarantine directories must already be `root:root 0700` (never changed) and the run directory must be new. `MANIFEST` records each file's identity, then `moving <i>` before and `moved <i>` after its rename (both directories and the file itself fsynced in between) and ends with `complete <n>` only for full custody. The result is `custody=complete`, otherwise `ADMIN_FAILED <step> custody=none|partial|uncertain|moved_but_open moved=<k>/<n> manifest=<path>`. A missing file blocks (`file_<i>_missing`), also after an earlier run. Output carries only counts and paths, never file contents |
| `ledger-production-dispatcher-install` | Installs `infra/vps/production-retention/arcade-chips-ledger-production-dispatch.sh` from `main` as `/usr/local/bin/arcade-chips-ledger-production-dispatch.sh` (`root:root 0755`). Before any change the helper reads this run from the GitHub API and blocks unless it is the in-progress `VPS Admin Operation` `workflow_dispatch` on `main` (`run_not_main_vps_admin_dispatch`) and `main` still points at the run's commit (`main_advanced`). A failed `systemctl stop` of either timer is reported for each timer; the other one is still stopped. It then pauses both timers as `ledger-dispatchers-pause` does, downloads the script at that exact commit, checks it is a bash script of at most 64 KiB whose git object id equals the one the contents API reports for that path and commit (`content_mismatch` keeps the old script), and replaces the old one with `rename(2)`. The result and the journal record `commit=<sha> sha256=<new> previous=<old>`, also for a failure during the install, which reads the destination back and reports `replaced=yes|no|unknown`. The timers stay stopped, also after a failure (`…timers_left_stopped`); `ledger-dispatchers-resume` is the separate next request. A script-only change needs no `systemd-daemon-reload`; the result shows `reload:<yes/no>` |
| `ws-restart-gate-install` | Installs `infra/vps/ws-restart-gate.mjs` from `main` as `/usr/local/sbin/arcade-ws-restart-gate` (`root:root 0755`). Verifies the run is an in-progress `VPS Admin Operation` `workflow_dispatch` on `main` (`run_not_main_vps_admin_dispatch`) and `main` still points at the run's commit (`main_advanced`). Validates syntax with `node --check` on a `.mjs` temporary file, validates required modes and git blob SHA (`content_mismatch` keeps old helper), and replaces atomically with `rename(2)`. Runs a post-install gate check (accepting safe or blocked, refusing `gate_error`), attempts atomic recovery from previous bytes on verification failure, never restarts WS Production, and records the commit and SHA-256 in the journal |
| `github-app-token-prepare` | Prepare only the fixed non-root signer account, protected empty key directory, executable and narrow run-as policy. No key read/copy, token mint, client switch or service operation. Partial failure requires protected-manifest inspection. |
| `github-app-key-quarantine` | After OWNER accepts new gh/Git behavior: verify the replacement signer through metadata-only info output (one scoped token is minted and discarded), then reuse the existing descriptor-based quarantine for only `.arcade-code-agent/app.pem`. Does not rotate/revoke the key or invalidate existing tokens. |
| `ws-preview-isolation-provision` | Full read-only preflight, then hard-kick/stop only Preview, verify empty cgroup, backup and isolate deploy/runtime identities; leaves Preview stopped. Occupied tables do not block Stage. No receipt or settlement guarantee. |
| `ws-preview-isolation-rollback` | Requires stopped Preview and protected manifest; revokes new key and restores original files, leaving Preview stopped. No automatic retry/start. |

See [Preview activation/recovery](../specs/1159-ci-cd-release-safety/ws-preview-access-implementation.md). After an attempted stop or partial mutation, FAILED requires inspecting protected manifest/unit state; never infer unchanged state from a failed request.

Every operation uses fixed absolute commands with fixed arguments and no shell. There is no free command, file
path, package name or unit name input. The dispatcher install uses `curl` to `api.github.com` and
`raw.githubusercontent.com` for this repository, with URLs built from the validated run id and commit.
The one-key quarantine also invokes the non-root signer proof, which requests one scoped token from
the fixed `api.github.com` installation endpoint and discards it without printing it.

### Quarantine limits and recovery

`custody=complete` means every listed file is in the quarantine, `copilot` has no path to it and no process shows a
reference to it in `/proc`. It cannot prove that `copilot` kept no copy or hidden reference (for example a
descriptor queued on a Unix socket): an account that could read a file may have copied it. Treat the contents as
exposed; rotating the credentials stays required.

Recovery means the owner reads a quarantined file as root where it is: `/var/lib/arcade-admin/quarantine/<runId>/`.
Never move a file back into `/home/copilot` as root: that tree belongs to `copilot`, and a root write there can be
redirected by a symlink or replace another file. Returning a file to `copilot` would be a separate reviewed
operation.

For a run without `complete <n>`, check every `file <i>` line of `MANIFEST`, not only the `moved` lines: the file is
either `<i>-<name>` in the run directory or still at its source, identified by the recorded `dev`, `ino` and
`size`. A `moving <i>` line without `moved <i>` means that file's move is uncertain until this check. Do not request
the operation again before the remaining files are resolved; a moved file is missing at its source, so a new
request blocks with `file_<i>_missing` until the list is changed by a reviewed PR. There is no restore operation.

## Request

1. Dispatch `VPS Admin Operation` from `main` with `operation`, `reason` and `confirmation` exactly
   `RUN <operation>`. The reason is one plain line of 10–200 letters, digits, spaces or `.,:;()/+=_-`, so it
   cannot add lines, markdown or HTML to the summary.
2. The unprivileged job `request` ("1. Review request: <operation>"; no environment, no secret) checks the
   inputs and writes the approval summary: the operation's reviewed description from
   `infra/vps/vps-admin-approval.mjs` (changes, risk and downtime, side effects, way back, read-only or not),
   target, `main` revision, requester, triggering actor and, labelled as free text, the reason. A catalog
   operation without exactly one description fails this job, so nothing can be approved without one. It finishes
   before the approval request.
3. The owner reads that summary in the pending run (see [Before you approve](#before-you-approve)) and approves
   the `vps-admin` environment for the job `operate` ("2. Run on the VPS after approval: <operation>"). Before
   that approval no job has a VPS secret. A re-run needs a new approval.
4. `operate` connects as `arcade-admin` (the step fails for any other account) and runs the helper once.

`ADMIN_OK <operation> <details>` is success. `ADMIN_BLOCKED <operation> <reason>` (for example `busy`,
`unexpected_arguments`, `unverifiable_<unit>_<property>`, `audit_unavailable`, `…_still_running`) and
`ADMIN_FAILED <operation> <step>` fail the job. A systemd read that fails or returns an undocumented value blocks
the operation; a status is never reported from unverified data. Nothing is retried automatically; the owner
decides the next step.

### Before you approve

GitHub's `Review deployments` dialog shows only the environment and a comment field; it cannot show a custom
description. The run page shows it instead, so read it there before opening the dialog:

1. Open the run from the link or from Actions → `VPS Admin Operation`. The run title is
   `VPS Admin: <operation> (requested by <actor>)`.
2. Stay on the `Summary` tab. The annotation at the top says `Read-only` or `Changes the VPS` with the title of the
   operation; scroll below the job graph to `Approve only if expected: <operation>`.
3. Check operation, revision, requester, changes, risk, side effects and the way back. The reason is the
   requester's free text; the reviewed description is what the helper does.
4. Only then use `Review deployments` → `vps-admin` → `Approve and deploy`; otherwise `Reject`.

The same applies to `WS Server Deploy` (job `Review WS Production release request`, environment `ws-production`).

## Audit

- GitHub: the run (requester, triggering actor, reason, result) and the environment deployment history (approver,
  time).
- VPS: the journal entries tagged `arcade-vps-admin` (`journalctl -t arcade-vps-admin`) before and after each
  request: operation, run id, sudo caller, result and detail. Blocked requests are recorded too.
- No operation starts without a recorded start entry (`ADMIN_BLOCKED … audit_unavailable`). If the end entry
  cannot be written, the result is `ADMIN_FAILED <operation> audit_end_after_<outcome>`, never success; the
  operation is not repeated.
- Requests are serialized by the workflow concurrency group `vps-admin` and by `flock(1)` on
  `/run/arcade-vps-admin.lock`. The kernel releases the lock when the helper exits or dies, so there is no stale
  lock to clean up; a second request while one runs is `busy`.

## Adding an operation

A reviewed PR adds the operation to `OPERATIONS` in `infra/vps/vps-admin.mjs`, to the workflow choice list and to
`infra/vps/arcade-admin.sudoers` (the guard test keeps the three identical), with a fundamental test, and its
approval description to `APPROVAL` in `infra/vps/vps-admin-approval.mjs` in catalog order (facts of the helper code;
no backticks, pipes, angle brackets or line breaks). It becomes
available on the VPS only after the helper and sudoers file are reinstalled with `infra/vps/stage-vps-admin.sh`.

## Activation (owner, each step a separate GO)

1. Create the `vps-admin` environment: required reviewer owner, prevent self-review, deployment branches `main`
   only, no admin bypass, no secrets yet. Verify it read-only.
2. Merge the PR.
3. Run `infra/vps/stage-vps-admin.sh` as root from the merged `main`: it creates `arcade-admin`, or refuses an
   existing one that is not a system account, belongs to any other group, has other group members, another home
   or shell, or a home, `.ssh` or `authorized_keys` not owned by it or group/other writable. It installs the helper
   and `/etc/sudoers.d/arcade-admin`, and refuses unless `sudo -l -U arcade-admin` exits 0, has exactly one
   "may run" section and lists only `(root) NOPASSWD:` helper operations (an error or unknown format is a STOP), and verifies the read-only status operation and that `copilot` cannot run the helper.
4. Generate a new ed25519 key, put its public part in `/home/arcade-admin/.ssh/authorized_keys`
   (`arcade-admin:arcade-admin 0600`), and add `VPS_ADMIN_HOST`, `VPS_ADMIN_USER=arcade-admin` and
   `VPS_ADMIN_SSH_KEY` as `vps-admin` environment secrets.
5. First request: `ledger-dispatchers-status`, approved by the owner; check the run summary and the journal.

With prevent self-review, a run dispatched by the owner cannot be approved by the same owner. Agent requests need
the release agent App (`vars.WS_RELEASE_AGENT`, T004 activation step 5), which comes only after the owner token has
left `copilot` (T004-3); until then the agent cannot request an operation that it could also approve.

## GitHub App key isolation

See [security audit and OWNER cutover/recovery](../specs/1159-ci-cd-release-safety/github-app-key-isolation.md).
The new catalog entries do not take effect until a separately authorized trusted OWNER reinstall.
The fixed non-root signer run-as rule is not a root shell or admin-catalog permission for copilot.
Do not use the legacy mixed-snapshot quarantine to retire only the App key: it requires every old
snapshot and can block after earlier moves. The dedicated operation reuses that implementation with
one fixed target. Neither operation is authorized by merge or this documentation.


## #1240: one-time public npm archive cache eviction

The earlier report-only proposal is deferred. There is no minimum reclaim
threshold. This operation reserves all ledger evidence, secrets, backups,
Production state, agent installations/sessions and test directories.

The entire deletion allowlist is `NPM_CACHE_1240` in `vps-admin.mjs`: three
public `@anthropic-ai/claude-code-linux-x64` tarball versions, 2.1.318, 2.1.319
and 2.1.322. Each SHA-512 and size was compared to the public npm registry
version document. The digest gives the exact path below
`/home/copilot/.npm/_cacache/content-v2/sha512/` as first two hex characters,
next two, remaining 124. No directory traversal, cache index, installed package,
metadata response, `.npmrc`, `_npx` tree or new path is eligible. The constants
are public package metadata; live allocated-byte measurements stay outside Git.
See [npm cache design](https://docs.npmjs.com/cli/v11/commands/npm-cache/):
cache misses may be refetched, and cache data is not a persistent store.
Offline reinstall may require downloading the verified package again.

`npm-cache-1240-check` reports candidate file allocations without creating
custody directories. Both modes check all three regular, single-link copilot
files, size/digest, root device, age (48 hours to one year), pinned parent
ownership/no symlinks and visible process cwd/root/exe/fd/mmap references.
Missing targets or an incomplete process scan fail closed. A 120-second
validation deadline is checked during hashing and before deletion; the existing
synchronous process scan/custody calls may overrun that deadline, after which
no deletion starts. The workflow retains its outer timeout.

Cleanup repeats checks, reuses `quarantineSnapshots` to rename into a fresh
root-only run directory under `/var/lib/arcade-admin/npm-cache-1240`, then
rechecks all original inodes, hashes and process use before deleting anything.
Only regular files in that protected directory are unlinked, avoiding unlink
races in copilot-writable cache paths. Streaming hashes use a 1 MiB buffer.
There is no second data copy and no new helper/dependency/scheduler.
The normal admin lock and audit remain mandatory. Custody and deletion markers
are fsynced in `MANIFEST`; any failure requires inspecting this manifest and
remaining files. Never auto-retry or infer an unchanged cache after failure.
Do not restore into copilot-owned paths as root. Deleted tarballs have no local
rollback; any later fetch uses normal non-root package tooling and integrity.

The reported `deleted_allocated_bytes` sums the unlinked files' allocated
blocks; it is not a measurement of root headroom gained. Concurrent writes,
unknown references or incomplete execution can change actual recovery. Compare
`df -B1 /` and `df -i /` before/after, then verify WS Production/Preview, Caddy,
dispatcher timers, and the unchanged current/verified rollback release.

### Publication and separate OWNER GO

The agent does not expand App/signer permissions. OWNER publishes the companion
workflow choice update together with the reviewed catalog change; catalog,
workflow, sudoers and approval descriptions must match before installation.
The agent supplies a reviewed patch, not an alternative dispatch or credential.
A merge does not authorize staging, checking or deletion.

After review/publication, a separate OWNER GO covers trusted installation from
the reviewed merged main through `stage-vps-admin.sh` (including its existing
support files). Verify installed source equality. Then request the check via
the App wrapper and approve that distinct run in `vps-admin`:

`GH_CONFIG_DIR=/home/copilot/.arcade-code-agent/gh /home/copilot/.arcade-code-agent/bin/gh workflow run vps-admin-operation.yml --ref main -f operation=npm-cache-1240-check -f 'confirmation=RUN npm-cache-1240-check' -f 'reason=Issue 1240 verify three fixed public npm cache archives'`

Read the successful check, current service/release baseline and expected
allocation. Only a separate OWNER approval may authorize the cleanup request:

`GH_CONFIG_DIR=/home/copilot/.arcade-code-agent/gh /home/copilot/.arcade-code-agent/bin/gh workflow run vps-admin-operation.yml --ref main -f operation=npm-cache-1240-cleanup -f 'confirmation=RUN npm-cache-1240-cleanup' -f 'reason=Issue 1240 evict three verified public npm cache archives'`

Neither command is executed while preparing the patch. No broad test/build or
prevention rollout is part of this incident. Focused fundamental validation:
`TMPDIR=/dev/shm node --test --test-name-pattern='VPS admin' ws-tests/infra-vps-workflow.guard.test.mjs`.

## Volume work directory preparation

OWNER confirmed a 50 GB EXT4 volume `/dev/sdb`, mounted at
`/mnt/HC_Volume_107462648`, with its existing fstab entry and
`/dev/disk/by-id/scsi-0HC_Volume_107462648` pointing to `/dev/sdb`.
The empty mount directory is `root:root 0755`; the operation preserves it.
The helper rechecks mount/device identity and root-owned non-writable ancestors
before creating the single child through pinned directory descriptors.
It does not migrate checkouts, caches, credentials or other data.

This PR only adds the catalog entry. It does not install or run the helper.
Before approval, OWNER must separately arrange the reviewed helper and sudoers
installation through the approved maintenance procedure and verify installed
bytes against the reviewed source. The workflow uses the installed helper;
merging this entry alone does not update it. A later explicit request uses
`operation=volume-workdir-prepare` and `confirmation=RUN volume-workdir-prepare`,
with its own `vps-admin` OWNER approval. This task authorizes neither step.

A failure is never retried automatically. Inspect any partial directory before
requesting recovery; there is no recursive chown/chmod, repair or deletion path.

## Codex CLI bubblewrap AppArmor repair (preparation only)

The three fixed catalog operations below implement the Ubuntu 24.04 profile path
recommended by [OpenAI](https://learn.chatgpt.com/docs/sandboxing#prerequisites).
They preserve `kernel.apparmor_restrict_unprivileged_userns=1`, existing Codex
configuration and services. No operation installs packages, enables networking,
changes `sandbox_mode`, restarts a service, signals an agent or runs a CLI smoke.

| Operation | Effect and separate approval |
|---|---|
| `codex-bwrap-apparmor-check` | Read-only kernel policy/attachment/hash, source and process inspection. Reports conflicts, unknown or incomplete policy as BLOCKED. Only the standard admin lock/audit writes occur. |
| `codex-bwrap-apparmor-install` | Repeats the check, verifies the trusted staged profile and offline compilation, uses parser ADD from protected custody, verifies loaded policy, then publishes only an absent policy file, never replace. Keeps protected evidence. Requires its own OWNER approval. |
| `codex-bwrap-apparmor-rollback` | Only a complete, unchanged own install with no active dependents may return to the recorded absent baseline. Retains the file in custody and removes only the two owned kernel profiles. Requires its own OWNER approval. |

### Pinned source and installation scope

`infra/vps/bwrap-userns-restrict` is an unmodified profile extracted from Ubuntu
`noble-updates/main`, package `apparmor-profiles`, version
`4.0.1really4.0.1-0ubuntu0.24.04.9`. The package SHA-256 is
`90b02aa006eea7702cd4e851343e469e41365dda42145a3cb035de1d6c773b8c`;
the profile SHA-256 is
`11d39094f044f0cda0febb3ad517b830301da6b2ce929664af09ee9e4dd264f9`.
The download URL and upstream copyright/license accompany the asset in
`infra/vps/bwrap-userns-restrict.LICENSE`. Preparation verified the package hash
against the VPS's existing APT metadata and compiled the profile with AppArmor
4.0.1 using `-Q -K` without loading it. Trusted OWNER preparation must verify
Ubuntu signed repository metadata and the package/profile digests before staging
from the reviewed merged source; the root helper never trusts a file in an
agent-writable checkout or a caller-provided download/path.

OWNER staging installs only two new inert support files under
`/usr/local/libexec/arcade-vps-admin/`: `codex-bwrap-apparmor.py` and the pinned
profile, both `root:root 0644`. It refuses non-root-owned, writable or symlinked source paths/ancestors (including
the running stager, even when it is outside the selected checkout) before
any account/file change, verifies the profile digest and compares installed support bytes. It does not copy the profile into
`/etc/apparmor.d` or load it. No new package dependency is installed; the host
must already have `/usr/sbin/apparmor_parser` and bubblewrap. Existing staging
and sudoers verification remain mandatory. Use an OWNER-controlled trusted
checkout, never run the root stager against a copilot-owned working tree.

### Conflict and dependency gates

The check requires Ubuntu 24.04, active AppArmor, restriction value 1, an
unconfined caller in PID 1's user/mount/PID namespaces, AppArmor namespace level
zero without stacking, and complete access to:

- the kernel's `policy/profiles` tree, including child profiles, `name`, `attach`,
  `mode` and SHA-256, with an exact match to the flat kernel `profiles` list;
- the `policy/namespaces` directory; any nested policy namespace blocks;
- root-owned, non-writable, non-symlink AppArmor source paths and includes;
- all visible process/thread AppArmor labels, executable names and identities.

Another profile name `bwrap` or `unpriv_bwrap`, or any attachment that can match
`/usr/bin/bwrap`, blocks install. Brace patterns are expanded; glob/class
matching deliberately overapproximates and may produce a safe false positive.
Unknown attachments, unsupported syntax, missing hashes, unreadable processes,
source mentions of dormant vendor bubblewrap policy or local overrides block.
No other vendor's profile is disabled, removed or replaced. This avoids the
attachment collision described in [Codex #38715](https://github.com/openai/codex/issues/38715).

Existing `/etc/apparmor.d/bwrap-userns-restrict`, state directory, local includes,
disable/complain overrides or inspection races block instead of being repaired.
The install's state parent and target must be on the same filesystem. Kernel
introspection unsupported by the host is a STOP, not an invitation to weaken
inspection or turn off AppArmor.

Active `bwrap` processes or threads using either owned profile block mutation.
No process is stopped. OWNER must arrange a quiet launch window: the admin lock
serializes catalog operations but cannot prevent independent sandbox launches
or root policy edits. Pre/post checks reduce this race; they do not eliminate
it. The new profile affects future `/usr/bin/bwrap` users beyond Codex and its
child capability restrictions can affect nested sandbox consumers.

### Installation evidence and rollback limits

The one-shot state directory is
`/var/lib/arcade-admin/codex-bwrap-apparmor` (`root:root 0700`). An append-only,
fsynced `manifest.jsonl` records the absent baseline, source/kernel snapshots,
publication/loading phases, target inode/hash and verified post-install policy
hashes. The target is `root:root 0644`. Atomic no-clobber publication uses a
hardlink to the protected profile copy; both links are retained, so the expected
link count is two. Parser `-a -K -I /etc/apparmor.d` loads the protected custody copy before
publication and verifies both profiles without replacing an existing one. Only
then is the persistent file linked into `/etc/apparmor.d`. A failed ADD leaves no
persistent policy file for a later boot/reload to activate. No automatic retry,
recovery or broad AppArmor reload occurs. Post-mutation verification reads policy,
source and identity; it does not reject success because a new process started.
Process dependency gates remain mandatory immediately before mutation. Every
live thread is inspected even if its group leader is a zombie; only individual
dead threads and confirmed exited tasks are skipped.

A failed load may have changed only part of the kernel policy. FAILED never
means unchanged. Any manifest without a complete successful install blocks the
rollback operation and needs OWNER inspection and a separately reviewed recovery
path. The helper does not guess whether a concurrently present profile is ours.

Rollback rechecks the exact target/protected-copy identity, source baseline,
kernel policy hashes and all process dependencies. Even an unrelated policy or
source update after install blocks rollback. Drift or incomplete inspection
means STOP. It moves only its verified target into `retired-profile` custody,
then removes its two kernel profiles using the retained source. It keeps all
bytes and phase evidence. Failure during rollback leaves explicit incomplete
state and is not retried. A completed rollback restores the original missing
profile and the original sandbox limitation; it does not make Codex work.
The retained state deliberately blocks automatic reinstallation.

### Publication and OWNER GO order

1. Review this PR and its independent Claude Code review; OWNER decides merge.
   Merge alone performs no VPS catalog installation or AppArmor activation.
2. Separate OWNER GO: trusted installation of the merged catalog/support files
   and sudoers via `infra/vps/stage-vps-admin.sh`. Verify installed bytes and the
   existing restricted `arcade-admin` contract. No AppArmor operation is run by
   staging, and no workflow is dispatched as part of this PR.
3. Separate `VPS Admin Operation` dispatch from `main` for
   `codex-bwrap-apparmor-check`, confirmation
   `RUN codex-bwrap-apparmor-check`, with its own `vps-admin` approval. Inspect
   the successful evidence; BLOCKED/FAILED stops this sequence.
4. Separate OWNER GO and `vps-admin` approval for
   `codex-bwrap-apparmor-install`, confirmation
   `RUN codex-bwrap-apparmor-install`, in the quiet window. Installation repeats
   every check; a previous successful check does not authorize a stale mutation.
5. Only a further explicit GO permits the previously blocked non-root Codex CLI
   smoke, using its retained Volume checkout/runtime and the sandbox. Neither
   successful profile installation nor synthetic tests prove that smoke passes.
6. If needed, rollback is an alternative later request, not a mandatory step:
   `codex-bwrap-apparmor-rollback`, confirmation
   `RUN codex-bwrap-apparmor-rollback`, with separate OWNER approval and all gates.

Fundamental verification (synthetic files and mocked parser only, no root):
`node --test --test-name-pattern='VPS admin' ws-tests/infra-vps-workflow.guard.test.mjs`.
The guard suite verifies catalog/workflow/sudoers parity and exercises policy
conflicts, incomplete inspection, pinned data, no-clobber publication, drift,
process dependencies, partial load and rollback. Preserve the incident's Volume
smoke artifacts and preparation package; this change authorizes no cleanup.

If the App cannot publish workflow changes, do not expand its permissions or use
OWNER credentials. Keep the PR Draft and blocked. OWNER must publish the three
choices below immediately after `volume-workdir-prepare` in the existing workflow
before merge; catalog-parity checks must stay failing until that companion change
is present. A Draft containing only the publishable files is not a complete or
merge-ready catalog update.

```yaml
          - codex-bwrap-apparmor-check
          - codex-bwrap-apparmor-install
          - codex-bwrap-apparmor-rollback
```
