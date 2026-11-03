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
| `ledger-dispatchers-pause` | Stops both dispatcher timers, then waits up to 5 minutes until no dispatcher runs |
| `ledger-dispatchers-resume` | Refuses while a dispatcher unit needs `daemon-reload`; otherwise starts both timers and checks they are active |
| `systemd-daemon-reload` | `systemctl daemon-reload` |

Every operation uses fixed absolute commands with fixed arguments and no shell. There is no free command, file
path, package name or unit name input.

## Request

1. Dispatch `VPS Admin Operation` from `main` with `operation`, `reason` (10–200 characters) and
   `confirmation` exactly `RUN <operation>`.
2. The owner reads the reason, operation and requester in the pending run and approves the `vps-admin`
   environment. Before that approval the job has no VPS secret. A re-run needs a new approval.
3. The job checks the confirmation, records operation, run, requester and reason in the run summary, connects as
   `arcade-admin` (the step fails for any other account) and runs the helper once.

`ADMIN_OK <operation> <details>` is success. `ADMIN_BLOCKED <operation> <reason>` (for example `busy`,
`unexpected_arguments`, `…_still_running`) and `ADMIN_FAILED <operation> <step>` fail the job. Nothing is
retried automatically; the owner decides the next step.

## Audit

- GitHub: the run (requester, triggering actor, reason, result) and the environment deployment history (approver,
  time).
- VPS: the journal entries tagged `arcade-vps-admin` (`journalctl -t arcade-vps-admin`) before and after each
  request: operation, run id, sudo caller, result and detail. Blocked requests are recorded too.
- Requests are serialized by the workflow concurrency group `vps-admin` and by the helper lock
  `/run/arcade-vps-admin.lock`; a lock left by a dead process is taken over, a live one blocks (`busy`).

## Adding an operation

A reviewed PR adds the operation to `OPERATIONS` in `infra/vps/vps-admin.mjs`, to the workflow choice list and to
`infra/vps/arcade-admin.sudoers` (the guard test keeps the three identical), with a fundamental test. It becomes
available on the VPS only after the helper and sudoers file are reinstalled with `infra/vps/stage-vps-admin.sh`.

## Activation (owner, each step a separate GO)

1. Create the `vps-admin` environment: required reviewer owner, prevent self-review, deployment branches `main`
   only, no admin bypass, no secrets yet. Verify it read-only.
2. Merge the PR.
3. Run `infra/vps/stage-vps-admin.sh` as root from the merged `main`: it creates `arcade-admin`, installs the
   helper and `/etc/sudoers.d/arcade-admin`, and verifies the read-only status operation and that `copilot`
   cannot run the helper.
4. Generate a new ed25519 key, put its public part in `/home/arcade-admin/.ssh/authorized_keys`
   (`arcade-admin:arcade-admin 0600`), and add `VPS_ADMIN_HOST`, `VPS_ADMIN_USER=arcade-admin` and
   `VPS_ADMIN_SSH_KEY` as `vps-admin` environment secrets.
5. First request: `ledger-dispatchers-status`, approved by the owner; check the run summary and the journal.

With prevent self-review, a run dispatched by the owner cannot be approved by the same owner. Agent requests need
the release agent App (`vars.WS_RELEASE_AGENT`, T004 activation step 5), which comes only after the owner token has
left `copilot` (T004-3); until then the agent cannot request an operation that it could also approve.
