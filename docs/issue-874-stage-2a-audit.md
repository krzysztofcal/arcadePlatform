# Issue #874 — Stage 2A audit

Audit date: 2026-08-10 UTC. Production rollout and corrective snapshot:
2026-08-11 UTC.

## Status

Stage 2A is complete:

- PR #876 was merged to `main`;
- migration `20260810120000_chips_ledger_schema_cleanup.sql` was applied to
  Production;
- the Production smoke test passed;
- no WS/runtime deploy was required and no accounting behavior was changed.

## Production evidence correction

The earlier 3,506,176-byte snapshot with 102 `chips_transactions` rows and
204 `chips_entries` rows was not representative of the operator-confirmed
Production database and is withdrawn. It must not be used as a Production
baseline or as evidence that Stage 2A would reclaim only about 0.8 MB.

The post-migration snapshot below was run by the operator against Production.
It is consistent with the approximately 59 MB / 31,878-transaction
continuous-poker measurement recorded before the cleanup, allowing for
continued ledger growth between snapshots.

## Production after Stage 2A

| Relation | Rows | Table bytes | Index bytes | Total bytes |
| --- | ---: | ---: | ---: | ---: |
| `chips_transactions` | 34261 | 23552000 | 7987200 | 31539200 |
| `chips_entries` | 68522 | 9150464 | 14327808 | 23478272 |
| **Combined ledger** | — | **32702464** | **22315008** | **55017472** |

The combined ledger currently occupies 55.02 MB / 52.47 MiB.

The remaining `chips_transactions` indexes are exactly the intended set:

- `chips_transactions_idempotency_key_unique`;
- `chips_transactions_pkey`;
- `chips_transactions_tx_type_created_idx`;
- `chips_transactions_user_id_idx`.

The migration removed:

- `chips_transactions_idempotency_idx`;
- `chips_transactions_idempotency_key_uidx`;
- the legacy `chips_transactions_sequence_key` UNIQUE constraint/index.

Therefore Production now has one authoritative UNIQUE enforcement for
`idempotency_key`. The `sequence` column remains an identity column; only its
unused UNIQUE constraint/index was removed. All `chips_entries` indexes were
left unchanged.

## Storage impact

An exact Production byte delta cannot be calculated from the available
snapshots. The original exact "before" snapshot was invalid, while the
approximately 59 MB historical measurement and the exact 55,017,472-byte
after snapshot were collected at different row counts during continuous
ledger writes. Subtracting them would mix cleanup savings with intervening
growth and catalog variation.

The controlled Stage before/after measurement remains the direct isolation of
the migration's effect:

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

Stage recovered 10,608,640 bytes (10.61 MB / 10.12 MiB), entirely from
`chips_transactions` index storage. Production had the same redundant schema,
but its exact reclaimed bytes were not measured against a valid same-workload
before snapshot.

## Contract verification

- `postTransaction()` still uses the retained UNIQUE constraint for atomic
  idempotency and compares `payload_hash`/`tx_type` for replay versus conflict.
- Existing replay/conflict tests use
  `chips_transactions_idempotency_key_unique` and passed.
- The Stage duplicate probe was rejected by `unique_violation` without
  changing the transaction row count.
- `EXPLAIN` selected `chips_transactions_idempotency_key_unique` for lookup by
  `idempotency_key`.
- No current runtime, admin, recovery, reconciliation, or tooling consumer
  depends on `chips_transactions.sequence` uniqueness.
- The Production smoke test passed after the migration.

## Scope and breaking impact

Stage 2A changed schema/index storage only. It did not change ledger rows,
balances, double-entry accounting, append-only triggers, payload hashing,
replay behavior, `chips_entries`, WS, or UI.

The only schema-contract change is that `chips_transactions.sequence` is no
longer guaranteed UNIQUE. No current consumer depends on that guarantee.

Stage 2A does not bound future ledger growth. Stage 2B remains responsible for
the hot/cold archival design and its accounting, idempotency, provenance, and
history contracts.
