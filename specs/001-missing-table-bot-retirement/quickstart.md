# Issue #978 Plan Quickstart

This runbook describes the later implementation and Stage canary sequence. It is not an instruction to mutate Stage during the `$speckit-plan` phase. It assumes the additive migration has been reviewed and is present on canonical Stage.

## Preconditions

Use only the canonical Stage connection values validated by `validateStageEnvironment()`:

- `SUPABASE_STAGE_DB_URL`;
- `SUPABASE_STAGE_URL` for `https://krydukthwdvccggbyjfw.supabase.co`;
- `SUPABASE_STAGE_SERVICE_ROLE_KEY` as required by the existing Stage tooling.

The wrapper must reject any `SUPABASE_PROD_*` or `PRODUCTION_*` variable. It must verify PostgreSQL system identifier `7656985631720456337` through `chips_assert_archive_prune_stage()` and must not accept a Production target.

Before a canary, confirm that the deployed database includes:

- the additive v1 cleanup-receipt branch;
- `chips_retire_missing_table_bot_registry_batch(...)`;
- the current TABLE fence, parser, archive proof, prune receipt, registry mapping guard, and canonical text hash functions.

No browser, WebSocket, runtime, workflow, Storage, or Production change is required for this feature.

## Read-only audit

Run the new wrapper explicitly in audit mode:

```text
node scripts/ops/chips-ledger-missing-table-bot-retirement.mjs --target stage --mode audit
```

The audit must:

1. inventory material identity classes by type, user presence, key family/version, ownership, hot/archive state, policy, age, rows/day, and bytes/day;
2. remeasure the missing-table bot-internal whole-batch cohort;
3. validate each possible batch through the SQL function with `p_execute = false`;
4. emit only complete `ready` batches as executable candidates, with `batch_id`, `registry_count`, and `registry_keys_sha256`;
5. report rejected/mixed/unknown batches and protected classes separately;
6. compare the result with the historical estimate of about 10,080 keys without treating that estimate as a target or authorization;
7. report residual 30-day and one-year rows/day and bytes/day by class.

An empty candidate set is a successful no-op. Any parser error, missing proof, count/hash drift, hot row, existing table, fence problem, or target uncertainty remains fail-closed.

## Exact-batch canary

Select one smallest `ready` batch after independent review. Record its batch ID, `registry_count`, identity-set SHA, key-family summary, proof/prune evidence, absent-table summary, and pre-action account/ledger snapshot. Verify:

- `source_policy_id = 'stage-ledger-auto-retention-30d-v1'` and `format_version = 1`;
- all registry rows are null-user TABLE rows in one of the four supported families;
- parser-derived table IDs equal stored `table_id` values;
- `chips_table_fence_is_active()` and `enforcement_active` are true;
- archive is committed, proof is verified, and prune is complete/exact;
- `registry_count = transaction_count`;
- no hot transaction or entry exists;
- every authoritative `poker_tables` row is absent;
- no human, full-replay, legacy, unknown, or normal #890 CLOSED-table identity is included.

The operator then requires explicit owner confirmation in the exact form `GO <batch_id>` and runs:

```text
node scripts/ops/chips-ledger-missing-table-bot-retirement.mjs --target stage --mode execute --batch-id <batch_id> --registry-count <count> --registry-sha256 <sha256> --confirmation "GO <batch_id>"
```

The SQL operator re-reads and locks the batch in a serializable transaction. It derives the current exact mapped key set, recomputes `chips_archive_text_ids_sha256`, repeats every eligibility check, deletes all rows mapped to that batch, checks the affected count, and writes the three existing `registry_cleaned_*` fields atomically. It does not modify a balance, ledger row, table row, replay snapshot, archive object, or Storage object.

Stop and roll back the transaction on any error. There is no partial-batch retry path and no manual direct `DELETE` fallback.

## Post-canary verification

Verify the committed result contains:

- `state = retired`, the expected batch ID, count, and identity-set SHA;
- `registry_cleaned_at` set once;
- `registry_cleaned_key_count = transaction_count`;
- `registry_cleaned_keys_sha256` equal to the audited/derived SHA;
- zero registry rows with that `archive_batch_id`;
- zero hot transactions and entries for the archived transaction IDs;
- unchanged account balances, `next_entry_seq`, ledger conservation, and provenance;
- no change to `poker_tables` or Storage.

Probe one retired bot-internal key through the existing TABLE transaction path. A terminal `table_closed`/`idempotency_retired` rejection is accepted for this breaking semantic change. The probe must create zero second transactions, entries, balance changes, or provenance changes.

Retry the exact batch with the same count and SHA. It must return `already_retired` without mutation. A different count, SHA, batch ID, partial receipt, residual mapping, or target must fail closed.

After the canary, run the read-only classification and residual-horizon audit again. Continue only with separately reviewed exact batches. Do not create a scheduler, automatic draining loop, generic TTL, generic archive, or per-key tombstone under this feature.

## Validation after implementation

The implementation review should run the existing deterministic checks:

```text
node scripts/syntax-check.mjs
node tests/chips/chips-ledger-bot-only-retention.test.mjs
npm test
```

The disposable PostgreSQL contract should be enabled with the existing `CHIPS_MIGRATIONS_TEST_DB_URL` setup where available. Stage audit and canary evidence must remain separate from the deterministic test run. No command in this plan authorizes a Production action.
