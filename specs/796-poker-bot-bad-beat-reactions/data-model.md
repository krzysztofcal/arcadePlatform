# Data Model: Poker: Bot Bad-Beat & Lost All-In Reactions (Backend + Poker V2 Catalog #796)

**Feature Branch**: `796-poker-bot-bad-beat-reactions`

**Created**: 2026-09-27 | **Revised**: 2026-09-28

**Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

---

## 1. Entities & Types

### AuthoritativeHandAccounting (Server Internal)
Snapshot of player chips utilized to evaluate all-in participation without mutating gameplay state.

```typescript
interface AuthoritativeHandAccounting {
  // Exact starting chips of each seated player when the hand was dealt
  handStartStacksByUserId: Record<string, number>;
  
  // Total cumulative chips contributed to pots by each player across all streets
  contributionsByUserId: Record<string, number>;
}
```

### DetachedReactionContext (Server Internal)
The immutable context created in `ws-server/server.mjs::buildDetachedReactionContext` and supplied to reaction classifiers. This context is server-internal and not exported. Neither `handStartStacksByUserId` nor `contributionsByUserId` is ever exposed in client snapshots or WebSocket protocol messages.

```typescript
interface DetachedReactionContext {
  phase: string;
  handId: string;
  bigBlind: number;
  handSeats: ReadonlyArray<{ userId: string; seatNo: number }>;
  foldedByUserId: Record<string, true>;
  leftTableByUserId: Record<string, true>;
  sitOutByUserId: Record<string, true>;
  riverChangedWinnerUserIds: ReadonlyArray<string>;
  
  // Authoritative accounting maps (server-internal only)
  handStartStacksByUserId: Record<string, number>;
  contributionsByUserId: Record<string, number>;

  handSettlement: {
    handId: string;
    payouts: Record<string, number> | null;
  } | null;

  showdown: {
    handId: string;
    winners: ReadonlyArray<string> | null;
    handsByUserId?: Record<string, {
      category: number;
      ranks: ReadonlyArray<number>;
      key: string;
    }>;
  } | null;
}
```

### AllInLossReactionPool
The ordered pool of five bot-only reaction keys emitted upon an ordinary all-in loss:

```typescript
type AllInLossReactionKey =
  | 'all_in_oh_no'       // 😞 "Oh no..."
  | 'all_in_that_hurts'  // 😣 "That hurts."
  | 'all_in_no_way'      // 😠 "No way..."
  | 'all_in_come_on'     // 😤 "Come on!"
  | 'all_in_censored';   // 🤬 "******!"

const ALL_IN_LOSS_REACTION_KEYS: ReadonlyArray<AllInLossReactionKey> = Object.freeze([
  'all_in_oh_no',
  'all_in_that_hurts',
  'all_in_no_way',
  'all_in_come_on',
  'all_in_censored'
]);
```

### SettlementReactionCandidate
Candidate object returned by `classifySettlementReaction` before cooldown reservation and jitter delay. Note: `targetSeatNo` MUST be omitted for `bad_beat` and all five all-in loss reactions; existing `targetSeatNo` semantics for all other reactions remain completely unchanged. `not_this_time` is excluded from settlement (used exclusively for folds).

```typescript
interface SettlementReactionCandidate {
  botUserId: string;
  botSeatNo: number;
  targetSeatNo?: number; // Preserved for existing targeted reactions (nice_bluff, lucky, generic congrats); omitted for bad_beat and all-in loss pool
  reactionKey:
    | 'bad_beat'
    | AllInLossReactionKey
    | 'i_was_bluffing'
    | 'nice_bluff'
    | 'lucky'
    | 'nice_hand'
    | 'wow'
    | 'congrats'
    | 'well_played';
  handId: string;
  delayMs?: number;
}
```

---

## 2. Decision Logic & Classification Matrix

| Participant State | Showdown Type | River Reversal? | Selected Key | Target Seat | Base Probability |
|---|---|---|---|---|---|
| Fold win (1 winner, all others folded) | Normal folds | N/A | `i_was_bluffing` (winning bot) / `nice_bluff` (losing bot) | Winner seat (for `nice_bluff`) | 75% |
| **All-in bot loser (`contrib === start`, `payout <= 0`, not in `winners`)** | **Heads-up (2 hands in `handsByUserId`)** | **Yes (winner in `riverChangedWinnerUserIds`)** | **`bad_beat`** | **None (Broadcast)** | **100% (1.0)** |
| **All-in bot loser (`contrib === start`, `payout <= 0`, not in `winners`)** | **Multiway (3+ hands) or non-reversal** | **No / Multiway** | **Uniform sample from `ALL_IN_LOSS_REACTION_KEYS` (5 keys)** | **None (Broadcast)** | **100% (1.0)** |
| Showdown winner | Any | Yes (close rank or river) | `lucky` | Lucky winner seat | 70% |
| Showdown winner | Any | No | `nice_hand` (if category >= 4) | Strong winner seat | 90% |
| Bot winner | Any | No | `wow` (if payout >= 20 BB) | None (Broadcast) | 100% |
| Regular winner | Any | No | `congrats` / `well_played` | First winner seat | 80% |

