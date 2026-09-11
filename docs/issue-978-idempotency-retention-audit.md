# Issue #978: Missing-Table Bot Identity Retirement Audit

This document records the accepted research boundary and the evidence contract
for the historical missing-table gap. The primary input is the GitHub issue
comment “Research result — 2026-09-11”. The live GitHub repository remains the
source of truth for code; the research counts are historical measurements and
must be revalidated by the read-only Stage audit.

## Classification baseline

The accepted 2026-09-11 research measured canonical Stage project
`krydukthwdvccggbyjfw` with PostgreSQL system identifier
`7656985631720456337`:

| Historical class | Research measurement | V1 treatment |
|---|---:|---|
| Bot-internal TABLE identities in the four observed families | 99,874 | Candidate source only when every batch guard passes |
| New registry rows in seven days | 21,614, about 3,088/day | Measurement only; no generic TTL |
| Human TABLE identities | 268 | Retain on the human TABLE path |
| Complete full-replay non-TABLE identities | 42 | Retain on the full-replay path |
| Legacy or unknown TABLE identities | 2,052 | Retain and report as protected/unknown |
| Older TABLE identities with missing `poker_tables` rows | about 33.7k | Historical gap under this feature’s evidence rules |
| Missing-table bot identities mapped to the 30-day archive policy | 10,183 | Revalidate by exact batch |
| Complete whole-batch shape | 10,080 | Historical estimate; never an automatic target |
| Mixed batches | 103 | Reject whole batch; never split per key |

The fresh audit reports mapped, unmapped, and material hot identities from the
full `public.chips_transaction_idempotency` table. It reports key/version,
transaction type, user ownership, producer presence, replay state, archive and
prune state, policy, age, hot transaction/entry state, and rows/day plus
bytes/day. Its identity classes distinguish human TABLE identities, complete
full-replay non-TABLE identities, bot-internal TABLE identities, and
legacy/unknown/other identities. A full-replay class requires one of the five
existing full-replay transaction types and all three replay snapshot fields;
non-TABLE rows without a complete snapshot, including MINT rows, remain
legacy/unknown/other. It emits hot and total 30-day and one-year projections as
estimates only. It does not persist a classifier and does not authorize a batch.

The current Stage review confirms 42 complete full-replay identities: BUY_IN 11,
CASH_OUT 11, WELCOME_BONUS 6, PROMO_BONUS 8, and ADMIN_ADJUST 6.

V1 recognizes only these parser families, with `key_format_version = 1`:

- `managed-bot-seed-buyin`;
- `bot-seed-buyin`;
- `poker:bot-replacement-buyin:v1`;
- `poker:bot-terminal-cashout:v1`.

Human TABLE identities, complete full-replay non-TABLE identities,
legacy/unknown identities, normal #890 CLOSED bot-only tables, present tables,
hot rows, malformed keys, unsupported keys, mixed batches, and incomplete
evidence remain protected.

## Exact eligibility contract

Every candidate and batch must satisfy the complete conjunction in the SQL
operator. A missing or conflicting fact rejects the whole batch:

1. The target is canonical Stage, the physical identity is
   `7656985631720456337`, and `project_ref` is exactly
   `krydukthwdvccggbyjfw`.
2. `format_version = 1`, `source_policy_id =
   'stage-ledger-auto-retention-30d-v1'`, `status = 'committed'`, and
   `committed_at` is present.
3. Archive proof is complete and verified. All five prune receipt fields are
   present, positive where counts apply, count-equal to the batch, and hash-
   equal to the archive proof.
4. Both `chips_table_fence_is_active()` and
   `chips_table_fence_control.enforcement_active` are true immediately before
   the mutation.
5. Every registry row maps to the selected `archive_batch_id`; the derived
   `registry_count` equals `transaction_count`; the sorted identity set and
   `chips_archive_text_ids_sha256(text[])` hash equal the operator evidence.
6. Every row has `tx_type` `TABLE_BUY_IN` or `TABLE_CASH_OUT`, `user_id is
   null`, no full-replay fields, non-null `table_id`, and
   `key_format_version = 1`.
7. `chips_parse_table_idempotency_key(text)` succeeds for every key, returns
   one of the four supported families, and its parsed table ID equals stored
   `table_id`.
8. Every parsed/stored table ID has no authoritative `poker_tables` row.
9. No derived transaction has a row in `chips_transactions` or
   `chips_entries`.
