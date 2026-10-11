# Tasks: Poker Single Player vs Bots (#1077)

**Source:** [spec.md](spec.md), [plan.md](plan.md), GitHub issue [#1077](https://github.com/krzysztofcal/arcadePlatform/issues/1077)  
**Baseline:** `main` (`97f8b8e5`)  
**State:** Owner approved Variant B. Local implementation in progress. No migrations pushed to remote.

---

## Phase 0 — Preflight & Architecture Decision

- [x] **T001 / Research:** Inspect `agents.md`, `skills.md`, issue #1077, PR #1084; map create/join/bootstrap/bot/retention paths, DB constraints, and existing test coverage.
- [x] **T002 / Architecture decision:** Completed investigation; owner approved minimal new boolean `is_single_player` with DB CHECK constraint (Variant B).
- [x] **T003 / SpecKit:** Update `specs/1077-single-player/{spec,plan,tasks}.md` documenting Variant B, dedicated tables, fail-fast join, 1000 CH cap, atomic bot funding rollback, and double-click protection.

---

## Phase 1 — Database & Backend Implementation (Local Only)

- [x] **T004a / Local migration:** Create `supabase/migrations/20261011200000_poker_single_player_table_flag.sql` adding `is_single_player boolean not null default false` and constraint requiring `lifecycle_kind = 'STANDARD'` and `created_by is not null` when true. (Keep local, do not push).
- [x] **T004b / Dedicated create:** In `netlify/functions/_shared/poker-table-init.mjs`, persist `is_single_player`. In `netlify/functions/poker-quick-seat.mjs`, create fresh dedicated table for Single Player, support owner-only same-mode Resume, enforce buyIn <= 1000 CH, and protect retries/double-clicks from duplicate tables.
- [x] **T005 / Critical fail-fast gate:** In `shared/poker-domain/join.mjs::executePokerJoinAuthoritative()`, enforce sole-owner, zero other humans, buyIn <= 1000 CH, and atomic bot funding rollback (fail closed if required bots cannot be funded). Propagate rejection codes in `ws-server/poker/persistence/authoritative-join-adapter.mjs` and `handlers/join.mjs`.
- [x] **T006 / Isolation:** Ensure `poker-quick-seat.mjs::selectCandidate()` and `ws-server/server.mjs::buildLobbyTableEntry()` exclude Single Player tables from public recommendation and lobby listings.

---

## Phase 2 — Client & UI Activation

- [x] **T007 / UI:** Activate `poker/index.html` Single Player card and `poker/poker.js::initLobby()` with Play/Resume flows, buy-in tier selector (`<= 1000 CH`), guest guidance, 44px targets, and error handling. Preserve Daily Bonus and other Coming Soon cards.

---

## Phase 3 — Fundamental Tests & Local Verification

- [x] **T008 / Fundamental tests:** Extend `tests/poker-quick-seat.behavior.test.mjs` and `shared/poker-domain/join.behavior.test.mjs`:
  - Distinct users create distinct dedicated Single Player tables.
  - Fail-fast rejection of unauthorized human with zero seat/debit/state effect.
  - Fail-fast rejection of table containing another human.
  - Atomic rollback when bot funding fails (zero human debit, zero seat).
  - Enforce buyIn <= 1000 CH on create and authoritative join.
  - Normal Poker Online never selects Single Player tables.
  - Double-click / retry reuses pending table.
  - Owner reconnect to own table succeeds without second debit.
- [x] **T009 / Verification:** Syntax, CSP inline hash check, and test suite execution.

---

## Phase 4 — Review & Deployment Gates

- [ ] **T010 / Deployment gate:** Await owner GO before pushing migration or executing WS deploy / Stage operations.
- [ ] **T011 / Handoff:** Present diff, test results, and breaking impacts.
