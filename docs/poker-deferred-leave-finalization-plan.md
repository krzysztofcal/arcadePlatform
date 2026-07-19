# Poker deferred leave finalization plan

## Root cause

An authoritative leave during a live hand sets `leftTableByUserId[userId] = true` but retains the player's state and persistent seat until settlement. Bot autoplay settles later, outside the leave transaction, and no post-settlement operation removes the retained seat. The janitor then sees an `ACTIVE` human seat and keeps the table open.

## Implementation

1. Reuse the existing authoritative human `TABLE_CASH_OUT` operation in `shared/poker-domain/leave.mjs`.
2. Add `finalizeDeferredLeavesAfterSettlement()`. In one SQL transaction it locks table, state, and seats and collects active human seats flagged in `leftTableByUserId`.
3. If another active human remains, cash out deferred leavers from authoritative `state.stacks`, remove them from state and `poker_seats`, and persist one CAS before rollover.
4. If no active human remains, delegate directly to `executeTerminalPokerCloseInTx()`. The server trusts its controlled result and does not duplicate escrow validation.
5. Invoke finalization after the settlement reveal delay and before replacement funding or next-hand preparation. Restore runtime after every committed change.
6. Make the janitor ignore a persisted `seat.user_id` explicitly flagged in `leftTableByUserId` as defense in depth.

Failures roll back and prevent rollover. Retryable DB/CAS failures use settled-rollover retry; `terminal_accounting_invariant_failed` remains reserved for the existing terminal accounting invariant. Repeated finalization is a no-op and ledger cash-outs use deterministic idempotency keys.

## Verification and impact

Cover a deferred leaver with another human remaining, the last human leaving, retry/idempotency, rollback, terminal close failure, and janitor `user_id` mapping. Verify on Netlify Deploy Preview with a manual WS Preview Deploy. There are no migrations, new environment variables, CSP changes, poker-rule changes, or WS frame changes.

The separate in-memory `guest_table_*` lifecycle is outside this PR; the reported UUID table was a persistent cash table.
