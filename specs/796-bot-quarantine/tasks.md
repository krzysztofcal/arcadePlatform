# Tasks: NORMAL/SLOW periodic per-tier pools

**Input**: Design documents from `/specs/796-bot-quarantine/`.

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/bot-quarantine.md](contracts/bot-quarantine.md).

**Tests**: Only requested fundamental deterministic backend/runtime/transaction tests. No UI/CSS/JSP/glue suites or new test framework.

**Organization**: User-story phases follow the active Spec Kit template. T001–T029 are implemented and locally verified in this worktree; T029 is the separate exact-SHA WS Preview/runtime gate recorded in `quickstart.md`. The conditional Stage refill canary is separately authorized and remains unrun. Latest live #1018 supersedes the old 19-task farmer-only plan.

## Format: `[ID] [P?] [Story] Description`

`[P]` means separate files and no dependency on another incomplete task at that checkpoint. Paths are repository-relative. Story labels map to spec. Shared financial/runtime files require the explicit order below, not speculative parallel edits.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm requirements and implementation authority, not generic project setup.

- [x] T001 Record accepted independent review, selection of #1018 instead of #869, no drift from live issue, and separate explicit implementation instruction in `specs/796-bot-quarantine/quickstart.md`. Reconfirm periodic 3h per-tier NORMAL/SLOW policy, 4+4 limits and accepted Sybil risk. Before any future migration PR publication, declare intended shared Stage mutation via DB Stage Apply PR and applied forward-only rule; Production remains separate GO. No ignore/tooling/dependency cleanup. (FR-021)

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Minimal persistence/policy contracts; blocks all stories.

- [x] T002 After T001, add additive files under `supabase/migrations/` for `data-model.md` §§1–5 and extend `tests/chips/chips.migration.test.mjs`. USER fields: automatic NOT NULL NORMAL/SLOW default NORMAL, override NOT NULL AUTO/FORCE_NORMAL/FORCE_SLOW default AUTO, positive monotonic revision, nullable first-SLOW timestamp and actor/time audit. `poker_tables.is_slow_only boolean NOT NULL DEFAULT false`, enforce false→true only. Access policy `id=1`, slow_threshold_ch 1..9007199254740991 initially 1000000000, positive revision initially 1. Tier policy buy_in positive safe integer PK; enabled NOT NULL default false; four threshold/amount fields positive safe integers; revision/updated_at/updated_by. Provision only missing exact 100/500 NORMAL+SLOW SYSTEM accounts at zero. Preserve every existing pool account ID, balance and provenance, especially the existing 500 POKER_BOT_BANKROLL; never zero/reset it. No MINT or historical relabel. Enable RLS on new public policies, no anon/authenticated read/write access; backend-only access/marker writes. Add narrow typed pool+bucket unique index on existing `chips_transactions` metadata, no receipt table; provide required narrow user_id-leading poker_seats active-membership and created_by-leading poker_tables pending-owner indexes/access paths matched to final status/participation predicates; no broad index. The reviewed table-leading (table_id,user_id) uniqueness is insufficient. Reuse an adequate existing index only with documented final SQL/index/EXPLAIN evidence rather than a duplicate; T027 proves both paths locally. Declare shared Stage effect before publishing, never edit applied migrations. (FR-001/004/006–009/011/013/021)
- [x] T003 After T002, add small `shared/poker-domain/bot-access.mjs` sharing threshold/override/effective-class validation and policy loaders with existing `poker-progression.mjs` balance validation; define trusted snapshot revision/freshness contract and enabled exact tier/pair mapping inputs. Missing/invalid !=NORMAL; positive safe integers and monotonic revisions, no env/client bypass. No per-hand loader calls, global scans, generic config framework or pool auto-creation. (FR-001–003/009/011/017)

**Checkpoint**: Foundation ready for independently testable stories; no environment activation.

## Phase 3: User Story 1 - Appropriate class and uninterrupted play (Priority: P1)

**Goal**: JOIN/settled classification, safe owner promotion and sticky metadata without breaking legal participation.

**Independent Test**: Wallet/settled threshold−1/=threshold, overrides, denied JOIN, unknown cache and leave/rejoin with provisioned local pools.

### Tests for User Story 1

