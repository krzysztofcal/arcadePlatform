# Tasks: NORMAL/SLOW periodic per-tier pools

**Input**: Design documents from `/specs/796-bot-quarantine/`.

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/bot-quarantine.md](contracts/bot-quarantine.md).

**Tests**: Only requested fundamental deterministic backend/runtime/transaction tests. No UI/CSS/JSP/glue suites or new test framework.

**Organization**: User-story phases follow the active Spec Kit template. T001–T029 are completed historical implementation/evidence; T029 is the earlier exact-SHA WS Preview/runtime gate recorded in `quickstart.md`. The current live #1018 amendment adds only the manual FORCE_RESTRICTED extension through T030–T036, followed by the pre-merge Stage acceptance gate T037. The Stage refill canary is **AUTHORIZED FOR PRE-MERGE STAGE ACCEPTANCE / RUN: NO-OP**; acceptance is complete (T037 PASS). Latest live #1018 supersedes the old 19-task farmer-only plan.

## Format: `[ID] [P?] [Story] Description`

`[P]` means separate files and no dependency on another incomplete task at that checkpoint. Paths are repository-relative. Story labels map to spec. Shared financial/runtime files require the explicit order below, not speculative parallel edits.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm requirements and implementation authority, not generic project setup.

- [x] T001 Record accepted independent review, selection of #1018 instead of #869, no drift from live issue, and separate explicit implementation instruction in `specs/796-bot-quarantine/quickstart.md`. Reconfirm periodic 3h per-tier NORMAL/SLOW policy, 4+4 limits and accepted Sybil risk. Before any future migration PR publication, declare intended shared Stage mutation via DB Stage Apply PR and applied forward-only rule; Production remains separate GO. No ignore/tooling/dependency cleanup. (FR-021)

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Minimal persistence/policy contracts; blocks all stories.

- [x] T002 After T001, add additive files under `supabase/migrations/` for the original `data-model.md` §§1–5 and extend `tests/chips/chips.migration.test.mjs`. The applied base migration stores automatic NOT NULL NORMAL/SLOW default NORMAL and override NOT NULL AUTO/FORCE_NORMAL/FORCE_SLOW default AUTO; the additive T031 migration extends that same CHECK with manual FORCE_RESTRICTED. USER fields retain positive monotonic revision, nullable first-SLOW timestamp and actor/time audit. `poker_tables.is_slow_only boolean NOT NULL DEFAULT false`, enforce false→true only. Access policy `id=1`, slow_threshold_ch 1..9007199254740991 initially 1000000000, positive revision initially 1. Tier policy buy_in positive safe integer PK; enabled NOT NULL default false; four threshold/amount fields positive safe integers; revision/updated_at/updated_by. Provision only missing exact 100/500 NORMAL+SLOW SYSTEM accounts at zero. Preserve every existing pool account ID, balance and provenance, especially the existing 500 POKER_BOT_BANKROLL; never zero/reset it. No MINT or historical relabel. Enable RLS on new public policies, no anon/authenticated read/write access; backend-only access/marker writes. Add narrow typed pool+bucket unique index on existing `chips_transactions` metadata, no receipt table; provide required narrow user_id-leading poker_seats active-membership and created_by-leading poker_tables pending-owner indexes/access paths matched to final status/participation predicates; no broad index. The reviewed table-leading (table_id,user_id) uniqueness is insufficient. Reuse an adequate index only with documented final SQL/index/EXPLAIN evidence rather than a duplicate; T027 proves both paths locally. Declare shared Stage effect before publishing, never edit applied migrations. (FR-001/004/006–009/011/013/021)
- [x] T003 After T002, add small `shared/poker-domain/bot-access.mjs` sharing threshold/override/effective-class validation and policy loaders with existing `poker-progression.mjs` balance validation; define trusted snapshot revision/freshness contract and enabled exact tier/pair mapping inputs. Missing/invalid !=NORMAL; positive safe integers and monotonic revisions, no env/client bypass. No per-hand loader calls, global scans, generic config framework or pool auto-creation. (FR-001–003/009/011/017)

**Checkpoint**: Foundation ready for independently testable stories; no environment activation.

## Phase 3: User Story 1 - Appropriate class and uninterrupted play (Priority: P1)

**Goal**: JOIN/settled classification, safe owner promotion and sticky metadata without breaking legal participation.

**Independent Test**: Wallet/settled threshold−1/=threshold, overrides, denied JOIN, unknown cache and leave/rejoin with provisioned local pools.

### Tests for User Story 1

- [x] T004 After T003, extend `shared/poker-domain/join.behavior.test.mjs`, `ws-server/poker/table/table-manager.behavior.test.mjs` and `shared/poker-domain/leave.behavior.test.mjs`: sticky wallet/settled SLOW, the full sequence AUTO/NORMAL→FORCE_NORMAL→wallet or settled stack reaches threshold→durable automatic SLOW while effective NORMAL→Return to AUTO→effective SLOW immediately without another threshold check (exercise both authoritative evidence paths), known-SLOW vs UNKNOWN marker, safe owned empty promotion only, denial without human marker/seat/debit, mixed financed rejoin/payout and restart. Assert below-threshold settled path calls zero policy/account/override/tier-policy reads and zero classification writes; changed revision applied after background refresh, expired/failed cache cannot authorize funding. Fundamental cases only. (FR-001–005/018–020; SC-001/005)

### Implementation for User Story 1

