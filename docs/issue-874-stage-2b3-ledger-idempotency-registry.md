# Issue #874 — Stage 2B.3: durable online transaction idempotency registry

Stage 2B.3 adds a durable identity record for every chips transaction. It keeps
the idempotency contract available after a future verified archive/delete stage
removes the full hot transaction and entry rows. This stage does not archive,
delete, prune, or upload ledger data.

## Caller audit

`netlify/functions/chips-tx.mjs` returns the complete `transaction`, `entries`,
and current `account` for `BUY_IN` and `CASH_OUT`. `leave.mjs` requires only
`result.transaction.id` for `TABLE_CASH_OUT`. The WS persistence writer requires
`transaction.id` and `transaction.payload_hash` for technical `TABLE_BUY_IN`.

The additional current full-result callers are the welcome-bonus endpoint,
bonus-campaign flow, and admin ledger adjustment endpoint. Their transaction
types are `WELCOME_BONUS`, `PROMO_BONUS`, and `ADMIN_ADJUST`, respectively.
Other current callers ignore the result or use only the technical receipt.

## Registry schema and invariants

`public.chips_transaction_idempotency` has `idempotency_key` as its only key and
stores `transaction_id`, `payload_hash`, `tx_type`, normalized `user_id`, the
original transaction timestamp, optional full replay snapshots, and creation
time. It has no foreign keys to the ledger, accounts, or Auth users, so the row
survives future ledger retention.

The migration backfills exactly one row per existing transaction. Full replay
snapshots are stored for `BUY_IN`, `CASH_OUT`, `WELCOME_BONUS`, `PROMO_BONUS`,
and `ADMIN_ADJUST`; all entries are ordered by `entry_seq`. Other types retain
identity only.

The migration fails if a full-replay transaction has no entries or is not
balanced. It does not modify ledger rows or balances. RLS is enabled and
`anon`/`authenticated` have no privileges or policies.

An `AFTER INSERT` trigger captures identity in the same database transaction.
A registry guard rejects `DELETE`, identity changes, and any replacement or
clearing of a completed replay snapshot. The only replay transition is empty to
complete.

## Runtime contract

After payload validation and `payload_hash` calculation, `postTransaction()`
reads the registry before attempting a new ledger transaction. It compares
normalized owner (`payloadUserId || null`), `tx_type`, and `payload_hash`.
Any mismatch returns HTTP `409` through the existing endpoint mapping.

For a matching key, runtime first tries the existing hot transaction snapshot.
If it is absent, full-result types use the immutable registry transaction and
entry snapshots plus the current user account snapshot. Technical types return
the original transaction id and the basic identity fields required by current
callers. A missing required snapshot fails closed with
`chips_idempotency_replay_unavailable`; runtime never reads Storage.

New transactions keep the existing transaction, balance, and entry writes in
one database transaction. The insert trigger creates the identity row, and
full-result types conditionally fill the replay snapshot in the same
transaction. A snapshot failure rolls back the new ledger transaction. A
savepoint handles a concurrent unique-key race before resolving the
authoritative registry row.

## Stage measurement and capacity horizon

The Stage run must record transaction/registry parity, missing or mismatched
rows, incomplete full snapshots, table/index/total bytes, replay snapshot
bytes, average bytes per registry row, and projections for 2,880 transactions
per day. The projection is linear:

- 30 days: `86,400` registry rows at the measured average bytes per row;
- one year: `1,051,200` registry rows at the measured average bytes per row.

The registry is therefore not a bounded-growth solution. It must be compared
with the current Production ledger baseline of 34,261 transactions,
68,522 entries, and 55,017,472 combined bytes. If the registry is not
materially smaller than the full ledger, 2B.4 design work must stop for a
capacity review.

## Preconditions for Stage 2B.4

Before any future ledger removal, 2B.4 must require a registry row for every
candidate transaction, matching identity fields, a complete replay snapshot
for every full-result type, and a committed, independently verified archive.
Those deletion preconditions are documented only; this stage does not
implement them.

## Scope boundary

This PR does not modify the existing Stage 2B.2 Storage object or manifest,
does not upload or delete Storage objects, does not delete or prune ledger
rows, and does not alter balances, conservation, entry sequencing, UI/API
history, or browser code. There are no new persistent environment variables
and no Production migration or rollout.

Breaking impact is expected to be none: existing replay/conflict responses and
the full results consumed by current callers remain unchanged.