- [x] T004 After T003, extend `shared/poker-domain/join.behavior.test.mjs`, `ws-server/poker/table/table-manager.behavior.test.mjs` and `shared/poker-domain/leave.behavior.test.mjs`: sticky wallet/settled SLOW, the full sequence AUTO/NORMAL→FORCE_NORMAL→wallet or settled stack reaches threshold→durable automatic SLOW while effective NORMAL→Return to AUTO→effective SLOW immediately without another threshold check (exercise both authoritative evidence paths), known-SLOW vs UNKNOWN marker, safe owned empty promotion only, denial without human marker/seat/debit, mixed financed rejoin/payout and restart. Assert below-threshold settled path calls zero policy/account/override/tier-policy reads and zero classification writes; changed revision applied after background refresh, expired/failed cache cannot authorize funding. Fundamental cases only. (FR-001–005/018–020; SC-001/005)

### Implementation for User Story 1

- [x] T005 After T004, extend `shared/poker-domain/join.mjs::executePokerJoinAuthoritative` and `ws-server/poker/persistence/authoritative-join-adapter.mjs`: authoritative wallet threshold before buy-in including automatic SLOW persistence under FORCE_NORMAL, effective override only after automatic classification, durable transition survives structured policy denial, financed rejoin preserved. Locked SLOW owner promotion requires STANDARD/OPEN empty state/no seats/no prior bot funding; promotion commits only with accepted fresh admission. Set `has_human_participant` only in accepted admission/rejoin branches. No Create classifier or runtime MINT. (FR-001/002/004/005/018; SC-001)
- [x] T006 After T005, extend `ws-server/server.mjs::runSettledRolloverCommand` and `ws-server/poker/table/table-manager.mjs::prepareSettledHandRollover/commitSettledHandRollover`, with `persisted-state-writer.mjs::writeViaDb`, for authoritative settled-stack comparison before next funding plan. Server owns one ≤30s bounded refresh of policy/tier policy plus connected/still-seated access IDs, max age 30s; hydrate JOIN/reconnect, update after confirmed local commit, never refresh from each hand. Persist actual transition/marker in existing transaction/version flow, reconcile revision only on real change, preserve concurrent override without suppressing the automatic transition; FORCE_NORMAL keeps only effective NORMAL and never resets sticky marker. Return to AUTO derives stored automatic SLOW without a new threshold check. Commit/restore only after persistence; unknown rollback/recovery prevents new funding without blocking legal settlement. No second settlement flow or wealth aggregation. (FR-002–004/019; SC-001/005)
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

- [x] T021 After T020, extend `tests/admin-endpoints.behavior.test.mjs`, `tests/admin-users-list.behavior.test.mjs` and `tests/admin-ops-summary.behavior.test.mjs` only for backend access/policy reads/writes: unauthorized zero mutation, enums/positive integers, stale revision conflict, authenticated actor/time, FORCE_NORMAL/FORCE_SLOW/AUTO and pair-before-enable. Reuse T004 cache tests for threshold/override refresh; no Admin rendering tests. (FR-001/011/017/020; SC-005)

### Implementation for User Story 5

- [x] T022 After T021, add `netlify/functions/admin-user-poker-access.mjs` and `admin-poker-policy.mjs` using `_shared/admin-auth.mjs::requireAdminUser` and existing admin-bonus-campaigns handler patterns. Implement contract §6, row expectedRevision update, access/global/tier fields, exact pool balances via existing data path; integrate `admin-user-details.mjs::loadUserDetails`, `admin-users-list.mjs`, `admin-ops-summary.mjs::loadOpsSummary`. Preserve automatic state on override edits, policy FOR UPDATE serializes with refills, safe-integer balance/amount checks. Return saved revision and 30s propagation interval; klog audit, no generic framework or table-action audit misuse. (FR-001/002/011/017; SC-005)
- [x] T023 After T022, extend external `js/admin-page.js` Users/Ops controls for automatic/override/effective class, Force NORMAL/Force SLOW/AUTO, SLOW threshold and per-tier enabled/four threshold+amount fields with audit/revision/conflict feedback. Reuse existing markup/styles; JSP/global JS and klog only, CSS selector per line if changed, CSP SHA in `netlify.toml`/existing function headers if an inline script is added. Verify presentation manually in future preview, no UI/glue suite. (FR-017/020; SC-005)

