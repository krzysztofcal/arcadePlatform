# VPS admin operations (root on demand, #1159)

Root work on the VPS is requested, approved and executed through one GitHub Actions workflow. Nobody gets a
standing root shell: the agent account `copilot` keeps only its existing narrow sudo rules, and the executor
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
| `ledger-dispatchers-status` | Read-only: user, state, timer state and pending `daemon-reload` of both ledger dispatchers |
| `ledger-dispatchers-pause` | Stops both dispatcher timers, then waits until no dispatcher runs. One 5-minute deadline covers both dispatchers and every `systemctl` call, and a state read after it is a timeout even if idle; on timeout it reports `timeout_timers_left_stopped` with each service state and leaves the timers stopped for the owner's decision (no automatic resume) |
| `ledger-dispatchers-resume` | Refuses while any of the two services or two timers needs `daemon-reload`; otherwise starts both timers and checks they are active |
| `systemd-daemon-reload` | `systemctl daemon-reload` |
| `copilot-secret-snapshots-quarantine` | Moves the fixed list of `copilot` files that hold credentials or their recovery copies (`HOST.quarantine.files` in `infra/vps/vps-admin.mjs`; nothing else in the home) into `/var/lib/arcade-admin/quarantine/<runId>/` (`root:root 0700`) with `rename(2)`, so `copilot` can no longer read them. The home and every parent directory are opened with `O_NOFOLLOW`, each relative to the previous descriptor, and the move goes through these descriptors, so a symlink or rename in `copilot`'s tree cannot redirect it. Before the first move every file must exist as a single-link regular file of `copilot` in `copilot` directories, no process may refer to it (cwd, root, executable, descriptor or memory mapping, by device and inode), existing quarantine directories must already be `root:root 0700` (never changed) and the run directory must be new. `MANIFEST` records each file's identity, then `moving <i>` before and `moved <i>` after its rename (both directories and the file itself fsynced in between) and ends with `complete <n>` only for full custody. The result is `custody=complete`, otherwise `ADMIN_FAILED <step> custody=none|partial|uncertain|moved_but_open moved=<k>/<n> manifest=<path>`. A missing file blocks (`file_<i>_missing`), also after an earlier run. Output carries only counts and paths, never file contents |

Every operation uses fixed absolute commands with fixed arguments and no shell. There is no free command, file
path, package name or unit name input.

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
2. The unprivileged job `request` (no environment, no secret) checks the inputs and writes operation, reason,
   `main` revision, requester and triggering actor to its summary. It finishes before the approval request.
3. The owner reads that summary in the pending run and approves the `vps-admin` environment for the job
   `operate`. Before that approval no job has a VPS secret. A re-run needs a new approval.
4. `operate` connects as `arcade-admin` (the step fails for any other account) and runs the helper once.

`ADMIN_OK <operation> <details>` is success. `ADMIN_BLOCKED <operation> <reason>` (for example `busy`,
`unexpected_arguments`, `unverifiable_<unit>_<property>`, `audit_unavailable`, `…_still_running`) and
`ADMIN_FAILED <operation> <step>` fail the job. A systemd read that fails or returns an undocumented value blocks
the operation; a status is never reported from unverified data. Nothing is retried automatically; the owner
decides the next step.

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
`infra/vps/arcade-admin.sudoers` (the guard test keeps the three identical), with a fundamental test. It becomes
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
