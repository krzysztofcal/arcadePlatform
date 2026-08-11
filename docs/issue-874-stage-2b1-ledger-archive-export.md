# Issue #874 — Stage 2B.1 read-only ledger archive export

Status: prototype only. This document describes the exporter added by this PR.

The exporter measures the size of a complete, immutable ledger batch before a
cold-storage design is selected. It writes a local `.jsonl.gz` file and a local
JSON manifest. It does not upload to Supabase Storage, create a bucket, delete
rows, prune history, write a remote manifest, or modify any database row.

## Running it on Stage

Use a private shell and the existing target-specific PostgreSQL configuration.
The target is deliberately explicit; there is no default target.

```sh
set +o history
read -rsp 'Stage PostgreSQL connection string: ' SUPABASE_STAGE_DB_URL
printf '\n'
export SUPABASE_STAGE_DB_URL
export EXPECTED_SUPABASE_STAGE_PROJECT_REF=krydukthwdvccggbyjfw
export EXPECTED_SUPABASE_PROD_PROJECT_REF=otbqfijerkieoxwpxjnm
set -o history

node scripts/ops/chips-ledger-archive-export.mjs \
  --target stage \
  --cutoff-days 30 \
  --batch-size 5000 \
  --output /private/path/chips-ledger-stage-2026-08-11.jsonl.gz
```

`SUPABASE_PROD_DB_URL` is selected only when `--target prod` is explicitly
requested. Both expected project refs are checked against the versioned
canonical refs, and the selected URL is checked against the selected ref. Do
not run the Production target as part of this PR validation. The Production
path is read-only by construction and is reserved for a separately approved
measurement.

The connection string is never printed. Clear database variables after the
run. Store the output outside the repository with restrictive permissions.

## Parameters

- `--target stage|prod` — required. Unknown values and omitted target fail
  closed.
- `--cutoff <timestamp>` — explicit timezone-aware cutoff. A transaction is
  eligible only when `created_at < cutoff` (strict comparison).
- `--cutoff-days <integer>` — defaults to `30`; used to calculate the cutoff
  at process start when `--cutoff` is absent.
- `--batch-size <integer>` — defaults to and is capped at `5000`.
- `--after-created-at <timestamp>` and `--after-id <uuid>` — the pair is the
  keyset cursor for resuming a batch.
- `--output <path>` — local `.jsonl.gz` artifact. Existing files are never
  overwritten.
- `--manifest <path>` — local manifest; defaults to
  `<output>.manifest.json`. Existing files are never overwritten.

The target-specific variables follow the existing operations convention:
`SUPABASE_STAGE_DB_URL` / `SUPABASE_PROD_DB_URL` and
`EXPECTED_SUPABASE_STAGE_PROJECT_REF` /
`EXPECTED_SUPABASE_PROD_PROJECT_REF`. The older
`SUPABASE_STAGE_PROJECT_REF` / `SUPABASE_PROD_PROJECT_REF` names are accepted
as compatibility aliases for the expected refs.

## JSONL record contract

The gzip payload is UTF-8 JSON Lines with one complete transaction per line and
a final newline. There is no header or manifest line. Each record has this
shape (field names are part of the prototype contract):

```json
{
  "schema_version": 1,
  "record_type": "chips_transaction",
  "transaction": {
    "id": "uuid",
    "sequence": "bigint-as-string",
    "tx_type": "TABLE_BUY_IN",
    "idempotency_key": "…",
    "payload_hash": "…",
    "user_id": "uuid-or-null",
    "reference": "…",
    "description": "…",
    "metadata": {},
    "created_by": "uuid-or-null",
    "created_at": "2026-01-01T00:00:00.000000Z"
  },
  "table_context": null,
  "entries": [
    {
      "id": "bigint-as-string",
      "transaction_id": "uuid",
      "account_id": "uuid",
      "entry_seq": "bigint-as-string",
      "amount": "bigint-as-string",
      "metadata": {},
      "created_at": "2026-01-01T00:00:00.000000Z",
      "account": {
        "id": "uuid",
        "account_type": "USER|SYSTEM|ESCROW",
        "user_id": "uuid-or-null",
        "system_key": "TREASURY-or-null",
        "status": "active",
        "label": "optional label"
      }
    }
  ]
}
```