**Checkpoint**: Saved revisions converge under the declared cache bound; no deploy required for tuning.

## Phase 8: User Story 6 - Existing discovery with compatibility (Priority: P2)

**Goal**: WS live inventory and DB Quick Seat preserve architecture and resume.

**Independent Test**: slowOnly metadata, self access, class-compatible recommendation and stale final JOIN rejection.

### Tests for User Story 6

- [x] T024 After T023, extend `ws-server/poker/table/table-manager.behavior.test.mjs`, `ws-server/poker/handlers/join.behavior.test.mjs` and `tests/poker-quick-seat.behavior.test.mjs` for committed slowOnly projection, class-compatible fresh candidate, existing resume preference, constrained fallback, and stale recommendation denied by final JOIN. Test runtime/business contracts, not browser rendering or simple JSON glue. (FR-015/016/020; SC-006)

### Implementation for User Story 6

- [x] T025 After T024, extend `ws-server/server.mjs::buildLobbyTableEntry/syncLobbyTable/buildLobbySnapshotPayload` from existing `activeLobbyTablesById` with slowOnly; send authenticated self-only `poker_access` on connection/cache refresh/confirmed transition. Update `poker/poker-ws-client.js` (the repository's realtime client; issue wording calls this `poker-realtime.js`) and `poker/poker.js::canViewLobbyTable` compatibility/unknown handling preserving own financed resume. No personalized table inventory, subscriber×table DB reads, SQL live-list replacement or other users' access disclosure. (FR-003/015/020; SC-006)
- [x] T026 After T025, extend `netlify/functions/poker-quick-seat.mjs::selectExistingActiveSeat/selectCandidate/recommendSeatAtTable/createAndRecommend`: resolve server effective class for fresh predicate, prefer valid existing participation, ordinary vs SLOW-only filter, unchanged DB selection/response and shared limited Create fallback. Final JOIN remains authoritative for class/caps/progression; stale result can deny, no personalized WS offers or automatic bypass. Run T024 tests. (FR-005–008/016; SC-002/006)

**Checkpoint**: Both entry paths use compatibility without acquiring admission authority.

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Real concurrency proof, plan compliance and controlled future handoff.

- [x] T027 After T007/T010/T015/T018/T022/T026, add one `tests/chips/poker-pool-policy.transaction.test.mjs` using existing postgres/node:test with isolated local DB identity guard (reject Stage/Production), two connections and barriers without sleeps. Verify parallel Create/JOIN max4 each, fifth no artifacts/CH, pending→active, funded rejoin, actual settled transition concurrent Admin override, duplicate refill same pool/bucket across revisions, rollback/unknown commit. Verify final active/pending SQL query shape and EXPLAIN access paths on representative local PostgreSQL fixtures with many unrelated users/tables and current planner statistics: user_id-leading active, created_by-leading pending, five-row early bound, selective indexed EXISTS, no global seat/table scan. Record index definitions and plan evidence; if existing indexes suffice, document that proof rather than duplicate them. Also verify no per-hand policy reads via focused T004 assertions. No additional broad suites. Latest local disposable PostgreSQL run completed 6/6 with 0 skipped (including pre-migration capability/cutover regression) on a fresh test database; evidence is recorded in quickstart. (FR-001–014/017–020; SC-001–005)
- [x] T028 After T027, run focused commands in `specs/796-bot-quarantine/quickstart.md`, record evidence and review/refactor only touched plan/implementation for simplicity, breaking impacts, JSP/klog/CSP and no fallback/runtime MINT. Specify cutover pause of new admissions/funding, preserve payouts, provision missing exact pools at zero and policies, preserving existing pool balances, enable only after all writers/readers agree; rollback never restores old TREASURY fallback or class/limit bypass. Re-run Spec Kit consistency against live #1018; no generic cleanup. Focused implementation groups passed; the exact Vitest 12-failure set matches the base checkout and the full admin smoke has the same 16 origin/auth failures on base/current, while the feature-admin cases pass. (FR-020/021; SC-001–006)
- [x] T029 After T028, complete the future **WS runtime gate**: exact runtime SHA `1d00fa2cd8b3110eb1967b5f577a3c671f5591e3` was verified by [WS Preview workflow run 36327260598](https://github.com/krzysztofcal/arcadePlatform/actions/runs/36327260598) with matching `RELEASE_SHA`/`DEPLOY_REF` and passing Preview health. Targeted smoke passed NORMAL/SLOW Create/JOIN, 4+4 rejection, funded rejoin, Admin/cache propagation, `slowOnly` lobby, DB Quick Seat, cash-out/payout, and the read-only `GET /internal/admin/poker-maintenance` CONTINUOUS_BOT status: HTTP 200, `ok:true`, `environment:"preview"`, repository status available, `desiredTableCount:5`, `supervisorStarted:true`, no active sweep and `lastError:null`. FORCE_NORMAL durable semantics and settled rollover without per-hand policy reads are covered by deterministic T004/T027 evidence; no natural automatic-SLOW Stage account, threshold mutation or ledger funding was used. This checkbox records only the WS Definition-of-Done gate. Track **Stage refill canary separately** in quickstart: it remains conditional operational validation with real Stage ledger MINT via `.github/workflows/poker-bot-pool-refill.yml`, only after separate explicit user authorization; status is `NOT AUTHORIZED / NOT RUN`. Production migration/seed/refill/timer activation and merge remain separately unauthorized. (FR-021; SC-001–003/005/006)

## Dependencies & Execution Order

### Phase Dependencies

T001→T002→T003. US1 T004–T007→US2 T008–T010→US3 T011–T015→US4 T016–T020→US5 T021–T023→US6 T024–T026→T027→T028→T029. This conservative order avoids overlapping JOIN, writer, server, ledger and Admin changes. Explicit prerequisites in each task are authoritative. The conditional Stage MINT canary noted in T029 is not part of the WS gate dependency chain or checkbox; its authorization/evidence status is recorded independently.

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

29 tasks: setup1, foundation2, US1=4, US2=3, US3=5, US4=5, US5=3, US6=3, cross-cutting3. T001–T029 are complete in this implementation worktree; T029 exact-SHA WS Preview/runtime evidence is recorded in `quickstart.md`. The conditional Stage refill canary remains a separate authorization gate and is `NOT AUTHORIZED / NOT RUN`. The fixed 19-task count from the earlier cleanup request is superseded by this full rewrite against current live #1018. Automatic DB Stage Apply PR applied the immutable migration to shared Stage (97→98; follow-up 98/0; smoke PASS). No Stage refill/MINT, Production operation, live-VPS scheduler activation or merge was performed; the only runtime deployment evidence is the accepted exact-SHA WS Preview run already recorded for T029.

## Requirement coverage index

The task references below make the complete FR/SC coverage explicit while keeping the phase descriptions concise.

| Requirement | Tasks |
| --- | --- |
| FR-001 | T002–T006, T021–T022 |
| FR-002 | T003–T006 |
| FR-003 | T003, T006–T007, T014, T025 |
| FR-004 | T002, T005–T007, T024–T026 |
| FR-005 | T005, T010, T013, T026 |
| FR-006 | T008–T010, T027 |
| FR-007 | T008–T010, T027 |
| FR-008 | T009–T010, T027 |
| FR-009 | T002–T003, T011–T013, T021–T022 |
| FR-010 | T011–T015 |
| FR-011 | T002–T003, T016–T018, T021–T022 |
| FR-012 | T016, T018–T020, T027 |
| FR-013 | T002, T016–T019, T027 |
| FR-014 | T016, T019–T020 |
| FR-015 | T024–T025 |
| FR-016 | T024–T026 |
| FR-017 | T003, T021–T023 |
| FR-018 | T004–T005, T008, T010 |
| FR-019 | T006–T007, T011, T013–T014 |
| FR-020 | T004, T011, T016, T021, T023–T024, T027–T028 |
| FR-021 | T001–T002, T016, T019–T020, T028–T029 |
| SC-001 | T004–T007, T027–T029 |
| SC-002 | T008–T010, T027 |
| SC-003 | T011–T015, T027 |
| SC-004 | T016–T020, T027 |
| SC-005 | T004, T006, T021–T023, T027–T028 |
| SC-006 | T024–T026, T028–T029 |
