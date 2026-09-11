# Phase 0 Research: Historical Missing-Table Bot Identity Retirement

## Inputs and freshness

The primary input is the accepted research comment on GitHub issue #978, titled “Research result — 2026-09-11”, created 2026-09-11T08:24:53Z. It measured canonical Stage project `krydukthwdvccggbyjfw` with PostgreSQL system identifier `7656985631720456337` and recorded:

- approximately 102.2k registry rows;
- 99,874 bot-internal TABLE identities in the four observed families;
- 21,614 new rows in seven days, about 3,088 per day;
- 268 human TABLE identities;
- 42 non-TABLE full-replay identities;
- 2,052 legacy or unknown TABLE identities;
- about 33.7k older TABLE identities pointing to missing `poker_tables` rows;
- 10,183 missing-table bot-internal identities already mapped to the 30-day archive policy, with no hot transactions;
- 10,080 of those identities in complete whole-batch shape and 103 in mixed batches.

The live GitHub `main` at planning time is `25d5a7b9c5b13caf6948e97c4435d065c5d76e02`, the merge commit for PR #979. The relevant live paths under `supabase/`, `scripts/ops/`, and `tests/` have no changes relative to the research code commit `78b0b50b831e7ef8dd6c1113fddfb8ad1cd501ea`; the intervening changes are Spec Kit and governance artifacts. The live repository therefore remains the current code authority, while the counts above remain historical measurements.

The workspace has no Stage PostgreSQL URL or credentials. The Supabase project listing confirms that the canonical Stage project exists and is healthy, but it cannot provide a usable database session for a candidate query in this planning run. The plan therefore requires a fresh, bounded, read-only Stage audit before any migration application or owner GO. The estimate of 10,080 is never used as a hard-coded target.

## Existing mechanism inventory

| Existing mechanism | Current behavior | V1 reuse or boundary |
|---|---|---|
| `chips_ledger_archive_pruner` | Restricted role owns the archive/proof/prune functions and has the narrow table privileges needed for them. Direct registry deletion is guarded. | Own the new `SECURITY DEFINER` function; keep execution restricted to the existing operator role. |
| `chips_assert_archive_prune_stage()` | Verifies the physical PostgreSQL system identifier is canonical Stage and rejects the known Production identity. | Call before any V1 mutation and retain the exact Stage project-ref check. |
| `chips_table_fence_is_active()` and `chips_table_fence_control.enforcement_active` | The TABLE transaction fence is the database boundary that rejects new TABLE work for missing or closed tables before an economic effect. | Require both active/enforced state immediately before registry deletion; never toggle the fence. |
| `chips_parse_table_idempotency_key(text)` | Authoritative immutable parser for version-1 TABLE keys, including the four observed bot-internal families and table UUID extraction. | Re-parse every candidate inside the database operator; compare parsed table ID and format with stored registry fields. |
| `chips_archive_text_ids_sha256(text[])` | Immutable canonical hash over sorted text identities. | Hash the exact sorted `archive_batch_id` registry set and compare it with the audit-supplied count/SHA and later receipt. |
| `chips_ledger_archive_batches.archive_batch_id` mapping | Registry mapping has a foreign key to the durable batch and the current guard prevents replacing or clearing an existing mapping. | Use it as the complete-batch boundary; derive all rows from the locked batch rather than adding a tombstone or archive table. |
| `registry_cleaned_at`, `registry_cleaned_key_count`, `registry_cleaned_keys_sha256` | Existing immutable cleanup receipt used by schema-v2 bot-only and other lifecycle paths. | Extend its check constraint and the current archive-batch trigger with one exact v1/source-policy state; write the receipt atomically after the exact delete. |
| `chips_prune_committed_archive_batch(...)` | Generic operator that verifies archive evidence and removes hot ledger transactions/entries. | Do not call it for V1: the required ledger prune is already complete and repeating it would widen the mutation surface. |
| `chips_prune_and_cleanup_bot_only_archive_batch(...)` | #890 schema-v2 operator for a present, `CLOSED`, bot-only table, with bot-only proof and persisted GO state. | Leave it unchanged. Its present-table lifecycle gate cannot prove the missing-table state required by #978. |
| `createPruneStore(sql)` in `scripts/ops/chips-ledger-archive-prune.mjs` | Provides the existing PostgreSQL connection, identity lookup, serializable transaction, lock timeout, statement timeout, and lifecycle operator call patterns. | Reuse the identity/connection patterns; add only a narrow method or direct call for the new function in the new wrapper. |
| `validateStageEnvironment()` and Stage constants in `scripts/ops/chips-ledger-stage-automation.mjs` | Rejects Production credential names and validates canonical Stage URL/DB reference. | Reuse for the manual wrapper; do not call the scheduled automation or alter its workflow. |
| `scripts/ops/_shared/chips-table-idempotency.mjs` | Strict JavaScript mirror of the PostgreSQL parser for diagnostics. | Use only as a conservative diagnostic aid if needed; PostgreSQL remains authoritative for eligibility. |

## Current code and contract findings

