# Approval UX — readable owner approvals (#1159)

## Problem

Only two environments have required reviewers: `vps-admin` (VPS Admin Operation) and `ws-production` (WS Server
Deploy), both owner-only with prevent self-review and `main` only. The `Review deployments` dialog shows only the
environment, so the owner could not see what an approval does. WS Server Deploy showed nothing before approval: its
SHA and phrase checks ran only after it.

## Change

- `vps-admin-operation.yml`: run name `VPS Admin: <operation> (requested by <actor>)`, job names
  `1. Review request: <operation>` and `2. Run on the VPS after approval: <operation>`. The unprivileged `request`
  job checks out its own `main` revision and renders the summary from `infra/vps/vps-admin-approval.mjs`: one
  reviewed description per helper operation (changes, risk and downtime, side effects, way back, read-only flag),
  never from the free-text reason. A catalog operation without exactly one description fails the job.
- `ws-server-deploy.yml`: run name `WS Production release <sha> (requested by <actor>)` for dispatches only. A new
  unprivileged job `request` (`contents: read`, `actions: read`, no environment, no secret) runs exactly when
  `deploy` would, repeats the authorize checks (so a refused run stops before the approval) and renders
  `scripts/ws-release-approval.mjs`: target, exact SHA, requester, last confirmed deploy, scope (commits and WS
  input files changed: packaged files and the deploy workflow; the artifact itself is rebuilt, not compared), risk
  and downtime, side effects, way back. `deploy` needs it and keeps its name, its
  environment and its own authorize step after the approval.
- Honesty limits: the last confirmed deploy is GitHub evidence (`latestWsDeploy`: newest deploy job on `main`
  succeeded, nothing unfinished), not a read of the VPS; with any unfinished run or unreadable history it is shown as
  unknown. Every deploy-job check after the approval is listed under `NOT RUN YET`; nothing is reported as passed
  that has not run. Commit subjects and paths are shown only inside closed code spans, so no Markdown link or image renders.

## Where to read it before approving

Run page → `Summary` tab: the run title, the notice annotation at the top and, below the job graph, the section
`Approve only if expected: …`. Then `Review deployments` → environment → `Approve and deploy` or `Reject`.
Details: `docs/vps-admin-operations.md` (Before you approve).

## Tests (fundamental, existing files)

- `ws-tests/infra-vps-workflow.guard.test.mjs`: description catalog equals the helper catalog, invalid or missing
  descriptions fail, rendering refuses unvalidated inputs and never claims a result; workflow names and order.
- `ws-tests/ws-server-deploy.workflow.guard.test.mjs`: `request` has the deploy condition, read-only permissions, no
  environment, secret or SSH; `deploy` needs it and keeps environment, authorize step and its unnamed job.
- `tests/www-production-release.test.mjs`: request checks, last confirmed deploy without the current run, scope on a
  real temporary git repository, unknown states, inert subjects, no unrun check shown as passed.
- Existing guard tests now pin `deploy.needs: [impact, validate, request]` and slice `validate` up to `request`.

## Breaking impact

- A WS Production dispatch now also needs the GitHub API (`commits/main`) in the `request` job; if it is
  unavailable the run stops before the approval instead of after it (fail closed). Pull request and push runs of
  WS Server Deploy show one more skipped job.
- Job display names of VPS Admin Operation changed; anything that looked up the jobs `request`/`operate` by display
  name must use the new names (nothing in the repository does). `deploy` keeps its name for Release Record.
- The root helper `infra/vps/vps-admin.mjs` is unchanged: no reinstall on the VPS.

## Owner actions

- The two workflow files need an owner push (the agent App has no Workflows permission), as for #1207.
- Acceptance after merge, each run a separate GO: one `ledger-dispatchers-status` request (read-only) and, when a
  WS release is due anyway, its dispatch; check the summaries before approving. No settings change.
