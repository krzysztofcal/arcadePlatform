# Stage-only chips-ledger automation

This workflow is related to closed Issue #874 and is intentionally unavailable
for Production. The orchestrator has no target argument: it hardcodes the
canonical Stage project `krydukthwdvccggbyjfw` and PostgreSQL system identifier
`7656985631720456337`. The workflow passes only Stage credentials.

## Policy

- `CHIPS_LEDGER_STAGE_AUTOMATION_ENABLED=1` is required; the variable is absent
  or disabled by default at merge.
- The schedule runs once per day with a strict 30-day cutoff.
- One run can create at most one batch of 5,000 transactions. It never drains a
  backlog in a loop.
- Selection starts at the beginning of `(created_at, id)` on every new cycle and
  chooses the oldest currently hot, unmapped, prunable technical rows. Manual
  manifests without `source_policy_id` never drive the cursor.
- A missing candidate is a successful no-op.

The JSONL is produced by the prunable-only exporter mode. The manual exporter
mode remains unchanged. The database pruner repeats the complete technical,
registry, conservation, table, escrow, proof, receipt and mapping checks before
any delete.

## Recovery durability

Before execute, the existing private `chips-ledger-archive` bucket must contain
and privately return both deterministic, no-overwrite (`x-upsert=false`) gzip
objects:

```text
recovery/v1/sha256/<compressed-sha>.jsonl.gz
recovery/v1/sha256/<compressed-sha>.recovery.json.gz
```

Both objects use `application/gzip`. The first is a complete second copy of the
verified archive. The second is the gzip-compressed recovery manifest containing
the target identity, policy ID, archive metadata and immutable ID proof. Upload
is followed by private download and byte/SHA verification for both objects.
Execute is refused until both copies match the expected bytes. Restore uses
these recovery objects and does not require the primary archive object.

The local working bundle remains `0700` with `0600` files. A partial, different,
or missing durable copy is fail-closed. After a post-commit runner failure,
receipt/mappings and the normal `already_pruned` path are used; no blind retry or
new batch is created.

## Resume and locking

GitHub Actions concurrency is complemented by a target-specific PostgreSQL
session advisory lock held for the entire cycle. A busy lock is a no-op; a lost
lock session aborts the cycle. Pending, partial, mismatched or otherwise
ambiguous own manifests stop the run and are reported in the aggregate Job
Summary. A committed manifest with no proof can resume only through the normal
proof/dry-run path. A proven manifest must have a complete durable recovery
pair; with that pair it is fully revalidated before execute, while a missing or
partial pair is fail-closed. A pruned manifest with a complete pair is
rechecked through `already_pruned`. Every allowed resume repeats identity,
policy, archive, recovery, proof, receipt and mapping verification.

Logs and Job Summary contain only aggregate counts, sizes, hashes and state. They
never contain ledger records, credentials, DB URLs, service keys or recovery
contents. No Actions artifact is used for recovery.
