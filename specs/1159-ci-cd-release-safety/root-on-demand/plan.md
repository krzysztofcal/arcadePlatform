# Plan — root on demand (#1159)

## Reused mechanisms

| Need | Existing mechanism reused |
|---|---|
| Identity pairs | `if:` of `ws-server-deploy.yml` job `deploy` (owner/owner or `vars.WS_RELEASE_AGENT`) |
| Owner approval before credentials | GitHub Environment with required reviewer, as `ws-production` |
| Separate executor | VPS account per role, as `arcade-release` (bootstrap + staging script) |
| Root logic | Root-owned Node helper with fixed argv and one-line results, as `infra/vps/ws-restart-gate.mjs` |
| Minimal sudo | Exact `Cmnd_Alias` per account, as `infra/vps/arcade-deploy.sudoers` |
| Install on an existing host | Root staging script, as `infra/vps/stage-ws-restart-gate.sh` |

A separate environment (`vps-admin`) and account (`arcade-admin`) are used instead of `ws-production` /
`arcade-release`, because environment secrets reach every job of the environment: the release job must not hold the
admin key, and admin operations must not hold the release key.

## Files

- `infra/vps/vps-admin.mjs` → `/usr/local/sbin/arcade-vps-admin`:
  - `OPERATIONS`: catalog, each a function of an injectable `host` (`run`, `sleep`, `isAlive`, `lockDir`,
    `requester`);
  - `runOperation(operation, runId, overrides)`: validates the name against the catalog and `runId`
    (`^[1-9][0-9]{0,19}$`), takes `/run/arcade-vps-admin.lock` (stale lock of a dead pid taken over), writes
    start/result journal entries with `/usr/bin/logger -t arcade-vps-admin`, returns one line;
  - CLI: exactly two arguments, otherwise `ADMIN_BLOCKED invalid unexpected_arguments`.
- `infra/vps/arcade-admin.sudoers` → `/etc/sudoers.d/arcade-admin`: `arcade-admin` may run the helper with each
  catalog operation (`<operation> *`, the helper rejects anything but one run id).
- `infra/vps/stage-vps-admin.sh`: creates `arcade-admin` (refuses if `copilot` is in its group), installs helper
  and sudoers, `visudo -c`, verifies the read-only status operation and that `copilot` cannot run the helper.
- `infra/vps/bootstrap.sh`: same account, helper and sudoers for new hosts.
- `.github/workflows/vps-admin-operation.yml`: `workflow_dispatch` (`operation` choice, `reason`,
  `confirmation`), concurrency `vps-admin`, job `operate` with the identity `if:`, `environment: vps-admin`,
  authorize step (confirmation `RUN <operation>`, reason 10–200 characters, summary), SSH step as `arcade-admin`
  with secrets `VPS_ADMIN_HOST`, `VPS_ADMIN_USER`, `VPS_ADMIN_SSH_KEY`; only `ADMIN_OK <operation>` passes.
- `docs/vps-admin-operations.md`, `agents.md`, `infra/vps/README.md`: request/approve/audit rules and activation.

## Tests (extend `ws-tests/infra-vps-workflow.guard.test.mjs`, run by Infra VPS)

- helper: unknown operation and bad run id are refused and audited without any systemctl call; pause waits until
  idle and stops at the bound; resume refuses a pending `daemon-reload`; a busy lock blocks; a stale lock is taken
  over;
- consistency: workflow choice list = `OPERATIONS` = sudoers aliases; no shell in the helper;
- workflow: identity expression for every actor pair, `main` only, `environment: vps-admin`, secrets only in the
  SSH step, no `always()`.

## Risks

- **Agent can approve its own request** while it still holds the owner token: the activation order requires
  T004-3 (owner token removed from `copilot`) and the release agent App before any agent request.
- **Catalog growth into a shell**: each new operation is a reviewed PR with fixed argv; the guard test keeps the
  three lists identical.
- **Stuck lock**: only a lock of a dead process is taken over; `/run` is cleared on reboot.
