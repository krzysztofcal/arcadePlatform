# Netlify Preview retention — specification

Status: implementation for Draft review / no activation. Issue #1164, linked to #1159. Separate scope after Production AND Stage signing rotation PASS. GitHub issue: **#1164 [CI/CD] Safe 7-day Netlify Preview retention with protected deployment pins**, created under OWNER GO; related #1159. #1159's generic artifact-retention requirement is related but does not specify this destructive Preview policy; #1157 covers user-data retention, not deployments.

## User scenarios and fundamental acceptance

1. P1 — OWNER can inspect a complete value-free candidate list before destructive work. A closed/merged PR's unpinned Preview becomes eligible only after seven days from closure and creation. Missing PR/closure/date information protects the deployment.
2. P1 — Production, rollback evidence, active Stage and APK-dependent deployments survive regardless of age/PR state. Explicit pins override retention; unknown pin/provider state blocks execution. Closing a PR does not retire its APK dependency.
3. P2 — An open PR retains the latest successful Preview alias even if its current HEAD failed to deploy. An older unneeded version becomes eligible seven days after replacement by a newer successful version (not immediately because its creation date is old).
4. P2 — After separately approved activation, one daily trusted workflow removes only freshly revalidated candidates. Oldest versions first; latest alias owner last, never falling back to an older retained deployment. Errors stop the batch; no destructive retry.

## Requirements and boundaries

- Scope only ready `deploy-preview` context on playkcswh, site f7e19a84-28f7-41f7-978a-f3b4552a404d. All Production versions/current publication, branch deploys, unknown contexts, nonready deployments and provider locks are excluded. Landing is out of scope.
- Seven days means168h UTC; exact boundary qualifies. Conservative rule: closed eligibility=max(created,closedAt)+7d; open superseded eligibility=max(created,nextSuccessfulCreated)+7d. Reopened PR uses OPEN rules, not stale closedAt.
- Pins are a small reviewed JSON list of deployment IDs or temporary PR-wide holds with reasons; no automatic expiry. Temporary holds #1095/#1141/#1155/#1160/#1161/#1162/#1163 preserve APK, Stage, rotations, #1159 evidence/rollback until OWNER explicitly narrows them. #1160 has no independent deploy in the snapshot; retain its rule for future safety.
- Protect latest ready alias owner if deleting it would fall back to any retained older ready version. For fully deletable closed groups, delete oldest first and verify older versions gone before touching latest. A DELETE failure/uncertainty, PR reopening, new deploy, changed alias/pin or wrong site/context => STOP.
- DELETE is permanent: old links, Functions, logs and build artifacts disappear. Rebuilding a source is not restoration of its original deployment ID/permalink. Export only necessary value-free audit evidence before removal; required artifacts remain pinned.
- Production/Stage rotations and OWNER acceptance are mandatory prerequisites; retention does not substitute for key revocation. 1676 mint candidates are not1676 proven vulnerabilities. No mass emergency deletion in this task.
- Current work includes the shared classifier, thin API adapter and manual-only trusted-main workflow. Dry-run is default; no schedule. A future canary of at most5 explicit IDs requires all independent authorization/rotation/dependency gates. No actual DELETE, retention setting, secret configuration, environment mutation or app/financial change is authorized.

## Success criteria

Every candidate has ID, PR, reason and eligibility time; every exclusion has a reason. Zero protected/current Production IDs qualify. Unknown state denies destructive execution. Actual operations remain zero until both rotations PASS and separate OWNER GO. Daily cleanup, once approved, has zero Production publication/WS/DB side effects; older public Preview links intentionally cease to work.

## Implementation acceptance

Canary requires both OWNER actor identities (original/rerun), main definition/source, versioned disabled-by-default gate/evidence fields, a separate repository enable variable, exact manifest digest/sourceSHA/ID approval and15-minute confirmation freshness. Every DELETE is preceded by fresh locks/publication/PR/alias/main/APK checks and audit; no automatic retry after uncertainty. Newly started, updated or rerun Android builds after manifest APK review block canary. Code/CI preparation and manual dry-run do not require completed rotations.
