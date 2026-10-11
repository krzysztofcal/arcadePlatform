# Feature Specification: Poker Single Player vs Bots (#1077)

**Issue:** https://github.com/krzysztofcal/arcadePlatform/issues/1077  
**Baseline:** `main` (commit `97f8b8e5`)  
**Status:** Mandatory Architecture Preflight completed (T001–T003). Stop gate reached: minimal SQL migration proposal submitted for owner review before creation or deployment.

---

## 1. Overview and Product Requirements

Poker Single Player vs Bots allows authenticated players to play poker online against server bots in dedicated, private cash-game tables.

### SP-001 — Identity and Isolation
- **Online Cash Runtime:** Reuses the existing authoritative WebSocket runtime (`ws-server/`), table lifecycle, bot autoplay, reconnect, and CH ledger/escrow. It is **not** an offline client simulation or separate game engine.
- **Dedicated Tables:** Every new Single Player session creates a **brand-new dedicated table** belonging exclusively to that player and existing bots.
  - No matchmaking between human players.
  - No joining or reusing tables of other humans.
  - Default Poker Online matchmaking / Quick Seat must never select or recommend Single Player tables.
- **Sole-Owner Resume:** A player may Resume/reconnect to their own existing active Single Player table without paying an additional buy-in.
  - Reconnect/Resume is restricted to the table creator (`created_by === userId`).
  - Cross-user table reuse is strictly forbidden.

### SP-002 — Mandatory Architecture Gate & Mode Discriminator
- The mode discriminator must be server-trusted, immutable, and survive table creation, state transitions, client reload/reconnect, and server restarts.
- **Constraint Preflight:** Existing database constraints in `supabase/migrations/20260729100000_poker_managed_table_profiles.sql` restrict `poker_tables.lifecycle_kind` to `('STANDARD', 'CONTINUOUS_BOT')`, and require `managed_profile_key IS NULL` for `STANDARD`.
- Casual use of mutable client-visible state (`poker_state.state`), stake economics fields (`poker_tables.stakes`), or evading check constraints is explicitly prohibited.
- A minimal additive migration is required to record the durable mode on `poker_tables`. Implementation halts at the T002 stop gate pending explicit owner authorization.

### SP-003 — Authoritative Fail-Fast Admission
- Inside `shared/poker-domain/join.mjs::executePokerJoinAuthoritative()` under `poker_tables ... FOR UPDATE`:
  - Enforce trusted sole-owner mode: only `created_by` may join or rejoin a Single Player table.
  - Enforce zero other humans: any attempt by another human (via direct URL, WS `join`, forged message, autoJoin, or race condition) must be rejected immediately.
  - **Fail-Fast Safety:** The rejection must occur **before** any seat assignment, buy-in debit, bot seeding, or state mutation.
  - No conversion, eviction, silent table switch, or second debit.
  - Enforce that corrupted/polluted tables reject joins fail-closed.

### SP-004 — Economy, Hard 1000 CH Cap, and Bot Gates
- **Hard 1000 CH Buy-In Cap:** Single Player tables accept **only currently enabled/unlocked tiers <= 1000 CH** (typically 100, 500, 1000 CH depending on account tier unlock).
  - Tiers > 1000 CH are strictly prohibited for Single Player.
  - The cap must be enforced on the server in `poker-quick-seat.mjs` table creation **and** authoritatively in `executePokerJoinAuthoritative()`. UI filtering alone is insufficient.
  - Poker Online multiplayer tables retain their standard higher tiers without change.
- **Anti-Farming & Bot Pool Compatibility:**
  - `NORMAL` and `SLOW` pool separation is preserved.
  - `RESTRICTED` accounts must fail closed: never receive bot opponents or access bot pools.
  - Human-owned tables receive safely funded bots via `seedBotsForJoin()` from existing bot bankroll pools.
  - If bot funding is unavailable, show an honest failure state; never grant free chips or unbacked bots.

### SP-005 — Dedicated Creation, Discovery, and UI
- Single Player requests route through the existing `netlify/functions/poker-quick-seat.mjs::handler()` with mode opt-in (e.g. `mode: "single_player"`).
- Single Player new-play skips `selectCandidate()` and directly invokes `createPokerTableWithState()`.
- Only own-table Resume queries active seats.
- UI in `poker/index.html` and `poker/poker.js`:
  - Activate the Single Player card (transitioning from "Coming Soon" to active Play/Resume).
  - Filter stake tier selection to eligible tiers <= 1000 CH.
  - Provide clear guest sign-in guidance.
  - Preserve 44px touch targets, portrait/landscape responsiveness, and PR #1084 Daily Bonus integration.

### SP-006 — Runtime, Retention, and Cleanup
- Tables containing the human player are **human-participating tables** (`has_human_participant = true`).
- They are **never** treated as historical 7-day bot-only tables for cleanup (#891).
- Standard human-table close/settlement/escrow retention policies (#923) apply.
- Normal table janitor and inactive session cleanup remain intact.

---

## 2. Invariants and Guardrails

1. **One Human Invariant:** Under no circumstance may more than one human exist in `poker_seats` or `poker_state` for a Single Player table.
2. **Fail-Closed on Mismatch:** If an unauthorized user attempts to join a Single Player table, or a player attempts to join with buy-in > 1000 CH, return a deterministic rejection error with zero side effects.
3. **Ledger Integrity:** Escrow system key `POKER_TABLE:${tableId}` and idempotency keys `join-buyin:${tableId}:${userId}:...` must strictly obey chips ledger triggers. No duplicate debits on Resume/reconnect.
4. **No Framework / No New Engines:** Reuse existing WS runtime, reducers, and Netlify functions.
5. **JSP / Global JS Compatibility:** All client script changes must use global/IIFE patterns without ES modules.
6. **Logging:** Use `klog()`, never `console.log()`.
7. **CSS Rules:** One physical line per selector in `css/` and `poker/poker.css`.
