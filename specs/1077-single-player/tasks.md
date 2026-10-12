# Tasks: Poker Single Player vs Bots (#1077)

**Source:** [spec.md](spec.md), [plan.md](plan.md), GitHub issue [#1077](https://github.com/krzysztofcal/arcadePlatform/issues/1077)
**Baseline:** AGY `e7fd0ce2`; current main integrated locally at `d45756dc`.
**State:** Final owner review accepted; GO covers Draft PR publication and automatic two-migration shared Stage apply. Latest main integrated; WS Preview/runtime, Production and merge gates remain.

---

## Phase 0 — Preflight & Architecture Decision

- [x] **T001 / Research:** Inspect `agents.md`, `skills.md`, issue #1077, PR #1084; map create/join/bootstrap/bot/retention paths, DB constraints, and existing test coverage.
- [x] **T002 / Architecture decision:** Completed investigation; owner approved minimal new boolean `is_single_player` with DB CHECK constraint (Variant B).
- [x] **T003 / SpecKit:** Update `specs/1077-single-player/{spec,plan,tasks}.md` documenting Variant B, dedicated tables, fail-fast join, 1000 CH cap, atomic bot funding rollback, and double-click protection.

---

## Phase 1 — Database & Backend Implementation (Local Only)

- [x] **T004a / Local migration:** Create `supabase/migrations/20261011200000_poker_single_player_table_flag.sql` adding `is_single_player boolean not null default false` and constraint requiring `lifecycle_kind = 'STANDARD'` and `created_by is not null` when true. (Publication and automatic Stage apply now explicitly authorized).
- [x] **T004b / Dedicated create & request ID:** In `netlify/functions/_shared/poker-table-init.mjs`, persist `is_single_player`. In `netlify/functions/poker-quick-seat.mjs`, create fresh dedicated table for Single Player, support owner-only Resume with explicit `tableId`, reject closed table replay with 409 `table_closed`, enforce buyIn <= 1000 CH, reject RESTRICTED early (403), and protect retries/double-clicks via mandatory `requestId` against `public.poker_requests`. Return active Single Player tables in `poker-progression.mjs`.
- [x] **T005 / Critical fail-fast gate:** In `shared/poker-domain/join.mjs::executePokerJoinAuthoritative()`, enforce early locked RESTRICTED check (`lock: true`), sole-owner, zero other humans, buyIn <= 1000 CH, and atomic bot funding rollback (fail closed if required bots cannot be funded). Propagate rejection codes in `ws-server/poker/persistence/authoritative-join-adapter.mjs` and `handlers/join.mjs`.
- [x] **T005b / Non-authoritative fail-closed:** In `ws-server/poker/handlers/join.mjs` and `ws-server/poker/table/table-manager.mjs`, fail-closed (`single_player_authoritative_required`) if Single Player join is attempted without authoritative check or when observe-only is enabled.
- [x] **T006 / Isolation & bootstrap:** Ensure `poker-quick-seat.mjs::selectCandidate()` and `ws-server/server.mjs::buildLobbyTableEntry()` exclude Single Player tables from public recommendation and lobby listings. Hydrate `is_single_player` on table manager bootstrap / restart.

---

## Phase 2 — Client & UI Activation

- [x] **T007 / UI:** Activate `poker/index.html` Single Player card and `poker/poker.js::initLobby()` with Play/Resume flows (including multi-table dropdown), buy-in tier selector (`<= 1000 CH`), guest guidance, 44px targets, `singlePlayRequestId` idempotency lifecycle, and readable error handling (including `joinErrorMessage` for `single_player_bot_funding_unavailable`). Preserve Daily Bonus and other Coming Soon cards.

---

## Phase 3 — Fundamental Tests & Local Verification

- [x] **T008 / Fundamental tests:**
  - Quick Seat: dedicated tables, isolation, `requestId` idempotency deduplication, early RESTRICTED 403, deterministic multi-table resume.
  - Authoritative Join: fail-fast rejection of unauthorized humans, second humans, > 1000 CH buy-in, early RESTRICTED rejection, atomic bot rollback.
  - WS Server: non-authoritative join fail-closed, observe-only fail-closed, `tableManager.join()` human conflict guard, restart/bootstrap hydration.
- [x] **T009 / Verification:** Current syntax (226 files), CSP inline hash check (55 documents), and repository local test runner (146 registered groups, exit 0). Migration validity passes isolated PGlite checks; repository migration manifest guard passes (111 source files, seven unchanged replacements).

---

## Phase 4 — Review & Deployment Gates

- [x] **T010 / Code review package:** Prepare complete unified diff / patch against `origin/main` for owner code review.
- [x] **T011a / Publication authorization:** Owner GO for push, Draft PR and automatic shared Stage application of exactly the two #1077 migrations.
- [x] **T011b / Stage evidence:** Earlier approved publication completed automatic Stage apply and read-only verification: 111 applied, zero pending, column/CHECK/index present, both reviewed hashes unchanged. No Stage access during the current local smoke amendment.
- [ ] **T011c / Runtime deployment gate:** Await separate GO for exact-SHA WS Preview, runtime verification, Production or merge.
- [x] **T012 / Handoff:** Record AGY commits, baseline, review findings, verification, remaining release gates and phased rollout in `handoff-review.md`.

## Phase 5 — VPS handoff review (2026-10-12)

- [x] **T013 / Recovery:** Import all six original AGY commits to arcadePlatform2; preserve source checkout, original target branch and backup of AGY HEAD. Integrate latest main without resetting or overwriting changes.
- [x] **T014 / Four requested findings:** Verify visible multi-table Resume, CLOSED intent rejection, V2 bot-funding error and early locked RESTRICTED check; preserve selected Resume table across re-render.
- [x] **T015 / Eligibility:** Use separate <=1000 CH Single Player eligibility in progression, Quick Seat, table access and authoritative JOIN. Extend existing fundamental tests for high bankroll, enabled tiers and NORMAL/SLOW admission.
- [x] **T016 / Replay and funding:** Replay intent before current tier validation; retain closed error on changed bankroll. Require at least two bots capacity permitting and cover monetary rollback after partial bot funding.
- [x] **T017 / Lock ordering:** Admin access mutation takes the existing user slot lock before account/table locks; propagation test verifies the order. Independent review confirms owner JOIN/rejoin serialization.
- [x] **T018 / Bounded intent contract:** Owner approved 24h timestamped start IDs with 5m future skew. API rejects expired/purged IDs, preserves retained CLOSED 409 and request/buy-in retry payload. Existing cleanup protects trusted intent rows for 24h5m; endpoint and isolated PGlite purge tests pass. Online and Resume are unchanged.
- [x] **T019 / Migration inventory:** Classify immutable additive migration as shared-safe with exact SHA-256; update 54/57 counters and 20/4/33 categories. Guard passes and rejects stale hashes, unclassified entries, incorrect categories/counters. No replacement or DB application.

## Phase 6 — Owner CHANGES REQUESTED review

- [x] **T020 / Request lookup:** EXPLAIN ANALYZE/BUFFERS on isolated PGlite (250,000 requests, 10,000 tables) confirms table-first scan; separate measured partial QUICK_SEAT user/request index changes it to direct request lookup. New immutable migration and repeat application validated locally; update manifest to 111 sources/54 baseline/57 missing, 20/4/33 categories, existing 7 replacements.
- [x] **T021 / Access and input regressions:** Single Player RESTRICTED denied before active-seat tableAccess rejoin success; explicit invalid Single Player tableId rejected before DB work; Online optional request IDs ignored. Existing endpoint tests failed before fixes and pass afterward; Online rejoin/legacy request shape coverage retained.
- [x] **T022 / Backend-owned capacity:** Remove Single Player resume-count admission cap; existing backend active/pending caps remain authoritative. Handle explicit cap responses and clear definitively rejected start intents; existing caps/replay tests and ad-hoc extracted real handler feedback check pass. No maintained UI tests.
- [x] **T023 / Small corrections:** Resume select min-height 44px; plan reflects minimum 2 bots bounded by maxPlayers-1.
- [x] **T024 / Review:** Separate read-only subagent reviewed all five fixes, isolation/economy/rollback/TTL/cleanup/Online; no remaining concrete code findings. Full runner (146 groups, exit 0), 296 focused tests, 226-file syntax, 55-document CSP and 111-migration guard pass; export final reviewed HEAD patch. Owner review and T011 remain pending.

## Phase 7 — Final owner P1/P2 review

- [x] **T025 / Unknown mode fail-closed:** Reproduce missing loader+notification with actual manager/handler; preserve nullable mode through runtime/bootstrap normalization; block unknown UUID non-authoritative/observe-only admission, retain trusted executor seat attachment and explicit known Online metadata. Existing WS tests cover zero admission/broadcast/autoplay effects, lost notification DB hydration and trusted notifier compatibility.
- [x] **T026 / Online tableId compatibility:** Validate/scope tableId only in Single Player. Existing endpoint test covers malformed, empty, null, wrong-type and valid foreign UUID fields ignored by Online; original seat selection is unscoped.
- [x] **T027 / Related lobby isolation:** Independent review found cached unknown UUID could pollute Online lobby; projection now excludes it until trusted metadata, verified through existing backend lobby test. No frontend or migration change.
- [x] **T028 / Final package:** Fresh npm runner (146 groups, exit 0), 328 focused tests, syntax (226 files), CSP (55 documents), migration guard (111 sources/seven replacements) pass; independent re-review has no remaining material findings. Small diff against 86c589b5 and full patch against current-main merge-base prepared. Owner review/deployment gate T011 remains pending.

- [x] **T029 / Main integration:** Merge `d45756dc` (#1093) without conflicts; separate read-only integration review passes.
- [x] **T030 / Stage publication preflight:** Canonical Stage identity verified, 109 applied / exactly two approved pending / no unknown versions; no competing migration PR; Netlify production branch `main` confirmed through read-only API.


## Phase 8 — Owner smoke regressions (local only)

- [x] **T031 / Total funded bots:** Count valid existing ACTIVE bots plus newly seeded bots; preserve authoritative stacks and forbid duplicate funding. Cover empty first admission, four existing bots, partial top-up, inconsistent/unfunded seats and actual funding SQL with isolated PGlite.
- [x] **T032 / Ended participation:** Table-locked guard refuses Single Player fresh paid re-entry after prior participation, before financial/seat changes. Keep first admission and free ACTIVE Resume, CLOSED denial and Online re-entry. Cover ACTIVE confirmation → finalized Leave → WS JOIN plus rollback on partial pool exhaustion.
- [x] **T033 / Resume feedback:** Expose stable ended error through Quick Seat, access preflight and authoritative adapter; discard stale lobby Resume, refresh progression, clear V2 auto-JOIN retries and remembered seat. No automatic New Game.
- [x] **T034 / Final local evidence:** Fresh npm test (146 groups), focused tests 258/258, full WS server 140/140 on Node 20, V2 live 157/157, syntax 226, CSP 55 and migration guard 111/seven pass. Separate read-only re-review has no P1/P2 findings; local report/commit and patch against `8839bf0b` prepared.
- [ ] **T035 / Repeat runtime gate:** Await owner review and separate GO for publication and exact-new-SHA WS Preview; repeat manual smoke before considering readiness. No Stage/ledger operations or deployment in this amendment.


## Final P2 owner review (local only)

- [x] **T036 / Exact existing-bot funding:** Require authoritative buy-in amount in the existing receipt query; isolated PGlite rejects balanced -1/+1 funding at buy-in 100 while preserving valid seed/replacement receipts.
- [x] **T037 / Definitive reconnect refusal:** Do not restore remembered seat after ended participation; deterministic V2 test checks cleared seat, disabled auto-JOIN and no retry while retaining transient-error seat memory.
- [x] **T038 / P2 local package:** Focused domain/PGlite/V2 237/237, npm 146 groups, syntax 226, CSP 55 and migration guard 111/seven pass; separate read-only review has no P1/P2 findings; small patch against `c8c27901` prepared. No publication, Stage/ledger access or deployment; T035 remains pending.


## Deferred Leave Resume amendment (local only)

- [x] **T039 / Resume eligibility:** Exclude Single Player owner marked left from listing; Quick Seat/access and table-locked authoritative JOIN reject before ACTIVE rejoin, without touching stack, seat or financial transfers.
- [x] **T040 / Local regression package:** Fundamental JOIN/Leave/API/PGlite tests 92/92, npm 146 groups, syntax 226, CSP 55, migration guard 111/seven PASS; separate read-only review has no P1/P2 findings; local patch against `f37f9001` prepared. No push/Stage/ledger/deployment authorization; repeat runtime gate remains pending.
