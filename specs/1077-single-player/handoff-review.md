# Issue #1077 — VPS handoff and independent review, 2026-10-12

## Recovery evidence

- Target: `/home/copilot/work/arcadePlatform2` (case-sensitive actual path), branch `feat/1077-single-player-poker`.
- Initial target checkout: `fix/canonical-initial-bot-seeding`, `89667e36f44f65b168d282b072b07e77f377c02d`; clean tracked/untracked status. That branch remains intact and is the restoration point.
- AGY source: `/home/copilot/work/arcadePlatform-1077`, separate Git common directory `/home/copilot/work/arcadePlatform/.git`; clean source checkout on `feat/1077-single-player-poker`, `d29736dc`.
- All original commits imported without rewriting: `1d2c01e4`, `bc7c8c2f`, `7cc9897f`, `1a7cb45f`, `77aaf7ac`, `d29736dc`.
- Original AGY tip preserved locally as `backup/1077-agy-handoff-d29736dc`.
- AGY artifacts: `/home/copilot/.gemini/antigravity-cli/brain/2d9029ba-d5b4-4288-81fc-9ad9b52aa614/1077-single-player-poker.patch` and `.diff`. Both SHA-256 `2f701f51a4a33be9f3521368210479a99a5e829703fd4012d63f69a2e260cbeb`. Commits were used as the complete source; patches were not reapplied over them.
- Current GitHub main verified read-only at `8f691d6562d95d3357025f729474eab77d1ecc54`, integrated locally in merge commit `48577f5c78792fc8c309a709d89bbcf0fbc0fac9`. Only new main work after AGY's baseline is #1090 Welcome bonus claim; it merged without conflicts and existing tests pass.

## Review outcome

The four requested findings were already partly fixed in AGY's final commit. They were retained and checked, then independently reviewed across New Game → Quick Seat → authoritative JOIN → funding → gameplay → Resume → cleanup.

- **P1 Resume:** progression lists only the authenticated owner's OPEN Single Player ACTIVE seats. The visible dropdown sends the selected table ID; selection now survives re-render and ordering has an ID tie-breaker. Rejoin uses authoritative JOIN with no second debit.
- **P1 CLOSED request replay:** query includes CLOSED tables and returns `409 table_closed` without creation. Replay now precedes current tier eligibility, so changed bankroll cannot hide the closed result. Changing buy-in for the same intent still fails explicitly. Physical purge limitation below remains unresolved.
- **P2 bot funding message:** V2 `joinErrorMessage()` handles `single_player_bot_funding_unavailable`. Fresh paid admission requires funded bots, with full transaction rollback on insufficient opponents.
- **P2 locked access:** early owner RESTRICTED check uses the existing `lock: true` snapshot. Independent review found an admin-account/table lock inversion; admin mutation now obtains the same existing per-user slot advisory lock as JOIN before row locks.
- **Additional P1:** high-bankroll players previously lost every <=1000 CH tier when Online's highest-two window advanced. Single Player now derives its own enabled/unlocked tiers through the shared progression implementation, reused in API, table access, JOIN and lobby; Online selection is unchanged.
- **Additional P2:** Single Player minimum is at least two bots, clamped by capacity, while preserving the existing maximum and pool funding rules. Extended existing successful NORMAL/SLOW tests with high bankroll/minimum-one configuration; strengthened partial funding rollback coverage for user, pool, escrow and committed ledger effects.
- No new engine, bot faucet, scheduler, UI test suite or dependencies. Browser JS remains IIFE/global-compatible; changed CSS uses one physical line per selector. No added inline script; existing CSP hashes still validate.

## Cleanup and economic limits

Existing `table-janitor.mjs` classifies OPEN tables without active humans as `open_inert_table` after the configured creation grace (default 60 seconds), including tables never materialized in memory. Its existing persisted-table scan and inactive-cleanup adapter invoke terminal closure. Failed bot admission leaves no human seat/debit or partial funded bot after transaction rollback. Existing terminal close handles empty escrow/seat/state teardown; no new janitor is needed.

Successful human admission/rejoin marks `has_human_participant=true`; Single Player remains STANDARD and uses the existing human retention lifecycle. NORMAL/SLOW pools, SLOW-only marking, 4 active/4 pending caps, WS autoplay/gameplay and reconnect retain their existing mechanisms. Authoritative owner/no-other-human guards precede economic effects. Online candidate selection and WS public lobby exclude Single Player; non-authoritative/observe-only Single Player admission fails closed.

## Verification evidence