- [x] T005 After T004, extend `shared/poker-domain/join.mjs::executePokerJoinAuthoritative` and `ws-server/poker/persistence/authoritative-join-adapter.mjs`: authoritative wallet threshold before buy-in including automatic SLOW persistence under FORCE_NORMAL, effective override only after automatic classification, durable transition survives structured policy denial, financed rejoin preserved. Locked SLOW owner promotion requires STANDARD/OPEN empty state/no seats/no prior bot funding; promotion commits only with accepted fresh admission. Set `has_human_participant` only in accepted admission/rejoin branches. No Create classifier or runtime MINT. (FR-001/002/004/005/018; SC-001)
- [x] T006 After T005, extend `ws-server/server.mjs::runSettledRolloverCommand` and `ws-server/poker/table/table-manager.mjs::prepareSettledHandRollover/commitSettledHandRollover`, with `persisted-state-writer.mjs::writeViaDb`, for authoritative settled-stack comparison before next funding plan. Server owns one ≤30s bounded refresh of policy/tier policy plus connected/still-seated access IDs, max age 30s; hydrate JOIN/reconnect, update after confirmed local commit, never refresh from each hand. Persist actual transition/marker in existing transaction/version flow, reconcile revision only on real change, preserve concurrent override without suppressing the automatic transition; FORCE_NORMAL keeps only effective NORMAL and never resets sticky marker, while FORCE_RESTRICTED keeps effective RESTRICTED without suppressing durable automatic SLOW evidence. Return to AUTO derives stored automatic NORMAL/SLOW without a new threshold check. Commit/restore only after persistence; unknown rollback/recovery prevents new funding without blocking legal settlement. No second settlement flow or wealth aggregation. (FR-002–004/019; SC-001/005)
- [x] T007 After T006, extend `ws-server/poker/bootstrap/persisted-bootstrap-repository.mjs`, `persisted-bootstrap-db.mjs`, `persisted-bootstrap-adapter.mjs::normalizeTableMeta` and `table-manager.mjs` with committed `isSlowOnly`; retain marker through restart/close and occupied managed transition. Review `shared/poker-domain/leave.mjs`/`terminal-close.mjs`: known effective SLOW may persist marker in existing tx, UNKNOWN cannot promote or gate payout. Preserve existing financed NORMAL participation, no kick, no ordinary managed rotation bypass, no new lifecycle. Run T004 focused cases. (FR-003/004/019; SC-001)

**Checkpoint**: US1 locally verifiable; source isolation and caps still required before cutover.

## Phase 4: User Story 2 - Four active and four pending tables (Priority: P1)

**Goal**: Race-safe per-user limits across Create/fallback/final JOIN.

**Independent Test**: Four accepted, fifth rejected before mutation, rejoin without slot, pending-to-active and parallel requests.

### Tests for User Story 2

- [x] T008 After T007, extend `shared/poker-domain/join.behavior.test.mjs`, `tests/poker-create-table.stakes.test.mjs` and `tests/poker-quick-seat.behavior.test.mjs` for 4/5 boundaries across NORMAL/SLOW, disconnected financed seats, rejoin, first human pending transfer, terminal exclusion and fifth Create zero table/state/ESCROW. Add real races later in T027; no UI tests. (FR-006–008/018; SC-002)

### Implementation for User Story 2

- [x] T009 After T008, add `shared/poker-domain/table-participation.mjs` with shared `poker-table-slots:v1` + canonical UUID transaction advisory lock and active/pending predicates from data-model §3. Count distinct financed active tables including disconnected/pending leave, not discovery freshness; pending is OPEN STANDARD owned, human marker false, no seats/funding history, safe empty state. Bounded count-to-five qualifying distinct-table queries (not full COUNT then LIMIT), using mandatory user-leading active/creator-leading pending paths from T002 with final status predicates and selective indexed EXISTS probes; zero global seat/table scans, no persistent counter. READ COMMITTED counts after lock; helper accepts caller transaction, no nested detached tx. (FR-006–008; SC-002)
- [x] T010 After T009, wire `executePokerJoinAuthoritative` in `shared/poker-domain/join.mjs`, `netlify/functions/poker-create-table.mjs`, `_shared/poker-table-init.mjs::createPokerTableWithState`, and `poker-quick-seat.mjs::createAndRecommend` to the same user lock before table/state/account locks. Quick Seat acquires user before existing quickseat match lock. Fresh fifth JOIN rejects before buy-in/bot seed; fifth direct/fallback Create before any INSERT; accepted first JOIN transfers counts atomically, financed rejoin consumes no slot. Public null owner cannot use trusted managed bypass. Confirm no late user-lock acquisition from rollover; leave/close only release slots. (FR-005–008/018; SC-002)

**Checkpoint**: Caps apply to all entry paths; a recommendation is never quota authorization.

## Phase 5: User Story 3 - Exact tier/class funding (Priority: P1)

**Goal**: Runtime consumes isolated balances and preserves provenance without MINT.

**Independent Test**: Four exact pools, disabled future tier, empty pool, historical return.

### Tests for User Story 3

- [x] T011 After T010, extend `shared/poker-domain/join.behavior.test.mjs`, `ws-server/poker/persistence/persisted-state-writer.behavior.test.mjs`, and `shared/poker-domain/inactive-cleanup.behavior.test.mjs` for exact class/tier across seed/managed seed/replacement/top-up, no fallback/MINT, no phantom funded state, sticky table after FORCE_NORMAL, disabled/unprovisioned future tier, legacy TREASURY/500 return. (FR-009/010/019/020; SC-003)

### Implementation for User Story 3

- [x] T012 After T011, extend `shared/poker-domain/table-economy.mjs::getBotFundingSystemKeyForBuyIn`: require explicit enabled provisioned tier pair, 100 NORMAL POKER_BOT_BANKROLL_100, 500 NORMAL POKER_BOT_BANKROLL, tier-specific SLOW keys. Sticky table marker determines pool, effective seated SLOW promotes before funds; unknown denies. Remove new-funding TREASURY/class/tier fallback, do not enable all progression tiers. (FR-009/010; SC-003)
- [x] T013 After T012, wire exact resolver/fresh trusted access snapshot into `shared/poker-domain/bots.mjs::seedBotsForJoin` and `ws-server/poker/persistence/continuous-bot-table-repository.mjs` managed initial seed. Preserve existing bots, savepoint/atomic seat semantics; ordinary managed inventory NORMAL only, accepted SLOW owner JOIN can seed from SLOW. No runtime mint. (FR-005/009/010/019; SC-003)
- [x] T014 After T013, update `ws-server/poker/persistence/persisted-state-writer.mjs::writeReplacementFundings/writeManagedBotTopUps` and `ws-server/server.mjs::runSettledRolloverCommand` to exact pool and generalize 500-only insufficient-bankroll handling. Known SLOW marker persists before positive funding; unknown/empty/disabled => existing restore→prepare allowBotFunding:false→persist→restore, no fabricated funded commit or unbounded retry. Existing no-funding actions do not acquire new policy dependency. (FR-003/010/019; SC-003)
- [x] T015 After T014, verify/update only needed source attribution paths in `shared/poker-domain/terminal-close.mjs::normalizeFundingRows`, `leave.mjs`, `ws-server/poker/persistence/chips-ledger.mjs` and `netlify/functions/_shared/chips-ledger.mjs`: use actual original funding account, including old TREASURY/500 and later SLOW tranches, never current marker as return source. Run T011 regressions; no historical rewrite. (FR-010/019; SC-003)