---

## 3. Validation & Fail-Closed Invariants

1. **All-In Qualification (Exact Uncoerced Integer Equality)**:
   ```javascript
   function isPlayerAllIn(userId, handStartStacks, contributions) {
     const start = handStartStacks?.[userId];
     const contrib = contributions?.[userId];
     // Strictly validate raw types: no coercion from strings or other types
     if (typeof start !== 'number' || !Number.isInteger(start) || start <= 0) return false;
     if (typeof contrib !== 'number' || !Number.isInteger(contrib) || contrib < 0) return false;
     // Exact equality required: contrib > start is corrupt data and fails closed
     return contrib === start;
   }
   ```

2. **Lost All-In Candidate Qualification (Excludes Winners & Fail-Closed Payout Validation)**:
   ```javascript
   function isLostAllInCandidate(botUserId, state) {
     if (Array.isArray(state?.showdown?.winners) && state.showdown.winners.includes(botUserId)) {
       return false;
     }
     const rawPayout = state?.handSettlement?.payouts?.[botUserId];
     let payout = 0;
     if (rawPayout !== undefined && rawPayout !== null) {
       // If payout exists, strictly validate as a finite non-negative integer
       if (typeof rawPayout !== 'number' || !Number.isInteger(rawPayout) || rawPayout < 0) {
         // Malformed, non-finite, negative, or string values fail closed on this branch
         return false;
       }
       payout = rawPayout;
     }
     if (payout > 0) {
       // Any positive payout, including uncalled bet returns, strictly disqualifies from lost all-in
       return false;
     }
     return isPlayerAllIn(botUserId, state?.handStartStacksByUserId, state?.contributionsByUserId);
   }
   ```

3. **Heads-Up Showdown Qualification (Authoritative `showdown.handsByUserId`)**:
   ```javascript
   function isHeadsUpShowdown(showdown) {
     const comparedHands = showdown?.handsByUserId;
     const participantCount = comparedHands && typeof comparedHands === 'object'
       ? Object.keys(comparedHands).length
       : 0;
     const winnerCount = Array.isArray(showdown?.winners) ? showdown.winners.length : 0;
     return participantCount === 2 && winnerCount === 1;
   }
   ```

4. **Two Sequential Random Draws & Uniform All-In Loss Pool Sampling**:
   The classifier performs up to two sequential draws using the injected `random` function:
   - **Draw 1 (Frequency Gate)**: `samplePasses(random, 1, reactionSettings)` consumes one draw from `random`.
   - **Draw 2 (Selection Draw)**: If frequency passes and candidate is an ordinary all-in loser (or multiway reversal), `sampleAllInLossReactionKey(random)` consumes the next draw from `random` for uniform selection across `ALL_IN_LOSS_REACTION_KEYS`:
   ```javascript
   // Internal, non-exported helper in ws-server/poker/handlers/reaction.mjs
   function sampleAllInLossReactionKey(random = Math.random) {
     const r = typeof random === 'function' ? random() : Math.random();
     const clamped = Math.min(Math.max(Number(r) || 0, 0), 0.999999);
     const index = Math.floor(clamped * ALL_IN_LOSS_REACTION_KEYS.length);
     return ALL_IN_LOSS_REACTION_KEYS[index] || ALL_IN_LOSS_REACTION_KEYS[0];
   }
   ```
   **Boundary Mapping for Tests (Selection Draw)**:
   The selection boundaries apply strictly to the second draw after the frequency gate succeeds. Tests verify this behavior deterministically through the public `classifySettlementReaction` without requiring test-only exports:
   - `[0.0, 0.2)` → `all_in_oh_no`
   - `[0.2, 0.4)` → `all_in_that_hurts`
   - `[0.4, 0.6)` → `all_in_no_way`
   - `[0.6, 0.8)` → `all_in_come_on`
   - `[0.8, 1.0)` → `all_in_censored`

5. **Fail-Closed & Fallthrough Guarantee**:
   If accounting maps (`handStartStacksByUserId`, `contributionsByUserId`) are missing, invalid, non-integer, or corrupt (`contribution > handStartStack`), or if payout data is malformed/negative/non-finite, `isLostAllInCandidate` evaluates to `false`. The lost all-in / bad-beat branch is skipped, and the classifier cleanly continues down the existing waterfall (`lucky`, `nice_hand`, `wow`, `congrats`/`well_played`) without altering existing generic behavior or returning `null` on accounting or payout failure alone. If `reactionSettings.enabled === false` or `isCompleteReactionSettlement` fails, returns `null` as before.