10. Execution derives the complete set from the batch mapping. It never accepts
    a caller-supplied subset.

The operation is whole-batch only and fail-closed. The SQL function uses the
existing archive-pruner role, parser, hash, fence lock, and cleanup receipt
latches. It never calls a ledger prune function and never changes accounts,
transactions, entries, `poker_tables`, Storage, browser/runtime code, or
Production.

## Audit and exact execute flow

`T003` performs DB-only Stage preflight with `SUPABASE_STAGE_DB_URL`,
`createPruneStore(sql).getIdentity()`, and
`chips_assert_archive_prune_stage()`. REST and Storage credentials are not
needed. The wrapper rejects Production credential variables.

`--mode audit` opens a repeatable read-only transaction, aggregates the full
registry, discovers candidate batches from existing archive mappings, and
invokes the new SQL function only with `p_execute = false` for strict
per-batch validation. A rejected candidate remains a diagnostic; it is never
promoted to `ready`.

`--mode execute` rereads one exact batch and its complete current mapping,
compares the operator-supplied count and hash, runs the same prepare-only
validation, and then invokes the SQL function in a serializable transaction
with the exact confirmation `GO <batch_id>`. The function derives the complete
mapping again, locks the existing TABLE fence, deletes every row mapped to the
batch, verifies the affected count, and writes
`registry_cleaned_at`, `registry_cleaned_key_count`, and
`registry_cleaned_keys_sha256` atomically. A matching receipt with no residual
mapping returns `already_retired`; a mismatching receipt is rejected.

The `DB Stage Apply PR` workflow run `34610702293` automatically applied
`20260911100000_chips_ledger_missing_table_bot_registry_retirement.sql` to the
shared Stage database, so that migration is recorded in Stage history. The
implementation did not execute retirement, use a live `GO <batch_id>`, perform
a Stage canary, or perform registry cleanup. Production remains untouched. Any
later Stage canary requires independent review and explicit owner authorization.

## Preserved effective contracts

The additive migration keeps the current effective
`chips_ledger_archive_batches_cleanup_receipt_check` states:

- all three `registry_cleaned_*` fields null;
- the schema-v2 bot-only receipt with its existing proof, hash, and
  `chips.bot_only_go` contract;
- the `legacy_stage_allowlist_v1` receipt with its existing proof, count, hash,
  and cleanup-latch contract.

It obtains the effective `chips_guard_archive_batch_mutations()` definition
with `pg_get_functiondef(...)` after the closed-human patch and adds only the
new v1 branch. The existing bot-only GO and the closed-human
`chips.closed_human_go` alternative remain present. The legacy
`chips.legacy_stage_cleanup` path remains unchanged. The regression contract
checks these anchors without asserting every implementation detail.

## Breaking semantic effect and safety outcome

After a successful retirement, retrying a very old retired bot-internal TABLE
identity may no longer return its historical success payload. The existing
TABLE fence may return terminal `table_closed`/retired rejection. This is an
intentional semantic change. The retry must create no second transaction or
entry and must cause no balance, account sequence, ledger, or provenance
change.

The desired measurable result is a receipt-backed reduction of the selected
historical missing-table registry mappings, with zero protected identity
deletions, zero hot-row deletions, zero economic effects, and no residual
mapping for each retired exact batch. Residual growth remains separately
reported by identity class; it is not treated as a proof of a global database
plateau.

## Post-canary evidence template

The following is the required record format for a later owner-authorized Stage
canary. During this implementation it remains pending and contains no live
values.

```json
{
  "status": "pending_owner_authorized_stage_canary",
  "live_values_recorded": false,
  "target": "stage",
  "project_ref": "krydukthwdvccggbyjfw",
  "system_identifier": "7656985631720456337",
  "batch_ids": [],
  "registry_key_count": null,
  "registry_keys_sha256": null,
  "receipt_status": null,
  "residual_rows_per_day_by_class": null,
  "residual_bytes_per_day_by_class": null,
  "projection_30d_by_class": null,
  "projection_1y_by_class": null,
  "balances": null,
  "next_entry_seq": null,
  "ledger_rows": null,
  "provenance_rows": null,
  "retired_key_replay_result": null,
  "abort_or_blocking_reason": null
}
```

The live values may be filled only after independent review and an owner-
authorized Stage canary. No scheduler, automatic draining loop, generic TTL,
per-key tombstone, generic registry archive, or generic classification
framework is part of this feature.