**Checkpoint**: Runtime issuance is zero; shortfall waits for operational refill.

## Phase 6: User Story 4 - One periodic refill per exact pool (Priority: P1)

**Goal**: Independent operational MINT, one eligible amount/current UTC bucket.

**Independent Test**: Clock-controlled threshold/equality/replay/revision/missed-bucket cases, plus T027 concurrent DB dispatch.

### Tests for User Story 4

- [x] T016 After T015, extend `tests/chips-ledger.test.mjs` with narrow scheduled GENESIS→exact pool MINT validation and worker-injected deterministic clock/policy/balance cases: below/equal threshold, one amount, same-key replay, revision change same bucket no second MINT, disabled/unprovisioned/unsafe inputs, rollback/unknown commit, no-op later eligibility, missed buckets not caught up. Reject public metadata-only or arbitrary SYSTEM MINT. Also extend only existing `tests/chips/chips-ledger-stage-automation.workflow.guard.test.mjs` and `ws-tests/infra-vps-workflow.guard.test.mjs` with small deterministic authority guards for the future refill workflow/dispatcher/units/bootstrap. Workflow: exactly workflow_dispatch (no schedule/push/pull_request), canonical repository/ref checks, actor/environment/feature mutation gates, dry-run/read-only default, separate Production GO, and caller-supplied inputs cannot bypass authorization. VPS: exact repository + refill workflow/ref/mode, GitHub dispatch credential only, no Supabase/DB credentials or SQL/direct ledger mutation, timer only wakes dispatch. Bootstrap: fresh/rebuilt-only artifact installation; no enable --now/start/refill dispatch for the new timer/service, no activation by code deploy/install; existing live host stays on separate owner-approved targeted install flow. Reuse existing YAML/source assertions and local stubbed guard checks where needed; negative unauthorized-input cases must verify the guarded mutation path, not just presence of gate words. Never invoke real GitHub dispatch, systemd changes or DB/MINT from these tests. No new harness/framework, broad scheduler or UI/CSS/JSP/glue suite. (FR-011–014/020/021; SC-004)

### Implementation for User Story 4

- [x] T017 After T016, extend `netlify/functions/_shared/chips-ledger.mjs::validateEntries/postTransaction` narrowly for trusted scheduled-pool MINT: exactly GENESIS debit + mapped SYSTEM credit, balanced safe integer, purpose/pool/tier/class/revision/bucket metadata. Current missing_user_entry rule remains for unrelated SYSTEM MINT; reuse transaction/payload hash/registry, not public metadata capability or table funding key. (FR-013; SC-004)
- [x] T018 After T017, add `scripts/ops/poker-bot-pool-refill.mjs`: current DB UTC 3h bucket only; per enabled pool policy FOR SHARE→pool serialization→ordered accounts, fresh balance and indexed cross-revision committed pool+bucket guard, then exactly one configured amount if below threshold. Use a `poker-pool-refill` key composed of the exact system key, policy revision and UTC bucket, with original payload on replay; policy edits/disable-reenable cannot reopen a consumed bucket. No-op can retry eligibility; old uncommitted buckets rejected, unknown commit recovered. Bounded tx timeout/recheck after locks, per-pool atomic outcomes, strict environment/ref authorization and dry-run default. No receipts/table-linked retention. (FR-011–014; SC-004)
- [x] T019 After T018, add `.github/workflows/poker-bot-pool-refill.yml` using `.github/workflows/chips-ledger-production-scheduled-automation.yml` actor/repo/ref/environment guards; workflow_dispatch only, GitHub-hosted Node job, reviewed ref, explicit target/mode, dry-run default, separate Production gate. Dispatch concurrency is defense in depth; DB pool/bucket identity is authority. No native cron or automatic runtime-triggered refill. Complete and pass the T016 refill-workflow cases in `tests/chips/chips-ledger-stage-automation.workflow.guard.test.mjs` against this artifact. (FR-014/020/021; SC-004)
- [x] T020 After T019, add `infra/vps/arcade-poker-pool-dispatch.sh`, `.service`, `.timer` reusing existing arcade-chips-ledger-dispatch pattern; extend `infra/vps/bootstrap.sh` only for future fresh/rebuilt VPS installation of disabled artifacts, never for an existing live VPS. In `specs/796-bot-quarantine/quickstart.md`, specify a separate owner-approved existing-host upgrade/install flow following `infra/vps/README.md` and `docs/chips-ledger-stage-automation.md`: read-only inventory and rollback manifest, targeted reviewed artifact installation, reload/verify without dispatch. Installation and activation are separate; neither code deploy nor installation automatically enables/starts the timer. Timer every3h dispatches intended repo/ref/target/mode with GitHub credentials only; no DB secrets/SQL, no automatic activation by installation. Missed ticks dispatch at most current bucket. Production install/enable/refill requires separate authorization. Complete and pass the T016 dispatcher/service/timer/fresh-bootstrap cases in `ws-tests/infra-vps-workflow.guard.test.mjs`; scope no-start/no-enable assertions to the new refill artifacts, preserving unrelated existing bootstrap behavior. (FR-014/020/021; SC-004)

**Checkpoint**: Worker locally validated and operational artifacts prepared; scheduler not activated by this plan.

## Phase 7: User Story 5 - Purpose-specific Admin controls (Priority: P2)

**Goal**: Authorized live tuning with audit and bounded cache propagation.

**Independent Test**: Backend authorization/validation/revision conflicts and resulting runtime cache behavior.

### Tests for User Story 5

- [x] T021 After T020, extend `tests/admin-endpoints.behavior.test.mjs`, `tests/admin-users-list.behavior.test.mjs` and `tests/admin-ops-summary.behavior.test.mjs` only for backend access/policy reads/writes: unauthorized zero mutation, enums/positive integers, stale revision conflict, authenticated actor/time, AUTO/FORCE_NORMAL/FORCE_SLOW/FORCE_RESTRICTED and pair-before-enable. Reuse T004 cache tests for threshold/override refresh; no Admin rendering tests. (FR-001/011/017/020; SC-005)

### Implementation for User Story 5

