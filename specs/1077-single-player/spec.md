# Feature Specification: Poker Single Player vs Bots (#1077)

**Issue:** https://github.com/krzysztofcal/arcadePlatform/issues/1077  
**Baseline:** `main` (commit `97f8b8e5`)  
**Status:** Owner decision approved Variant B (2026-10-11). Minimal forward-only migration for `is_single_player` authorized locally.

---

## 1. Owner Decision — Variant B Approved (Binding Contract)

The owner approved **Variant B with corrections**:
- Add `is_single_player boolean NOT NULL DEFAULT false` to `public.poker_tables`.
- One simple database `CHECK` constraint: when `is_single_player` is true, `lifecycle_kind = 'STANDARD'` **and** `created_by IS NOT NULL`.
- Do not modify `lifecycle_kind` values. Do not overload `managed_profile_key`, `stakes`, or `poker_state.state`.
- Do not add an index by default without measurement justification.
- **Local Implementation Only:** The migration file and application changes are prepared locally. **Do not push any PR containing `supabase/migrations/**` until explicit owner authorization for the Stage migration side effect.**

---

## 2. Core Product Requirements

### SP-001 — Identity and Isolation
- **Online Cash Runtime:** Reuses the existing authoritative WebSocket runtime (`ws-server/`), table lifecycle, bot autoplay, reconnect, and CH ledger/escrow. It is **not** an offline client simulation or separate game engine.
- **Dedicated Tables:** Every new Single Player session creates a **brand-new dedicated table** belonging exclusively to that player and existing bots.
  - No matchmaking between human players.
  - No joining or reusing tables of other humans.
  - Default Poker Online matchmaking / Quick Seat must never select or recommend Single Player tables.
- **Sole-Owner Resume:** A player may Resume/reconnect to their own existing active Single Player table without paying an additional buy-in.
  - Reconnect/Resume is restricted to the table creator (`created_by === userId`).
  - Cross-user table reuse is strictly forbidden.
  - Poker Online resume never silently routes to Single Player, and vice versa.

### SP-002 — Mode Discriminator
- The mode discriminator is the server-trusted, immutable column `poker_tables.is_single_player`.
- Enforced at table creation via `createPokerTableWithState({ isSinglePlayer: true })`.
- Cannot be altered or requested post-creation.

### SP-003 — Authoritative Fail-Fast Admission
- Inside `shared/poker-domain/join.mjs::executePokerJoinAuthoritative()` under `poker_tables ... FOR UPDATE`:
  - **Sole-Owner Check:** Only `created_by` may join or rejoin a Single Player table.
  - **Zero Other Humans:** Verify `activeSeatRows(seatRows)` and `state.seats` contain no other human. If another human is present or attempting admission, reject immediately.
  - **Hard 1000 CH Cap Check:** Verify `authoritativeBuyIn <= 1000`. Over-cap tables or requests are rejected immediately.
  - **Fail-Fast Safety:** All rejections occur **before** seat assignment, buy-in debit, bot seeding, or state mutation.
  - No conversion, eviction, silent table switch, or second debit.
  - Contaminated/polluted table reconnect fails fast.

### SP-004 — Economy, Hard 1000 CH Cap, and Atomic Bot Funding
- **Hard 1000 CH Buy-In Cap:** Single Player tables accept **only currently enabled/unlocked tiers <= 1000 CH** (100, 500, 1000 CH if available).
  - Enforced in `poker-quick-seat.mjs` creation and authoritatively in `executePokerJoinAuthoritative()`.
  - Normal Poker Online multiplayer tables retain all higher tiers without change.
- **Mandatory Bot Funding with Atomic Rollback:**
  - Single Player tables require the legitimate configured minimum bots (at least 2 bots, clamped by table capacity).
  - If bot funding from NORMAL/SLOW pool cannot provision the required bots, the JOIN **fails closed and rolls back the entire transaction**.
  - Zero chips debited from the human player. Zero partial bot debits.
  - The table remains unjoined and will be pruned by standard inactive table cleanup.
  - `RESTRICTED` accounts fail closed (never receive bot opponents).

### SP-005 — Dedicated Creation, Discovery, and UI
- Request routes through existing `netlify/functions/poker-quick-seat.mjs::handler()` with `mode: "single_player"`.
- Single Player new-play skips `selectCandidate()` and calls `createPokerTableWithState()`.
- Sequential retries, double-clicks, and timeouts reuse an existing pending unjoined Single Player table for that owner without creating duplicates or hitting caps.
- Normal table list and WS lobby exclude Single Player tables (`buildLobbyTableEntry` returns `null`).
- In `poker/index.html` and `poker/poker.js`:
  - Activate the Single Player card.
  - Expose only eligible unlocked tiers <= 1000 CH.
  - Show honest error states (e.g. bot pool unavailable or account RESTRICTED).
  - Preserve guest guidance, 44px touch targets, portrait/landscape responsiveness, and Daily Bonus (#1084).

### SP-006 — Runtime, Retention, and Cleanup
- Tables containing the human player receive `has_human_participant = true` upon successful join.
- Never treated as 7-day bot-only tables (#891). Standard human-table close/settlement/escrow retention policies (#923) apply.
- Normal table janitor and inactive session cleanup remain in effect.
