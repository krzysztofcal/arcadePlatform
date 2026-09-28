# Data Model: Poker: Bot Bad-Beat & Lost All-In Reactions (Backend #796)

**Feature Branch**: `796-poker-bot-bad-beat-reactions`
**Date**: 2026-09-27
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
  
  // Authoritative accounting maps
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

### SettlementReactionCandidate
Candidate object returned by `classifySettlementReaction` before cooldown reservation and jitter delay. Note: `targetSeatNo` is never set for `bad_beat` or `not_this_time`.

```typescript
interface SettlementReactionCandidate {
  botUserId: string;
  botSeatNo: number;
  targetSeatNo?: number; // Only for nice_bluff / targeted reactions; omitted for bad_beat and not_this_time
  reactionKey: 'bad_beat' | 'not_this_time' | 'i_was_bluffing' | 'nice_bluff' | 'lucky' | 'nice_hand' | 'wow' | 'congrats' | 'well_played';
  handId: string;
  delayMs?: number;
}
```

---

## 2. Decision Logic & Classification Matrix

| Participant State | Showdown Type | River Reversal? | Selected Key | Target Seat | Base Probability |
|---|---|---|---|---|---|
| Fold win (1 winner, all others folded) | Normal folds | N/A | `i_was_bluffing` (winning bot) / `nice_bluff` (losing bot) | Winner seat (for `nice_bluff`) | 75% |
| **All-in bot loser (`contrib === start`, `payout <= 0`, not in `winners`)** | **Heads-up (2 players at showdown)** | **Yes (winner in `riverChangedWinnerUserIds`)** | **`bad_beat`** | **None (Broadcast)** | **100% (1.0)** |
| **All-in bot loser (`contrib === start`, `payout <= 0`, not in `winners`)** | **Multiway or non-reversal** | **No / Multiway** | **`not_this_time`** | **None (Broadcast)** | **100% (1.0)** |
| Showdown winner | Any | Yes (close rank or river) | `lucky` | Lucky winner seat | 70% |
| Showdown winner | Any | No | `nice_hand` (if category >= 4) | Strong winner seat | 90% |
| Bot winner | Any | No | `wow` (if payout >= 20 BB) | None (Broadcast) | 100% |
| Regular winner | Any | No | `congrats` / `well_played` | First winner seat | 80% |

---

## 3. Validation & Fail-Closed Invariants

1. **All-In Qualification (Exact Equality Only)**:
   ```javascript
   function isPlayerAllIn(userId, handStartStacks, contributions) {
     const start = handStartStacks?.[userId];
     const contrib = contributions?.[userId];
     if (!Number.isInteger(start) || start <= 0) return false;
     if (!Number.isInteger(contrib) || contrib < 0) return false;
     // Exact equality required: contrib > start is corrupt data and fails closed
     return contrib === start;
   }
   ```
2. **Lost All-In Candidate Qualification (Excludes Winners & Positive Payouts)**:
   ```javascript
   function isLostAllInCandidate(botUserId, state) {
     if (Array.isArray(state?.showdown?.winners) && state.showdown.winners.includes(botUserId)) {
       return false;
     }
     const payout = Number(state?.handSettlement?.payouts?.[botUserId] ?? 0);
     if (payout > 0) {
       // Any positive payout, including uncalled bet returns, strictly disqualifies from lost all-in
       return false;
     }
     return isPlayerAllIn(botUserId, state?.handStartStacksByUserId, state?.contributionsByUserId);
   }
   ```
3. **Heads-Up Showdown Qualification**:
   ```javascript
   function isHeadsUpShowdown(handSeats, foldedByUserId, showdown) {
     const nonFolded = handSeats.filter((s) => foldedByUserId[s.userId] !== true);
     const winnerCount = Array.isArray(showdown?.winners) ? showdown.winners.length : 0;
     return nonFolded.length === 2 && winnerCount === 1;
   }
   ```
4. **Fail-Closed & Fallthrough Guarantee**:
   If accounting maps (`handStartStacksByUserId`, `contributionsByUserId`) are missing, invalid, or corrupt (`contribution > handStartStack`), `isPlayerAllIn` evaluates to `false`. The lost all-in / bad-beat branch is skipped, and the classifier cleanly continues down the existing waterfall (`lucky`, `nice_hand`, `wow`, `congrats`/`well_played`) without altering existing generic behavior or returning `null` on accounting failure alone. If `reactionSettings.enabled === false` or `isCompleteReactionSettlement` fails, returns `null` as before.