The registry stores `transaction_id`, `tx_type`, `user_id`, `transaction_created_at`, `archive_batch_id`, `table_id`, `key_format_version`, and `key_format`. The archive batch stores immutable status, policy, transaction/entry counts, archive proof fields, prune receipt fields, and the existing cleanup receipt fields. This is enough to prove the historical ledger side without adding a second source of truth.

The latest archive-batch mutation guard has three relevant properties:

1. Archive proof, prune receipt, bot-only proof, cleanup receipt, and destructive GO fields are write-once and cannot be replaced or cleared.
2. Archive proof and prune receipt must be completed in separate transitions; prune receipt and registry cleanup receipt must also be separate.
3. Registry deletion is allowed only for `chips_ledger_archive_pruner` with the transaction-local `chips.bot_registry_cleanup = '1'` latch. The cleanup receipt is allowed only for the same role with `chips.bot_cleanup_receipt = '1'`.

The current cleanup constraint and trigger only admit the schema-v2 bot-only cleanup state. A migration must update both definitions together. Merely changing the check constraint would leave the trigger rejecting the v1 receipt, while broadly weakening the trigger would compromise #890. The v1 branch must be limited to `format_version = 1` and the exact `stage-ledger-auto-retention-30d-v1` policy.

The current #890 function invokes a lifecycle gate that requires a `poker_tables` row and a `CLOSED` bot-only state. The missing-table class cannot be routed through that function. Reusing its delete/receipt role latches and exact-retry shape while implementing a separate absent-row predicate is the smallest safe distinction.

The existing Node exporter has broad live-transaction selectors for producing archives. They are unsuitable as a retirement selector because V1 operates after archive and prune. The new audit should start from durable archive batches and registry mappings, then invoke the new SQL function in prepare-only mode for strict per-batch validation. This avoids a new generic classification framework and avoids re-running the archive pipeline.

## Eligibility proof assembled from existing evidence

The exact batch validator must treat the following as one indivisible conjunction:

1. Physical database is canonical Stage; batch project ref is `krydukthwdvccggbyjfw`.
2. Batch is committed, has `format_version = 1`, and has exactly `source_policy_id = 'stage-ledger-auto-retention-30d-v1'`.
3. Archive proof is complete and verified; prune receipt is complete and exact against archive transaction/entry proof and batch counts.
4. The registry mapping set for the batch is non-empty and its derived count equals `transaction_count`.
5. Every row is a `TABLE_BUY_IN` or `TABLE_CASH_OUT` with `user_id is null`, `key_format_version = 1`, and one of the four supported bot-internal formats.
6. The authoritative SQL parser succeeds for every key, returns version 1, and yields a table ID equal to stored `registry.table_id`; stored format also agrees.
7. Every derived table ID has no row in `poker_tables`, with no attempt to distinguish or repair missing lifecycle state.
8. No derived transaction ID has a row in `chips_transactions` or `chips_entries`.
9. The derived keys are sorted, exact, and hashed with `chips_archive_text_ids_sha256`; the count and SHA match the operator input and, after execution, the immutable cleanup receipt.
10. A single transaction performs either no mutation (`ready`) or the exact batch registry delete plus receipt update (`retired`).

An unsupported key is not parsed by a permissive fallback. The validator rejects the whole batch. The same whole-batch rule applies to one human identity, one existing table, one hot row, one parser mismatch, or one count/hash discrepancy.

## Alternatives considered

### Generic age-based registry deletion

Rejected because age and archive mapping do not establish replay or duplicate-prevention safety. The accepted research isolates a historical missing-table cohort with a database rejection fence; other classes remain retained.

### New per-key tombstone or generic registry archive

Rejected because it recreates an unbounded identity store or introduces a second authoritative replay path. Existing immutable batch mappings and cleanup receipts are sufficient for this finite cohort.

### Reuse the existing #890 bot-only operator unchanged

Rejected because its lifecycle gate requires an existing `CLOSED` bot-only table and its schema-v2 proof contract is intentionally owned by #890. V1 reuses the shared role, proof, hash, fence, and receipt primitives but has a separate missing-table predicate.

### Add a persistent scheduler or automatic draining loop

Rejected because the research found a finite historical gap and the feature explicitly requires manual, bounded, exact-batch execution. A new scheduler would widen the safety and ownership surface without evidence that new missing-table rows are being created.

### Store another registry-key hash column

Rejected for the initial design. The exact set is derivable from the immutable `archive_batch_id` mapping under the locked batch, and the existing `registry_cleaned_*` fields persist the resulting count/SHA. A new column is unnecessary unless implementation validation shows that the current mapping or receipt cannot provide this proof.

## Research conclusions and unresolved operational inputs

The live code supports a narrow additive v1 receipt/operator path without runtime changes. The four-family, null-user, parser-bound, absent-table, complete-proof, exact-pruned, no-hot-row, exact-whole-batch predicate is sufficiently specific to keep human, full-replay, legacy/unknown, and normal #890 identities outside the mutation.

The remaining operational input is a fresh read-only Stage measurement. It must verify current candidate count, policy distribution, batch mixing, exact hashes, fence state, and residual growth immediately before any migration application or GO. No destructive Stage action was performed during research or planning.
