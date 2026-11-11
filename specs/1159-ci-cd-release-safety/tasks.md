# #1159 — PR1 implementation tasks and retained PR3 requirement

Scoped record for the independent main-based PR1; approved full design is maintained in #1159 / reviewed SpecKit. Mechanism inventory does not complete the performance baseline; after-state measurements from existing runs: `final-measurements.md` (2026-11-06). Checkboxes below were re-checked against `main` and run history on 2026-11-06.

- [x] PR1: dispatch-only trusted-main executor; PR provides approved SQL blobs only, no executable PR tooling.
- [x] Exact source/project/system, history fingerprint/count, pending file/hash set and canonical operator confirmation; reject changed/fork source.
- [x] Read-only inspect without CREATE/backfill; atomic operational batch/version/hash receipts, locks/timeouts, original-approval replay/no-op and preserved CH smoke.
- [x] Remove password URL/SQL from process argv; suppress private error/NOTICE output; retire unsafe alternate DB Stage Prepare executor.
- [x] Existing fundamental guards extended; isolated PostgreSQL17 integration (including real lock conflict/late rollback) and actionlint/local validation PASS.
- [x] Superseded: PR1 is on `main` (`db-stage-apply-pr.yml` dispatch-only); the Draft-stage acceptance record was not kept, the real dispatches below are the evidence.
- [x] Real main-definition Stage inspect (read-only): runs 42109960749, 42111502460, 42114784436, 42116598479 (2026-11-05, #1157), step `Read-only Stage inspect` success.
- [x] Real main-definition Stage apply, dispatched by the owner (the workflow admits `apply` only for owner/owner): run 42116230654 success; an earlier attempt 42110915806 failed in `Apply exact approved set atomically` (#1157 follow-up fixes #1202/#1203).
- [x] (Done in PR3 #1166; automatic run 42234126142 waited 25s for the matching Preview, no manual retry.) PR3 retained OWNER requirement: pending Netlify Preview must not routinely require manually retrying an APK build. Prefer one bounded read-only prerequisite wait for the same PR/sourceSHA/config before Gradle (e.g. up to10min/20s interval), recheck latest approved head and stop obsolete source. This polls deploy readiness, not repeated compilation/deploy. If genuinely timed out/failed/wrong-context, report NOT BUILT/failure honestly; no unbounded loop, new service or extra trigger framework. Test the pending→ready race fundamentally during PR3; do not implement it here.

No environment settings, Stage/Production apply, Ready, merge, app deploy, Terms activation or Play publication in PR1. Existing manual release/WWW+WS cutover remain later coordinated scopes.

## PR2 — native stacked Preview

- [x] Local shared Stage identity, fail-closed Redis selection, build credential validation and exact localhost CORS policy.
- [x] Native parent Stage WS routing/noindex and build receipt; package shared dependency in WS Docker image.
- [x] Fundamental local regression tests; readonly platform configuration gaps and secret isolation blockers documented.
- [x] Available historical timing/manual-operation evidence collected; T001 baseline remains partial, not DONE.
- [x] Draft PR #1163 required actionlint and Netlify Preview PASS at 24f0766a3ade7f64008557c7dc3d68373a4a7ec5; no native child acceptance implied.
- [ ] Separate OWNER GO for compatible parent/child code propagation, isolated branch credentials and exact parent enrollment: no evidence collected on 2026-11-06 (a working child Preview does not prove these).
- [x] Native #1155 → #1160 exact-SHA Netlify status: success on the child head `419f1185`; `build-info.js` names `PR #1160`, that commit and its own deploy id (`final-measurements.md`).
- [ ] Stage identity of the #1160 Preview (its `build-info.js` does not show it; not verified on 2026-11-06).
- [ ] Real Android CORS acceptance against the #1160 Preview (not re-verified on 2026-11-06).

See `pr2-native-stacked-preview.md` for precise methods, configuration gates and breaking impact; `pr2-measurements.md` for partial baseline evidence. Future main merge can trigger WS deploy classification; no independent automatic-WS cutover is authorized.

### PR2 no-deal-key activation continuation

- [x] Explicit empty deal-key D/P overrides and no exact-child shadow; Production/context metadata preserved.
- [x] Stage Netlify build rejects nonempty deal key; existing generator/snapshot/replay boundary regressions PASS (20 tests).
- [x] Independent Stage XP/CHIPS and approved parent Supabase/DB/JWT/WS public configuration; unused sweep disabled only Stage.
- [ ] Administrator executes already authorized protected C/Redis exact-parent copy using existing root custody; no copilot privilege expansion.
- [ ] Native parent then child exact-SHA READY and nonfinancial acceptance, with mandatory exact-SHA WS Preview runtime gate still outstanding.
- [ ] Separate technical debt: historical snapshot/replay derivation after a future deal-key change lacks key provenance; preserve materialized cards and refuse unsupported reconstruction. Do not implement dual-key or rotate in PR2.

## PR3 implementation (current)

- [x] Own-PR/source binding, bounded pending→ready prerequisite, stale/foreign/failed/timeout fail-closed, explicit dispatch inputs, no CI static-origin fallback.
- [x] Conservative synchronize classification skips known docs/test-only compilation without changing other CI/Preview checks; enrich existing receipt and verify packaged CSP/SRI.
- [x] Local fundamental tests, actionlint, syntax and guards; read-only stacked #1160 validation binds child source/deploy rather than parent.
- [x] Hosted own-PR READY → automatic APK run40975904744, embedded receipt/checksum/debug signature PASS, 22.779s wait. All hosted checks PASS at a1ed1ace. Physical installation NOT TESTED. Documentation-only synchronize acceptance recorded in PR #1166 without relabelling the existing artifact.

## PR4 — WS Production explicit dispatch (T002)

- [x] Push/merge validates only; deploy requires OWNER main dispatch with exact current-main `releaseSha` and confirmation; existing safety/rollback unchanged. See `pr4-ws-production-dispatch.md`.
- [x] Hosted CI on Draft PR, including the workflow guard in `validate`.
- [x] Merged as #1167 (`f8d5a3d2`, `[skip netlify]`); post-merge acceptance on `83c8da88` recorded under PR5 OWNER GO 1.
- [x] `ws-production` environment (owner required reviewer, prevent self-review, `main` only), restart gate with hold/drain and presence/financial preflight (#1172, #1176), separate release account (#1177); first gated release run 41606535297 (`d49ce068`, 2026-11-03).

## PR5 — WWW Production publication separated from merge (T003)

- [x] Read-only Netlify audit; official lock, `ignore` and build-hook behavior; design, coverage table, limitations and breaking impact in `pr5-www-production-publish.md`.
- [x] Unpublished Production permalinks can mutate Production: `ignore` skips `main` Git builds (Previews/branch deploys kept); candidates only from an OWNER build hook.
- [x] OWNER-run `scripts/www-production-release.mjs`: dry-run default; lock, exact main HEAD, ready Production deploy, build-info identity, function names, root CSP/HSTS; WS release proven from GitHub deploy evidence; relock-or-uncertain; receipt on every outcome; rollback mode removed until T004. Fundamental tests registered.
- [x] WS evidence: read-only VPS `current`/metadata/service start must agree with GitHub deploy history; unfinished/queued WS runs block; both rechecked before restore. Mandatory candidate discard with API+permalink 404 proof, else STOP.
- [x] WS compatibility surface derived from the WS Server Deploy package step (incl. packaged `netlify/functions/_shared` modules and the deploy-context generator); fail closed if unparseable.
- [x] OWNER GO 1 (2026-10-30): #1168 merge published `6ae52b31a745a6e69b60b668` (`83c8da88`, backlog included, accepted by OWNER); auto publishing then locked on it via API; verified `locked=true`, id unchanged, `stop_builds=false`. PR4 push acceptance on `83c8da88`: validate SUCCESS, notice present, deploy SKIPPED.
- [x] OWNER GO 2 (2026-10-31): #1169 merged as `3fe60fc5` without a Netlify marker. The main Git Production build was skipped by `ignore`: deploy record `6ae5a688d0733085c009316b` (`production`, `state=error`, "Canceled build due to no content change", no files or functions, never published; permalink answers 500). Published deploy still `6ae52b31a745a6e69b60b668`, `locked=true`, `stop_builds=false`, no build hooks. Push workflows all success; WS Server Deploy validate SUCCESS, deploy SKIPPED (`deploy_ws=false`, so no notice). PR Preview built with this `ignore` on `d14c1b91`; no PR Preview after the merge yet.
- [ ] OWNER GO 3/4: OWNER-only build hook; first release with WS compatibility decision, recorded receipt and restore/lock behavior.
- [ ] OPEN: historical permalink exposure / visitor protection; WS `/healthz` release SHA; redirects and function digest coverage.

## T004 activation, Approval UX and open items (2026-11-06)

- [x] `arcade-code-agent` installation token: Actions write, scoped to this repository; `vars.WS_RELEASE_AGENT=arcade-code-agent[bot]`.
- [x] VPS Admin with the App as requester and the owner as approver: runs 42223180928 (`ledger-dispatchers-status`), 42225018370 (`ledger-production-dispatcher-install`, `sha256=24ac4554…50bf81`), 42226390939 (`ledger-dispatchers-resume`, `timers_active`); `current_user_can_approve=false` for the App on `vps-admin`.
- [ ] Approval UX (`approval-ux.md`, Draft #1209): owner push of the two workflow files, merge, then one read-only acceptance request.
- [ ] WS Preview follow-up: simplify provisioning to full preflight then fixed Preview stop/empty-cgroup proof; remove standalone safe-stop/receipt/presence fields; scope existing workflow to dedicated ws-preview credentials. See `ws-preview-access-implementation.md`; installation, provisioning, deploy and DRAIN release remain separate OWNER GO.
- [ ] Release Record of WS: the only record (`release-20261104-3`) holds WWW `83c8da88`; WS `d49ce068` cannot be recorded because its run predates the release receipt (#1182). The next owner-approved WS release yields a recordable receipt; its packaged WS surface is unchanged since `d49ce068` (`wsSurfaceChanged` false on 2026-11-06), so none is due now.
- [ ] Superseded Draft #1171 (T004 SpecKit, says T004-2 Draft): close or update; owner decision.

