# Issue #874 — Stage 2B.4 controlled ledger pruning

Stage 2B.4 adds a manual, bounded pruning path for one previously committed
and verified Stage archive. It removes only the exact hot transaction and
entry IDs contained in that archive. A cutoff, timestamp range, or cursor is
evidence checked against the archive manifest; none of them is a deletion
selector.

This first version is deliberately narrow. It accepts only technical
`TABLE_BUY_IN` and `TABLE_CASH_OUT` transactions with `user_id IS NULL`, no
entries for `USER` accounts, exactly one `SYSTEM` entry, exactly one `ESCROW`
entry, and exactly one unambiguous table ID per transaction. It processes one
all-or-nothing batch of at most 5,000 transactions. It does not prune user
ledger history, upload or delete Storage objects, run on a schedule, or support
Production.

## Immutable archive proof

The CLI privately downloads the committed object, verifies the complete Stage
2B.1/2B.2 contract, and derives ordered ID proofs from the JSONL bytes. Proof
registration is a separate, non-destructive database transaction. A committed
manifest may transition once from no proof to a complete proof; the guard
prevents replacing or clearing it.

The bytes hashed by Node and PostgreSQL are defined exactly:

- transaction proof: every `transaction.id` as a lowercase canonical UUID in
  JSONL record order, UTF-8 encoded and followed by one LF byte (`0a`);
- entry proof: every `entry.id` as canonical positive decimal bigint text with
  no leading zeroes, in JSONL record order and then entry-array order within
  each record, UTF-8 encoded and followed by one LF byte;
- there is no BOM, whitespace, separator other than LF, or extra empty value;
  the final ID is also followed by LF.

The shared known vector is:

```text
transactions:
00000000-0000-4000-8000-00000000000a\n00000000-0000-4000-8000-00000000000b\n
SHA-256: 726400e7a16ea9e7ca71ee707fb025934613059de29366a5ae7f626256b688fa

entries:
1\n2\n10\n9007199254740993\n
SHA-256: 58eb8c6b6deb82261f809eb3277a61b010224ae0fe568f199ced00f51f7dd8ac
```

Proof registration compares the archive-derived counts, `tx_types`, amount
totals, raw/compressed sizes and hashes, cutoff, cursor, and first/last
timestamps with the immutable committed manifest before storing the two ID
hashes. Registration does not change ledger rows.

## Database state machine

The pruning function locks the manifest first and then follows this order:

1. A complete matching receipt requires all mapped registry rows and no hot
   transaction or entry rows. It returns `already_pruned` without trying to
   validate rows that were intentionally removed.
2. With no receipt, no mappings may exist. The complete hot batch must still
   exist and pass every current eligibility and accounting check before a
   dry-run can return `ready` or execute can prune it.
3. A partial receipt, partial hot batch, partial or foreign mapping, or mapping
   without a receipt fails closed.

Execute maps each durable idempotency row to the archive batch, deletes the
exact entry IDs, deletes the exact transaction IDs, verifies exact row counts
and unchanged account balances and `next_entry_seq`, and writes one immutable
receipt in the same transaction. A rollback restores mappings, rows, and the
empty receipt together. Registry identity and replay snapshots remain online;
runtime replay never needs Storage.

Every execute call repeats the complete validation. A successful dry-run is
diagnostic evidence, not authorization for a later execute. The database
rejects a `NULL` execute flag, and only literal `TRUE` can enter the mutation
path.

## Eligibility and concurrency gates

For every transaction, the function rechecks:

- the exact `TABLE_BUY_IN`/`TABLE_CASH_OUT` whitelist and direction of amounts;
- `user_id IS NULL`, zero `USER` entries, two complete entries, and exact
  double-entry conservation;
- one table marker derived consistently from metadata, reference, or escrow
  account context;
- transaction age below the committed cutoff;
- an absent retained table or an existing table in `CLOSED` state;
- an existing active table escrow account whose balance is exactly `0`;
- a matching durable idempotency identity row;
- exact counts, order, ID hashes, `tx_types`, amount totals, time range, and
  cursor end from the committed archive.

All distinct table IDs and all affected tables, accounts, registry rows,
transactions, and entries are locked in deterministic order. The CLI owns the
transaction boundary: it uses `SERIALIZABLE`, a local five-second lock timeout,
and a local 120-second statement timeout. Execute retries at most three times,
and only for a serialization failure or lock timeout. Other errors fail
immediately. The whole batch is atomic.

## Stage-only authorization

Both the CLI and the database function require canonical Stage. The database
function reads PostgreSQL's stable system identifier and accepts only
`7656985631720456337`; it explicitly rejects Production identifier
`7575202818581710058`. The committed manifest project ref must also be
`krydukthwdvccggbyjfw`. The manifest value is a secondary consistency check,
not the server identity gate.

