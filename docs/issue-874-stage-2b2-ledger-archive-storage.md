# Issue #874 — Stage 2B.2 verified immutable ledger archive in Storage

Stage 2B.2 extends the local Stage 2B.1 prototype with one verified, private
Supabase Storage archive. It is an operational prototype: the ledger remains
read-only, there is no pruning, and no archive object is deleted.

## Storage contract

The fixed bucket is `chips-ledger-archive`. It is created and inspected only
through the Supabase Storage API, never by writing `storage.buckets` or
`storage.objects` from SQL. The bucket must remain:

- private (`public: false`);
- restricted to `application/gzip`;
- limited to `6291456` bytes (6 MiB) per object.

The deterministic object path is:

```text
v1/sha256/<lowercase-compressed-sha256>.jsonl.gz
```

The uploader uses a standard Storage upload with `x-upsert: false`. It never
overwrites an object. An existing object is downloaded through the private
authenticated endpoint and compared byte-for-byte with the local artifact.

## Local artifact and PostgreSQL manifest

The `.jsonl.gz` and local sidecar manifest keep the Stage 2B.1 format and
`schema_version: 1`. Each JSONL line is one complete transaction with all its
entries. IDs, `sequence`, `entry_seq`, and amounts are decimal strings. Every
entry includes its account context, including `account_type`, `user_id`, and
`system_key`.

The local manifest additionally contains exact decimal-string totals:

```json
"amounts": {
  "credits": "9007199254740993",
  "debits": "9007199254740993",
  "net": "0"
}
```

Before Storage access, the uploader verifies gzip round-trip, raw and
compressed bytes, both SHA-256 values, counts, `tx_type` distribution, cursor,
time range, account context, duplicate IDs, deterministic order, and
double-entry conservation. The object must also be no larger than 6 MiB.

The migration creates `public.chips_ledger_archive_batches`, keyed by
`object_path`. It records the project ref, archive format version, cutoff,
cursor start/end, first/last timestamps, counts, `tx_types`, raw/compressed
sizes and hashes, credits, absolute debits, net amount, status, and creation
and commit timestamps. The only state transition is `pending -> committed`.
Constraints require non-negative counts/sizes, 64-character lowercase SHA-256
values, equal credits/debits, net `0`, and a matching `committed_at` for each
state. RLS is enabled and `anon` and `authenticated` have no privileges or
policies. The table is a manifest registry, not a balance source.

## Required environment and commands

The uploader requires all of the following existing environment values:

- `SUPABASE_URL` — the HTTPS Supabase API origin for the selected target;
- `SUPABASE_SERVICE_ROLE_KEY` — used transiently for Storage API requests;
- `SUPABASE_STAGE_DB_URL` or `SUPABASE_PROD_DB_URL` — selected by the explicit
  target;
- `EXPECTED_SUPABASE_STAGE_PROJECT_REF` and
  `EXPECTED_SUPABASE_PROD_PROJECT_REF` (the existing legacy project-ref names
  remain accepted as compatibility aliases).

The script requires explicit paths and has no target or path defaults:

```sh
node scripts/ops/chips-ledger-archive-store.mjs \
  --target stage \
  --artifact /private/path/chips-ledger-stage.jsonl.gz \
  --manifest /private/path/chips-ledger-stage.manifest.json
```

Before any database or Storage connection, it validates the selected target,
both canonical project refs, the HTTPS API origin, and the API/DB project-ref
match. It does not print the DB URL or service-role key. The Stage procedure
must set `--target stage`; Production is not part of this prototype run.

## Retry and recovery

The uploader first verifies the local files, then inserts one `pending` row
using `object_path` as the primary key. Existing rows are compared across all
immutable fields; any difference fails closed. A pending row may be retried:

1. if the object is absent, upload once with no upsert, download it privately,
   verify its exact size and compressed SHA-256, and commit the row;
2. if the object already exists, never upload over it; download, verify, and
   commit the pending row;
3. if the row is already committed, download and verify the object and return
   an idempotent success without an upload.

An upload or download failure leaves the manifest pending and performs no
remote cleanup. A mismatching object is never committed. A committed row with
a missing object fails closed and requires operational investigation; the
uploader does not silently recreate it. The conditional SQL update changes
only a `pending` row, so retry cannot create a second manifest for the same
object path.

## Stage procedure and evidence

After the migration workflow has applied the exact PR HEAD to the shared Stage
database, run the exporter with a private temporary output directory and a
cutoff that produces a non-empty batch. Then run the uploader twice against
the same local files. The second run must report an idempotent success and no
Storage overwrite. Confirm that an unauthenticated public-object request is
rejected; private-object verification must use the authenticated download.

Leave the one valid Stage object and its `committed` manifest row in place as
the 2B.2 evidence. Remove only the local temporary gzip and sidecar manifest,
and clear transient secret variables after collecting aggregate output. Do not
print records, user IDs, idempotency keys, URLs containing credentials, or
service-role keys.

Record in Issue #874 and the PR:

- exact PR HEAD and Stage project ref;
- bucket and object path;
- cutoff and cursor start/end;
- transaction/entry counts and `tx_type` distribution;
- credits, absolute debits, and net amount;
- raw/compressed bytes and both SHA-256 values;
- upload and private-download durations;
- first-run and second-run/idempotency results;
- public-access rejection;
- confirmation that Production, ledger rows, and Storage deletion were not
  used.

Stage 2B.3 and 2B.4, remote manifest expansion, cold-history APIs/UI,
idempotency registries, pruning, deletion, schedulers, and Production rollout
remain out of scope. This PR adds no runtime, WebSocket, browser, or persistent
environment configuration.
