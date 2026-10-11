# Implementation Plan: Poker Single Player vs Bots (#1077)

**Source:** [spec.md](spec.md), GitHub issue [#1077](https://github.com/krzysztofcal/arcadePlatform/issues/1077)  
**Baseline:** `main` (commit `97f8b8e5`)  
**Status:** Approved Variant B implementation complete locally. All fundamental tests, syntax, and CSP checks passing. Ready for owner review (Phase 4). Migration kept local.

---

## 1. Minimal Migration Implementation (Local Only)

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
- **Hard 1000 CH Cap:**
  - Reject `selectedBuyIn > 1000` with `400 invalid_buy_in`.
  - Filter available tiers to `<= 1000 CH`.
- **Per-mode Resume:**
  - Single Player: check `selectExistingActiveSeat()` with `is_single_player = true and created_by = $1`.
  - Poker Online: check `selectExistingActiveSeat()` with `coalesce(is_single_player, false) = false`.
- **Dedicated Create & Double-click Protection:**
  - For Single Player, skip `selectCandidate()` across tables.
  - If a recent pending unjoined Single Player table exists for this owner with the same buy-in (`status = 'OPEN'`, `is_single_player = true`, `has_human_participant = false`), reuse it.
  - Otherwise create new dedicated table via `createPokerTableWithState({ isSinglePlayer: true })`.
- **Matchmaking Isolation:**
  - In `selectCandidate()`, enforce `and coalesce(t.is_single_player, false) = false`.

### 2.3 Authoritative Join Guard (`shared/poker-domain/join.mjs`)
- In `executePokerJoinAuthoritative()` under `poker_tables ... FOR UPDATE`:
  - Query `is_single_player`.
  - If `is_single_player` is true:
    - **Sole-Owner:** `table.created_by === userId` (otherwise throw `single_player_owner_only`).
    - **Buy-In Cap:** `authoritativeBuyIn <= 1000` (otherwise throw `invalid_buy_in`).
    - **No Other Humans:** `activeSeatRows` and `state.seats` contain zero other humans (otherwise throw `single_player_human_conflict`).
    - **Fail-Fast Safety:** All checks occur before seat insertion, debit, bot seeding, or state mutation.
  - **Mandatory Bot Funding with Atomic Rollback:**
    - On fresh Single Player join, calculate required bots (`Math.max(1, botCfg.minPerTable || 2)`).
    - If `seededBots.length < requiredBots`, throw `single_player_bot_funding_unavailable`.
    - This causes `beginSql` to roll back the entire transaction (human buy-in, seat, and partial bot debits all roll back cleanly).
    - `RESTRICTED` accounts fail closed.

### 2.4 WebSocket Server & Projection
- `ws-server/poker/table/table-manager.mjs::normalizeTableMeta()`:
  - Preserve `isSinglePlayer`.
- `ws-server/poker/bootstrap/persisted-bootstrap-adapter.mjs::normalizeTableMeta()`:
  - Preserve `is_single_player`.
- `ws-server/server.mjs::buildLobbyTableEntry()`:
  - Return `null` if `tableMeta?.isSinglePlayer === true` (exclude from public multiplayer lobby).
- `ws-server/poker/persistence/authoritative-join-adapter.mjs`:
  - Map `"single_player_owner_only"`, `"single_player_human_conflict"`, `"single_player_bot_funding_unavailable"`.

---

## 3. Frontend & Lobby Activation

### 3.1 `poker/index.html`
- Activate `.tile--single` card with interactive controls:
  - Buy-in tier selector for tiers `<= 1000 CH`.
  - "PLAY VS BOTS" action button.
  - Guest sign-in messaging and prompt.

### 3.2 `poker/poker.js`
- Wire Single Player tier selector and quickSeat trigger with `mode: "single_player"`.
- Support resume and honest error reporting (bot pool exhausted, restricted account).
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
