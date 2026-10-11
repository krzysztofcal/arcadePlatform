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
- [x] **T004b / Dedicated create & request ID:** In `netlify/functions/_shared/poker-table-init.mjs`, persist `is_single_player`. In `netlify/functions/poker-quick-seat.mjs`, create fresh dedicated table for Single Player, support owner-only same-mode Resume, enforce buyIn <= 1000 CH, reject RESTRICTED early (403), and protect retries/double-clicks via `requestId` against `public.poker_requests`.
- [x] **T005 / Critical fail-fast gate:** In `shared/poker-domain/join.mjs::executePokerJoinAuthoritative()`, enforce RESTRICTED check, sole-owner, zero other humans, buyIn <= 1000 CH, and atomic bot funding rollback (fail closed if required bots cannot be funded). Propagate rejection codes in `ws-server/poker/persistence/authoritative-join-adapter.mjs` and `handlers/join.mjs`.
- [x] **T005b / Non-authoritative fail-closed:** In `ws-server/poker/handlers/join.mjs` and `ws-server/poker/table/table-manager.mjs`, fail-closed (`single_player_authoritative_required`) if Single Player join is attempted without authoritative check or when observe-only is enabled.
- [x] **T006 / Isolation & bootstrap:** Ensure `poker-quick-seat.mjs::selectCandidate()` and `ws-server/server.mjs::buildLobbyTableEntry()` exclude Single Player tables from public recommendation and lobby listings. Hydrate `is_single_player` on table manager bootstrap / restart.

---

## Phase 2 — Client & UI Activation

- [x] **T007 / UI:** Activate `poker/index.html` Single Player card and `poker/poker.js::initLobby()` with Play/Resume flows, buy-in tier selector (`<= 1000 CH`), guest guidance, 44px targets, `singlePlayRequestId` idempotency lifecycle, and error handling. Preserve Daily Bonus and other Coming Soon cards.

---

## Phase 3 — Fundamental Tests & Local Verification

- [x] **T008 / Fundamental tests:**
  - Quick Seat: dedicated tables, isolation, `requestId` idempotency deduplication, early RESTRICTED 403, deterministic multi-table resume.
  - Authoritative Join: fail-fast rejection of unauthorized humans, second humans, > 1000 CH buy-in, early RESTRICTED rejection, atomic bot rollback.
  - WS Server: non-authoritative join fail-closed, observe-only fail-closed, `tableManager.join()` human conflict guard, restart/bootstrap hydration.
- [x] **T009 / Verification:** Syntax (225 files), CSP inline hash check (55 files), and repository test suite execution (0 failures).

---

## Phase 4 — Review & Deployment Gates

- [x] **T010 / Code review package:** Prepare complete unified diff / patch against `origin/main` for owner code review.
- [ ] **T011 / Deployment gate:** Await owner GO before pushing migration or executing WS deploy / Stage operations.
- [ ] **T012 / Handoff:** Present diff, test results, phased rollout plan, and breaking impacts.
