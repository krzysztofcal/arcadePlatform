# Data Model: Historical Missing-Table Bot Identity Retirement

The feature uses existing tables and receipt columns. It adds no generic archive table, tombstone table, classification table, scheduler state, or replay source.

## Existing durable entities

### `public.chips_ledger_archive_batches`

This row remains the durable unit of work and the audit anchor.

| Property | V1 meaning | Required relationship or invariant |
|---|---|---|
| `batch_id` | Exact whole-batch identifier | Selected explicitly; never inferred from a range or age-only query. |
| `project_ref` | Archive target | Must equal `krydukthwdvccggbyjfw`. |
| `format_version` | Archive schema | Must be `1` for this feature. |
| `source_policy_id` | Archive policy identity | Must equal exactly `stage-ledger-auto-retention-30d-v1`. |
| `status`, `committed_at` | Archive commit state | Must be committed with a non-null commit timestamp. |
| `transaction_count`, `entry_count` | Immutable archive cardinalities | Prune receipt counts must equal these values and be positive. |
| `archived_transaction_ids_sha256`, `archived_entry_ids_sha256`, `archive_proof_verified_at` | Archive proof | All three must be complete before retirement. |
| `pruned_at`, `pruned_transaction_count`, `pruned_entry_count`, `pruned_transaction_ids_sha256`, `pruned_entry_ids_sha256` | Ledger prune receipt | All five must be complete, count-equal to the batch, and hash-equal to archive proof. |
| `registry_cleaned_at` | Cleanup completion timestamp | Null before retirement; immutable after a successful receipt. |
| `registry_cleaned_key_count` | Number of registry identities retired | Must equal the derived `registry_count` and `transaction_count`. |
| `registry_cleaned_keys_sha256` | Canonical sorted identity-set hash | Must equal the derived `chips_archive_text_ids_sha256` result and remain immutable. |

The existing `chips_ledger_archive_batches_cleanup_receipt_check` retains all of its effective states: the all-null receipt; the unchanged `format_version = 2`, `stage-ledger-bot-only-retention-7d-v1` bot-only receipt with its bot-proof hash; and the unchanged `format_version = 2`, `legacy_stage_allowlist_v1` receipt with its existing proof/prune/count/hash conditions. It gains one narrowly scoped valid state only for `format_version = 1` and `source_policy_id = 'stage-ledger-auto-retention-30d-v1'`. The migration must derive the current effective `chips_guard_archive_batch_mutations()` body after all prior migrations, including the closed-human patch, and add only the matching v1 cleanup branch. It must preserve write-once and separate-transition behavior, the legacy cleanup/proof basis, schema-v2 `chips.bot_only_go`, and closed-human `chips.closed_human_go` GO behavior. The legacy `chips.legacy_stage_cleanup` and registry-delete guard path remain unchanged.

The existing `destructive_go_at` and `destructive_go_batch_id` properties remain owned by the current policy-specific authorization paths. V1 uses the exact `GO <batch_id>` value as a transient function input and does not add a second persistent authorization record.

### `public.chips_transaction_idempotency`

Each row is an identity included in the exact batch only when all of these properties hold:

| Property | V1 rule |
|---|---|
| `idempotency_key` | Non-null primary identity; included in the derived sorted set. |
| `transaction_id` | Used to prove no hot `chips_transactions` or `chips_entries` remain. |
| `tx_type` | Exactly `TABLE_BUY_IN` or `TABLE_CASH_OUT`. |
| `user_id` | Must be null. |
| `transaction_created_at` | Historical archive identity; no new age-only decision is made from it. |
| `archive_batch_id` | Must equal the selected `batch_id`; the existing foreign key and write-once guard make this the whole-batch boundary. |
| `table_id` | Must be non-null and equal to the table ID returned by the authoritative SQL parser. |
| `key_format_version` | Exactly `1`. |
| `key_format` | Must match the parser and be one of `managed-bot-seed-buyin`, `bot-seed-buyin`, `poker:bot-replacement-buyin:v1`, or `poker:bot-terminal-cashout:v1`. |
| replay fields | Not used as a substitute for the missing-table fence; human/full-replay rows are outside V1. |

