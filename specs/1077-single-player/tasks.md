# Tasks: Poker Single Player vs Bots (#1077)

**Source:** [spec.md](spec.md), [plan.md](plan.md), GitHub issue [#1077](https://github.com/krzysztofcal/arcadePlatform/issues/1077)
**Baseline:** AGY `e7fd0ce2`; current main integrated locally at `8f691d65`.
**State:** AGY handoff recovered and reviewed locally; two release gates remain. No push, PR, Stage writes or deployment.

---

## Phase 0 — Preflight & Architecture Decision

- [x] **T001 / Research:** Inspect `agents.md`, `skills.md`, issue #1077, PR #1084; map create/join/bootstrap/bot/retention paths, DB constraints, and existing test coverage.
- [x] **T002 / Architecture decision:** Completed investigation; owner approved minimal new boolean `is_single_player` with DB CHECK constraint (Variant B).
- [x] **T003 / SpecKit:** Update `specs/1077-single-player/{spec,plan,tasks}.md` documenting Variant B, dedicated tables, fail-fast join, 1000 CH cap, atomic bot funding rollback, and double-click protection.

---

## Phase 1 — Database & Backend Implementation (Local Only)

- [x] **T004a / Local migration:** Create `supabase/migrations/20261011200000_poker_single_player_table_flag.sql` adding `is_single_player boolean not null default false` and constraint requiring `lifecycle_kind = 'STANDARD'` and `created_by is not null` when true. (Keep local, do not push).
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
- [x] **T009 / Verification:** Current syntax (226 files), CSP inline hash check (55 documents), and repository local test runner (146 registered groups, exit 0). Migration validity passes isolated PGlite checks; repository migration manifest guard fails (T019).

---

## Phase 4 — Review & Deployment Gates

- [x] **T010 / Code review package:** Prepare complete unified diff / patch against `origin/main` for owner code review.
- [ ] **T011 / Deployment gate:** Await owner GO before pushing migration or executing WS deploy / Stage operations.
- [x] **T012 / Handoff:** Record AGY commits, baseline, review findings, verification, remaining release gates and phased rollout in `handoff-review.md`.

## Phase 5 — VPS handoff review (2026-10-12)

- [x] **T013 / Recovery:** Import all six original AGY commits to arcadePlatform2; preserve source checkout, original target branch and backup of AGY HEAD. Integrate latest main without resetting or overwriting changes.
- [x] **T014 / Four requested findings:** Verify visible multi-table Resume, CLOSED intent rejection, V2 bot-funding error and early locked RESTRICTED check; preserve selected Resume table across re-render.
- [x] **T015 / Eligibility:** Use separate <=1000 CH Single Player eligibility in progression, Quick Seat, table access and authoritative JOIN. Extend existing fundamental tests for high bankroll, enabled tiers and NORMAL/SLOW admission.
- [x] **T016 / Replay and funding:** Replay intent before current tier validation; retain closed error on changed bankroll. Require at least two bots capacity permitting and cover monetary rollback after partial bot funding.
- [x] **T017 / Lock ordering:** Admin access mutation takes the existing user slot lock before account/table locks; propagation test verifies the order. Independent review confirms owner JOIN/rejoin serialization.
- [ ] **T018 / Post-purge intent contract:** Owner decision pending on permanent durable request identity versus deduplication bounded by retained tables. Current cascade behavior is a known limitation, not a completed permanent guarantee.
- [ ] **T019 / Migration release compatibility:** Resolve Production manifest guard rejecting the added local migration through a separately reviewed minimal manifest/guard change. Do not add Production migration copies or apply Stage implicitly.
