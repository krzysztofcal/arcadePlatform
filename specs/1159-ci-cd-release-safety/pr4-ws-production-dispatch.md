# PR4 — WS Production deploy only by explicit exact-SHA dispatch (T002)

Base main `cc52d0f6ed`; independent of PR3. Files: `.github/workflows/ws-server-deploy.yml`, `ws-tests/ws-server-deploy.workflow.guard.test.mjs`, one `agents.md` rule. `scripts/ci-impact.mjs::classifyCiImpact` unchanged: `deploy_ws` keeps selecting validation and now only reports a pending release on push.

## Previous behavior (main cc52d0f6)

- `push` to main with `deploy_ws=true` ran `deploy` automatically after `validate` (VPS lock, artifact, SCP, release switch, restart, health, rollback).
- `workflow_dispatch` had no inputs and no ref/actor check: a dispatch from **any branch** deployed that branch's `github.sha` to Production.

## New behavior

- `pull_request` / `push main`: unchanged validation (same steps, required check names). Push never deploys; with `deploy_ws=true` it emits `WS Production was NOT deployed` (notice + summary).
- Deploy job condition (conjunction): `deploy_ws`, `workflow_dispatch`, `github.ref == refs/heads/main`, `github.actor` and `github.triggering_actor` = OWNER (same model as PR1 `db-stage-apply-pr.yml`; covers reruns).
- First deploy step, before any VPS access: `releaseSha` full lowercase SHA == `GITHUB_SHA` == checkout HEAD == current `origin/main` HEAD (stale rerun cannot roll back to an older commit); confirmation exactly `DEPLOY WS PRODUCTION <releaseSha>`. Inputs reach bash only via env.
- Second runner-side check directly before `Atomic release switch + restart + health gate on VPS` (after packaging and upload): current `origin/main` HEAD must still equal `GITHUB_SHA`, otherwise nothing is switched.
- Unchanged: full `validate` on dispatch (`deploy_ws=true` for dispatch), packaging/V3 build context, shared maintenance flock, Production env preflight, release switch, health gates, runner WS smoke, V3-only rollback, `RELEASE_SHA=github.sha` metadata.

## Exact-SHA limitation

`main` HEAD is checked at deploy start and again immediately before the release-switch step. A window remains after the second check: SSH connect and the remote wait for the shared maintenance flock (up to 300 s) before the switch/restart. A commit merged to `main` during that window does not stop the release; the deployed revision is still the explicitly approved `releaseSha` (an earlier main commit), recorded in `release-metadata.json`. Closing the window fully would need GitHub access from the VPS or new coordination infrastructure; intentionally not added. Operator rule: do not merge to `main` while a WS Production release is running.

## Residual risk / OPEN (not in scope)

- OPEN: GitHub Environment `ws-production` (main-only, OWNER reviewer, SSH secrets moved there). Until then repository-level SSH secrets remain readable by any workflow a writer dispatches from a modified branch definition (pre-existing for all workflows); YAML cannot close this. No settings changed in PR4.
- OPEN (T004): automatic active-human/reconnect/resume/escrow/ledger preflight before restart. Today this is the operator procedure in `docs/poker-deployment.md`; the confirmation phrase is only the operator's attestation.
- Therefore the current dispatch is an explicit, exact-SHA, OWNER-only gate, **not** a complete safe Production release process.
- Netlify Production still auto-publishes `main` (T003). Until then a merge can update WWW without WS; release WS promptly by dispatch or keep the existing `[skip netlify]` procedure when protocol compatibility requires coordination.
## Breaking impact

Merges no longer refresh WS Production. Any commit with `deploy_ws=true` leaves Production WS on the previous release until an OWNER dispatch. Dispatch from branches, by non-OWNER, without inputs, with a non-HEAD SHA or wrong phrase deploys nothing. `[skip actions]` is no longer needed to prevent a WS deploy (still skips validation).

## Merge and activation plan (each step separate OWNER GO)

1. Until PR4 is merged, do not merge other `deploy_ws=true` PRs without the existing hold procedure (the old main definition still auto-deploys).
2. Merge PR4 with **Squash and merge**; the resulting commit message must contain `[skip netlify]` and must **not** contain `[skip actions]`. Netlify Production still follows `main`, so an unmarked merge could publish previously held WWW changes; `[skip actions]` would hide the acceptance run below.
   GitHub pre-fills the squash body with all commit messages; one PR4 commit body quotes the actions skip marker, so edit the body to keep only `[skip netlify]`.
3. Post-merge acceptance, observed before declaring PASS:
   - `WS Server Deploy` push run on the squash SHA: `validate` SUCCESS, notice `WS Production was NOT deployed` present, `deploy` SKIPPED.
   - Netlify Production published deploy ID unchanged versus the ID recorded immediately before the merge.
   - WS Production `/opt/ws-server/current` release unchanged (read-only, if checked).
4. OPEN, separate settings GO: `ws-production` Environment as above, then add `environment: ws-production` to `deploy`.
5. First real release (separate GO): operator restart preconditions, dispatch from `main` with the current HEAD SHA and phrase, no merges to `main` during the run; verify health/smoke and `release-metadata.json`.
