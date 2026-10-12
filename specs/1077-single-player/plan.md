# Implementation Plan: Poker Single Player vs Bots (#1077)

**Source:** [spec.md](spec.md), GitHub issue [#1077](https://github.com/krzysztofcal/arcadePlatform/issues/1077)
**Baseline:** AGY started on `e7fd0ce2`; handoff integrates current `main` `8f691d65` (2026-10-12).
**Status:** Implementation and review fixes remain local. Runtime tests, syntax and CSP pass; permanent post-purge request identity and migration-manifest compatibility remain open. No runtime deployment evidence or Stage writes.

---

## 1. Minimal Migration Implementation (Local Only)

### Handoff review amendment (2026-10-12)

- Preserve all six AGY commits through `d29736dc`; integrate current main `8f691d65` locally, preserving #1090 Welcome claim behavior.
- Verify the four requested findings already addressed by AGY's final commit; keep existing Resume, closed replay, funding error and access row lock paths.
- In `shared/poker-domain/poker-progression.mjs`, add opt-in Single Player eligibility before Online's highest-two tier window. Reuse in Quick Seat, progression response/table access and authoritative JOIN; expose `singlePlayerAvailableBuyIns` to the lobby. Online keeps its current window.
- Move Quick Seat request replay ahead of current tier eligibility, preserving RESTRICTED denial and changed-buy-in rejection.
- Enforce at least two configured funded bots (clamped by table capacity) only for Single Player; preserve existing bot maximum/pool rules. Extend existing successful NORMAL/SLOW and partial-funding tests.
- Serialize administrative access overrides with JOIN using `shared/poker-domain/table-participation.mjs::lockUserTableSlots()` before account/table row locks; extend the existing propagation test.
- Preserve selected Resume table through lobby re-render and add unique table ID as final ordering tie-breaker.
- Audit physical-purge idempotency separately: current request rows cascade with table deletion. Durable identity beyond retention requires owner contract clarification; do not introduce an independent idempotency subsystem silently.
- Verification: existing focused domain/endpoint/WS tests, existing full local runner, syntax, CSP and local SQL migration checks. No push, PR, Stage writes or deploys.

Add forward-only migration `supabase/migrations/20261011200000_poker_single_player_table_flag.sql`:
- `alter table public.poker_tables add column if not exists is_single_player boolean not null default false;`
- Constraint: `check ((is_single_player is false) or (is_single_player is true and lifecycle_kind = 'STANDARD' and created_by is not null))`
- No partial index by default.
- Keep migration local; do not push without owner authorization for Stage apply.

---

## 2. Backend & Domain Touchpoints

### 2.1 Table Initialization (`netlify/functions/_shared/poker-table-init.mjs`)
- `createPokerTableWithState(tx, { ..., isSinglePlayer = false })`:
  - Include `is_single_player` in SQL INSERT statement into `public.poker_tables`.

### 2.2 Quick Seat & Candidate Matching (`netlify/functions/poker-quick-seat.mjs`)
- Detect Single Player mode from payload (`mode === "single" || mode === "single_player" || singlePlayer === true`).
- **Early RESTRICTED Guard:**
  - Reject `RESTRICTED` status immediately with `403 single_player_restricted_unavailable` before candidate lookup, seat lookup, or table creation.
- **Hard 1000 CH Cap:**
  - Reject `selectedBuyIn > 1000` with `400 invalid_buy_in`.
  - Filter available tiers to `<= 1000 CH`.
- **Per-mode Deterministic Resume:**
  - Single Player: check `selectExistingActiveSeat()` with `is_single_player = true and created_by = $1`, ordered by `coalesce(s.last_seen_at, s.created_at) desc` (with explicit `tableId` filter support).
  - Return active Single Player tables in `poker-progression.mjs` via `singlePlayerRejoinableTables` / `singlePlayerRejoinableTableIds`.
  - Poker Online: check `selectExistingActiveSeat()` with `coalesce(is_single_player, false) = false`.
- **Dedicated Create & Request-ID Idempotency:**
  - For Single Player, skip `selectCandidate()` across tables.
  - Require normalized `requestId` (`normalizeRequestId(event.requestId)`), rejecting missing with `400 missing_request_id`.
  - Check `selectSinglePlayerTableByRequestId(tx, { userId, requestId })` against `public.poker_requests`.
  - If existing request found:
    - If buy-in changed -> reject with `400 invalid_buy_in`.
    - If original table status is closed -> reject with `409 table_closed` (never creates a duplicate table for the same intent).
    - Otherwise replay same table (`strategy: "idempotent_replay"`).
  - New Game actions provide distinct `requestId` generating a dedicated new table via `createPokerTableWithState({ isSinglePlayer: true })`, subject to 4 active / 4 pending limits.
- **Matchmaking Isolation:**
  - In `selectCandidate()`, enforce `and coalesce(t.is_single_player, false) = false`.

### 2.3 Authoritative Join Guard (`shared/poker-domain/join.mjs`)
- In `executePokerJoinAuthoritative()` under `poker_tables ... FOR UPDATE`:
  - Query `is_single_player`.
  - If `is_single_player` is true:
    - **Early Account Status Guard:** Reject `RESTRICTED` users immediately (`single_player_restricted_unavailable`) before capacity checks, chip debit, or bot funding. Uses `readPokerAccessSnapshot(tx, { userId, lock: true })` taking row lock on `chips_accounts` to eliminate race conditions with concurrent overrides.
    - **Sole-Owner:** `table.created_by === userId` (otherwise throw `single_player_owner_only`).
    - **Buy-In Cap:** `authoritativeBuyIn <= 1000` (otherwise throw `invalid_buy_in`).
    - **No Other Humans:** `activeSeatRows` and `state.seats` contain zero other humans (otherwise throw `single_player_human_conflict`).
    - **Fail-Fast Safety:** All checks occur before seat insertion, debit, bot seeding, or state mutation.
  - **Mandatory Bot Funding with Atomic Rollback:**
    - On fresh Single Player join, calculate required bots (`Math.max(1, botCfg.minPerTable || 2)`).
    - If `seededBots.length < requiredBots`, throw `single_player_bot_funding_unavailable`.
    - This causes `beginSql` to roll back the entire transaction (human buy-in, seat, and partial bot debits all roll back cleanly).
    - `RESTRICTED` accounts fail closed.

### 2.4 WebSocket Server & Non-Authoritative Fail-Closed Guard
- `ws-server/poker/handlers/join.mjs`:
  - If table has `isSinglePlayer === true` and `!authoritativeJoinRequired` (e.g., `authoritativeJoinEnabled` is false or `observeOnlyJoinEnabled` is true), fail closed immediately by throwing error with `code: "single_player_authoritative_required"`.
- `ws-server/poker/table/table-manager.mjs::join()`:
  - If table has `isSinglePlayer === true`:
    - Enforce authoritative join requirement (`single_player_authoritative_required`).
    - Enforce single human ceiling across active seats (`single_player_human_conflict`).
- `ws-server/poker/table/table-manager.mjs::normalizeTableMeta()`:
  - Preserve `isSinglePlayer`.
- `ws-server/poker/bootstrap/persisted-bootstrap-adapter.mjs`:
  - Select and normalize `is_single_player` from DB on table hydration / server restart.
- `ws-server/server.mjs::buildLobbyTableEntry()`:
  - Return `null` if `tableMeta?.isSinglePlayer === true` (exclude from public multiplayer lobby).
- `ws-server/poker/persistence/authoritative-join-adapter.mjs`:
  - Map `"single_player_owner_only"`, `"single_player_human_conflict"`, `"single_player_bot_funding_unavailable"`, `"single_player_restricted_unavailable"`, `"single_player_authoritative_required"`.

---

## 2.5 Phased Rollout Sequence

To ensure zero risk of older multiplayer clients seating into Single Player tables before protections are active:
1. **Phase 1: DB Migration (Schema)** - Add column `is_single_player` with CHECK constraint via `supabase/migrations/20261011200000_poker_single_player_table_flag.sql`. Existing rows default to `false`.
2. **Phase 2: WS Server Deployment** - Hydrate `is_single_player`, activate non-authoritative fail-closed protections, authoritative join guards, and exclude from public lobby projections. Pinned SHA deployment.
3. **Phase 3: Netlify Atomic Deployment (Backend + Frontend)** - Deploy Netlify functions (`poker-quick-seat.mjs`, `poker-progression.mjs`) and frontend web assets (`poker/index.html`, `poker/poker.js`, `poker/poker.css`) atomically. Activates candidate isolation, mandatory `requestId` on New Game, early RESTRICTED check, and Single Player UI controls. Older clients continue playing Poker Online without seeing Single Player tables; newer clients are immediately protected by WS.

---

## 3. Frontend & Lobby Activation

### 3.1 `poker/index.html`
- Activate `.tile--single` card with interactive controls:
  - Resume shell with dropdown selector (`#pokerSingleResumeSelect`) and action button (`#pokerSingleResume`).
  - Buy-in tier selector for tiers `<= 1000 CH` (`#pokerSingleQuickTiers`).
  - "PLAY VS BOTS" action button (`#pokerSinglePlay`).
  - Guest sign-in messaging and prompt.

### 3.2 `poker/poker.js`
- Wire Single Player tier selector and quickSeat trigger with `mode: "single_player"`.
- Support resume for active tables (with multi-table dropdown selection) using existing `QUICK_SEAT_URL` endpoint with `tableId`.
- Honest error reporting (`single_player_bot_funding_unavailable`, restricted account, closed tables).
- Maintain JSP compatibility, IIFE/global functions, and 44px touch targets.

---

## 4. Fundamental Test Suite

1. **Quick Seat Isolation:**
   - Dedicated table created per player in Single Player.
   - Normal Poker Online never selects a Single Player table.
   - Single Player never selects other players' tables.
   - Single Player resume reuses own table; does not reuse Poker Online table.
   - Buy-in > 1000 CH rejected for Single Player, allowed for Poker Online.
   - Retry/double-click reuses pending table without duplicate creation.
2. **Authoritative Fail-Fast Join:**
   - Unauthorized user rejected with `single_player_owner_only` with zero seat/debit/state effect.
   - Single Player join with buyIn > 1000 CH rejected.
   - Table containing another human rejected with `single_player_human_conflict`.
   - Insufficient bot funding rolls back entire transaction (zero debit, zero seat).
   - Rejoin by owner on unpolluted table succeeds without second debit.
