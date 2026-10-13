# Implementation Plan: Poker Single Player vs Bots (#1077)

**Source:** [spec.md](spec.md), GitHub issue [#1077](https://github.com/krzysztofcal/arcadePlatform/issues/1077)
**Baseline:** AGY started on `e7fd0ce2`; handoff integrates current `main` `8f691d65` (2026-10-12).
**Status:** Owner accepted manual smoke and agent runtime/economic audit on `cbf0262fdb5dda061d53885fbff50496c5e279e4`; approved documentation finalization and PR #1095 Ready for review. Main `a0de1b09` remains integrated. Production rollout and merge are not authorized. See [runtime-smoke.md](runtime-smoke.md).

---

## 1. Minimal Migration Implementation (Local Only)

### Handoff review amendment (2026-10-12)

### Owner-approved blocker resolution

### Owner review amendments — five findings

### Final two-finding amendment

- Preserve unknown persisted-table mode as `isSinglePlayer: null` in `table-manager.mjs` and the existing bootstrap adapter; non-authoritative handler/direct manager attachment fail closed until trusted metadata is available. The existing positive seat proof from a successful authoritative executor is still accepted; observe-only cannot use that exception. Server-created non-UUID ephemeral/guest rooms remain explicit Online; a UUID DB table cannot be synthesized as Online.
- Exclude unknown UUID mode from `buildLobbyTableEntry()` so a rejected synthetic table cannot pollute the Online registry. Extend the existing backend lobby projection test, not UI rendering tests.
- Keep normal materialization functional by carrying explicit boolean mode through existing runtime notifier/server endpoint. Missing legacy notification metadata stays unknown until DB hydration; trusted mode is immutable once known.
- Restrict optional `tableId` validation/scoping to Single Player; Online ignores all optional tableId values and uses its original unscoped already-seated lookup.
- Extend existing WS handler/manager and Quick Seat tests, including missing notification/loader, default UUID metadata, explicit trusted Online mode, known SP fail-closed and Online legacy Resume. No migration change or shared DB operation.

- Measure `selectSinglePlayerTableByRequestId()` using EXPLAIN ANALYZE/BUFFERS in isolated PGlite with 250,000 request rows and 10,000 tables. Add a separate forward-only partial `(user_id, request_id)` QUICK_SEAT index only if the plan proves need; classify and hash it in the existing manifest/guard.
- Deny Single Player RESTRICTED table access before active-seat rejoin success; Online rejoin remains unchanged.
- Reject explicitly invalid Single Player `tableId` with `400 invalid_table_id`; normalize/validate start request IDs only in Single Player. Extend existing endpoint regression tests.
- Remove the lobby's alternative count-based table limit. Let existing backend caps decide; show explicit active/pending limit errors and clear definitive rejected start intents. Existing cap tests remain authoritative; no UI suite.
- Raise Resume selector touch height to 44px and synchronize the minimum-bot description with capacity-clamped minimum 2.
- Re-run existing local/domain/WS checks, syntax, CSP, migration guard and independent review; export the complete final patch. No publication or deployment.

- `poker-quick-seat.mjs`: validate existing `sp_<base36 milliseconds>_<random suffix>` IDs after `normalizeRequestId()`. New/retried intents expire after 24 hours; accept at most 5 minutes future skew. Retained CLOSED intents keep `409 table_closed`. Resume is independent of start-intent expiry; Online is unchanged.
- `closed-table-cleanup.mjs`: retain trusted Single Player QUICK_SEAT records for at least 24 hours plus 5 minutes from DB creation, in discovery, final guarded DELETE and status queries, even if configured table retention is shorter. Reuse existing cleanup only.
- `production-migrations/manifest.json` and `check-db-migrations.mjs`: inventory 111 source files, 54 baseline / 57 missing, category counts 20 shared-safe / 4 stage-only / 33 equivalent. Hash and classify the portable additive flag migration as shared-safe; preserve historical hashes, canonical identities and seven replacements.
- Extend existing endpoint and cleanup fundamental tests for timestamp boundaries, replay, purge guards and existing table caps; run local checks and independent review. No remote mutation.

- Preserve all six AGY commits through `d29736dc`; integrate current main `8f691d65` locally, preserving #1090 Welcome claim behavior.
- Verify the four requested findings already addressed by AGY's final commit; keep existing Resume, closed replay, funding error and access row lock paths.
- In `shared/poker-domain/poker-progression.mjs`, add opt-in Single Player eligibility before Online's highest-two tier window. Reuse in Quick Seat, progression response/table access and authoritative JOIN; expose `singlePlayerAvailableBuyIns` to the lobby. Online keeps its current window.
- Move Quick Seat request replay ahead of current tier eligibility, preserving RESTRICTED denial and changed-buy-in rejection.
- Enforce at least two configured funded bots (clamped by table capacity) only for Single Player; preserve existing bot maximum/pool rules. Extend existing successful NORMAL/SLOW and partial-funding tests.
- Serialize administrative access overrides with JOIN using `shared/poker-domain/table-participation.mjs::lockUserTableSlots()` before account/table row locks; extend the existing propagation test.
- Preserve selected Resume table through lobby re-render and add unique table ID as final ordering tie-breaker.
- Apply the owner-approved 24h timestamped request contract and 24h5m protection in existing physical cleanup; no durable identity or independent subsystem.
- Verification: existing focused domain/endpoint/WS tests, existing full local runner, syntax, CSP and local SQL migration checks. No push, PR, Stage writes or deploys.

Add forward-only migration `supabase/migrations/20261011200000_poker_single_player_table_flag.sql`:
- `alter table public.poker_tables add column if not exists is_single_player boolean not null default false;`
- Constraint: `check ((is_single_player is false) or (is_single_player is true and lifecycle_kind = 'STANDARD' and created_by is not null))`
- Measured partial lookup index in separate forward-only `supabase/migrations/20261012095657_poker_single_player_request_lookup.sql`: `(user_id, request_id) WHERE kind = 'QUICK_SEAT'`. Retain the existing `(table_id, kind, request_id, user_id)` unique index. Local EXPLAIN confirms direct request lookup replaces table scan; no other index is added.
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
    - On fresh Single Player join, calculate required bots (`Math.min(Math.max(2, botCfg.minPerTable), maxPlayers - 1)`).
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
1. **Phase 1: DB Migration (Schema)** - Draft PR intentionally triggers existing `DB Stage Apply PR` on shared Stage `krydukthwdvccggbyjfw` / system identifier `7656985631720456337`. Apply only `20261011200000_poker_single_player_table_flag.sql` (column/default/CHECK) and `20261012095657_poker_single_player_request_lookup.sql` (measured partial index). Read-only inventory must show exactly these two pending versions. Verify exact PR HEAD, successful workflow and installed objects; no manual SQL or retry. Existing rows default to `false`.
2. **Phase 2: WS Server Deployment** - Hydrate `is_single_player`, activate non-authoritative fail-closed protections, authoritative join guards, and exclude from public lobby projections. Pinned SHA deployment, only after separate owner GO.
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

### Publication preflight, 2026-10-12

Main `d45756dc181f679f5754d147edc61fabf62e05e0` integrated in `96272e0781de259fae2af6c27d735f4e0f384a7d`; #1093 UI retained, #1077 join errors preserved. Separate read-only reviewer found no material integration findings. Local checks rerun before publication. Stage inventory: 109 applied, exactly two approved pending, zero unknown; no migration-bearing competing open PR. Netlify API confirms production branch `main` and allowed branch deploys only `main`; PR preview is not runtime-verified until matching WS is explicitly deployed. Stop after Stage workflow and catalog verification.


## Local smoke fixes — 2026-10-12

1. `join.mjs::executePokerJoinAuthoritative()` keeps free ACTIVE rejoin first; under the existing table lock reject ended Single Player participation before any financial or seat mutation using the durable human flag/historical owner seat. No protocol extension or new schema.
2. Count valid existing bots using locked state stacks and balanced existing seed/replacement receipts from the table's funding class, then add newly funded bots. Pass the total to the existing state synchronizer without adding existing bots to stack updates or transferring their buy-ins again. Preserve minimum two, configuration/capacity bounds, transaction/savepoint rollback and Online logic.
3. Quick Seat and progression expose ended participation; lobby removes stale Resume and refreshes. V2 maps the authoritative error, clears auto-JOIN retry and remembered seat, and reuses access preflight. Normalize the stable rejection in the existing authoritative adapter.
4. Extend existing deterministic JOIN/API/adapter tests; verify receipt SQL with isolated PGlite, with no shared DB or migration changes. Separate read-only subagent review covers debit, escrow, rollback, idempotency and Online isolation.
5. Provide a local commit and small patch against `8839bf0b`. After owner review, a separate GO is required to publish and deploy the exact new runtime SHA before repeating owner smoke.


### Final P2 amendment implementation

Pass `authoritativeBuyIn` into the existing bot validation helper and require `credit.amount = buy-in` in its receipt query; keep matching debit, pool/escrow, seat/state checks and rollback. In `rejoinSeatAfterReconnect().catch()`, restore preferred seat only for errors other than ended participation. Extend the existing PGlite test with -1/+1 at buy-in 100 and existing V2 harness with ended/transient reconnect cases; no additional mechanism or protocol change.


### Deferred Leave correction

Use the existing persisted `poker_state.state.leftTableByUserId` for Single Player Resume listing, Quick Seat and table-access preflight. Check locked authoritative state before ACTIVE rejoin in `join.mjs`; CLOSED still wins, and no seat/CH mutation follows ended rejection. Leave, settlement, cash-out, cleanup, frontend messaging and protocol remain unchanged. Fundamental tests cover ACTIVE-but-left refusal/no writes, actual Resume-list SQL with owner isolation, normal ACTIVE/Online compatibility and existing deferred settlement scenarios.


### Lobby regression correction

Use `$1::uuid::text` / `$2::uuid::text` for existing JSON owner-key expressions in progression and Quick Seat. Retain all deferred-Leave checks. Correct the existing PGlite fixture from text identifiers to UUID and reproduce endpoint 500 before the fix/200 after. No schema, runtime domain, CSS or frontend behavior changes.
