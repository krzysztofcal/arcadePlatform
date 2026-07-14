# Poker human bust and rebuy analysis

Status: analysis only  
Date: 2026-07-14  
Observed environment: WS Preview / stage database  
Observed table: `7e22c318-0c3d-42dc-8481-2e7d7ff5756c`

## TL;DR

The player correctly lost the last 43 CH and reached stack `0`. The next hand correctly excluded that player, but the table still treated the player as an active seated human. The browser therefore continued to render the seat while the server returned no legal actions. Bots continued playing three-handed.

This is an incomplete busted-player lifecycle, not an illegal poker-engine action.

The recommended cash-game UX is:

1. show `Out of chips / Sitting out` immediately after settlement;
2. keep the seat reserved while the connected player decides;
3. offer an explicit `Buy in 100 CH` action and `Return to lobby`;
4. let the other players or bots continue;
5. seat the player into a new hand only after an atomic, idempotent USER-to-ESCROW rebuy succeeds.

Arcade Hub must not silently debit another 100 CH. Automatic rebuy is appropriate only as a separate, explicit opt-in setting.

The investigation also found a critical accounting defect: after the player busted, rollover removed the player's `0` stack from `poker_state`, while `poker_seats.stack` still contained the original `100`. Disconnect cleanup then fell back to that stale row and returned 100 CH to the user. The busted-player UX must not be implemented before this cash-out source-of-truth defect is fixed.

## Evidence from table `7e22c318`

The system journal no longer contained searchable events for this table. The stage database still contained the authoritative action audit, settlement audit, seat rows, poker state, and chips ledger entries.

### Timeline

| UTC | Event | Evidence |
| --- | --- | --- |
| 18:25:23 | Player joins with 100 CH | Ledger posts `USER -100`, `ESCROW +100` as `TABLE_BUY_IN`. |
| 18:28:34.951 | Player bets the remaining 43 CH | Accepted action audit records `BET 43`, `actorStackBefore: 43`, `actorStackAfter: 0`. |
| 18:28:37.188 | Bot calls 43 CH | Pot continues normally. |
| 18:28:40.522 | Hand settles | Bot at seat 4 receives the 195 CH pot. The evaluated pair with Q kicker beats the player's pair with T kicker. The settlement itself is consistent. |
| about 18:28:44 | Next hand starts | The new hand contains only the three bots. The busted player is not dealt in. |
| 18:28:44–18:29:21 | Bots continue playing | Multiple accepted bot actions are present for subsequent hands. |
| 18:29:25.348 | Inactive cleanup runs | Ledger posts `ESCROW -100`, `USER +100`, despite the settled player stack having been `0`. |

There was no automatic rebuy transaction after the bust. The only later user ledger movement was the incorrect 100 CH cash-out.

## Current runtime flow

### 1. Rollover excludes a broke human from the next hand

`ws-server/poker/engine/poker-engine.mjs` defines `MIN_STACK_TO_JOIN_HAND = 2`. `isContinuationEligibleByStack()` therefore excludes a member whose stack is `0` or `1`. `buildNextHandStateFromSettled()` builds the next hand from eligible members only.

`replaceBrokeBotsForNextHand()` handles only seats marked as bots. It replaces and funds broke bots, but has no corresponding human-bust transition.

Result for this table: the player's table membership remained, but the next `pokerState.seats`, `handSeats`, and `stacks` contained only bots.

### 2. The table still counts the busted user as an active human

`hasActiveHumanMember()` in `ws-server/poker/table/table-manager.mjs` checks only whether `coreState.members` contains a non-bot. It does not check stack or a sit-out/busted state.

That keeps settled rollover and bot autoplay alive. Continuing the game for the remaining players is correct, but the human needs an explicit sitting-out state and recovery action.

### 3. The action contract correctly returns no actions

`computeSharedLegalActions()` in `ws-server/poker/shared/poker-primitives.mjs` returns an empty action set when `stack <= 0`. A busted player must not be allowed to bet, call, check, raise, or fold in a hand in which they were not dealt.

The problem is therefore not that action buttons were disabled. The problem is that the UI did not explain why and did not offer a rebuy or leave flow.

### 4. The client continues to render the seat

`deriveCurrentSeat()` in `poker/poker-v2.js` derives the hero seat from the table-level seat list or `youSeat`. `renderControls()` treats a signed-in seated user as joined even when the resolved stack is `0`.

