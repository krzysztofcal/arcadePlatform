# Internal Contract: Missing-Table Bot Retirement Operator

This is an internal Stage operations interface. It is not a product API and is not callable by browser, Netlify, `anon`, `authenticated`, or `service_role` clients.

## CLI entry point

The implementation adds:

`scripts/ops/chips-ledger-missing-table-bot-retirement.mjs`

The wrapper accepts only an explicit Stage target:

```text
node scripts/ops/chips-ledger-missing-table-bot-retirement.mjs --target stage --mode audit
node scripts/ops/chips-ledger-missing-table-bot-retirement.mjs --target stage --mode execute --batch-id <batch_id> --registry-count <count> --registry-sha256 <sha256> --confirmation "GO <batch_id>"
```

The implementation must reject a Production target, a Production credential variable, an unknown mode, a missing required value, a non-positive count, or a non-lowercase 64-character SHA. There is no scheduler mode, loop mode, generic policy flag, or implicit execute mode.

The wrapper uses the existing `SUPABASE_STAGE_DB_URL`, `SUPABASE_STAGE_URL`, and `SUPABASE_STAGE_SERVICE_ROLE_KEY` validation path. It verifies project ref `krydukthwdvccggbyjfw` and physical system identifier `7656985631720456337`. Secrets are read from the environment and never emitted.

## Database function

The additive migration defines one narrow function:

```text
public.chips_retire_missing_table_bot_registry_batch(
  p_batch_id bigint,
  p_registry_key_count bigint,
  p_registry_keys_sha256 text,
  p_execute boolean default false,
  p_confirmation text default null
) returns jsonb
```

The function is `SECURITY DEFINER`, uses an empty `search_path`, is owned by `chips_ledger_archive_pruner`, and is executable only through the existing operator role. It must not be directly executable by public, `anon`, `authenticated`, or `service_role`.

The function derives the sorted registry key set from `archive_batch_id = p_batch_id`; the caller cannot pass a subset for deletion. It computes the canonical SHA with `chips_archive_text_ids_sha256(text[])` and compares both derived count and SHA with the supplied values. The SQL parser and all lifecycle/evidence predicates are authoritative inside this function.

## `audit` behavior

`audit` uses a repeatable read-only transaction. It may enumerate committed v1 batches and call the database function with `p_execute = false`, but it must not set a cleanup latch, delete a registry row, update a receipt, or invoke a ledger-prune function.

For a valid complete batch it emits a structured `klog` event containing at least:

- `batch_id`, `project_ref`, `source_policy_id`, and `format_version`;
- `state = "ready"`;
- `registry_count`, `transaction_count`, `entry_count`, and `registry_keys_sha256`;
- counts by supported key family and TABLE transaction type;
- parsed/missing table summary;
- archive proof, exact prune, fence, and hot-row evidence;
- current residual class and growth metrics where available.

Malformed, unsupported, mixed, present-table, hot, or otherwise unsafe batches are reported as rejected diagnostics and are never promoted to `ready`. A no-candidate result is a successful no-op report.

## `execute` behavior

`execute` must:

1. re-read the exact batch and current registry mapping;
2. run `chips_assert_archive_prune_stage()` and require the canonical Stage project ref;
3. run the full exact eligibility conjunction from `spec.md`, including source policy, version, four key families, parser/table binding, active/enforced fence, committed archive, verified proof, exact prune, count/hash, no hot rows/entries, and absent `poker_tables` rows;
4. require `p_confirmation` to equal exactly `GO <p_batch_id>`;
5. set the existing transaction-local registry-delete and cleanup-receipt latches only around the authorized operation;
6. delete all registry rows mapped to that exact batch and verify the affected count equals the derived count;
7. write `registry_cleaned_at`, `registry_cleaned_key_count`, and `registry_cleaned_keys_sha256` in the same transaction;
8. commit only the `retired` result, or return `already_retired` for a matching immutable receipt with no residual mapping.

The database transaction is serializable and uses the existing bounded lock/statement timeout pattern. Any concurrent change, row-count mismatch, receipt mismatch, present table, fence loss, parser error, or target/evidence failure aborts the complete transaction.

The function must not call `chips_prune_committed_archive_batch(...)`, change `chips_accounts`, change `chips_transactions`, change `chips_entries`, change `poker_tables`, alter balances or sequences, alter replay snapshots, or access Production/Storage for a mutation.

## Retry and breaking semantics

An exact retry supplies the same batch count and SHA. If the receipt is complete and matches those values, and no registry row remains mapped to the batch, the result is `already_retired` with no mutation. A partial receipt, residual mapping, different count/SHA, or different batch is a fail-closed error.

After a successful retirement, a very old retry of a retired bot-internal identity may return terminal `table_closed` or `idempotency_retired` instead of historical success. The existing TABLE fence must ensure that this outcome creates no second transaction, entry, balance mutation, or provenance change. Human TABLE, full-replay, and legacy/unknown identity behavior is outside this contract and remains retained.

## Output and logging

All normal audit and execute output is aggregate, structured `klog` output suitable for copying into the issue-978 audit document. The wrapper must not use `console.log`, must not print credentials, and must exit nonzero on a rejected execute request or failed safety check.
