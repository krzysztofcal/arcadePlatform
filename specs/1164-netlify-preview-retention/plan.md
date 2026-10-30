# Netlify Preview retention — minimal plan

## Existing mechanisms and issue

Use Node20 built-ins, GitHub Actions ubuntu-24.04, existing GitHub PR metadata and official Netlify API. No services, VPS worktree/dependency installs, artifact manager, UI or database. No dedicated issue found in title/body searches for Netlify retention/cleanup and Preview/deploy retention; OWNER-authorized issue **#1164 [CI/CD] Safe 7-day Netlify Preview retention with protected deployment pins** is created and linked to #1159.

Constitution: KISS; trusted-main destructive boundary; fail closed; Production/Stage separation; explicit OWNER permissions. Node CLI is separate from browser/JSP; no CSS, CSP, OAuth or Poker changes. Only15 fundamental policy/adapter tests, no E2E/framework/performance benchmark.

## Files

- `scripts/netlify-preview-retention-plan.mjs`: pure offline `planPreviewRetention()` + JSON CLI. No fetch, credentials, DELETE or apply switch. Reuse this policy function in the future executor.
- `tests/netlify-preview-retention.test.mjs`: date boundary, Production/pins/locks/branch exclusions, OPEN/current/HEAD mismatch, reopened/missing metadata, alias fallback, ordered candidates and input refusal.
- This directory: spec/plan/tasks, `protected-deployments.json`, full `dry-run.json` and concise `dry-run.md`.
- Implemented: `scripts/netlify-preview-retention.mjs` thin API adapter/executor and manual-only `.github/workflows/netlify-preview-retention.yml`, no schedule. No copying classifiers into YAML or a second retention engine.

## Evidence reused / current dry-run

Existing Netlify snapshot2064 records (complete21-page prior read), with1676 ready nonproduction mint deployments, reused locally. No repeat Netlify function probe/pagination. Added only current GitHub state/closedAt/HEAD for the368 referenced PRs. Exact asOf2026-10-29T12:48:46Z; estimate1557 candidate deployments across350 PRs,507 held/excluded. Details in dry-run files.

Provider lock fields/current alias targets were not preserved in the original compact snapshot and are NOT freshly rechecked here. Results are **CANDIDATE_ESTIMATE**, never an executable deletion authorization. New pins/locks/manual aliases/deployments or later time may change the count. Actual deletion eligibility now is ZERO: rotation gates and OWNER GO are not complete. Snapshot/PR-state source files remain local under /tmp; no secrets, cookies, tokens or account data are in the result.

## Future daily flow — no activation now

1. First obtain confirmed Production B/A-rejection PASS and Stage C/A-rejection PASS, plus reviewed final APK/Stage/rollback pins. Add links to accepted operational evidence. Explicit OWNER GO must authorize the cleanup scope, maximum batch and schedule; a local boolean is not evidence of approval.
2. Initially publish one small independent Draft PR for the planner/executor workflow after code review GO. Keep schedule absent and dry-run default. First manual destructive canary requires separately approved exact fresh IDs; only then enable daily schedule through an approved main change. Nothing is triggered by Draft→Ready or by ordinary PR CI.
3. Workflow definition/executor from trusted main only, fixed repo/site, no untrusted PR checkout. GitHub contents/pull-requests read permissions; no WS/DB/deployment commands. API credential is not automatically available because it exists on VPS: setting a GitHub secret requires separate GO. Prefer an existing approved least-access Netlify credential; if Personal token cannot be scoped to Preview DELETE, disclose Production-capable permissions and rely on reviewed main executor/immutable target checks, never claim credential-level isolation. Do not expose it to pull_request or fork jobs, argv or logs.
4. Every daily run refreshes deploy/PR/pin/publication/lock data read-only, computes the plan with the same function, emits value-free JSON evidence via existing Actions artifacts/summary. Capture exact script/pin revisions and selected IDs/reasons; use existing repository artifact-retention limits, no new storage system.
5. Proposed bounded quota100 DELETEs/run, oldest first per PR, concurrency1 and shared cleanup group (no cancel-in-progress). First manual canary<=5. These are proposed operational limits to approve with activation, not hidden authorization. Backlog may take multiple daily runs; don't promise every old object disappears immediately after day7.
6. Before EACH DELETE, GET the exact deployment and fresh PR/publication/pin/lock/alias state: same site/id/review/context/created/source, still eligible, not protected, no new latest or reopened PR. Missing/error/conflicting state stops the run. Before deleting latest in a closed group, verify all older unprotected ready versions are actually gone and no retained older version exists. Current OPEN aliases never deleted. Never rely on a stale multi-day JSON as authorization.
7. `DELETE /api/v1/deploys/{deploy_id}` only for that verified object; do not use site DELETE, restore/publish, bulk retention configuration or wildcard delete. API marks deployment for deletion: bounded read-only postflight must verify disappearance. No automatic repeat DELETE after timeout/429/error; reconcile read-only and stop, preserving latest alias where possible. Existing404 can be recorded as already absent, not an extra successful delete.
8. Persist before/after minimal audit results with no secrets/PII, and report irreversible removals plus held objects. If any reference may be needed for rollback, pin first and deny removal. A missing object cannot be undeleted; operational recovery may rebuild approved code into a NEW ID only after separate deployment GO, without claiming restoration of original evidence/link.