This produces the observed state:

- hero seat remains visible;
- stack is `0`;
- the hero is not part of the new hand;
- legal actions are empty;
- action controls cannot be used;
- no dedicated `Out of chips` explanation or recovery CTA appears.

## Critical accounting finding

This incident exposed a source-of-truth gap between `poker_state.state.stacks` and `poker_seats.stack`.

Before rollover, the authoritative settled state recorded the human stack as `0`. Rollover then built a new hand containing only eligible players and removed the busted user's stack entry. The corresponding `poker_seats` row still contained the original buy-in value `100`.

`stateFirstStackAmount()` in `shared/poker-domain/inactive-cleanup.mjs` prefers the stack in `poker_state`, but falls back to `poker_seats.stack` when the user is absent from state. For this table that fallback selected stale `100`, and cleanup paid it to the user.

This violates the intended accounting invariant:

> A user cash-out must equal the user's authoritative remaining table stack, never the original buy-in or an unverified fallback.

### Required accounting contract before rebuy work

- Declare one authoritative stack for every active human table lifecycle, including `0` after a bust.
- Keep `poker_seats.stack` transactionally synchronized as an operational projection, but never use it as a cash-out fallback for an active table lifecycle.
- Rollover must not erase the only durable proof that a busted player's balance is `0`.
- Cleanup must fail closed and flag manual review when the cash-out amount cannot be proven. It must not refund a stale positive seat value.
- Process restart/restore, ordinary leave, disconnect cleanup, table close, and rebuy must use the same source-of-truth rule.
- Add an accounting invariant covering the complete session: user buy-ins minus user cash-outs must equal the user's net table loss retained in escrow/distributed through the table lifecycle.

This should be treated as a high-priority accounting fix. The UI issue is visible, but the incorrect 100 CH refund changes ledger balances.

## Recommended product behavior

Arcade Hub currently behaves like a cash/ring game: the user selects a buy-in, funds table escrow, can leave and cash out, and bots continue across hands. It should therefore use cash-game bust semantics rather than tournament elimination semantics.

Official PokerStars documentation provides useful precedent:

