# Tasks — root on demand (#1159)

Constitution check: fundamental tests only, in an existing test file; no new framework; no VPS, secret,
environment or GitHub settings change in the PR.

## PR (code, tests, docs)

- [x] R1 `infra/vps/vps-admin.mjs`: catalog, validation, lock, journal audit, one-line results.
- [x] R2 `infra/vps/arcade-admin.sudoers`: exact helper operations for `arcade-admin`.
- [x] R3 `infra/vps/stage-vps-admin.sh` and `infra/vps/bootstrap.sh`: account, helper, sudoers, verification.
- [x] R4 `.github/workflows/vps-admin-operation.yml`: identity, `vps-admin` environment, authorize, SSH step.
- [x] R5 `docs/vps-admin-operations.md`, `agents.md`, `infra/vps/README.md`.
- [x] R6 Fundamental tests in `ws-tests/infra-vps-workflow.guard.test.mjs`.

## Activation (owner, each a separate GO; see `docs/vps-admin-operations.md`)

- [ ] A1 Create and protect the `vps-admin` environment; agent verifies it read-only.
- [ ] A2 Merge the PR.
- [ ] A3 Run `infra/vps/stage-vps-admin.sh` as root from merged `main`.
- [ ] A4 New SSH key: `authorized_keys` of `arcade-admin`; `vps-admin` secrets.
- [ ] A5 First approved request: `ledger-dispatchers-status`.
- [ ] A6 Agent requests only after T004-3 is complete and the release agent App exists.