`sequence`, entry `id`, `entry_seq`, and `amount` are always strings in the
serialized contract. Account identity is repeated with every entry so the
record can be interpreted without querying `chips_accounts`; in particular,
`account_type`, `user_id`, and `system_key` are retained. Current transaction
columns and current entry columns are exported; `table_context` is derived
eligibility evidence, not a second accounting source of truth.

## Eligibility and lifecycle safety

The exporter reads all rows in one PostgreSQL `REPEATABLE READ, READ ONLY`
transaction. Poker lifecycle association is detected from any of the current
consumer shapes:

- `metadata.tableId`;
- `reference` beginning with `table:<tableId>` or `poker-rebuy:<tableId>`;
- an entry whose account is an `ESCROW` account with
  `system_key = POKER_TABLE:<tableId>`.

For a transaction with no such marker, no poker-specific restriction is added.
For a marked transaction, all of these conditions must hold:

- the transaction is older than the cutoff;
- the table is absent because retention removed it, or its current status is
  exactly `CLOSED`;
- the corresponding `ESCROW` account exists and its balance is exactly `0`;
- the table ID is a valid UUID and the transaction has one unambiguous table
  ID.

An active or otherwise non-`CLOSED` table, a missing escrow, a non-zero escrow,
an invalid marker, or multiple table IDs makes the transaction ineligible.
This keeps terminal-close bot provenance and bot-claims recovery hot-only;
neither runtime path reads the local archive. A deleted `poker_tables` row is
not treated as proof by itself—the zero escrow check is still required.

## Cursor and resume semantics

Selection order is deterministic:

```text
transaction.created_at ASC, transaction.id ASC
```

The UUID is the stable tie-breaker. The manifest reports the input cursor, the
first/last timestamps, and `cursor.next` containing the last exported
`created_at` and `id`. Resume with those two values:

```sh
node scripts/ops/chips-ledger-archive-export.mjs \
  --target stage \
  --cutoff '2026-07-12T00:00:00.000000Z' \
  --after-created-at '2026-01-01T00:00:00.000000Z' \
  --after-id '00000000-0000-4000-8000-000000000001' \
  --output /private/path/next-batch.jsonl.gz
```

The cursor is a position in the ordered eligible snapshot, not an idempotency
registry. For a later run against a changing database, rerun with an overlap
or from the beginning if a previously active table may have become eligible
before the saved cursor. The manifest/checksum identifies exactly what was
written by each batch.

## Verification performed before writing

The exporter does not create either output until all checks pass. It verifies:

- every selected transaction has exactly the database-reported number of
  entries;
- every entry belongs to that transaction and entry IDs are unique in the
  batch;
- transaction IDs are unique and ordered by the stated cursor order;
- every transaction is older than the cutoff and satisfies lifecycle
  eligibility;
- the exact `bigint` sum of entries for every transaction is zero;
- the JSONL serializes and parses back identically;
- gzip decompression reproduces the exact raw JSONL bytes;
- raw/compressed byte counts and SHA-256 hashes match the manifest.

The sidecar manifest reports transaction and entry counts, sorted `tx_type`
counts, time range, cursor position, raw bytes, compressed bytes, the
compressed-over-raw ratio, and both raw JSONL and compressed-artifact SHA-256
hashes. The ratio is defined as `compressed_bytes / raw_bytes`; an empty batch
reports `null` for this ratio.

## Stage measurement to add to Issue #874

After the Stage run, add the manifest values to Issue #874, including:

- exact cutoff and cursor start/end;
- transaction and entry counts;
- `tx_type` distribution;
- first/last transaction timestamps;
- raw and compressed bytes and compressed/raw ratio;
- compressed artifact SHA-256;
- batch duration and whether the batch was resumed;
- any incomplete or ineligible rows observed (the expected result is zero
  exported failures).

These measurements are the evidence needed to estimate bytes per transaction,
bytes per day, object sizes below the future Storage limit, and the next
Stage 2B design. This prototype intentionally makes no claim about a final
retention, idempotency registry, upload, or deletion strategy.
