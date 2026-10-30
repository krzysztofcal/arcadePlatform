# PR4 — WS Production deploy only by explicit exact-SHA dispatch (T002)

Base main `cc52d0f6ed`; independent of PR3. Files: `.github/workflows/ws-server-deploy.yml`, `ws-tests/ws-server-deploy.workflow.guard.test.mjs`, one `agents.md` rule. `scripts/ci-impact.mjs::classifyCiImpact` unchanged: `deploy_ws` keeps selecting validation and now only reports a pending release on push.

## Previous behavior (main cc52d0f6)

- `push` to main with `deploy_ws=true` ran `deploy` automatically after `validate` (VPS lock, artifact, SCP, release switch, restart, health, rollback).
- `workflow_dispatch` had no inputs and no ref/actor check: a dispatch from **any branch** deployed that branch's `github.sha` to Production.

## New behavior

- `pull_request` / `push main`: unchanged validation (same steps, required check names). Push never deploys; with `deploy_ws=true` it emits `WS Production was NOT deployed` (notice + summary).
- Deploy job condition (conjunction): `deploy_ws`, `workflow_dispatch`, `github.ref == refs/heads/main`, `github.actor` and `github.triggering_actor` = OWNER (same model as PR1 `db-stage-apply-pr.yml`; covers reruns).
- First deploy step, before any VPS access: `releaseSha` full lowercase SHA == `GITHUB_SHA` == checkout HEAD == current `origin/main` HEAD (stale rerun cannot roll back to an older commit); confirmation exactly `DEPLOY WS PRODUCTION <releaseSha>`. Inputs reach bash only via env.
- Unchanged: full `validate` on dispatch (`deploy_ws=true` for dispatch), packaging/V3 build context, shared maintenance flock, Production env preflight, release switch, health gates, runner WS smoke, V3-only rollback, `RELEASE_SHA=github.sha` metadata.

## Residual risk / not in scope

- Repository-level SSH secrets remain readable by any workflow a writer dispatches from a modified branch definition (pre-existing for all workflows). YAML cannot close this; activation step below (GitHub Environment) can. No settings changed in PR4.
- Active-human/reconnect/escrow/ledger restart checks are still the existing operator procedure (`docs/poker-deployment.md`); automating them is T004. The confirmation phrase is the operator's attestation.
- Netlify Production still auto-publishes `main` (T003). Until then a merge can update WWW without WS; release WS promptly by dispatch or keep the existing `[skip netlify]` procedure when protocol compatibility requires coordination.

## Breaking impact

Merges no longer refresh WS Production. Any commit with `deploy_ws=true` leaves Production WS on the previous release until an OWNER dispatch. Dispatch from branches, by non-OWNER, without inputs, with a non-HEAD SHA or wrong phrase deploys nothing. `[skip actions]` is no longer needed to prevent a WS deploy (still skips validation).

## Activation plan (separate OWNER GO)

1. Before merging PR4, do not merge other `deploy_ws=true` PRs without the existing hold procedure (old definition still auto-deploys).
2. Merge PR4 normally: the push runs the new definition (validation only, no deploy job). Verify run: `deploy` skipped, notice present.
3. Optional hardening (settings GO): GitHub Environment `ws-production` restricted to `main` with OWNER reviewer, move `WS_HOST/WS_USER/WS_SSH_KEY` there, add `environment: ws-production` to `deploy`.
4. First real release: operator preconditions, then dispatch from main with current HEAD SHA and phrase; verify health/smoke and `release-metadata.json`.
