# Quickstart: validate NORMAL/SLOW per-tier pools with manual RESTRICTED

## Current gate

Implementation of the accepted Spec Kit is authorized from T001 onward. Live #1018 remains the requirements source; snapshot synced 2026-09-27, updated_at 2026-09-27T17:10:33Z, and the final amendment adds manual-only FORCE_RESTRICTED without a third automatic class. T001–T029 and their runtime evidence are historical; T030–T037 are the final amendment and acceptance sequence. No stale “sync live issue first” blocker remains. Local implementation and deterministic tests are allowed; both forward-only Stage migrations are applied and Stage currently reports 99 applied / 0 pending. The Stage-only refill canary is **AUTHORIZED FOR PRE-MERGE STAGE ACCEPTANCE / NOT RUN**; Production mutations, scheduler activation, live-VPS installation and merge remain separately gated.

## Prerequisites for later implementation validation

- Accepted Spec Kit and explicit T001 instruction; local isolated PostgreSQL using existing Node 20/postgres tooling, never Stage/Production for the transaction suite.
- DB Stage Apply PR [36310279719](https://github.com/krzysztofcal/arcadePlatform/actions/runs/36310279719) applied `20260927100000_poker_bot_quarantine_policy.sql` to shared Stage (97→98 applied, smoke PASS); [36310527312](https://github.com/krzysztofcal/arcadePlatform/actions/runs/36310527312) confirmed 98 applied / 0 pending and smoke PASS. The applied migration is immutable. No Stage refill/MINT occurred; Production remains unmodified and requires separate GO.
- The amendment added exactly `supabase/migrations/20260927110000_poker_force_restricted.sql`, extending only `chips_accounts_poker_access_override_chk`; it is classified `needs-production-equivalent` in the exhaustive manifest. Shared Stage read-only verification now reports 99 applied / 0 pending; the immutable 20260927100000 migration was not edited. No Stage refill/MINT occurred, and Production still requires a separate GO.
- Local fixtures: four exact pool accounts at zero, valid disabled tier policies, automatic NORMAL/AUTO users, empty STANDARD tables and existing managed table fixture. Enable/fund only explicit local test fixtures; no production values inferred from Stage examples.
- For integration later: exact runtime-SHA WS Preview and target identity evidence. The Stage-only refill/MINT canary is **AUTHORIZED FOR PRE-MERGE STAGE ACCEPTANCE / NOT RUN** and is a separate gate after the runtime/Caddy gate. Production migration, seed, MINT, timer/refill activation require a wholly separate GO.

## Focused local commands (after corresponding tasks exist)

Run from repository root with existing test environment conventions. These commands validate critical backend/runtime behavior; they do not activate a scheduler.

```bash
node --test shared/poker-domain/join.behavior.test.mjs shared/poker-domain/leave.behavior.test.mjs ws-server/poker/table/table-manager.behavior.test.mjs
node --test tests/poker-create-table.stakes.test.mjs tests/poker-quick-seat.behavior.test.mjs ws-server/poker/handlers/join.behavior.test.mjs
node --test ws-server/poker/persistence/persisted-state-writer.behavior.test.mjs shared/poker-domain/inactive-cleanup.behavior.test.mjs
npx vitest run tests/chips-ledger.test.mjs
node --test tests/admin-endpoints.behavior.test.mjs tests/admin-users-list.behavior.test.mjs tests/admin-ops-summary.behavior.test.mjs
node --test tests/chips/chips.migration.test.mjs tests/chips/poker-pool-policy.transaction.test.mjs
node --test tests/chips/chips-ledger-stage-automation.workflow.guard.test.mjs ws-tests/infra-vps-workflow.guard.test.mjs
```

The planned transaction suite must validate its local target before connecting and reject shared Stage/Production; use two connections and barriers, no sleeps. Do not run it against a remote target. No broad UI/CSS/JSP/glue suite. If future inline script changes, additionally run existing `npm run check:csp-inline` and include required SHA change.

The two existing workflow/VPS guard files are extended in T016 and must pass against the new artifacts in T019/T020. They check security/authority deterministically using existing YAML/source assertions and local stubs only: dispatch-only trigger; canonical repo/ref and actor/environment/feature gates; read-only default; separate Production GO; unauthorized inputs cannot reach mutation. They also verify exact dispatcher target/mode, GitHub credential only, no VPS Supabase/DB credentials or SQL/direct ledger writes, timer-only dispatch, and fresh/rebuilt-only installation with no enable --now/start/dispatch of the new artifacts. Existing-host installation remains separate and owner-approved. No real workflow dispatch, systemd changes or DB/MINT is performed by guard tests; no new framework or broad scheduler/UI suite. Record their results with T028 local evidence, independently of WS Preview and the separately authorized Stage canary.

## Recorded local T027/T028 evidence

- T027 ran `tests/chips/poker-pool-policy.transaction.test.mjs` against a fresh disposable PostgreSQL 17 database (`poker_policy_fresh_test`, local-only). The five subtests passed with `5 tests`, `5 pass`, `0 fail`, `0 skipped`: concurrent 4+4 Create/JOIN and fifth rejection with zero artifacts, pending→active and funded rejoin, settled automatic SLOW concurrent with FORCE_NORMAL, rollback/unknown-commit and cross-revision refill idempotency, and bounded indexed EXPLAIN for both count paths. The fixture asserted the user-leading `poker_seats` and creator-leading `poker_tables` indexes, early limit five and no global seat/table scan.
- Focused implementation groups passed: JOIN/leave/table-manager `124/124`; Create/Quick Seat/handler `29/29`; persisted writer/inactive cleanup `49/49`; workflow/VPS guards `17/17`; feature Admin access/tier cases `3/3`. These are backend/fundamental checks only. The full Admin smoke command has 16 origin/auth failures in both this checkout and the base checkout because its test origin environment is absent; it is not a feature regression.
- The exact `npx vitest run tests/chips-ledger.test.mjs` comparison is recorded below. The implementation checkout reported `49 tests: 37 pass, 12 fail`; the matching base checkout reported `48 tests: 36 pass, 12 fail`. The same twelve test names and failure causes occurred in both runs, so the declared failures are baseline failures rather than regressions from this diff.
- The repository-wide `tests/chips/chips.migration.test.mjs` also passed `1/1` on disposable local PostgreSQL after applying the same minimal `auth`/`storage`/`extensions` and role bootstrap used by `.github/workflows/tests.yml`. That test run used only disposable local fixtures; shared Stage was subsequently updated by the automatic repository workflow recorded above, not by the test command.

## Critical scenario matrix

| Scenario | Expected result | Tasks |
| --- | --- | --- |
| Wallet/settled stack threshold−1 and threshold; restart | NORMAL below, sticky automatic SLOW at threshold; no leave required | T004–T007 |
| AUTO/FORCE_NORMAL/FORCE_SLOW/FORCE_RESTRICTED; dynamic threshold | AUTO/NORMAL→FORCE_NORMAL or FORCE_RESTRICTED→wallet or settled stack reaches threshold→automatic SLOW persists while effective state remains override-selected→Return to AUTO immediately yields effective SLOW without another threshold check; test both evidence paths. WS revision delivery retains bounded refresh; sticky is_slow_only never resets | T004/T006/T021–T023/T032 |
| FORCE_RESTRICTED manual-only state | Admin-only override yields effective RESTRICTED while automatic NORMAL/SLOW persists; threshold may still persist automatic SLOW; Return AUTO reveals it immediately; no RESTRICTED automatic class, bankroll, refill policy or table marker | T030–T035 |
| Unchanged settled hand; stale cache | Zero added policy/account/override/tier reads/writes; stale cannot fund/admit, payout legal | T004/T006 |
| Own safe empty promotion vs other/prefunded/managed | Only SLOW owner accepted final JOIN promotes and can seed SLOW | T004/T005/T013 |
| Four active, fifth fresh, financed rejoin | Four accepted; fifth zero buy-in/funding; rejoin no slot | T008–T010/T027 |
| Four pending, fifth direct/fallback Create | Fifth creates no table/state/ESCROW | T008–T010/T027 |
| Concurrent Create/JOIN; first human pending transfer | Both limits ≤4, pending→active once | T027 |
| Active/pending query shape and local EXPLAIN | User_id-leading active and created_by-leading pending paths matched to final predicates; early limit five qualifying distinct tables, indexed EXISTS, no global seat/table scan | T002/T009/T027 |
| Exact tier/class funding; missing/disabled/empty pool | Correct four pools, no cross-tier/class/TREASURY fallback or runtime MINT | T011–T015 |
| Mixed live table; UNKNOWN leave; original source return | Sticky known-SLOW, legal payout/rejoin; UNKNOWN no false promotion; provenance retained | T004/T007/T011/T015 |
| Balance below/equal refill threshold | One configured amount below, zero at/above | T016–T018 |
| Duplicate/unknown commit/revision edit same bucket | At most one pool refill across revisions, stable original replay | T016/T018/T027 |
| Nine hours missed; stale queued run | Current bucket only, no backlog or multiple chunks | T016/T018–T020 |
| Workflow/VPS/bootstrap authority guards | Dispatch-only, trusted gates not input-only authorization, read-only default, exact dispatch target, no VPS DB/SQL, fresh-only installation without activation | T016/T019/T020 |
| Admin unauthorized/conflict/invalid integer | Zero unauthorized mutation; audit actor/time/revision for accepted update | T021/T022 |
| WS slowOnly inventory / DB Quick Seat / stale recommendation | Existing resume retained; class filter; final JOIN rejects stale class/cap | T024–T026 |
| Denied classification JOIN | No false has_human_participant or seat/funding | T004/T005 |
| Restricted fresh admission/funding | Ordinary bot-free STANDARD Create→JOIN succeeds with zero bot target/funding; bot-populated, SLOW-only and CONTINUOUS_BOT targets reject before buy-in; financed rejoin and legal settlement remain valid | T033–T035 |

## WS runtime gate — required before Stage acceptance

Use `.github/workflows/ws-preview-deploy.yml` definition from main with application revision equal to the latest runtime-affecting SHA, verify workflow succeeded for that exact SHA. Netlify preview alone does not deploy WS. Confirm NORMAL/SLOW Create→JOIN, 4+4 rejection, long-staying threshold transition, Admin revision propagation, slowOnly lobby/Quick Seat, managed behavior and cash-out in targeted smoke. Record the exact runtime SHA and workflow evidence below; a later docs-only evidence commit does not require another Preview deploy when runtime files are unchanged.

T029 exact-SHA evidence remains historical for runtime SHA `1d00fa2cd8b3110eb1967b5f577a3c671f5591e3`: [WS Preview workflow run 36327260598](https://github.com/krzysztofcal/arcadePlatform/actions/runs/36327260598) succeeded with matching release/deploy SHA and health PASS. It covered the original NORMAL/SLOW contract, 4+4 limits, funded rejoin, lobby/Quick Seat, Admin/cache and read-only CONTINUOUS_BOT status. It is not final merge evidence after the RESTRICTED runtime change.

The FORCE_NORMAL/FORCE_RESTRICTED durable-state and no-per-hand-policy-read invariants retain their deterministic evidence. **T036 FAIL/BLOCKED — owner found orphan pending + slow multi-confirm Admin Save protocol.** In-memory pending barrier survived finished/aborted requests, blocking subsequent legitimate Saves before DB write, while confirmation retried up to 3 times (12s total). Superseded by §25 single-owner deterministic WS mutation (`Admin UI → Netlify Admin auth → one internal WS request → WS fail-close → one DB transaction → WS cache/socket update → release fail-close → exact ACK`). Netlify performs zero local DB writes and zero confirmation retries; WS owns runtime guard, single DB transaction with optimistic revision check, authoritative SLOW persistence, cache/socket broadcast, and fail-close cleanup. Exact-SHA WS Preview deploy and green CI required before owner manual authenticated smoke retry: `AUTO → FORCE_RESTRICTED → immediately AUTO` with successive exact revisions and zero periodic-refresh delay. Caddy route unchanged.

## Authorized pre-merge Stage acceptance canary — separate gate

Refill worker starts dry-run. The Stage-only canary is **AUTHORIZED FOR PRE-MERGE STAGE ACCEPTANCE / RUN: NO-OP**; owner acceptance remains blocked on T036. Before merge, use the already registered `.github/workflows/chips-ledger-stage-scheduled-automation.yml` with mode `poker-bot-pool-refill-canary`, dispatching it at the PR branch/ref. Supply the exact lowercase 40-character `poker_refill_reviewed_sha` equal to that run's `GITHUB_SHA` and `REFILL <sha>` confirmation; checkout, `git rev-parse HEAD`, worker `POKER_BOT_REFILL_REVIEWED_REF` and `POKER_BOT_REFILL_CHECKED_SHA` must all match before any mutation. This one-time canary hardcodes `POKER_BOT_REFILL_POOL_CLASS=NORMAL` so a NORMAL acceptance does not fund SLOW solely for the test; the post-merge scheduler still evaluates both classes. Only the repository owner may dispatch this Stage-only mode, and it exposes only `SUPABASE_STAGE_DB_URL`. The standalone `.github/workflows/poker-bot-pool-refill.yml` remains the post-merge/dispatcher path with its dedicated `arcade-poker-refill-dispatch` actor and unchanged Production gates. After read-only preflight, enable only the minimum supported tier needed for the manual acceptance scenario. Compare ledger pool/bucket/amount and balance; runtime hand funding must create no MINT. VPS timer is only a GitHub-authenticated wake-up every 3h, with no DB credentials or SQL; it remains inactive for this acceptance. No native GitHub cron dependency. Record canary evidence separately and never conflate it with WS Preview completion. Production remains a wholly separate GO.

## Future scheduler installation — fresh vs existing VPS

`infra/vps/bootstrap.sh` is fresh-VPS only: it may install the new dispatcher/service/timer disabled on future fresh/rebuilt hosts. Never run bootstrap on an existing live VPS or bypass its fresh-vps guard.

For an existing host, follow a separate owner-approved targeted upgrade/install flow consistent with `infra/vps/README.md` and `docs/chips-ledger-stage-automation.md`: first read-only inventory of current units/configuration and a non-secret rollback manifest; review exact new artifacts; install only those dispatcher/units disabled, reload systemd and verify configuration/status without invoking the service or dispatching a workflow. Preserve existing timers/services. This is a future approved operation, not part of the docs task.

Installation and activation are separate steps. Neither code deploy, artifact installation nor bootstrap may automatically enable/start the new timer. Activation needs its own applicable authorization after reviewed target/ref/mode and workflow gates; Stage MINT and Production permissions remain distinct. VPS has GitHub dispatch credentials only, no DB credentials or SQL.

## Cutover / rollback / breaking review

Pause new admissions/funding while allowing current hands and lawful payouts. Provision only missing exact pool accounts at zero and policies; preserve existing account IDs, balances and provenance, especially the existing 500 bankroll; deploy all class/limit/source writers and metadata readers together. Deliberately enable and, only in authorized target, refill pools before reopening. Existing 500 key and all historical TREASURY/source attribution remain. Never infer enablement from progression catalog.

100 new funding moves from TREASURY to its own NORMAL pool; SLOW uses its own tier pool and can run out before the next refill. Sticky tables do not revert under FORCE_NORMAL. 4+4 applies to both classes; Sybil can multiply this per-account containment and remains an accepted residual risk. Admin override mutation is owned by WS with a single DB transaction, short-lived runtime guard, and exact ACK; stale expectedRevision returns 409 stale_revision without mutation, and concurrent mutations return 409 poker_access_mutation_in_progress. Rollback keeps new funding disabled rather than restoring class/limit/fallback bypass; applied migrations stay forward-only.

## Evidence record to complete later

T028 records the local command results and simplicity/constitution review here. T027's isolated PostgreSQL concurrency and active/pending SQL/index/EXPLAIN evidence is complete. The earlier T029 record contains the prior exact runtime SHA/workflow result and smoke outcome; the final amendment's Preview deploy evidence is recorded above, while its authenticated T036 smoke is FAIL/BLOCKED by the owner-found pending recovery bug. T037 is the separate pre-merge Stage acceptance gate: read-only preflight, minimum tier enablement, exact reviewed-SHA official refill, manual Play Now retest and read-only ledger verification. No future threshold check is required to expose stored automatic SLOW on Return to AUTO. Local implementation and deterministic test evidence is recorded below; STOP before any unapproved environment operation.

### Vitest baseline failure evidence

The implementation and base checkouts both failed on exactly these twelve tests: idempotent same-user/cross-user reuse; mismatched idempotency payload; numbered page metadata; legacy cursor fallback when `sort_id` is missing; `created_at` fallback when `display_created_at` is missing; `tx_created_at` fallback when entry `created_at` is missing; `created_at` preference; PostgreSQL timestamp normalization; legacy cursor payload; legacy cursor timestamps; ascending `entry_seq`/sequence stats; and legacy `after` paging without a cursor. Current causes are the same baseline causes (ledger mock/insufficient-funds setup, absent `listUserLedgerPage`, unhandled legacy mock queries and invalid legacy sequence input), with no changed failure category.

## Local implementation evidence

Historical local record for T001–T028: fundamental deterministic checks passed for access classification, authoritative JOIN/capacity and safe promotion, Quick Seat/Create compatibility, settled rollover persistence, exact pool mapping, refill authority/idempotency, Admin policy/override guards, WS self-access delivery, workflow/VPS guard contracts, and the full local PostgreSQL T027 proof. Evidence/refactor review confirmed FORCE_NORMAL automatic-state persistence, no runtime MINT or cross-class/tier/TREASURY fallback on the schema-backed path, klog-only new logging, JSP/global-script compatibility, unchanged CSS/CSP rules, and no broad test expansion. `issue-source.md` remains byte-for-byte unchanged as the live #1018 snapshot. The former T029 exact-SHA WS Preview/runtime smoke remains historical evidence only; the final amendment is covered by T030–T037. The automatic Stage migration apply is recorded above. No Stage refill/MINT, Production operations, live-VPS installation/activation or merge was performed; the only Preview runtime checks were the documented targeted smoke and read-only maintenance GET.


## Review fix evidence — 2026-09-27

The follow-up Admin/WS race fixes are covered by deterministic tests: recovery persists the authoritative `is_slow_only=true` marker before a committed SLOW barrier is released, later FORCE_NORMAL/AUTO leaves that marker true, and a second mutation for the same user receives `poker_access_mutation_pending` before any DB write. Existing legal settlement/rejoin behavior remains unchanged. Runtime SHA `770bae83aca334f4ffb21c8a89a7092cc87d287d` passed exact-SHA Preview run `36353641403`; at that historical checkpoint no Caddy apply or T036 smoke had run; the owner subsequently found the T036 blocker recorded below.

The earlier review fixes added no migration and left the applied SQL unchanged. The final amendment intentionally adds one forward-only CHECK migration while preserving the accepted economic model:

- Dispatcher defaults to Stage dry-run; a separately owner-approved root-owned environment file can select mutate. Repository/ref/actor/environment/feature gates and separate Production GO remain authoritative; installation never activates the timer.
- Refill derives UTC time from PostgreSQL `clock_timestamp()`, checks the bucket after required locks, and aborts/rolls back if later ledger work crosses the boundary. Lock/statement/idle waits and whole-run duration are bounded; cross-revision pool+bucket uniqueness remains unchanged.
- Settled replacement/top-up requires a fresh cached enabled tier and provisioned NORMAL+SLOW pair. The existing 25s refresh runs even for bot-only tables; settlement is still legal without new funding. CONTINUOUS_BOT uses NORMAL; transitioned STANDARD tables use SLOW.
- A transaction-local catalog capability probe keeps pre-migration Production on legacy JOIN/rejoin, progression, Quick Seat, bootstrap and historical 100 CH funding. It does not swallow DB errors or cache schema absence across transactions. New-schema transactions use full #1018 authority; existing history is unchanged. This permits code deployment before the separately authorized Production migration/cutover.

Local T027 rerun: six tests passed, zero skipped, on isolated PostgreSQL 17 `poker_policy_revision_test`, including original concurrency/EXPLAIN evidence and a real absent-schema→committed-migration→next-transaction capability check. Refill plus T027: 15/15 passed. Focused backend/compatibility suites passed: 56/56, JOIN/access/handler 62/62, progression/authoritative-adapter/lobby regression 24/24, feature Admin 3/3. Before this amendment the migration guard passed with 98 source migrations; the amendment changes the exhaustive inventory to 99 and adds no Production replacement. All 76 WS PR Node commands were executed: 919 passed, six Docker cases self-skipped because this user cannot access the Docker socket, and one root-owned rsync fixture failed because passwordless sudo is unavailable. The same rsync failure was reproduced from reviewed HEAD 193a5930; its test/workflow/helper are unchanged. Docker build and these host-dependent checks must be verified in GitHub CI. `git diff --check` passed; no added console.log, browser module, CSS or inline script/CSP change. T029 WS runtime evidence is historical; the Stage-only canary is now **AUTHORIZED FOR PRE-MERGE STAGE ACCEPTANCE / RUN: NO-OP** (latest evidence below).

## Final manual RESTRICTED amendment evidence

T030 synchronized all feature documents to the exact live #1018 snapshot (`2026-09-27T17:10:33Z`); `issue-source.md` is the literal source snapshot. T031 adds only `20260927110000_poker_force_restricted.sql`, leaves the applied 20260927100000 file untouched, and updates the exhaustive Production manifest/inventory as `needs-production-equivalent`. T032–T034 reuse existing access/Admin/cache, authoritative JOIN, DB Quick Seat, WS lobby and settled funding flows. Automatic state remains NORMAL/SLOW; FORCE_RESTRICTED is Admin-only effective RESTRICTED; no RESTRICTED bankroll/refill/table marker/lifecycle exists.

T035 focused evidence must include: automatic threshold never produces RESTRICTED; FORCE_RESTRICTED preserves automatic NORMAL/SLOW and Return AUTO; unauthorized Admin rejection; ordinary bot-free restricted Create→JOIN with zero bot funding; bot/SLOW-only/CONTINUOUS_BOT fresh denial before buy-in; legal financed rejoin; restricted Quick Seat/lobby filtering; settled legal rollover with zero replacement/top-up; 4+4; pre-migration compatibility; and migration manifest/constraint guards. Only deterministic fundamental tests are in scope.

**T036 FAIL/BLOCKED — poker_access_mutation_pending recovery bug found by owner.** FORCE_RESTRICTED followed by AUTO returned pending. The code omitted pending-only offline users from recovery candidates and accepted incomplete WS ACKs. The fix requires exact synchronous confirmation; local regression evidence and a new exact-SHA Preview deploy precede the owner retry. Caddy route was applied in [36356203190](https://github.com/krzysztofcal/arcadePlatform/actions/runs/36356203190); no Caddy/config change or reapply is required. Previous runtime `770bae83aca334f4ffb21c8a89a7092cc87d287d` / Preview [36353641403](https://github.com/krzysztofcal/arcadePlatform/actions/runs/36353641403) is historical, not final evidence for this fix.

Stage-only NORMAL canary [36393990217](https://github.com/krzysztofcal/arcadePlatform/actions/runs/36393990217) passed on reviewed SHA `8f7a2d62940791fd7d60c8bf29161150c19be2d2`, with identical dispatched/checkout/reviewed/worker SHA and `no_op` for `POKER_BOT_BANKROLL`. Stage read-only evidence: 99 applied / 0 pending; tier 500 enabled revision 3, NORMAL threshold/amount 5000/10000, SLOW 2000/5000; tier 100 disabled revision 1; NORMAL 500 balance 988040 CH, other exact pools 0 CH; refill MINT count 0→0. No balance update, SLOW funding or tier 100 change. A new canary is required on the final fix SHA.

Admin access Save performs authenticated WS pre-invalidation, exactly one DB mutation, then at most three synchronous WS confirmations (each capped at 4 seconds, no sleep or DB-write retry). HTTP 200 requires ok/refreshed true, pending/failClosed false and the exact committed revision and requested override. A committed pending mutation is recovered synchronously by the next request; stale caller revision returns 409 stale_revision with current access and no new write/barrier. Truly concurrent uncommitted mutations remain 409 poker_access_mutation_pending. The bounded background refresh prioritizes pending IDs (including offline/nonseated users), then active sessions and seated humans, deduplicated to 512; it is a safety backstop, not Save confirmation. Authoritative SLOW persistence and cache/socket updates complete before barrier release and positive ACK. Failed confirmation remains fail-closed; lawful settlement/rejoin/leave/cash-out are unchanged.

Production/VPS timer = `NOT AUTHORIZED / NOT RUN`; merge = `NOT AUTHORIZED`. Stage acceptance must follow a passing owner T036 retry, not merely green CI.
### Deterministic Admin Save recovery validation (2026-09-28)

Owner T036 failed with `poker_access_mutation_pending` on immediate AUTO after FORCE_RESTRICTED. Fundamental reproductions failed before the fix: offline pending IDs were omitted, confirmation retry was absent, and incomplete/mismatched WS ACKs could pass. Local evidence after the fix: Admin + propagation 44/44; preserved JOIN/access/settled/managed/refill guards 74/74; T027 disposable PostgreSQL 17 6/6, including real concurrency and EXPLAIN, zero skipped; migration guard 99 source migrations / 2 Production replacements; full `npm test` PASS. All 76 WS PR Node commands ran: 935 passed, 6 Docker-dependent cases skipped locally; the unchanged root-owned rsync fixture requires unavailable passwordless sudo (1 local environmental failure). GitHub CI must validate that fixture and Docker. No new schema/migration, Caddy/config, CSS, inline script or browser-module change; only klog logging. `propagationMs` was removed only from access mutation success; independent policy cache intervals remain unchanged. The propagation suite is now registered in `scripts/test-all.mjs`.

Read-only Preview journald inspection found no access-refresh error event in the owner-test time window; it cannot prove the missing ACK. The owner error and deterministic code reproductions establish the recovery defect. Existing managed seed-incomplete logs are consistent with disabled/unfunded profiles and were not used to activate or fund any pool.


### Final runtime deploy and owner retry handoff

Runtime SHA `727f50c38ef04e0bdbd07b4401dc9b4307a5f8fd` passed all GitHub runtime CI workflows (Tests `36425224910`, WS PR Checks `36425224922`, CI `36425224912`). DB Stage Apply `36425224911` confirmed 99 applied / 0 pending and smoke PASS; this fix adds no migration. Exact-SHA [WS Preview Deploy 36425620499](https://github.com/krzysztofcal/arcadePlatform/actions/runs/36425620499) succeeded: `RELEASE_SHA == DEPLOY_REF == 727f50c38ef04e0bdbd07b4401dc9b4307a5f8fd`, installed release metadata checks passed, local/public Preview health PASS. Final local WS server behavior: 138/138. Caddy/config diff is zero; no reapply. This evidence-only update does not change runtime files.

T036 is **PASS (owner-accepted §25 single-owner deterministic WS mutation)**. The subsequent owner smoke confirmed immediate sequential Admin mutations with zero periodic-refresh delay.

### Phase 11 / §26 verification evidence (T047–T052)

Resolves the two remaining P1 blockers and final preflight/order corrections:
1. **Settled rollover retry**: Unknown access or bot funding snapshot triggers `scheduleSettledRolloverRetry()` without advancing state or bypassing funding. Authoritative no-funding retains `allowBotFunding: false` without endless retry. In `decideSettledBotFunding()`, `effectiveRestricted === true` takes authoritative precedence before snapshot freshness validation, returning `{ known: true, allowed: false, systemKey: null, reason: "restricted" }` even when the funding snapshot is missing or expired.
2. **Continuous bot table controlled inactivity**: Disabled or unprovisioned tier 100 sets controlled inactive state (`desiredCount = 0`, zero table creation, zero seed, graceful retirement of open tables below minimum occupancy) without rollback/sweep churn. In `createManagedTable()`, schema and tier policy/provisioning validation run as preflight checks before any table mutation (`createPokerTableWithState`).

#### Test Execution Evidence
- `node --test ws-server/poker/runtime/poker-access-propagation.behavior.test.mjs`: 16/16 pass, including `human and two busted bots retry on unknown funding, then fund replacements and exit SETTLED without duplicates` and `RESTRICTED with missing or expired funding snapshot yields authoritative no-funding without retry`.
- `node --test ws-server/poker/persistence/continuous-bot-table-repository.behavior.test.mjs`: 16/16 pass, including `reconcile treats an enabled profile with disabled tier 100 as controlled inactive without table creation churn` and `reconcile treats an enabled profile with unprovisioned tier 100 as controlled inactive with zero table INSERT`.
- `node --test ws-server/server.behavior.test.mjs`: all settled rollover and timeout suites pass with standalone/guest guards.
- Local CI guards: `npm run ci:guards` PASS, `npm run check:csp-inline` PASS, `git diff --check` PASS (0 errors).
- GitHub PR CI: All 17 required checks passed on commit `b58651f54c16c573eb33e5b29fcab8b80e1c748a`.

#### WS Preview Deployment Evidence
- Exact runtime SHA `b58651f54c16c573eb33e5b29fcab8b80e1c748a` deployed via [WS Preview Deploy run 36479748272](https://github.com/krzysztofcal/arcadePlatform/actions/runs/36479748272).
- Verification confirmed: `RELEASE_SHA == DEPLOY_REF == b58651f54c16c573eb33e5b29fcab8b80e1c748a`.
- Local and public health gates: PASS (`https://ws-preview.kcswh.pl/healthz` returns `ok`).

#### Stage Read-Only Invariant Verification
- `poker_bot_tier_policy`: Tier 100 is `enabled: false` (revision 1), Tier 500 is `enabled: true` (revision 3).
- `chips_accounts`: `POKER_BOT_BANKROLL_100` = 0, `POKER_BOT_SLOW_BANKROLL_100` = 0, `POKER_BOT_SLOW_BANKROLL_500` = 0, `POKER_BOT_BANKROLL` = 986970.
- `chips_transactions`: Zero new transactions since 2026-09-28 19:19:38 UTC.
- `poker_tables`: Zero new tables or supervisor churn. Controlled inactivity holds.

Tasks T051 and T052 are marked complete.

### T037 Final Pre-Merge Stage Acceptance Evidence

T037 is **PASS — final pre-merge Stage acceptance complete.**

1. **Owner-gated Stage NORMAL refill canary**:
   - Dispatched and passed on PR HEAD `4af8c80e2e73de05f1bfa3bab856df0b7ba4949f` via [Chips Ledger Stage Automation run 36545904983](https://github.com/krzysztofcal/arcadePlatform/actions/runs/36545904983).
   - Exact lowercase reviewed SHA checks passed:
     `POKER_BOT_REFILL_REVIEWED_REF == POKER_BOT_REFILL_CHECKED_SHA == DEPLOYED_COMMIT_SHA == 4af8c80e2e73de05f1bfa3bab856df0b7ba4949f`.
   - Worker outcome: `[{"status":"no_op","poolKey":"POKER_BOT_BANKROLL"}]`.
   - Zero MINT executed, balances unchanged (`POKER_BOT_BANKROLL` = 984480 CH, reflecting ledger state after the 2026-09-29 08:27:40 UTC manual smoke ending at sequence 276956), tier 100 remains `enabled: false`.

2. **Manual owner smoke (Stage table `a008c0a1-a85e-4727-b8e2-4d7f649191da`)**:
   - Table: `a008c0a1-a85e-4727-b8e2-4d7f649191da` (500 CH STANDARD).
   - Owner access: `AUTO / NORMAL`.
   - Scenario: Both bots bust simultaneously.
   - Rollover: Successfully advanced `548 → 549`.
   - Replacement funding: Two replacements of 500 CH each funded from `POKER_BOT_BANKROLL`.
   - Ledger: Exactly `ESCROW +500 / SYSTEM -500` per replacement.
   - Idempotency & deduplication: Zero duplicate funding.
   - Progression: Next hand `..._549_3` started and successfully reached subsequent settlement.
   - Outcome: **T037 manual smoke PASS**.

Status is **READY FOR FINAL PR REVIEW**.
Production migration, seed, refill, cutover, and VPS refill timer activation remain strictly **NOT AUTHORIZED / NOT RUN**.
GitHub PR merge remains unauthorized (requires separate owner decision).
