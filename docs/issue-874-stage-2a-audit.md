# Issue #874 — Stage 2A audit

Audit date: 2026-08-10 UTC. Target: Production Supabase project
`otbqfijerkieoxwpxjnm`. The catalog queries were read-only; no Production
schema or ledger data was changed during the audit.

The byte values below use the same functions as the existing #860 metrics:
`pg_table_size`, `pg_indexes_size`, and `pg_total_relation_size`. Per-index
sizes use `pg_relation_size`. `idx_scan` is supporting evidence only. The
database reported `stats_reset = NULL`, so the scan counters are not treated
as proof of non-use.

## Production before

### Constraints

| Table | Constraint | Type | Definition | Backing index |
| --- | --- | --- | --- | --- |
| `chips_entries` | `chips_entries_account_id_fkey` | FOREIGN KEY | `FOREIGN KEY (account_id) REFERENCES chips_accounts(id)` | `chips_accounts_pkey` |
| `chips_entries` | `chips_entries_balanced_transaction` | constraint trigger | `TRIGGER DEFERRABLE INITIALLY DEFERRED` | — |
| `chips_entries` | `chips_entries_entry_seq_positive` | CHECK | `CHECK (entry_seq > 0)` | — |
| `chips_entries` | `chips_entries_non_zero_amount` | CHECK | `CHECK (amount <> 0)` | — |
| `chips_entries` | `chips_entries_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` | `chips_entries_pkey` |
| `chips_entries` | `chips_entries_transaction_id_fkey` | FOREIGN KEY | `FOREIGN KEY (transaction_id) REFERENCES chips_transactions(id) ON DELETE CASCADE` | `chips_transactions_pkey` |
| `chips_transactions` | `chips_transactions_idempotency_key_present` | CHECK | `CHECK (length(idempotency_key) > 0)` | — |
| `chips_transactions` | `chips_transactions_idempotency_key_unique` | UNIQUE | `UNIQUE (idempotency_key)` | `chips_transactions_idempotency_key_unique` |
| `chips_transactions` | `chips_transactions_payload_hash_present` | CHECK | `CHECK (length(payload_hash) > 0)` | — |
| `chips_transactions` | `chips_transactions_pkey` | PRIMARY KEY | `PRIMARY KEY (id)` | `chips_transactions_pkey` |
| `chips_transactions` | `chips_transactions_sequence_key` | UNIQUE | `UNIQUE (sequence)` | `chips_transactions_sequence_key` |
| `chips_transactions` | `chips_transactions_sequence_positive` | CHECK | `CHECK (sequence > 0)` | — |

### Indexes and usage

| Table | Index | Definition | Bytes | `idx_scan` |
| --- | --- | --- | ---: | ---: |
| `chips_entries` | `chips_entries_account_created_seq_idx` | `btree (account_id, created_at DESC, entry_seq DESC)` | 344064 | 1763 |
| `chips_entries` | `chips_entries_account_idx` | `btree (account_id)` | 73728 | 776 |
| `chips_entries` | `chips_entries_account_seq_idx` | `UNIQUE btree (account_id, entry_seq) WHERE (entry_seq IS NOT NULL)` | 262144 | 0 |
| `chips_entries` | `chips_entries_pkey` | `UNIQUE btree (id)` | 122880 | 41 |
| `chips_entries` | `chips_entries_transaction_idx` | `btree (transaction_id)` | 172032 | 12560 |
| `chips_transactions` | `chips_transactions_idempotency_idx` | `btree (idempotency_key)` | 352256 | 0 |
| `chips_transactions` | `chips_transactions_idempotency_key_uidx` | `UNIQUE btree (idempotency_key)` | 352256 | 42 |
| `chips_transactions` | `chips_transactions_idempotency_key_unique` | `UNIQUE btree (idempotency_key)` | 352256 | 9 |
| `chips_transactions` | `chips_transactions_pkey` | `UNIQUE btree (id)` | 106496 | 205757 |
| `chips_transactions` | `chips_transactions_sequence_key` | `UNIQUE btree (sequence)` | 98304 | 0 |
| `chips_transactions` | `chips_transactions_tx_type_created_idx` | `btree (tx_type, created_at)` | 98304 | 61 |
| `chips_transactions` | `chips_transactions_user_id_idx` | `btree (user_id)` | 40960 | 25 |

The three `idempotency_key` indexes are equivalent for lookup, while the
named UNIQUE constraint is the intended enforcement path. The two standalone
indexes are therefore the Stage 2A cleanup targets. Production also has a
legacy UNIQUE constraint/index on `chips_transactions.sequence`; no current
`origin/main` consumer uses that column for lookup, ordering, or identity.

No `chips_entries` index was removed. `chips_entries_account_seq_idx` has
`idx_scan = 0`, but it is a UNIQUE invariant for `(account_id, entry_seq)`,
not a redundant lookup index. The remaining indexes have query consumers and
were left unchanged.

### #860 before metrics