The operator derives all registry rows with the selected `archive_batch_id`, sorts `idempotency_key` values, computes the canonical SHA using `chips_archive_text_ids_sha256(text[])`, and requires the derived count to equal the archive batch `transaction_count`. The delete predicate is the batch mapping itself, so a client cannot select a subset of keys.

### `public.chips_transactions` and `public.chips_entries`

These are read-only safety evidence for this operation. For every registry `transaction_id` in the derived set:

- no row may remain in `chips_transactions`;
- no row may remain in `chips_entries`;
- no delete, insert, balance update, sequence update, or ledger mutation is performed by the V1 operator.

The absence of hot rows proves that V1 is a registry retirement after the existing ledger prune, rather than a combined archive/prune operation.

### `public.poker_tables`

The authoritative row must be absent for every parsed/stored `table_id`. A present row in any state, including `OPEN` or `CLOSED`, rejects the entire batch. V1 never deletes, updates, recreates, or marks a table row. Normal `CLOSED` bot-only rows remain under #890 and are not part of this entity relationship.

### `public.chips_table_fence_control`

The singleton `enforcement_active` property and `chips_table_fence_is_active()` result must both be true in the execute transaction immediately before registry deletion. The operator does not change this control row. This fence is the post-retirement rejection boundary for a later reuse attempt.

## Derived audit entities

### `MissingTableBotRetirementCandidate`

This is an in-memory/read-only audit projection, not a new database table. One candidate represents one complete archive batch and contains:

- `batch_id`, `project_ref`, `source_policy_id`, `format_version`, `status`;
- archive proof and exact prune receipt state;
- derived `registry_count`, `transaction_count`, and `entry_count`;
- `registry_keys_sha256` computed from the sorted mapped keys;
- counts by the four allowed key formats and TABLE transaction type;
- parsed/stored table ID count and missing `poker_tables` count;
- hot transaction and entry counts;
- a final `ready`, `already_retired`, or fail-closed reason.

The audit may report rejected batch reasons for operator visibility, but no rejected projection is executable. It does not persist classification or eligibility state.

### `RetirementOutcome`

The SQL function and wrapper return one of these states:

| State | Meaning | Mutation |
|---|---|---|
| `ready` | All predicates pass in prepare-only mode | None. |
| `retired` | Exact batch registry rows were deleted and the receipt committed | One atomic registry delete plus receipt update. |
| `already_retired` | Existing receipt matches the supplied batch count/SHA and no residual mapping exists | None. |
| rejected/error | Any guard, authorization, target, parser, lifecycle, proof, count, hash, or concurrency condition failed | Transaction rolls back; no economic mutation. |

## Protected identity classes

The following rows are deliberately not valid `MissingTableBotRetirementCandidate` members:

- human TABLE identities, regardless of age or archive state;
- `BUY_IN`, `CASH_OUT`, `WELCOME_BONUS`, `PROMO_BONUS`, and `ADMIN_ADJUST` identities requiring full replay;
- legacy or unknown key formats;
- any non-null `user_id` or non-TABLE transaction type;
- any identity with an existing `poker_tables` row, including normal CLOSED bot-only lifecycle rows;
- any hot transaction or entry;
- any row in a partial, mixed, unparseable, or otherwise ambiguous batch.

## State transitions

1. An existing committed v1 archive batch has complete archive proof and exact prune receipt, with `registry_cleaned_*` all null.
2. A read-only audit derives and verifies the complete mapped registry set. It returns `ready` only when every row and batch guard passes.
3. An explicit exact-batch GO invokes the serializable operator. The operator rechecks the full state, deletes all rows mapped to that batch, verifies the affected-row count, and writes the immutable cleanup receipt before commit.
4. A subsequent exact retry checks the stored receipt and absence of residual mappings and returns `already_retired`.
5. A later reuse of a retired bot-internal key reaches the existing TABLE fence and may return terminal `table_closed`/retired rejection. It must not create a second transaction, entry, balance mutation, or provenance change.

Any failed transition remains at its prior durable state. There is no partial-batch state and no per-key tombstone state.