The destructive function is `SECURITY DEFINER`, has an empty `search_path`,
and is owned by the `NOLOGIN`, `NOINHERIT`, `NOBYPASSRLS` role
`chips_ledger_archive_pruner`. Its tables and functions are schema-qualified.
The role has only the table, column, row-lock, and delete permissions needed by
the operation, plus role-specific RLS policies. `PUBLIC`, `anon`,
`authenticated`, and `service_role` cannot execute the proof or pruning
functions. The CLI connects through the existing direct Stage PostgreSQL
operations credential; Storage authorization is used only for private
downloads.

The manifest guard blocks deletion, makes the original proof fields and
`batch_id` immutable, permits only `pending -> committed`, and permits one
`NULL -> complete` transition for both archive ID proof and prune receipt. The
registry guard permits only one `NULL -> archive_batch_id` transition and
continues to prohibit registry deletion and identity/replay replacement.
Proof, receipt, and mapping transitions require
`current_user = 'chips_ledger_archive_pruner'`; even the direct operations role
cannot write them, and proof plus receipt cannot be set in one update. The
initial measurement intentionally has no index on `archive_batch_id`.

## CLI and recovery copy

The command has no Production or implicit execute mode:

```sh
node scripts/ops/chips-ledger-archive-prune.mjs \
  --target stage \
  --object-path v1/sha256/<compressed-sha256>.jsonl.gz \
  --confirm-sha <compressed-sha256>
```

The default is database dry-run. Use `--register-proof` once after full private
Storage verification. Execution requires both `--execute` and an explicit
private recovery location:

```sh
node scripts/ops/chips-ledger-archive-prune.mjs \
  --target stage \
  --object-path v1/sha256/<compressed-sha256>.jsonl.gz \
  --confirm-sha <compressed-sha256> \
  --execute \
  --recovery-dir /private/recovery-directory
```

Before opening the destructive database transaction, execute writes the
verified `.jsonl.gz` and a recovery manifest to a real directory owned by the
operator with mode `0700`. Files use mode `0600`, exclusive creation without
overwrite, per-file `fsync`, and parent-directory `fsync`. An exact existing
bundle may be reused for an idempotent retry; a partial or different bundle
fails closed. The CLI rechecks both local files, gzip, both archive hashes,
counts, conservation, and ordered ID hashes before every database attempt.

Before any database preflight and again after a successful destructive commit,
the CLI reads (but never creates or updates) the Storage bucket configuration
and requires the exact `chips-ledger-archive` name, `public=false`, only
`application/gzip`, and the 6 MiB object limit.

After commit, the CLI downloads the private Storage object again, verifies its
compressed and raw hashes and full archive contract, and checks the database
receipt, mappings, and absence of hot rows. A post-commit verification failure
cannot roll back a committed transaction: the CLI reports a distinct failure,
retains the recovery bundle, and operators must stop further pruning while the
receipt and archive are reconciled. It never performs remote cleanup.

## Stage procedure and evidence

Apply the migration through the existing exact-HEAD Stage workflow. For a
committed candidate object, run proof registration, dry-run, execute with a
new private recovery directory, and an identical execute retry. Confirm
`ready`, then `pruned`, then `already_pruned`; exactly one receipt and one
registry mapping per transaction; zero matching hot rows; unchanged balances
and account sequences; and an unchanged, privately downloadable Storage
object. Retain the recovery bundle until the operational evidence has been
reviewed.

Record only aggregate evidence in Issue #874 and the PR:

- exact PR HEAD, Stage project ref, and PostgreSQL system identifier;
- bucket, object path, compressed SHA-256, and both ordered ID SHA-256 values;
- cutoff, cursor, first/last timestamps, counts, `tx_types`, and amount totals;
- user transaction count, USER entry count, and distinct table count;
- dry-run, execute, receipt, mapping, retry, and post-commit download results;
- before/after hot relation counts and sizes, while noting that ordinary
  PostgreSQL deletes do not immediately return physical relation space;
- recovery directory/file permission checks and confirmation that Production
  and Storage were not mutated.

Before any Production design can be approved, complete at least two independent
Stage prune/retry cycles, exercise interruption recovery, prove stable user and
admin runtime behavior, quantify history/API impact, verify idempotency parity
after pruning, review database capacity effects including the still-linear
registry, and obtain explicit approval for a Production migration and retention
policy. The Production system identifier must remain rejected by this version.

## Breaking impact and scope boundary

Balances, conservation, account sequences, active-table provenance, terminal
cash-out, recovery invariants, and current idempotent replay are preserved.
Because this version rejects transactions and entries associated with `USER`
accounts, user ledger history and user `afterSeq` pagination are not changed.

The intentional Stage breaking impact is removal of the selected technical
transactions from hot global, admin, and table-history queries. Those callers
will no longer find the pruned rows in PostgreSQL; no cold-history API is added
here. That loss must be accepted for each Stage candidate and separately
designed before Production.

This stage does not modify balances, upload or delete Storage objects, create
new archives, prune user transactions, run on Production, add a scheduler,
change runtime/WS/UI code, or add environment variables. It also does not make
database growth fully bounded: `chips_transaction_idempotency` remains durable
and grows linearly. Issue #874 therefore cannot be closed solely because one
Stage 2B.4 batch succeeds.