| Relation | Table bytes | Index bytes | Total bytes |
| --- | ---: | ---: | ---: |
| `chips_transactions` | 737280 | 1425408 | 2162688 |
| `chips_entries` | 368640 | 974848 | 1343488 |
| **Combined ledger** | **1105920** | **2400256** | **3506176** |

For reference, the raw heap-only sizes were 696320 bytes for
`chips_transactions` and 327680 bytes for `chips_entries`. `pg_table_size`
includes the table storage used by the #860 metric.

## Consumer review

- `idempotency_key`: `postTransaction()` performs the lookup, inserts the
  transaction inside the accounting transaction, catches the unique race,
  and compares `payload_hash`/`tx_type` for replay versus conflict behavior.
  The WS ledger path, terminal close, admin adjustment, bonus, welcome-bonus,
  admin ledger, and recovery/provenance paths use the same transaction
  identity contract. None requires more than one unique structure.
- `chips_transactions.sequence`: current `origin/main` contains no runtime,
  admin, ledger API, reconciliation, recovery, or tooling consumer of this
  column. The only non-migration sequence references are the separate
  per-account `chips_entries.entry_seq` contract.
- `chips_entries`: account history/cursor queries, transaction joins,
  terminal close, recovery evidence, and admin ledger paths were inspected.
  There was no sufficiently strong evidence to remove any of its indexes.

## Stage 2A scope

The accompanying migration drops only:

- `chips_transactions_idempotency_idx`;
- `chips_transactions_idempotency_key_uidx`;
- the legacy `chips_transactions_sequence_key` UNIQUE constraint/index.

It retains the named `chips_transactions_idempotency_key_unique` constraint,
all ledger rows and columns, all `chips_entries` indexes, append-only
triggers, payload hashing, and accounting behavior. No archive/cold-storage
work is included.

## Safe-environment after verification

The migration was applied on the deploy-preview Stage project
`krydukthwdvccggbyjfw` on 2026-08-10 UTC. Stage had the same ledger index
layout as the Production audit before the migration. The migration history
recorded version `20260810120000` and the existing stage migration smoke
checks passed.

### #860 before/after comparison on Stage

| Relation | Metric | Before bytes | After bytes | Delta |
| --- | --- | ---: | ---: | ---: |
| `chips_transactions` | Table | 22609920 | 22609920 | 0 |
| `chips_transactions` | Index | 18309120 | 7700480 | -10608640 |
| `chips_transactions` | Total | 40919040 | 30310400 | -10608640 |
| `chips_entries` | Table | 8839168 | 8839168 | 0 |
| `chips_entries` | Index | 13795328 | 13795328 | 0 |
| `chips_entries` | Total | 22634496 | 22634496 | 0 |
| **Combined ledger** | **Table** | **31449088** | **31449088** | **0** |
| **Combined ledger** | **Index** | **32104448** | **21495808** | **-10608640** |
| **Combined ledger** | **Total** | **63553536** | **52944896** | **-10608640** |

The observed relation-level recovery was 10,608,640 bytes (10.61 MB / 10.12
MiB) from `chips_transactions` and the combined ledger. The three dropped
index relations accounted for 10,534,912 bytes in the before per-index
snapshot; `pg_indexes_size` also includes associated TOAST index storage and
can vary between live catalog snapshots.

### Stage after per-index snapshot

| Table | Index | Bytes | `idx_scan` |
| --- | --- | ---: | ---: |
| `chips_entries` | `chips_entries_account_created_seq_idx` | 5062656 | 8504 |
| `chips_entries` | `chips_entries_account_idx` | 909312 | 21382 |
| `chips_entries` | `chips_entries_account_seq_idx` | 4096000 | 0 |
| `chips_entries` | `chips_entries_pkey` | 1490944 | 3 |
| `chips_entries` | `chips_entries_transaction_idx` | 2138112 | 391928 |
| `chips_transactions` | `chips_transactions_idempotency_key_unique` | 4874240 | 2 |
| `chips_transactions` | `chips_transactions_pkey` | 1236992 | 358583 |
| `chips_transactions` | `chips_transactions_tx_type_created_idx` | 1171456 | 142 |
| `chips_transactions` | `chips_transactions_user_id_idx` | 368640 | 510 |

The after catalog has exactly one effective UNIQUE index for
`chips_transactions.idempotency_key`, backed by the retained named UNIQUE
constraint. The two standalone idempotency indexes and the
`chips_transactions.sequence` UNIQUE index are absent. The `sequence` column
still exists as an identity column, and all six non-internal ledger triggers
remain enabled, including the deferred balancing trigger and append-only
guards.

A duplicate probe attempted to insert an existing idempotency key inside a
PL/pgSQL subtransaction and was rejected by `unique_violation`; the stage
transaction row count stayed at `32799`. Existing migration/accounting tests
cover same-payload replay and payload-hash conflict behavior. An after-
migration `EXPLAIN` for `where idempotency_key = $1` selected
`chips_transactions_idempotency_key_unique`. Production rollout is a separate
step; the existing #860 `transactionIndexBytes` and combined ledger metrics
are the post-rollout measurement source.
