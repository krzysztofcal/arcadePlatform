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
