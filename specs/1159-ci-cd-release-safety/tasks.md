# #1159 — PR1 implementation tasks and retained PR3 requirement

Scoped record for the independent main-based PR1; approved full design is maintained in #1159 / reviewed SpecKit. Mechanism inventory does not complete the performance baseline: timing/manual-intervention measurements remain OPEN.

- [x] PR1: dispatch-only trusted-main executor; PR provides approved SQL blobs only, no executable PR tooling.
- [x] Exact source/project/system, history fingerprint/count, pending file/hash set and canonical operator confirmation; reject changed/fork source.
- [x] Read-only inspect without CREATE/backfill; atomic operational batch/version/hash receipts, locks/timeouts, original-approval replay/no-op and preserved CH smoke.
- [x] Remove password URL/SQL from process argv; suppress private error/NOTICE output; retire unsafe alternate DB Stage Prepare executor.
- [x] Existing fundamental guards extended; isolated PostgreSQL17 integration (including real lock conflict/late rollback) and actionlint/local validation PASS.
- [ ] Draft PR hosted checks and native Netlify Preview exactSHA acceptance; no cloud SQL dispatch.
- [ ] Real main-definition Stage inspect/apply (separate OWNER GO; never part of Draft validation).
- [ ] PR3 retained OWNER requirement: pending Netlify Preview must not routinely require manually retrying an APK build. Prefer one bounded read-only prerequisite wait for the same PR/sourceSHA/config before Gradle (e.g. up to10min/20s interval), recheck latest approved head and stop obsolete source. This polls deploy readiness, not repeated compilation/deploy. If genuinely timed out/failed/wrong-context, report NOT BUILT/failure honestly; no unbounded loop, new service or extra trigger framework. Test the pending→ready race fundamentally during PR3; do not implement it here.

No environment settings, Stage/Production apply, Ready, merge, app deploy, Terms activation or Play publication in PR1. Existing manual release/WWW+WS cutover remain later coordinated scopes.

## PR2 — native stacked Preview

- [x] Local shared Stage identity, fail-closed Redis selection, build credential validation and exact localhost CORS policy.
- [x] Native parent Stage WS routing/noindex and build receipt; package shared dependency in WS Docker image.
- [x] Fundamental local regression tests; readonly platform configuration gaps and secret isolation blockers documented.
- [x] Available historical timing/manual-operation evidence collected; T001 baseline remains partial, not DONE.
- [x] Draft PR #1163 required actionlint and Netlify Preview PASS at 24f0766a3ade7f64008557c7dc3d68373a4a7ec5; no native child acceptance implied.
- [ ] Separate OWNER GO for compatible parent/child code propagation, isolated branch credentials and exact parent enrollment; no settings changed here.
- [ ] Native #1155 → #1160 exact-SHA Netlify status, Stage identity and real CORS acceptance after configuration GO (T014 OPEN).

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
- [ ] OWNER GO: squash merge with `[skip netlify]` (no `[skip actions]`) and observed post-merge acceptance.
- [ ] OPEN: `ws-production` Environment; T004 automatic human/resume/escrow preflight. Current dispatch is not a complete safe release process.

## PR5 — WWW Production publication separated from merge (T003)

- [x] Read-only Netlify audit; official lock, `ignore` and build-hook behavior; design, coverage table, limitations and breaking impact in `pr5-www-production-publish.md`.
- [x] Unpublished Production permalinks can mutate Production: `ignore` skips `main` Git builds (Previews/branch deploys kept); candidates only from an OWNER build hook.
- [x] OWNER-run `scripts/www-production-release.mjs`: dry-run default; lock, exact main HEAD, ready Production deploy, build-info identity, function names, root CSP/HSTS; WS release proven from GitHub deploy evidence; relock-or-uncertain; receipt on every outcome; rollback mode removed until T004. Fundamental tests registered.
- [x] WS evidence: read-only VPS `current`/metadata/service start must agree with GitHub deploy history; unfinished/queued WS runs block; both rechecked before restore. Mandatory candidate discard with API+permalink 404 proof, else STOP.
- [x] WS compatibility surface derived from the WS Server Deploy package step (incl. packaged `netlify/functions/_shared` modules and the deploy-context generator); fail closed if unparseable.
- [x] OWNER GO 1 (2026-10-30): #1168 merge published `6ae52b31a745a6e69b60b668` (`83c8da88`, backlog included, accepted by OWNER); auto publishing then locked on it via API; verified `locked=true`, id unchanged, `stop_builds=false`. PR4 push acceptance on `83c8da88`: validate SUCCESS, notice present, deploy SKIPPED.
- [ ] OWNER GO 2: merge; observe skipped main Production build, unchanged published deploy, working PR Preview.
- [ ] OWNER GO 3/4: OWNER-only build hook; first release with WS compatibility decision, recorded receipt and restore/lock behavior.
- [ ] OPEN: historical permalink exposure / visitor protection; WS `/healthz` release SHA; redirects and function digest coverage.