- [x] T022 After T021, add `netlify/functions/admin-user-poker-access.mjs` and `admin-poker-policy.mjs` using `_shared/admin-auth.mjs::requireAdminUser` and existing admin-bonus-campaigns handler patterns. Implement contract §6, row expectedRevision update, access/global/tier fields, exact pool balances via existing data path; integrate `admin-user-details.mjs::loadUserDetails`, `admin-users-list.mjs`, `admin-ops-summary.mjs::loadOpsSummary`. Preserve automatic state on override edits, policy FOR UPDATE serializes with refills, safe-integer balance/amount checks. Return saved revision and 30s propagation interval; klog audit, no generic framework or table-action audit misuse. (FR-001/002/011/017; SC-005)
- [x] T023 After T022, extend external `js/admin-page.js` Users/Ops controls for automatic/override/effective state, AUTO/FORCE_NORMAL/FORCE_SLOW/FORCE_RESTRICTED, SLOW threshold and per-tier enabled/four threshold+amount fields with audit/revision/conflict feedback. Reuse existing markup/styles; JSP/global JS and klog only, CSS selector per line if changed, CSP SHA in `netlify.toml`/existing function headers if an inline script is added. Verify presentation manually in future preview, no UI/glue suite. (FR-017/020; SC-005)

**Checkpoint**: Saved revisions converge under the declared cache bound; no deploy required for tuning.

## Phase 8: User Story 6 - Existing discovery with compatibility (Priority: P2)

**Goal**: WS live inventory and DB Quick Seat preserve architecture and resume.

**Independent Test**: slowOnly metadata, self access, class-compatible recommendation and stale final JOIN rejection.

### Tests for User Story 6

- [x] T024 After T023, extend `ws-server/poker/table/table-manager.behavior.test.mjs`, `ws-server/poker/handlers/join.behavior.test.mjs` and `tests/poker-quick-seat.behavior.test.mjs` for committed slowOnly projection, class-compatible fresh candidate, existing resume preference, constrained fallback, and stale recommendation denied by final JOIN. Test runtime/business contracts, not browser rendering or simple JSON glue. (FR-015/016/020; SC-006)

### Implementation for User Story 6

