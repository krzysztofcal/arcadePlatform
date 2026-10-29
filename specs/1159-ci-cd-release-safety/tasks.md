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