- cash-game players can explicitly add chips through a buy-in/refill dialog, and the amount is confirmed before it is taken from the account ([Play Money cash-game refill](https://www.pokerstars.com/help/articles/pkr-feat-joining-pm-games/211807/));
- automatic rebuy is a user-configured setting with explicit trigger conditions such as losing all chips ([Auto Rebuy](https://www.pokerstars.com/help/articles/auto-rebuy/140280/));
- cash tables enforce defined minimum and maximum buy-ins ([cash-game buy-in limits](https://www.pokerstars.com/help/articles/ring-game-min-buy-in/96431/)).

### Recommended first release

After the settlement reveal, when a human's authoritative stack is `0`:

1. Mark the user as `Out of chips` / `Sitting out` for presentation and lifecycle purposes.
2. Keep the seat reserved while authenticated WS presence is healthy. Existing disconnect cleanup releases it after a disconnect; a hard timeout for a connected watcher is a separate product decision.
3. Show a modal or prominent table panel with:
   - current Arcade balance;
   - `Buy in 100 CH` as the primary action;
   - an optional permitted buy-in selector if table limits support it;
   - `Return to lobby`;
   - optionally `Keep watching`, without holding the seat indefinitely.
4. Keep bots and other funded players playing. Do not pause their hands while the busted user decides.
5. Keep normal poker action buttons visible but disabled, with an `Out of chips` reason. Do not show a generic `Waiting for action` state for the hero.
6. If the reservation expires or the player chooses the lobby, release the seat and cash out exactly the authoritative residual, normally `0`.

### Rebuy transaction contract

A rebuy must be a new explicit command, not a replay of `table_join` against an existing active seat. It should:

- be accepted only while the human is not in an active hand;
- validate table status, seat ownership, table buy-in limits, and user balance;
- atomically transfer the confirmed amount from the USER ledger account to the table ESCROW;
- atomically update the authoritative table stack and its seat projection;
- use a deterministic request-scoped idempotency key;
- expose the funded player only after the database transaction succeeds;
- join the player at the next hand boundary, never midway through a hand;
- fail without changing the table stack when ledger funding fails or the user has insufficient balance.

### Automatic rebuy

Do not automatically withdraw 100 CH in the first release. A silent debit would make repeated losses surprising and could consume bonuses or the entire Arcade balance without a fresh decision.

Auto-rebuy can be added later only as an explicit opt-in preference with:

- a visible enabled state;
- a selected target amount or stack threshold;
- table buy-in limits;
- insufficient-balance behavior;
- an easy disable control;
- idempotent funding and the same hand-boundary rule as manual rebuy.

Auto-rebuy is explicitly out of scope for the implementation described below. It is tracked separately in [GitHub issue #712](https://github.com/krzysztofcal/arcadePlatform/issues/712) and depends on the accounting, out-of-chips lifecycle, and manual rebuy work being deployed and verified first.

## Additional edge case: a one-chip stack

The shared engine currently requires at least 2 CH to join the next hand. That is appropriate as a bot replacement policy, but it is questionable for humans. A player with 1 CH can normally post a partial blind and be all-in; the existing blind-posting code already caps the posted blind at the available stack.

Human eligibility should therefore be reviewed separately from bot replacement. The likely contract is:

- human with stack `> 0`: eligible for the next hand, including a forced partial-blind all-in;
- human with stack `0`: busted/sitting out and offered rebuy;
- bot with stack below the configured replacement threshold: replaced using the existing funded replacement flow.

## Speckit-style implementation plan

### Goal

Deliver the smallest safe cash-game lifecycle in which:

- losing the final chip cannot produce an incorrect cash-out;
- a funded human with at least 1 CH can participate;
- a human at 0 CH is explicitly `OUT_OF_CHIPS` and is not dealt in;
- the player can consciously buy in for another 100 CH or leave;
- a successful rebuy becomes playable only at the next hand boundary;
- bots continue while the connected human decides;
- no automatic debit exists.

### Architecture decision

Keep the existing engine, WS server, chips ledger, table escrow, CAS writer, bot autoplay, and persisted poker tables. Do not introduce a second wallet, a new ledger type, or a separate rebuy service.

The implementation should formalize the existing distinction between:

- **table seats and table stacks**: every active seat, including a human at stack `0` or waiting for the next hand;
- **`handSeats`**: only players dealt into the current hand.

During action phases, the existing legal-action code already prefers `handSeats`, so a table-level out-of-chips or newly re-funded seat can remain visible without becoming eligible to act in the current hand.

Use these additive properties:

- `coreState.publicStacks[userId]`: current table stack projection, including `0`;
- persisted `pokerState.stacks[userId]`: durable stack evidence for every active table seat, not only current `handSeats`;
- `pokerState.waitingForNextHandByUserId[userId] = true`: an already funded human who must wait for the next deal;
- snapshot `private.playerState.status`: `ACTIVE`, `WAITING_NEXT_HAND`, or `OUT_OF_CHIPS`;
- snapshot `private.playerState.stack`: authoritative non-negative table stack;
- snapshot `private.playerState.canRebuy`: true only for an authenticated human with status `OUT_OF_CHIPS` at an open table, after authoritative rollover has removed that user from `handSeats`.

The client must treat `private.playerState` as optional for backward compatibility and derive the old behavior when it is absent.

No database migration is required. `poker_seats.stack` remains a transactionally synchronized operational projection for inventory and diagnostics. It is not authoritative cash-out evidence and must never be used by leave or cleanup to replace a missing active-lifecycle stack.

### Delivery strategy

The owner approved implementation of the three strictly ordered phases in PR #713:

1. **Phase 1 — accounting P0:** preserve the authoritative human stack, including `0`; synchronize the seat projection; make cleanup and leave fail closed when the authoritative stack is absent; verify restart/restore; and add the read-only discrepancy inventory.
2. **Phase 2 — lifecycle and UI:** expose `OUT_OF_CHIPS / SITTING_OUT`, distinguish table seats from current-hand participants, allow a human with 1 CH to play, and keep disabled actions plus the explanatory message stable.
3. **Phase 3 — explicit manual rebuy:** add the authoritative command, USER-to-ESCROW transaction, waiting-for-next-hand transition, and rebuy prompt.

The phases remain independently reviewable and must be verified in that order within the same preview deployment. Accounting acceptance is a prerequisite for accepting lifecycle behavior, and lifecycle acceptance is a prerequisite for accepting manual rebuy. Auto-rebuy remains a separate future issue.

### Phase 0 / runtime PR 1 — read-only impact inventory

Files and operational surfaces:

- new `scripts/poker-human-stack-audit.mjs` using the existing DB configuration and `klog` conventions;
- `public.poker_actions` settlement and accepted-action audit;
- `public.poker_state`;
- `public.poker_seats`;
- `public.chips_transactions`, `public.chips_entries`, and `public.chips_accounts`.

Tasks:

1. Add a read-only operator query or existing-admin-compatible report that finds active human seats where:
   - the seat projection is positive;
   - the current poker state has no stack entry for that user, or has a different stack;
   - the last settlement audit proves the human reached `0`.
2. Inventory historical positive `TABLE_CASH_OUT` entries occurring after an audited stack-0 settlement.
3. Produce counts and transaction IDs only; do not mutate balances in this implementation.
4. Flag ambiguous historical cases for manual review. Do not infer that every mismatch should be reversed.

Acceptance:

- the query is read-only and bounded;
- the observed stage table `7e22c318` is detected;
- no production balance is changed;
- remediation remains a separate owner-approved operation.

### Phase 1 / runtime PR 1 — accounting P0 only

#### `ws-server/poker/engine/poker-engine.mjs`

Change:

- update `buildNextHandStateFromSettled()` so settled rollover carries the proven stack for every active non-bot table member into durable `pokerState.stacks`, including `0`, independently of the next hand's participant arrays;
- preserve the current `MIN_STACK_TO_JOIN_HAND`, `isContinuationEligibleByStack()`, `orderedEligibleSeatMembers()`, `seats`, and `handSeats` behavior in this accounting PR;
- keep `replaceBrokeBotsForNextHand()` bot-only and do not fund humans from SYSTEM accounts;
- do not add presentation status, waiting-for-next-hand behavior, or the 1 CH rule change in this PR.

Invariants:

- a human stack `0` survives rollover as durable evidence;
- hand eligibility and player-visible behavior are unchanged by the P0 accounting fix;
- bot replacement funding behavior remains unchanged.

#### `ws-server/poker/table/table-manager.mjs`

Change:

- extend `prepareSettledHandRollover()` to return a normalized `humanStackUpdates` intent for active non-bot members, including zero;
- project settled human stacks into `nextCoreState.publicStacks` before building the next hand;
- extend `commitSettledHandRollover()` receipt validation so runtime state cannot commit unless the persistence receipt confirms the human stack projection and any bot replacement funding;
- leave `hasActiveHumanMember()` and other lifecycle/presentation behavior unchanged until runtime PR 2.

Properties:

```text
humanStackUpdates[] = {
  userId,
  seatNo,
  stack,
  settledHandId,
  fromStateVersion,
  toStateVersion
}
```

The intent is internal server data, not part of the public WS snapshot.

#### `ws-server/server.mjs`

Change `runSettledRolloverCommand()` and `persistMutatedState()` wiring to pass `humanStackUpdates` through the same prepare → persist → commit boundary already used by bot replacement funding.

Failure behavior:

- if the state CAS or human seat-stack update fails, the DB transaction rolls back;
- runtime remains on the previous settled state;
- the existing bounded/slow settled-rollover retry is used;
- no next hand is broadcast from an uncommitted candidate.

#### `ws-server/poker/persistence/persisted-state-writer.mjs`

Change:

- normalize and validate `humanStackUpdates` against table ID, seat number, state versions, unique user/seat, and non-negative integer stack;
- after successful poker-state CAS and inside the same SQL transaction, update only matching `ACTIVE`, `is_bot = false` seat rows;
- require every intended row to match exactly once;
- return a persistence receipt proving the seat-stack projection was committed;
- do not update bot seat rows through this path and do not change the bot ledger behavior from issue #705.

This makes the following atomic:

```text
poker_state CAS + human poker_seats.stack projection + bot replacement funding
```

#### `shared/poker-domain/inactive-cleanup.mjs` and `shared/poker-domain/leave.mjs`

Add a focused `shared/poker-domain/human-stack-accounting.mjs` helper and use it from both lifecycle modules. Replace the permissive positive fallback with this shared cash-out resolver.

Contract:

- the active lifecycle cash-out amount comes exclusively from the authoritative numeric stack in `poker_state.state.stacks`, including `0`;
- an absent, invalid, or out-of-range authoritative stack is always `stack_ambiguous`, regardless of the value or timestamp in `poker_seats.stack`;
- `poker_seats.stack`, `updated_at`, recent action rows, and the original buy-in are never sufficient fallback evidence for an online cash-out;
- ambiguous cleanup/leave fails closed, logs with `klog`, and requires restore or manual review;
- amount `0` completes lifecycle cleanup without creating a ledger transaction;
- ordinary leave and disconnect cleanup use the same resolver.

Do not use `console.log`. Logs must contain table ID, reason code, source (`authoritative_state` or `ambiguous`), and aggregate amount when proven, without email or profile data.

#### `ws-server/poker/bootstrap/persisted-bootstrap-adapter.mjs`

Change `normalizePublicStacks()` so active human lifecycle restoration requires a valid persisted gameplay stack for every active human seat. A missing human stack is an explicit restore-integrity error and must remain fail-closed; it must not be reconstructed from `poker_seats.stack`. Preserve the existing bot-specific restore rules separately.

Restore acceptance:

- an out-of-chips active human restores with stack `0` and remains seated but not dealt in;
- a human with stack `1` restores without changing the existing PR 1 eligibility policy;
- a stale positive seat row cannot override state stack `0`;
- a missing human state stack cannot be replaced by any seat-row value;
- replacement bot restore behavior stays intact.

### Phase 2 / runtime PR 2 — `OUT_OF_CHIPS` lifecycle and UI

#### `ws-server/poker/engine/poker-engine.mjs` and `ws-server/poker/table/table-manager.mjs`

Change:

- split the current `MIN_STACK_TO_JOIN_HAND` policy into human and bot rules;
- update `isContinuationEligibleByStack()`, `orderedEligibleSeatMembers()`, and `buildNextHandStateFromSettled()` so a human with stack `> 0` is eligible, while bot replacement may retain its existing `< 2` policy;
- formalize table-level seats/stacks as all active table members and `handSeats` as only players dealt into the current hand;
- keep a busted human at table stack `0` but outside `handSeats`;
- make `hasActiveHumanMember()` distinguish table presence from hand eligibility, so a connected out-of-chips human keeps the table experience alive without becoming an action participant;
- do not add rebuy funding, a rebuy command, or `WAITING_NEXT_HAND` in this PR.

Acceptance:

- a human stack `1` can post a partial blind and be all-in;
- a human stack `0` remains table-seated but is never dealt in;
- bot autoplay continues while the human is sitting out;
- the accounting source-of-truth rules from runtime PR 1 remain unchanged.

#### `ws-server/poker/read-model/room-core-snapshot.mjs`

Change:

- merge table members with current hand seats instead of dropping members not present in `handSeats`;
- merge `coreState.publicStacks` with live hand stacks per user instead of choosing one entire map;
- mark a non-bot table seat with authoritative stack `0` as `OUT_OF_CHIPS`;
- add optional `private.playerState` with `status` and `stack` for the authenticated viewer;
- preserve `legalActions.actions = []` for `OUT_OF_CHIPS`.

Snapshot example:

```json
{
  "private": {
    "userId": "...",
    "seat": 1,
    "holeCards": [],
    "playerState": {
      "status": "OUT_OF_CHIPS",
      "stack": 0
    }
  }
}
```

This is an additive WS contract change. `showdown`, `handSettlement`, bot autoplay, and per-pot settlement remain unchanged.

#### `poker/poker-v2.js`

Change snapshot normalization and rendering to:

- prefer `private.playerState` when present;
- show `Out of chips · Sitting out` instead of `Waiting for action` for the hero;
- keep the established action-button positions visible and disabled;
- clear queued pre-actions when status becomes `OUT_OF_CHIPS` or `WAITING_NEXT_HAND`;
- never infer that empty `legalActions` alone means bust;
- render the same state after reconnect or full resync without replaying settlement animation.

The seat can remain reserved while the authenticated WS presence is healthy. Existing disconnect/presence cleanup releases it after disconnect. A forced timeout for a connected watcher is not required in the first release and can be considered separately if seat hoarding becomes a product issue.

### Phase 3 / runtime PR 3 — explicit manual rebuy

#### Rebuy availability contract

Extend `private.playerState` with `canRebuy` only in this PR. It is true only when all of these are true in the same authoritative snapshot:

- the viewer is the authenticated non-bot seat owner;
- table status is `OPEN`;
- authoritative table stack is exactly `0`;
- the user is absent from current `handSeats` after settled rollover;
- the user does not already have a committed `WAITING_NEXT_HAND` rebuy.

During `SETTLED`, the busted user can still be present in the completed hand's `handSeats`; `canRebuy` must remain false in that snapshot. The rollover snapshot that excludes the user from the new hand is the first snapshot allowed to expose `canRebuy: true`. The client must render the rebuy CTA only from explicit `canRebuy === true`, never from stack `0` or empty legal actions alone.

Touchpoints:

- `ws-server/poker/read-model/room-core-snapshot.mjs` derives `canRebuy` from the complete condition above and adds `WAITING_NEXT_HAND` only after a committed rebuy;
- `ws-server/poker/engine/poker-engine.mjs` clears `waitingForNextHandByUserId[userId]` only when rollover actually admits the funded human to a new `handSeats` set;
- `poker/poker-v2.js` shows the rebuy CTA only for explicit `canRebuy === true` and shows `Funded · Joining next hand` for `WAITING_NEXT_HAND`.

#### Shared authoritative domain

Files:

- new `shared/poker-domain/table-buy-in.mjs` containing the existing normalized USER-to-ESCROW `TABLE_BUY_IN` posting operation;
- `shared/poker-domain/join.mjs` changed to use that helper without changing join semantics;
- new `shared/poker-domain/rebuy.mjs` containing `executePokerRebuyAuthoritative()`;
- new `ws-server/shared/poker-domain/rebuy.mjs` re-exporting the shared domain entrypoint.

Add `executePokerRebuyAuthoritative()` with these preconditions:

- authenticated non-bot user;
- table status `OPEN`;
- user owns an `ACTIVE` seat at that table;
- authoritative table stack is exactly `0`;
- user is absent from current `handSeats` after authoritative rollover;
- requested amount is exactly 100 CH for the first release;
- request ID is present.

Inside one SQL transaction:

1. call the existing `ensurePokerRequest()` pattern with kind `REBUY`; return the previously stored result for an identical completed request before evaluating current stack preconditions;
2. lock table, seat, and poker state;
3. validate the authoritative out-of-chips state;
4. CAS/update poker state to add stack `100` and `waitingForNextHandByUserId[userId] = true` without adding the user to current `handSeats`;
5. post existing `TABLE_BUY_IN` entries `USER -100` and `ESCROW +100` through `postUserTableBuyIn()`;
6. update `poker_seats.stack = 100`;
7. update table activity and store the successful poker request result in the same transaction;
8. commit and return the new state version plus ledger receipt.

Recommended idempotency key:

```text
poker:rebuy:v1:<tableId>:<userId>:<requestId>
```

The amount remains in the ledger payload hash. Reusing a request ID with a different amount must be rejected as a mismatch, not treated as a second operation. The stored `poker_requests` result supplies process-restart replay semantics before the already-funded stack would otherwise fail the `stack === 0` precondition.

Failure behavior:

- insufficient USER balance: reject with `insufficient_chips`, no state or seat change;
- state/CAS conflict: rollback, restore authoritative table, no debit;
- duplicate same request and payload: return the original successful result;
- duplicate request with different payload: reject;
- table closed, seat released, stack no longer zero, or user already in a hand: reject without ledger writes;
- process failure before SQL commit: no visible runtime change;
- process failure after SQL commit: reconnect/restore shows `WAITING_NEXT_HAND` and does not fund again.

#### WS command path

Files and touchpoints:

- new `ws-server/poker/persistence/authoritative-rebuy-adapter.mjs` following the join/leave adapter pattern;
- new `ws-server/poker/handlers/rebuy.mjs`;
- `ws-server/server.mjs` dispatch for canonical `table_rebuy` and client alias `rebuy`;
- `poker/poker-ws-client.js` method `sendRebuy(payload, requestId)`;
- `docs/ws-poker-protocol.md` request/result and additive snapshot fields.

After authoritative rebuy succeeds, restore or apply the committed state, broadcast one snapshot, and schedule normal settled rollover/bot autoplay. Do not hand-build a client-only stack update.

#### UI

Files:

- `poker/table-v2.html`;
- `poker/poker-v2.js`;
- `poker/poker-v2.css`;
- existing `window.ChipsClient.fetchBalance()` for the displayed Arcade balance; do not add a second balance endpoint.

UI behavior:

- show a prominent non-destructive panel or modal after settlement: `Out of chips`;
- explain that the player is sitting out while the table continues;
- primary CTA: `Buy in 100 CH`;
- secondary CTA: `Return to lobby`;
- optional tertiary action: close the prompt and keep watching without re-enabling poker actions;
- show pending state while the command is in flight and prevent duplicate clicks;
- on success show `Funded · Joining next hand` until rollover admits the player;
- on insufficient balance show the controlled error and a link to the account/chips surface;
- preserve a stable action-button layout and mobile readability.

Modify the existing external scripts only. Do not add inline JavaScript, a new script tag, CSP SHA, or external image origin. JavaScript must remain compatible with the existing page/JSP-compatible browser style. CSS must use one line per selector.

### Tests required by the accounting risk

Keep the suite focused on critical invariants.

#### Deterministic unit tests

Files:

- `ws-server/poker/engine/engine-rollover.behavior.test.mjs`;
- `ws-server/poker/read-model/room-core-snapshot.behavior.test.mjs`;
- new `shared/poker-domain/human-stack-accounting.behavior.test.mjs`.

Cases:

- runtime PR 1: settled human stack `0` remains in the authoritative stack map even when that user is absent from next-hand participant arrays;
- runtime PR 1: state stack `0` cannot be overridden by seat stack `100`;
- runtime PR 1: missing state plus any seat projection returns `stack_ambiguous`;
- runtime PR 1: broke bot replacement behavior is unchanged;
- runtime PR 2: human `0` remains table-seated, is excluded from `handSeats`, and derives `OUT_OF_CHIPS`;
- runtime PR 2: human `1` enters the next hand and posts a partial blind;
- runtime PR 3: `WAITING_NEXT_HAND` and rebuy availability are derived deterministically.

The accounting PR must not be expanded merely to share one combined test file.

#### Transaction and integration tests

Files:

- `ws-server/poker/persistence/persisted-state-writer.behavior.test.mjs`;
- `shared/poker-domain/inactive-cleanup.behavior.test.mjs`;
- `shared/poker-domain/leave.behavior.test.mjs`;
- new `shared/poker-domain/rebuy.behavior.test.mjs`;
- new `ws-server/poker/persistence/authoritative-rebuy-adapter.behavior.test.mjs`;
- new `ws-server/poker/handlers/rebuy.behavior.test.mjs`;
- `ws-server/poker/reconnect/resync.behavior.test.mjs`;
- `tests/poker-ws-client.test.mjs`;
- `tests/poker-v2-live.behavior.test.mjs`.

Cases:

1. bust `100 → 0`, rollover, disconnect cleanup: cash-out is `0`, not `100`;
2. bust, rollover, explicit leave: cash-out is `0`;
3. state CAS failure: seat projection and runtime do not commit;
4. runtime PR 1 restart after bust: authoritative stack remains `0`, cleanup remains safe, and no stale refund occurs;
5. successful rebuy: `USER -100`, `ESCROW +100`, seat/state stack `100` exactly once;
6. same rebuy request twice: one ledger transaction;
7. failed ledger funding: no persisted or runtime stack change;
8. rebuy during a bot hand: hero stays out of current `handSeats` and enters only the next hand;
9. restart after committed rebuy: `WAITING_NEXT_HAND` restores without a second debit;
10. leave after funded rebuy but before the next hand: exactly 100 CH is returned;
11. reconnect/resync at stack `0`: static out-of-chips UI, no actions;
12. action buttons remain stable and disabled while the rebuy prompt is visible.
13. completed-hand `SETTLED` snapshot with the busted user still in `handSeats`: `canRebuy` is false and no rebuy CTA is rendered;
14. first authoritative post-rollover snapshot without that user in `handSeats`: `canRebuy` is true and the rebuy CTA is rendered.
15. runtime PR 2 restart/reconnect after bust: the player renders as `OUT_OF_CHIPS` without rebuy behavior being present yet.

Ledger invariants:

```text
rebuy USER delta == -100
rebuy table ESCROW delta == +100
sum(rebuy entries) == 0
cash-out after audited bust == 0
```

### Manual verification

PR #713 requires both WS Preview Deploy and Netlify Deploy Preview. Verify the three phases in order on that shared preview: accounting and ledger evidence first, then out-of-chips lifecycle/UI, then explicit rebuy.

On stage:

1. buy in for 100 CH and record user/escrow balances;
2. lose the full stack naturally or through a controlled test table;
3. verify settlement, `Out of chips · Sitting out`, disabled stable actions, and continuing bots;
4. disconnect and reconnect before rebuy; verify stack remains `0` and no refund occurs;
5. rebuy 100 CH; verify one user debit, one escrow credit, and `Joining next hand`;
6. verify no cards/actions in the already-running hand;
7. verify normal participation in the next hand;
8. repeat the same request ID and verify no second debit;
9. test insufficient balance;
10. test `Return to lobby` both before and after a successful rebuy;
11. verify mobile layout and keyboard focus;
12. inspect `klog` for controlled reason codes and absence of email/token data.

### Rollout and rollback

Rollout order:

1. run the read-only discrepancy inventory on stage and production;
2. deploy PR #713 to WS Preview and Netlify Preview;
3. verify bust → rollover → disconnect/leave produces zero cash-out before testing rebuy;
4. verify 1 CH, `OUT_OF_CHIPS`, stable actions, reconnect, and continued bot play;
5. smoke-test the complete explicit rebuy flow, including the post-rollover `canRebuy` boundary, duplicate request, insufficient balance, and leave-before-next-hand behavior;
6. deploy the merged WS server to production before the web release can send `table_rebuy`;
7. verify one production bust/rebuy lifecycle and monitor ambiguous cash-out, rebuy failure, duplicate, and restore logs.

Rollback:

- accounting safety can be rolled back only after confirming no active table relies on the new preserved-zero/waiting state;
- after a rebuy has committed, do not roll WS back to a version that cannot understand `waitingForNextHandByUserId`; drain or close active affected tables first;
- browser rollback is safe because snapshot fields are additive, but the old UI will not offer rebuy;
- never reverse ledger entries automatically during rollback;
- historical incorrect cash-outs remain manual-review items.

### Breaking-impact analysis

No intended breaking changes:

- no DB migration;
- no new ENV or secret;
- no new CSP source or inline script;
- no changes to hand ranking, pot settlement, bot strategy, or replacement funding;
- `private.playerState` and `OUT_OF_CHIPS` seat status are additive;
- old snapshots without the fields remain accepted by the client.

Potentially breaking internal semantics:

- `pokerState.seats` becomes the table-seat set while `handSeats` is the dealt-player set; every engine/reducer caller that falls back from `handSeats` to `seats` must be audited;
- human stack `1` becomes eligible instead of silently excluded;
- cleanup and leave will fail closed for ambiguous legacy positive seat projections instead of paying them automatically;
- `poker_seats.stack` is no longer accepted as cash-out evidence when the active lifecycle stack is missing, even when its timestamp is recent;
- runtime rollover commit receipts gain mandatory human projection evidence;
- deployment order matters because old WS code does not understand committed waiting-for-next-hand rebuys.

Operational impact:

- support may see `stack_ambiguous` cases requiring manual review;
- the read-only inventory may reveal historical stage or production discrepancies;
- the observed stage refund must not be used as an automatic remediation template for all historical rows.

### Definition of Done

- A human who reaches `0` is never dealt into the next hand and receives no legal poker actions.
- The UI says `Out of chips`, not merely `Waiting for action`.
- The player can explicitly rebuy or leave; no silent ledger debit occurs.
- Other funded seats continue playing.
- A successful rebuy moves exactly the confirmed amount from USER to ESCROW once and seats the player only in a later hand.
- A failed or duplicated rebuy cannot create chips or debit twice.
- A busted player who leaves or disconnects receives `0`, not the original buy-in.
- Restore and cleanup cannot replace an authoritative `0` with a stale positive seat stack.
- A human with 1 CH can post a partial blind rather than being silently stranded.
- Accounting and rebuy tests listed above are green.
- Stage inventory and manual WS Preview smoke tests are complete.
- Auto-rebuy remains absent from runtime and tracked only by issue #712.

## Conclusion

The observed inability to act after losing the stack is expected at the poker-action layer, but the surrounding lifecycle and UX are incomplete. The professional cash-game response is a sitting-out/out-of-chips state with an explicit rebuy offer and a lobby exit, while play continues for funded participants.

The immediate priority is not the modal. It is fixing the stack source of truth that caused an incorrect 100 CH refund after this bust. Once cash-out integrity is guaranteed, manual rebuy is the smallest safe and user-friendly next feature.
