# Implementation Plan: Poker Single Player vs Bots (#1077)

**Source:** [spec.md](spec.md), GitHub issue [#1077](https://github.com/krzysztofcal/arcadePlatform/issues/1077)  
**Baseline:** `main` (commit `97f8b8e5`)  
**Status:** Mandatory Architecture Preflight completed (T001–T003). Review stop gate active: waiting for owner decision on SQL migration design.

---

## 1. Architecture Preflight Findings (T001–T002)

### 1.1 The Need for Durable Mode Identity
Single Player mode requires:
1. Tables to be permanently isolated from multiplayer Quick Seat candidate selection.
2. Tables to be excluded from the public lobby table listings (`buildLobbyTableEntry`).
3. Authoritative join (`executePokerJoinAuthoritative`) to know with absolute certainty whether a table is a Single Player table, so it can reject any non-owner human before executing seats, debits, or bot seeding.
4. Mode identity to persist across WebSocket server restarts and database recovery.

### 1.2 Evaluation of Potential Migration-Free Options
- **`poker_tables.lifecycle_kind` without migration:**
  - Database check constraint `poker_tables_lifecycle_kind_chk` strictly enforces `lifecycle_kind IN ('STANDARD', 'CONTINUOUS_BOT')`.
  - Setting `'SINGLE_PLAYER'` without altering this constraint results in Postgres error `23514` (check constraint violation).
- **`poker_tables.managed_profile_key` without migration:**
  - Foreign key references `poker_managed_table_profiles(profile_key)` on delete restrict.
  - Check constraint `poker_tables_managed_profile_chk` requires `managed_profile_key IS NULL` when `lifecycle_kind = 'STANDARD'`.
  - Overloading bot profiles is prohibited by project guidelines.
- **`poker_tables.stakes` JSONB without migration:**
  - Spec requirement SP-002 explicitly rules out casual use of "stake economics fields".
  - Furthermore, `ws-server/poker/table/table-manager.mjs::normalizeTableMeta()` strips `stakes` down to `{ sb, bb }` and discards all other keys.
  - In `ws-server/server.mjs`, runtime table materialization recalculates canonical stakes from `buyIn`, overwriting custom metadata.
  - Relying on `stakes` is therefore fragile, non-durable in runtime memory, and violates project constitution.
- **`poker_state.state` mutable JSONB without migration:**
  - Spec requirement SP-002 explicitly rules out casual use of "mutable client-visible state".
  - `poker_state` is updated on every player action and turn, is broadcast to clients, and is not queried by table indexing or Quick Seat candidate selection.
- **`created_by` column:**
  - In standard Poker Online, `created_by` is already populated with the creator's `userId`. It cannot distinguish a private Single Player table from a public STANDARD table.

### 1.3 Conclusion: SQL Migration is Required
A safe, robust, and permanent implementation requires an explicit database discriminator. In accordance with the instructions ("Jeżeli potrzebna jest migracja SQL, nie twórz ani nie pushuj jej. Zatrzymaj się i przedstaw do mojego review najmniejszy możliwy projekt migracji, skutki dla istniejących stołów i plan rollout/rollback"):
**No migration file has been created or pushed.** Implementation halts at T002 for owner review.

---

## 2. Minimal SQL Migration Proposals for Owner Review

### Proposal A (Recommended): Add `'SINGLE_PLAYER'` to `poker_tables.lifecycle_kind`
Extend the existing check constraints on `public.poker_tables`:

```sql
-- Migration: Add SINGLE_PLAYER to poker_tables.lifecycle_kind
alter table public.poker_tables
  drop constraint if exists poker_tables_lifecycle_kind_chk,
  drop constraint if exists poker_tables_managed_profile_chk;

alter table public.poker_tables
  add constraint poker_tables_lifecycle_kind_chk
    check (lifecycle_kind in ('STANDARD', 'CONTINUOUS_BOT', 'SINGLE_PLAYER')),
  add constraint poker_tables_managed_profile_chk
    check (
      (lifecycle_kind in ('STANDARD', 'SINGLE_PLAYER') and managed_profile_key is null)
      or (lifecycle_kind = 'CONTINUOUS_BOT' and managed_profile_key is not null)
    );
```

#### Impact on Existing Tables:
- **Zero data modification:** All existing rows continue to have `lifecycle_kind IN ('STANDARD', 'CONTINUOUS_BOT')`.
- **Default value remains `'STANDARD'`:** No impact on existing insert statements omitting `lifecycle_kind`.
- **Automatic isolation:** Existing queries filtering `lifecycle_kind = 'STANDARD'` (e.g. matchmaking, bot quarantine index) automatically ignore Single Player tables without modifying those queries.
- **Rollout Impact:** Forward-only additive change.
- **Rollback Plan:** If needed, delete/close any `SINGLE_PLAYER` tables and restore the original two-value check constraints.

---

### Proposal B (Alternative): Add `is_single_player` Boolean Column
Add a dedicated boolean column to `public.poker_tables`:

```sql
alter table public.poker_tables
  add column if not exists is_single_player boolean not null default false;

create index if not exists poker_tables_single_player_active_idx
  on public.poker_tables (created_by, id)
  where status = 'OPEN' and is_single_player is true;
```

#### Impact on Existing Tables:
- All existing rows receive the default `false`.
- Completely orthogonal to `lifecycle_kind`.

---

## 3. Implementation Touchpoints (Pending Owner Approval of Migration)

### 3.1 Table Creation & Quick Seat (`netlify/functions/poker-quick-seat.mjs`)
- Add mode parameter handling (e.g. `mode === "single_player"`).
- **Hard 1000 CH Cap:** Validate that requested `buyIn <= 1000 CH`. If `buyIn > 1000`, return `400 invalid_buy_in`.
- **Resume-First for Owner:** If user has an active seat at their own Single Player table, return existing table and seat (zero new buy-in).
- **Dedicated Creation:** If no active seat exists, skip `selectCandidate()` entirely and call `createPokerTableWithState()` directly with the Single Player lifecycle/flag and `userId`.
- **Exclusion in Standard Matching:** Ensure standard `selectCandidate()` includes `and t.lifecycle_kind = 'STANDARD'` (or `and coalesce(t.is_single_player, false) = false`) so Single Player tables are never returned to other humans.

### 3.2 Table Initialization (`netlify/functions/_shared/poker-table-init.mjs`)
- Support passing `lifecycleKind = "SINGLE_PLAYER"` (or `isSinglePlayer = true`) to `createPokerTableWithState()`.
- Persist the discriminator in the `insert into public.poker_tables` statement.

### 3.3 Authoritative Join Guard (`shared/poker-domain/join.mjs`)
- In `executePokerJoinAuthoritative()` under `poker_tables FOR UPDATE`:
  - Read table mode from locked row.
  - If table is Single Player:
    1. **Sole-Owner Check:** Verify `userId === table.created_by`. If another human attempts to join, immediately throw `makeError("single_player_owner_only")` or `makeError("table_not_found")`.
    2. **Single Human Check:** Verify `activeSeatRows(seatRows)` contains zero other non-bot users. If any other human is detected, fail-fast immediately.
    3. **Hard 1000 CH Cap Check:** Verify `authoritativeBuyIn <= 1000`. If over cap, throw `makeError("invalid_buy_in")`.
    4. **Fail-Fast Safety:** All checks occur before seat reservation, before `postUserTableBuyIn`, before `seedBotsForJoin`, and before `poker_state` mutation.
    5. **Rejoin Consistency:** Rejoin by the owner succeeds without second buy-in; polluted/corrupted table rejoin fails fast.

### 3.4 WebSocket Server & Persistence
- `ws-server/poker/table/table-manager.mjs::normalizeTableMeta()`:
  - Preserve `lifecycleKind: "SINGLE_PLAYER"` (or `isSinglePlayer: true`) in table metadata.
- `ws-server/poker/bootstrap/persisted-bootstrap-adapter.mjs::normalizeTableMeta()`:
  - Retain the Single Player mode when bootstrapping open tables from PostgreSQL.
- `ws-server/server.mjs::buildLobbyTableEntry()`:
  - If table is Single Player, return `null` so it is never published to the shared multiplayer lobby table list.
- `ws-server/poker/handlers/join.mjs` & `authoritative-join-adapter.mjs`:
  - Propagate authoritative join rejection codes cleanly to the client.

### 3.5 UI & Client (`poker/index.html`, `poker/poker.js`)
- In `poker/index.html`: Activate the `.tile--single` card.
- In `poker/poker.js`:
  - Open tier selection dialog for Single Player containing only unlocked tiers `<= 1000 CH` (e.g. 100, 500, 1000 CH).
  - On Play/Resume, invoke `poker-quick-seat.mjs` with `{ mode: "single_player", buyIn }`.
  - Navigate to table using existing `navigateToPokerTable()`.
  - For unauthenticated users, show existing sign-in guidance.
  - Preserve Daily Bonus (#1084), Coming Soon cards, and 44px touch targets in landscape/portrait.

---

## 4. Fundamental Test Strategy

Only deterministic, fundamental tests for critical backend, WS, and domain logic:
1. **Dedicated Table Creation:** Two authenticated users requesting Single Player receive distinct dedicated table IDs; neither joins the other's table.
2. **Authoritative Fail-Fast Guard:** Direct/forged join to a Single Player table by a different user fails fast with zero debit, zero seat insertion, and zero state mutation.
3. **Hard 1000 CH Cap:** Creation and authoritative join with buyIn=1000 succeeds; buyIn>1000 is rejected on server create and authoritative join. Multiplayer retains higher tiers.
4. **Legitimate Owner Resume:** Rejoining own table succeeds with zero second debit.
5. **Polluted Table Rejection:** If a table state is corrupted with another human, join fails fast.
6. **Lobby & Quick Seat Isolation:** `selectCandidate()` and `buildLobbyTableEntry()` never surface Single Player tables.
7. **Anti-Farming & Bot Allocation:** NORMAL/SLOW bot pools function as designed; RESTRICTED accounts fail closed.