- Existing `npm test`: **exit 0**, **146 registered check/test groups passed**. Mocked Stage/retention scenarios in that runner performed no shared Stage operation; this is local evidence only.
- Focused domain/endpoint/bootstrap/handlers/table-manager/access-propagation/janitor/inactive-cleanup/closed-cleanup run: **293 passed, 0 failed**; an additional high-bankroll endpoint case added afterward passes in the endpoint re-run (**8 passed**, including Quick Seat script).
- Syntax: **226 files passed**. CSP: **55 served documents passed**. Whitespace diff check passed.
- Isolated local PGlite migration verification: existing STANDARD/CONTINUOUS_BOT rows default false, null-owner and CONTINUOUS_BOT Single Player inserts rejected, owner STANDARD insert accepted, repeat application accepted. No shared DB connection.
- **Failing check:** `scripts/check-db-migrations.mjs` rejects the local feature with `Production migration manifest is not exhaustive for supabase/migrations`. The same script passes on an isolated export of current main: **109 migrations / 7 Production replacements**. The feature adds a 110th migration absent from that reviewed manifest. This is an introduced release blocker, not a baseline failure.
- Independent reviewer confirmed the final lock serialization and found no further concrete important defects beyond the post-purge request identity decision.

## Open gates and breaking impacts

1. **Permanent idempotency after purge is not implemented.** `poker_requests.table_id` cascades on physical deletion of its table. Existing CLOSED-table retention defaults to seven days and canonical human/bot retention completion adds further gating. CLOSED rows reject repeats while retained; a purged intent has no remaining record. No ledger archive can recover an unfunded New Game request. Owner decision was requested: durable independent identity requires an additional schema contract; bounding deduplication to existing retention would weaken the permanent guarantee. No silent architecture expansion or disabling physical cleanup was made.
2. **Migration release guard must be resolved before Stage apply.** The approved local flag migration is SQL-valid, but the current exhaustive Production manifest/guard does not accept it. No Production replacement or manifest change was made outside the approved scope.
3. **Schema-first rollout is mandatory.** Shared table creation, progression and authoritative JOIN reference `is_single_player`; deploying application code to an unmigrated DB causes SQL errors, including ordinary Poker Online callers. New progression exposes `singlePlayerAvailableBuyIns`; deploy frontend and functions together.
4. **Runtime evidence is pending.** No funded Stage smoke, exact-SHA WS deploy or Netlify Preview was performed. Local test doubles verify rollback orchestration; they are not a funded live database concurrency test.

## Migration → WS Preview → Netlify Preview plan (only after separate owner GO)

1. Close T018/T019, recheck current main, freeze a tested application SHA, and review the complete migration diff and Stage identity. Keep any automatic Netlify branch/PR publish held until schema and WS are ready. Publishing a migration-bearing PR is not a harmless review step: it can invoke DB Stage Apply PR.
2. After explicit publication and Stage-write authorization, make the exact reviewed revision available remotely without creating a migration-bearing PR. Use **DB Stage Prepare** from the trusted main workflow definition with the frozen revision as its `ref` input, or an explicitly approved targeted migration process. Before dispatch, inspect unapplied migrations so the workflow does not apply unrelated work. Confirm selected SHA, canonical Stage project, successful schema/constraint installation, existing rows false and no Production target.
3. After explicit WS deployment GO, dispatch **WS Preview Deploy** using workflow definition `main` and application input `ref=<frozen-runtime-SHA>`. Verify the run selected that exact SHA, succeeded, and Preview health/release evidence matches it. Confirm authoritative JOIN and persisted bootstrap are enabled; Netlify CI does not deploy WS.
4. After explicit Netlify Preview GO, atomically publish browser assets and functions from that reviewed revision against Stage/WS Preview. Confirm Preview environment uses Stage credentials and the intended WS Preview endpoint; do not connect this preview to Production.
5. Perform funded authenticated Preview smoke: New Game with 100/500/1000 where eligible, at least required funded bots, playable hand/autoplay; same-intent retries and CLOSED replay; owner Resume with several tables/no extra debit; foreign/direct WS and RESTRICTED rejection with zero economic effect; partial pool exhaustion rollback; existing empty-table cleanup and human retention; Poker Online isolation; portrait/landscape presentation and CSP.
6. Record exact schema/runtime/browser revisions and smoke outcome. Failures block further rollout. Leave additive schema in place on rollback; once Single Player tables exist, roll back only to a compatible revision that preserves authoritative isolation. Production and merge remain separate owner decisions.

All implementation changes remain local in arcadePlatform2. Nothing was pushed, no PR was opened, no Stage write or deployment was executed, and no GitHub PR was merged.