- [x] T025 After T024, extend `ws-server/server.mjs::buildLobbyTableEntry/syncLobbyTable/buildLobbySnapshotPayload` from existing `activeLobbyTablesById` with slowOnly and minimal authoritative `botCount`/lifecycle compatibility; send authenticated self-only `poker_access` on connection/cache refresh/confirmed transition. Update `poker/poker-ws-client.js` (the repository's realtime client; issue wording calls this `poker-realtime.js`) and `poker/poker.js::canViewLobbyTable` compatibility/unknown handling preserving own financed resume and filtering fresh RESTRICTED targets. No personalized table inventory, subscriber×table DB reads, SQL live-list replacement or other users' access disclosure. (FR-003/015/020; SC-006)
- [x] T026 After T025, extend `netlify/functions/poker-quick-seat.mjs::selectExistingActiveSeat/selectCandidate/recommendSeatAtTable/createAndRecommend`: resolve server effective class for fresh predicate, prefer valid existing participation, ordinary vs SLOW-only vs ordinary bot-free RESTRICTED filter, unchanged DB selection/response and shared limited Create fallback. Final JOIN remains authoritative for class/caps/progression; stale result can deny, no personalized WS offers or automatic bypass. Run T024 tests. (FR-005–008/016; SC-002/006)

**Checkpoint**: Both entry paths use compatibility without acquiring admission authority.

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Real concurrency proof, plan compliance and controlled future handoff.

- [x] T027 After T007/T010/T015/T018/T022/T026, add one `tests/chips/poker-pool-policy.transaction.test.mjs` using existing postgres/node:test with isolated local DB identity guard (reject Stage/Production), two connections and barriers without sleeps. Verify parallel Create/JOIN max4 each, fifth no artifacts/CH, pending→active, funded rejoin, actual settled transition concurrent Admin override, duplicate refill same pool/bucket across revisions, rollback/unknown commit. Verify final active/pending SQL query shape and EXPLAIN access paths on representative local PostgreSQL fixtures with many unrelated users/tables and current planner statistics: user_id-leading active, created_by-leading pending, five-row early bound, selective indexed EXISTS, no global seat/table scan. Record index definitions and plan evidence; if existing indexes suffice, document that proof rather than duplicate them. Also verify no per-hand policy reads via focused T004 assertions. No additional broad suites. Latest local disposable PostgreSQL run completed 6/6 with 0 skipped (including pre-migration capability/cutover regression) on a fresh test database; evidence is recorded in quickstart. (FR-001–014/017–020; SC-001–005)
- [x] T028 After T027, run focused commands in `specs/796-bot-quarantine/quickstart.md`, record evidence and review/refactor only touched plan/implementation for simplicity, breaking impacts, JSP/klog/CSP and no fallback/runtime MINT. Specify cutover pause of new admissions/funding, preserve payouts, provision missing exact pools at zero and policies, preserving existing pool balances, enable only after all writers/readers agree; rollback never restores old TREASURY fallback or class/limit bypass. Re-run Spec Kit consistency against live #1018; no generic cleanup. Focused implementation groups passed; the exact Vitest 12-failure set matches the base checkout and the full admin smoke has the same 16 origin/auth failures on base/current, while the feature-admin cases pass. (FR-020/021; SC-001–006)
- [x] T029 After T028, complete the historical **WS runtime gate**: exact runtime SHA `1d00fa2cd8b3110eb1967b5f577a3c671f5591e3` was verified by [WS Preview workflow run 36327260598](https://github.com/krzysztofcal/arcadePlatform/actions/runs/36327260598) with matching `RELEASE_SHA`/`DEPLOY_REF` and passing Preview health. Targeted smoke passed NORMAL/SLOW Create/JOIN, 4+4 rejection, funded rejoin, Admin/cache propagation, `slowOnly` lobby, DB Quick Seat, cash-out/payout, and the read-only `GET /internal/admin/poker-maintenance` CONTINUOUS_BOT status: HTTP 200, `ok:true`, `environment:"preview"`, repository status available, `desiredTableCount:5`, `supervisorStarted:true`, no active sweep and `lastError:null`. FORCE_NORMAL durable semantics and settled rollover without per-hand policy reads are covered by deterministic T004/T027 evidence; no natural automatic-SLOW Stage account, threshold mutation or ledger funding was used. This checkbox records only the historical WS Definition-of-Done gate. The final amendment has its own T036 runtime gate; T037 is the separate pre-merge Stage acceptance gate. Production migration/seed/refill/timer activation and merge remain separately unauthorized. (FR-021; SC-001–003/005/006)

## Phase 10 — Final live #1018 manual RESTRICTED amendment

These tasks are additive to T001–T029. T029 remains historical evidence for `1d00fa2c...`; T036 is the final amendment runtime gate and T037 is the pre-merge Stage acceptance gate.

- [x] T030 Synchronize `issue-source.md` to the exact live #1018 body updated `2026-09-27T17:10:33Z`, then update `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/bot-quarantine.md`, `quickstart.md` and relevant checklists. State explicitly that automatic class remains NORMAL/SLOW, overrides include AUTO/FORCE_NORMAL/FORCE_SLOW/FORCE_RESTRICTED, effective state may be RESTRICTED, and RESTRICTED has no automatic classifier, bankroll, refill policy, `is_restricted_only` marker or lifecycle. Preserve the accepted FORCE_NORMAL effective-only semantics and all T001–T029 history. (FR-001/003/004/010/015–019/021; SC-001/006/007)
- [x] T031 Add only `supabase/migrations/20260927110000_poker_force_restricted.sql` after the immutable 20260927100000 migration. Extend `chips_accounts_poker_access_override_chk` with `FORCE_RESTRICTED`; add no table/column/account/policy object. Extend `tests/chips/chips.migration.test.mjs`, `supabase/production-migrations/manifest.json`, `scripts/check-db-migrations.mjs` and `specs/004-production-retention/migration-inventory.md` so the exhaustive source inventory and `needs-production-equivalent` count are correct. Publishing this migration intentionally allows automatic DB Stage Apply; Production remains separately unauthorized. (FR-001/021; SC-007)
- [x] T032 Extend `shared/poker-domain/bot-access.mjs` and existing Admin paths `netlify/functions/admin-user-poker-access.mjs`, `admin-user-details.mjs`, `admin-users-list.mjs`, `js/admin-page.js` and WS access payload/cache normalization. Accept FORCE_RESTRICTED only through existing `requireAdmin`, optimistic revision, audit and cache propagation; automatic normalization still accepts only NORMAL/SLOW. Add deterministic tests for unauthorized rejection, automatic threshold persistence under FORCE_RESTRICTED, effective RESTRICTED and Return AUTO. Preserve JSP/global-script/klog rules. (FR-001/017/020; SC-001/005/007)
- [x] T033 Extend `shared/poker-domain/join.mjs::executePokerJoinAuthoritative`, `ws-server/poker/persistence/authoritative-join-adapter.mjs`, `netlify/functions/poker-progression.mjs` and `netlify/functions/poker-quick-seat.mjs`. Rejoin/resume is evaluated first and stays legal. Fresh RESTRICTED accepts only ordinary bot-free STANDARD, sets targetBotCount=0 and posts no bot funding; reject active/materialized bot funding, SLOW-only and CONTINUOUS_BOT before new buy-in. Reuse Create fallback and the shared 4+4 advisory lock; final JOIN remains authority. Add focused deterministic JOIN/Quick Seat tests. (FR-004–008/010/016/018/019; SC-001/002/006/007)
- [x] T034 Extend existing WS `buildLobbyTableEntry`/`lobby_snapshot` and `poker/poker.js::canViewLobbyTable` with minimal bot occupancy/lifecycle compatibility, preserving `rejoinableTableIds`. Extend `settledAccessStatus`, `classifySettledAccess`, `runSettledRolloverCommand`, `prepareSettledHandRollover` and `resolveSettledBotFundingSystemKey` so an effective RESTRICTED human permits legal settlement but creates no replacement/top-up/new seed. CONTINUOUS_BOT remains NORMAL; no per-hand policy read, eviction engine, escrow unwind or runtime MINT. Add focused lobby/table-manager/funding tests. (FR-003/010/015/019; SC-001/006/007)
- [x] T035 Run focused deterministic suites for access/Admin/JOIN/Quick Seat/lobby/table-manager/funding, the migration guard and relevant local PostgreSQL contracts; run `git diff --check` and a no-new-`console.log` review. Confirm pre-migration Production capability fixture, exact manifest/constraint guard, 4+4, no fallback/MINT, no new CSS/inline script/CSP impact and no broad UI/glue tests. Record evidence in `quickstart.md`; do not perform Stage refill/MINT or any operational activation. (FR-020/021; SC-001–007)
- [x] T036 **T036 PASS — owner retest accepted §25 single-owner deterministic WS mutation.** Admin override mutation is implemented as a single WS-owned operation: `Admin UI → Netlify Admin auth → one internal WS request → WS fail-close → one DB transaction → WS cache/socket update → release fail-close → exact ACK`. Netlify performs zero local DB writes and zero confirmation retries; WS owns runtime guard, single DB transaction with optimistic revision check, authoritative SLOW persistence, cache/socket broadcast, and fail-close cleanup. Verified by deterministic test suites and owner manual smoke (`AUTO → FORCE_RESTRICTED → immediately AUTO` with successive exact revisions and zero periodic-refresh delay). (FR-021; SC-001/003/005–007)

## Phase 11 — Corrective pre-merge amendment (§26, T047–T052)

These tasks resolve the two remaining P1 blockers from Issue #1018 (§26): transient unknown settled rollover retry and 100 CH continuous bot table controlled inactivity.

- [x] T047 In `ws-server/poker/runtime/settled-bot-funding.mjs`, split bot funding decisions into `decideSettledBotFunding()` with explicit `unknown` (missing/expired snapshot, unknown tier policy), `authoritative no-funding` (RESTRICTED, tier disabled, tier unprovisioned, invalid buy-in), and `allowed` (enabled + provisioned). Retain `resolveSettledBotFundingSystemKey(options)` wrapper. (FR-003/010/019; SC-001/003)
- [x] T048 In `ws-server/server.mjs::runSettledRolloverCommand()`, use `scheduleSettledRolloverRetry()` to retry on unknown access or funding snapshot without advancing state or calling `prepareSettledHandRollover(allowBotFunding: false)`. Authoritative no-funding retains `allowBotFunding: false` without endless retry. Standalone/guest paths avoid false retries. Add fundamental deterministic test for human + 2 busted bots retry and settlement rollover. (FR-003/010/019/021; SC-001/003/007)
- [x] T049 In `ws-server/poker/persistence/continuous-bot-table-repository.mjs`, check schema-backed tier 100 policy & provisioning in `reconcile()`. If disabled or unprovisioned, set controlled inactive state with `desiredCount = 0`, zero table creation, zero seed, graceful retirement of open tables. Fast fail defense in `createManagedTable()`. Add tests verifying zero churn. (FR-003/006/007/021; SC-001/002/007)
- [x] T050 Synchronize SpecKit documentation (`plan.md`, `tasks.md`, `quickstart.md`, `contracts/bot-quarantine.md`). Mark T036 complete and define Phase 11 (T047–T052). T037 remains the final pre-merge Stage acceptance gate. (FR-020/021; SC-001–007)
- [x] T051 Run focused behavioral tests, CI guards, push to PR branch, dispatch exact-SHA WS Preview Deploy, verify runtime health, and perform Stage read-only checks (tier 100 disabled, no supervisor seed errors, chips ledger unchanged). (FR-021; SC-001/007)
- [x] T052 Report and STOP before owner manual smoke T037. (FR-021; SC-001–007)

- [x] T037 **T037 PASS — final pre-merge Stage acceptance complete.** Stage-only NORMAL refill canary [36545904983](https://github.com/krzysztofcal/arcadePlatform/actions/runs/36545904983) passed on PR HEAD `4af8c80e2e73de05f1bfa3bab856df0b7ba4949f` (`POKER_BOT_REFILL_REVIEWED_REF == POKER_BOT_REFILL_CHECKED_SHA == DEPLOYED_COMMIT_SHA == 4af8c80e2e73de05f1bfa3bab856df0b7ba4949f`), returning `outcomes: [{"status":"no_op","poolKey":"POKER_BOT_BANKROLL"}]` with zero MINT and unchanged balance. Manual owner smoke passed on Stage table `a008c0a1-a85e-4727-b8e2-4d7f649191da` (500 CH STANDARD, owner `AUTO / NORMAL`): both bots busted simultaneously, rollover advanced `548 → 549`, two replacement bots funded at 500 CH each from `POKER_BOT_BANKROLL` (`ESCROW +500 / SYSTEM -500`), zero duplicate funding, and next hand `..._549_3` started and successfully reached settlement. Tier 100 remains disabled; Production migration, VPS timer activation and PR merge remain strictly separate unauthorized gates. (FR-011–014/020/021; SC-004–007)

## Phase 12 — Truthful Admin mutation vs refresh outcome contract (§26, T053–T058)

These tasks resolve the Admin UI issue where a mutation succeeds on the backend but subsequent read-only refresh fails or clobbers UI status, falsely displaying "Could not save/update" and risking duplicate mutations.

- [x] T053 Audit all Admin POST/PATCH handlers in `js/admin-page.js` to distinguish mutation outcome from best-effort refresh outcome.
- [x] T054 Update Admin mutation handlers in `js/admin-page.js` (`submitPokerAccessForm`, `submitPokerAccessPolicyForm`, `submitPokerTierPolicyForm`, `saveBonusCampaignDraft`, `setBonusCampaignStatus`, `submitAdjustForm`, `runTableAction`, `executeBotRecovery`, `runOpsAction`, `runPokerMaintenance`) so confirmed mutations are not overwritten by refresh failures; failed refresh displays a warning e.g. "Saved. Refresh failed — reload current state before another action." without automatic mutation retry. (FR-017/020; SC-005)
- [x] T055 Handle `stale_revision` on policy/access forms by silently reloading current state and prompting operator review before saving again, without automatic mutation replay. (FR-017/020; SC-005)
- [x] T056 Decouple `runPokerMaintenance` outcome from status refresh: confirmed mutation + failed refresh yields warning status with `pokerMaintenanceError = null`; timeout/unconfirmed yields warning with reloaded current status; cleanup phase failure messaging preserved. (FR-017/020; SC-005)
- [x] T057 Update Admin loaders (`loadOps`, `loadUserDetail`, `loadTableDetail`, `loadTables`, `loadBonusCampaigns`, `loadLedger`, `loadUsers`) to support silent / post-mutation mode (`{ silent: true }`) without wiping or clobbering active status messages, propagating errors to callers when silent. (FR-017/020; SC-005)
- [x] T058 Synchronize SpecKit documentation (`tasks.md`, `quickstart.md`), perform local verification (syntax check, `npm run ci:guards`, `npm run check:csp-inline`), push to PR branch, and confirm PR is ready for manual PR-deploy smoke. (FR-021; SC-005)

## Phase 13 — Pre-merge Production rollout preparation (§27, T075–T083)

These tasks prepare the complete Production rollout artifacts ahead of merge without performing any Production mutation, Production refill, tier enablement, or VPS activation.

- [x] T075 Author the dark/off Production-equivalent #1018 schema contract in `supabase/production-migrations/20260929201500_poker_bot_quarantine_production_contract.sql` (P1). Consolidate the 4 Stage migrations into one forward-only migration guarded by `chips.production_project_ref='otbqfijerkieoxwpxjnm'` and `pg_control_system().system_identifier='7575202818581710058'`. Require E1/E2 present and `POKER_BOT_BANKROLL` preserved; reject drifted schema; install #1018 schema dark/off with conservative access defaults `1_000_000_000 / 500 bps / 950,000,000`, 100/500 tiers disabled, missing pools at balance 0; record only P1 in schema_migrations. (FR-021; SC-007)
- [x] T076 Update `supabase/production-migrations/manifest.json`, `scripts/check-db-migrations.mjs`, and `specs/004-production-retention/migration-inventory.md`. Map the 4 Stage source migrations to P1 as their reviewed Production equivalent (`awaiting-production-go`). Add P1 sha256 and prerequisites to `replacement_migrations`. Refactor check script to validate production migrations directory against manifest replacements and require E1, E2, and P1. (FR-021; SC-007)
- [x] T077 Extend `tests/chips/chips.migration.test.mjs` with `assertProductionQuarantineContract`. Exercise real P1 SQL with test-local identity substitution only; prove wrong project/system identity fails before DDL; missing schema_migrations, missing prerequisite E1 or E2, pre-recorded P1 (drift), missing `POKER_BOT_BANKROLL`, or drifted schema fails closed before DDL with zero DDL committed; re-running P1 fails closed; baseline+E1+E2+P1 reaches expected catalog/constraint/index/RLS shape; disabled tier policies; conservative access policy values; existing USER defaults without financial mutation; `FORCE_RESTRICTED` in override CHECK; sticky `is_slow_only`; zero transactions/entries/tables; only P1 recorded. (FR-021; SC-007)
- [x] T078 Check in the exact post-merge cutover runbook in `specs/796-bot-quarantine/` (`issue-source.md`, `plan.md`, `tasks.md`, `quickstart.md`, `contracts/bot-quarantine.md`). Document the exact 15-step future Production cutover order and preserve all production prohibition gates. (FR-021; SC-007)
- [x] T079 Clarify existing-host VPS scheduler readiness in `infra/vps/README.md`. Document that bootstrap is never run on live VPS; targeted install copies only the 3 reviewed artifacts; units remain disabled initially; production env specifies target production and mode mutate; no DB credentials on VPS; timer activation is separate owner GO. (FR-021; SC-004)
- [x] T080 Define Production continuous-table restoration contract: target 2 tables (not Stage 5); buy-in 100 CH, blinds 1/2, target 3 bots; funded exclusively from `POKER_BOT_BANKROLL_100`; both 100 CH pools positive before enabling; supervisor convergence authoritative; failure path disables profile. (FR-006/007/021; SC-002)
- [x] T081 Enforce Caddy / runtime boundary: confirm zero changes to `ws-server/**`, `shared/**`, Netlify poker runtime, Caddy, or browser protocol; no new WS Preview Deploy required. (FR-021; SC-007)
- [x] T082 Run validation checks: `node scripts/check-db-migrations.mjs`, `npm run syntax`, `npm run ci:guards`, `npm run check:csp-inline`, `git diff --check`. Ensure full CI is green. (FR-021; SC-007)
- [x] T083 Report handoff evidence: P1 SHA256, PR HEAD, diff summary, test evidence, confirmation that Production baseline and live VPS remain untouched. (FR-021; SC-007)

## Phase 14 — Stage continuous inventory restoration (T084)

- [x] T084 Restore Stage continuous inventory before merge: execute owner-gated Stage refill canary exclusively for `SLOW / buy_in=100` (`POKER_BOT_SLOW_BANKROLL_100: 0 -> 2000 CH`); verify refill MINT read-only; restore `CONTINUOUS_BOT_DEFAULT` (enabled=true, desired=5); await supervisor convergence to 5 OPEN tables with 3 bots each funded exclusively from `POKER_BOT_BANKROLL_100`; collect ledger and table evidence. (FR-006/007/011–014/021; SC-002/004/007)

## Phase 15 — Full canonical tier catalog expansion & initial seed (§28, T085–T092)

- [x] T085 Implement single canonical tier catalog in `shared/poker-domain/table-economy.mjs` (`CANONICAL_POKER_BUY_IN_TIERS` = 11 tiers) and re-export in `shared/poker-domain/poker-progression.mjs` without duplication. Generalize `getBotFundingSystemKeyForBuyIn` to support all 11 tiers for explicit `poolClass` (NORMAL 500 = `POKER_BOT_BANKROLL`, other NORMAL = `POKER_BOT_BANKROLL_<buyIn>`, all SLOW = `POKER_BOT_SLOW_BANKROLL_<buyIn>`), while preserving legacy mapping for callers without `poolClass`. Define `CANONICAL_POKER_BOT_POOL_KEYS` (22 exact keys).
- [x] T086 Generalize ledger refill validation in `netlify/functions/_shared/chips-ledger.mjs` to dynamically accept all 22 exact pools. Extend `scripts/ops/poker-bot-pool-refill.mjs` to validate requested buy-in against canonical catalog, add owner-gated Production `initial-seed-all` mechanism (forbidden for dispatcher, requires production target, mutate mode, main ref, owner actor, checked SHA, production GO, and explicit confirmation matching SHA), query all policies when initialSeedAll is set, and allow seeding disabled pools via `allowDisabled: true` without enabling them.
- [x] T087 Update `ws-server/poker/persistence/persisted-state-writer.mjs` (`CONFIGURED_POKER_POOL_KEYS`), `netlify/functions/admin-poker-policy.mjs` (`POOL_KEYS`), and `netlify/functions/admin-ops-summary.mjs` to consume `CANONICAL_POKER_BOT_POOL_KEYS`.
- [x] T088 Author forward-only Stage migration `supabase/migrations/20260930075513_poker_bot_tier_catalog_expansion.sql` provisioning the 9 higher tiers (>500) disabled with dormant default thresholds/amounts and 18 zero-balance accounts. Zero MINT. Update Production P1 contract `supabase/production-migrations/20260929201500_poker_bot_quarantine_production_contract.sql` to provision all 11 tier policies disabled and all 22 pools (21 at 0 + preserved `POKER_BOT_BANKROLL`).
- [x] T089 Update `supabase/production-migrations/manifest.json` (missing_count=48, 20260930075513 mapped to P1, new P1 SHA256), `scripts/check-db-migrations.mjs` (48 missing entries, 27 needs-production-equivalent), and `specs/004-production-retention/migration-inventory.md`.
- [x] T090 Extend fundamental tests: `shared/poker-domain/poker-progression.behavior.test.mjs` (11 canonical tiers, pool keys, non-canonical rejection), `scripts/ops/poker-bot-pool-refill.behavior.test.mjs` (canonical buy-in filter, initial-seed-all authorization matrix, disabled tier execution), `tests/chips-ledger.test.mjs` (canonical max-tier 10M refill accepted, uncataloged pool rejected), and `tests/chips/chips.migration.test.mjs` (22 accounts, 11 policies, higher-tier drift check, 20260930075513 history gap).
- [ ] T091 Push to branch, await CI green and DB Stage Apply PR (`db-stage-apply-pr.yml`). Trigger WS Preview Deploy for new exact SHA, verify Preview health, and execute T091 smoke verification.
- [ ] T092 Final handoff: report final HEAD SHA, new P1 SHA256, Stage migration name, CI, exact-SHA Preview run, and read-only proof of 5 healthy Stage continuous tables.

## Dependencies & Execution Order

### Phase Dependencies

T001→T002→T003. US1 T004–T007→US2 T008–T010→US3 T011–T015→US4 T016–T020→US5 T021–T023→US6 T024–T026→T027→T028→T029→T030→T031→T032→T033→T034→T035→T036→Phase 11 (T047→T048→T049→T050→T051→T052)→T037→Phase 12 (T053→T054→T055→T056→T057→T058)→Phase 13 (T075→T076→T077→T078→T079→T080→T081→T082→T083)→Phase 14 (T084)→Phase 15 (T085→T086→T087→T088→T089→T090→T091→T092). Explicit prerequisites in each task are authoritative. T037 is the pre-merge Stage acceptance gate; Phase 12 completes the truthful Admin UI contract; Phase 13 prepares Production rollout artifacts; Phase 14 restores Stage continuous inventory; Phase 15 expands canonical tiers and initial seed. Production and VPS activation remain separate unauthorized gates.

### User Story Dependencies

US1 uses foundation and provisioned local fixtures. US2 composes with US1 JOIN; US3 uses class/marker; US4 refills already isolated pools; US5 exposes established policy contracts; US6 exposes established access/caps. Stories can be locally tested independently with fixtures, but the whole economic policy must be integrated before environment activation.

### Within Each User Story

Critical tests precede implementation; no broad TDD scaffolding. Confirm intended fundamental failures, implement, run focused checks. Existing packages/methods first; one new transaction suite only where two DB connections are necessary.

### Parallel Opportunities

No `[P]` edits scheduled because shared files dominate. Read-only review is safe concurrently after each phase: US1 threshold vs payout; US2 active vs pending traces; US3 source mapping vs historical returns; US4 timer configuration vs worker replay; US5 authorization vs manual control walkthrough; US6 WS inventory vs DB recommendation. These are review examples, not additional tasks or permission to execute environment actions.

## Implementation Strategy

### MVP First (User Story 1 Only)

Complete foundation and US1 and demonstrate classification/compatible play with controlled local pool fixtures. STOP and validate. This local slice does not authorize Production or partially protected live funding.

### Incremental Delivery

Add caps, isolated funding, scheduled refill, Admin and discovery in that order, testing each slice. Activate only the integrated policy after cutover review and target-specific verification; no mixed old/new writers.

### Notes

43 tasks: setup1, foundation2, US1=4, US2=3, US3=5, US4=5, US5=3, US6=3, cross-cutting3, final manual RESTRICTED amendment7, Phase 11 rollover/controlled-inactivity6, pre-merge Stage acceptance1, Phase 12 admin contract6. T001–T035 and Phase 11/12 are complete in this implementation worktree; T029 remains historical exact-SHA evidence, T036 is the final amendment WS Preview/runtime gate, and T037 is the pre-merge Stage acceptance gate. The Stage refill canary is **AUTHORIZED FOR PRE-MERGE STAGE ACCEPTANCE / RUN: NO-OP**; acceptance is complete (T037 PASS). The immutable original migration and the CHECK-only FORCE_RESTRICTED migration are both applied; Stage currently reports 99 applied / 0 pending. No Stage refill/MINT, Production operation, live-VPS scheduler activation or merge was performed.

## Requirement coverage index

The task references below make the complete FR/SC coverage explicit while keeping the phase descriptions concise.

| Requirement | Tasks |
| --- | --- |
| FR-001 | T002–T006, T021–T022, T030–T032 |
| FR-002 | T003–T006 |
| FR-003 | T003, T006–T007, T014, T025, T030, T034 |
| FR-004 | T002, T005–T007, T024–T026, T030, T033–T034 |
| FR-005 | T005, T010, T013, T026, T033 |
| FR-006 | T008–T010, T027 |
| FR-007 | T008–T010, T027 |
| FR-008 | T009–T010, T027 |
| FR-009 | T002–T003, T011–T013, T021–T022 |
| FR-010 | T011–T015, T030, T033–T034 |
| FR-011 | T002–T003, T016–T018, T021–T022 |
| FR-012 | T016, T018–T020, T027 |
| FR-013 | T002, T016–T019, T027 |
| FR-014 | T016, T019–T020 |
| FR-015 | T024–T025, T030, T034 |
| FR-016 | T024–T026, T033 |
| FR-017 | T003, T021–T023, T030–T032 |
| FR-018 | T004–T005, T008, T010 |
| FR-019 | T006–T007, T011, T013–T014, T030, T033–T034 |
| FR-020 | T004, T011, T016, T021, T023–T024, T027–T028, T030–T035 |
| FR-021 | T001–T002, T016, T019–T020, T028–T037 |
| SC-001 | T004–T007, T027–T029, T030–T037 |
| SC-002 | T008–T010, T027 |
| SC-003 | T011–T015, T027 |
| SC-004 | T016–T020, T027 |
| SC-005 | T004, T006, T021–T023, T027–T028, T030–T037 |
| SC-006 | T024–T026, T028–T029, T030–T037 |
| SC-007 | T030–T037 |

### T036 owner-found recovery regression fix — §25 single-owner deterministic WS mutation

Admin override mutation is implemented as a single WS-owned operation (§25 of #1018):
Admin UI → Netlify Admin auth → one internal WS request → WS fail-close → one DB transaction (`SELECT ... FOR UPDATE`, expectedRevision check, atomic row update, read policy, persist SLOW if applicable) → WS cache/socket update → release fail-close → exact ACK.

Netlify authenticates the admin and forwards the actor ID with zero local DB write, zero pre-invalidation, zero confirmation retries, and zero recovery polling. WS owns the runtime guard (`activePokerAccessMutations`), short-lived fail-close lifecycle, single DB transaction, authoritative cache and socket broadcast. Stale expectedRevision returns 409 stale_revision with zero DB update; truly concurrent requests return 409 poker_access_mutation_in_progress. Guard and fail-close are cleaned up in finally. The 25s periodic refresh and 30s cache TTL are decoupled from Admin Save correctness.

Tested with deterministic behavioral suites (`ws-server/poker/runtime/poker-access-propagation.behavior.test.mjs` and `tests/admin-endpoints.behavior.test.mjs`):
1. AUTO rev N → FORCE_RESTRICTED rev N+1 → immediately AUTO rev N+2 with zero periodic refresh delay.
2. Exactly one DB update per accepted Admin request.
3. Stale revision performs zero DB update and releases fail-close immediately.
4. DB transaction failure rolls back and cleans up guard and fail-closed state.
5. Two concurrent same-user mutations: second gets fast 409, third succeeds after first completes.
6. Runtime cache contains committed revision and override before success ACK.
7. FORCE_SLOW / Return AUTO preserves sticky is_slow_only.
8. Netlify PATCH executes exactly one WS call with zero DB write and zero retry.
9. WS timeout/network error results in zero replay mutation.
