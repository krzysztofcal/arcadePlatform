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
| `registry_cleaned_at`, `registry_cleaned_key_count`, `registry_cleaned_keys_sha256` | Existing immutable cleanup receipt used by schema-v2 bot-only and `legacy_stage_allowlist_v1` lifecycle paths. | Preserve the all-null state, the schema-v2 bot-only state, and the legacy state exactly; add one exact v1/source-policy state and write it atomically after the exact delete. |
| `chips_prune_committed_archive_batch(...)` | Generic operator that verifies archive evidence and removes hot ledger transactions/entries. | Do not call it for V1: the required ledger prune is already complete and repeating it would widen the mutation surface. |
| `chips_prune_and_cleanup_bot_only_archive_batch(...)` | #890 schema-v2 operator for a present, `CLOSED`, bot-only table, with bot-only proof and persisted GO state. | Leave it unchanged. Its present-table lifecycle gate cannot prove the missing-table state required by #978. |
| `createPruneStore(sql)` in `scripts/ops/chips-ledger-archive-prune.mjs` | Provides the existing PostgreSQL connection, identity lookup, serializable transaction, lock timeout, statement timeout, and lifecycle operator call patterns. | Reuse the identity/connection patterns; add only a narrow method or direct call for the new function in the new wrapper. |
| `createPruneStore(sql).getIdentity()` in `scripts/ops/chips-ledger-archive-prune.mjs` and `chips_assert_archive_prune_stage()` | Existing DB-only physical identity lookup and database-side Stage assertion. | Use with `SUPABASE_STAGE_DB_URL` and canonical Stage constants in the new wrapper. Do not require the REST URL or service-role key, and do not expand `validateStageEnvironment()` in `scripts/ops/chips-ledger-stage-automation.mjs`. |
| `scripts/ops/_shared/chips-table-idempotency.mjs` | Strict JavaScript mirror of the PostgreSQL parser for diagnostics. | Use only as a conservative diagnostic aid if needed; PostgreSQL remains authoritative for eligibility. |

## Current code and contract findings

The registry stores `transaction_id`, `tx_type`, `user_id`, `transaction_created_at`, `archive_batch_id`, `table_id`, `key_format_version`, and `key_format`. The archive batch stores immutable status, policy, transaction/entry counts, archive proof fields, prune receipt fields, and the existing cleanup receipt fields. This is enough to prove the historical ledger side without adding a second source of truth.

The effective archive-batch contract is the result of all migrations currently on live `main`, rather than the body of an older migration copied forward. The relevant parts are:

1. `chips_ledger_archive_batches_cleanup_receipt_check` from `20260825100000_chips_ledger_legacy_stage_allowlist_cleanup_hardening.sql` accepts the all-null receipt state; the `format_version = 2`, `source_policy_id = 'stage-ledger-bot-only-retention-7d-v1'` state with its bot-proof hash; and the `format_version = 2`, `source_policy_id = 'legacy_stage_allowlist_v1'` state with its existing proof/prune/count/hash conditions. These three states must remain unchanged in meaning. The new V1 state is an additional branch only.
2. `chips_guard_archive_batch_mutations()` from that migration makes proof, prune receipt, bot-only proof, cleanup receipt, and destructive GO fields write-once; requires proof/prune and prune/cleanup to use separate transitions; retains the schema-v2 exact bot-only GO requirement; and accepts the legacy cleanup proof basis. The related `chips_guard_idempotency_mutations()` path retains the `chips.legacy_stage_cleanup`, `chips.bot_only_prune`, `chips.bot_only_go`, and registry-delete latch behavior used by the legacy operator.
3. `20260904180000_chips_ledger_closed_human_canary_execute.sql` dynamically patches the current guard so the destructive GO check accepts `chips.bot_only_go = '1'` **or** `chips.closed_human_go = '1'`. The bot-only alternative remains required, and the closed-human GO behavior must remain unchanged. This patch is part of the effective contract even though it does not contain a second full guard definition.

The new migration must obtain the current `pg_get_functiondef('public.chips_guard_archive_batch_mutations()'::regprocedure)` after all preceding migrations, verify anchors for the legacy receipt/proof branch, `chips.bot_only_go`, and `chips.closed_human_go`, and abort if that shape is absent or ambiguous. It may add only the narrow v1 cleanup-proof branch to that effective definition. It must not copy `20260819220000_chips_ledger_bot_only_retention_hardening.sql` or any earlier guard body, and it must not weaken or replace the legacy branch, the schema-v2 branch, the separate-transition rules, the role/latch checks, or either GO alternative. The cleanup constraint and trigger must be updated together; changing only the constraint would leave the trigger rejecting the v1 receipt.

The current #890 function invokes a lifecycle gate that requires a `poker_tables` row and a `CLOSED` bot-only state. The missing-table class cannot be routed through that function. Reusing its delete/receipt role latches and exact-retry shape while implementing a separate absent-row predicate is the smallest safe distinction. The new path must leave the normal #890 function, the legacy cleanup operator, and their existing receipt/GO contracts intact.

The existing Node exporter has broad live-transaction selectors for producing archives. They are unsuitable as a retirement selector because V1 operates after archive and prune. The 2026-09-11 issue research has already classified the historical cohort; the new audit only documents and revalidates that classification against current Stage/live data. It must start from durable archive batches and registry mappings, then invoke the new SQL function in prepare-only mode for strict per-batch validation. It must not create a generic or persistent classification framework, a scheduler, or a second archive pipeline.

## Eligibility proof assembled from existing evidence

The exact batch validator must treat the following as one indivisible, fail-closed conjunction for every candidate and every batch:

1. The physical database is canonical Stage, the batch project ref is `krydukthwdvccggbyjfw`, and the target is not Production.
2. The batch is committed with a non-null `committed_at`, has exactly `format_version = 1`, and has exactly `source_policy_id = 'stage-ledger-auto-retention-30d-v1'`.
3. Archive proof is complete and verified, and the committed archive batch has a complete, exact prune receipt whose counts and hashes match the immutable archive proof and batch counts.
4. The active/enforced TABLE transaction fence is confirmed immediately before any mutation, using both `chips_table_fence_is_active()` and `chips_table_fence_control.enforcement_active`.
5. The complete registry mapping is non-empty, belongs to the selected `archive_batch_id`, contains no duplicate or extra mapping, and has `registry_count = transaction_count`.
6. Every row is a `TABLE_BUY_IN` or `TABLE_CASH_OUT` with `user_id is null`, `key_format_version = 1`, and one of the supported bot-internal TABLE key families: `managed-bot-seed-buyin`, `bot-seed-buyin`, `poker:bot-replacement-buyin:v1`, or `poker:bot-terminal-cashout:v1`.
7. `chips_parse_table_idempotency_key(text)` succeeds for every key, returns the supported version and family, and yields a `tableId` equal to stored `registry.table_id`; the stored format must also agree with the parser result.
8. Every parsed/stored table ID has no authoritative row in `poker_tables`.
9. No derived transaction ID has a hot row in `chips_transactions` or `chips_entries`.
10. The exact sorted identity set is recomputed with `chips_archive_text_ids_sha256(text[])`; its count and hash match the operator input and, after execution, the immutable cleanup receipt.
11. Whole-batch execution performs either no mutation (`ready`) or one atomic delete of all rows mapped to the locked batch plus the receipt update (`retired`). A single unsupported, malformed, protected, mixed, present-table, hot, stale, or ambiguous row rejects the entire batch.

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
