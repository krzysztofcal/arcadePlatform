# Root on demand — owner-approved VPS admin operations (#1159)

## Problem

VPS work that needs root (pausing the ledger dispatchers, `daemon-reload`, the T004-3 cutover and rollback) is
done today by the owner pasting root commands that the agent prepares. The agent has no root, which is correct, but
every such operation costs an interactive owner session and relies on hand-checked one-line commands.

## Goal

The agent requests one specific, reviewed admin operation; the owner approves it in GitHub Actions; the operation
runs on the VPS under a separate executor identity with minimal sudo. The agent never receives standing root, a
root shell or a credential that reaches the executor.

This builds on T004 (#1171): same identity pairs, same environment approval pattern, same separate-account and
root-helper approach as `ws-production` / `arcade-release` / `arcade-ws-restart-gate`. It does not change T004.

## Requirements

- **R-CATALOG.** Only operations from a fixed catalog in code. No shell, no free command, path, unit or package
  input. The only argument is the numeric run id. Adding an operation is a reviewed PR.
- **R-IDENTITY.** The workflow runs only for `workflow_dispatch` on `refs/heads/main` with a matching pair of
  `github.actor`/`github.triggering_actor`: owner/owner or `vars.WS_RELEASE_AGENT`/`vars.WS_RELEASE_AGENT`.
- **R-APPROVE.** The job uses the `vps-admin` environment (owner required reviewer, prevent self-review, `main`
  only, no admin bypass). Its secrets are the only path to the executor account, so nothing reaches the VPS before
  the owner approves. A re-run needs a new approval.
- **R-EXECUTOR.** A separate VPS account `arcade-admin`, never in a group with `copilot`. Its sudoers file lists
  only the helper with each catalog operation. `copilot` cannot run the helper.
- **R-AUDIT.** The GitHub run records operation, requester, triggering actor and reason; the environment records
  the approver. The helper writes journal entries (tag `arcade-vps-admin`) before and after every request,
  including refused ones.
- **R-SAFE.** Requests are serialized (workflow concurrency group and helper lock). Every outcome is one line
  `ADMIN_OK|ADMIN_BLOCKED|ADMIN_FAILED`; only `ADMIN_OK` passes the job. No automatic retry. Long waits are bounded.
- **R-TESTS.** Fundamental tests only, in existing test files.

## Initial catalog

`ledger-dispatchers-status` (read-only), `ledger-dispatchers-pause`, `ledger-dispatchers-resume`,
`systemd-daemon-reload` — the operations the T004-3 cutover and its rollback needed.

## Out of scope

Installing files, packages or tokens through the catalog; WS Production restarts (owned by the T004 release
flow); any change to existing sudoers rules; VPS, secret, environment or GitHub settings changes in this PR.

## Breaking impact

None for existing workflows, accounts or sudoers. New: an environment, an account, a sudoers file and a helper,
all inactive until the owner activation steps in `docs/vps-admin-operations.md`.