## GO / STOP

Current GO: prepare docs/classifier/tests/offline dry-run only. Future GO1: reviewed local code publication/CI (currently authorized); GO2 after BOTH rotations PASS: credential placement and exact manual canary; GO3: daily activation/limit/pin maintenance. They may be consolidated by OWNER when concrete artifacts and evidence are ready; this plan grants none implicitly.

STOP on missing rotation evidence/OWNER enablement, unknown dependency/pin, incomplete pagination, unavailable GitHub, date drift, metadata mismatch, provider lock, alias fallback, wrong site/context, token-scope uncertainty or DELETE uncertainty. Preserve Production, landing, Stage/WS/DB and APK; no secrets mutation or automatic rollback/deploy.

Breaking impact is intentional retirement of old Preview URLs/functions/logs/required-check links. Not a signing-key fix. Pins ensure current evidence and APK/Stage dependencies remain until explicitly retired.

Official API and deletion/alias behavior were already verified during #1159 signing review; reuse those findings: https://docs.netlify.com/deploy/manage-deploys/manage-deploys-overview/ and https://github.com/netlify/open-api/blob/master/swagger.yml . Personal custom deploy-retention settings are not assumed available; no provider setting change proposed.

## Implemented manual workflow / future canary handoff

- Workflow has only workflow_dispatch, checkout github.sha, fixed repository/main and OWNER actor+triggering_actor; no PR execution/secret exposure, schedule or dispatch performed here. Node20/built-in fetch, no npm installation needed for this job.
- New GitHub secret name `NETLIFY_PREVIEW_RETENTION_TOKEN` and repository variable `NETLIFY_PREVIEW_RETENTION_CANARY_ENABLED` are **not configured**. Without the secret a future live dry-run stops; this does not block local code/CI. No credential is read from VPS by the workflow.
- Versioned manifest schema1 includes disabled canaryDeletionAuthorized/automaticDeletionAuthorized, false rotation flags, null evidence and APK review time. Any enabling/pin/evidence change needs normal reviewed main publication plus OWNER GO; no standalone mutable remote pin file. Production IDs remain protected even if not pinned.
- Future manual canary approval JSON: `{sourceSha, pinsSha256, deployIds, approvedAt, apkDependenciesReviewed:true, changeWindowConfirmed:true}`. sourceSha must be actual trusted dispatch/main SHA, pins digest from `approvalDigest()` of the versioned parsed manifest, deployIds unique/max5, approval no older than15min. Confirmation is `DELETE PREVIEWS <siteId> <approvalDigest(approval)>`; no secret data. Digest is scope pinning, not independent authorization: OWNER identity and disabled gates are also required.
- After separate accepted Production/Stage rotation reports, OWNER reviews historical APK pins, fills evidence/review fields, authorizes credential setup and canary enablement. The tool fetches all Android workflow run metadata and denies if any run is pending/updated/started/created at or after that review (including reruns), until pins are reviewed again. No APK download or artifact-management system.
- Immediately before each DELETE: source/main remains exact, fresh complete inventory, stable Production publication, same PR state/closure/head, same deployment source/age/context/site and known unlocked state, actual review-alias build-info deployId/SHA. Old build-info absence/unknown data fails closed. Latest in a closed group can be deleted only after **all** older ready versions are gone; open current never deleted.
- Netlify DELETE has no documented atomic conditional-write/CAS: the supervised canary requires a no-concurrent-deployment/config window; workflow concurrency only serializes cleanup itself. Unexpected provider state stops, not a claim that all external writers are locked.
- Audit JSON is written before each attempt and uploaded with always(); timeout/deletion-not-confirmed records pending ID and stops without another DELETE. Irreversible operations are never described as transactionally rollbackable.
- Historical1557-ID dry-run is evidence only, intentionally **not shipped as an executable/persistent deletion list**. The implementation never reads it. Fresh plans come from Netlify/GitHub. No actual workflow dispatch/cleanup or secret setup in this PR.
- Standard existing CI includes both test files through scripts/test-all.mjs. This adds no Production/Stage apply trigger. CI impact includes broad validation due to a workflow file, but deploy_ws=false for this diff. Any eventual merge still needs separate safe Netlify publication controls; no merge authorized now.
