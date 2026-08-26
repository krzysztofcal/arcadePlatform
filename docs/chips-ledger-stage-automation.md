# Stage-only chips-ledger automation

This workflow is related to closed Issue #874 and is intentionally unavailable
for Production. The orchestrator has no target argument: it hardcodes the
canonical Stage project `krydukthwdvccggbyjfw` and PostgreSQL system identifier
`7656985631720456337`. The workflow passes only Stage credentials.

## Policy

- `CHIPS_LEDGER_STAGE_AUTOMATION_ENABLED=1` is required; the variable is absent
  or disabled by default at merge.
- The existing 30-day Stage maintenance runs once per day with a strict
  30-day cutoff.
- After the separate bot-only policy is activated by its exact database GO, the
  7-day cleanup schedule runs every 15 minutes and processes at most 25
  complete-table batches per invocation. Schema-v2 intentionally keeps one
  table per batch for an atomic lifecycle receipt; the bounded schedule
  provides a theoretical 2,400-table/day ceiling, above the observed Stage
  bot-table creation rate.
- The first bot-only canary is a two-run Actions sequence: dispatch
  `bot-only-7d-prepare-only`, record its exact committed `batch_id`, then
  dispatch `bot-only-7d-execute` with that `approved_batch_id`. The execute
  path remains behind `CHIPS_LEDGER_BOT_ONLY_EXECUTE=1` and the exact-batch
  checks in the database.
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

## Operator runbook

The automation has no force, repair, or state-skipping mode. Do not invoke the
pruner with `--execute` by hand, edit an archive manifest, clear an idempotency
mapping, delete a Storage object, or enable the kill switch to get past one of
the states below. Keep the Stage cycle blocked and preserve all evidence until
the condition is resolved.

### Pending, partial, or ambiguous manifest

If the aggregate Job Summary reports `pending`, a partial proof/receipt, more
than one incomplete manifest, an invalid policy, or another ambiguous state:

1. Do not rerun the cycle and do not create a second batch.
2. Record the aggregate state, object path, compressed SHA-256, policy ID,
   transaction/entry counts, and timestamps from the Job Summary. Never copy
   ledger rows, recovery contents, credentials, or database URLs into a ticket
   or chat.
3. Using read-only access, compare the single Stage manifest, its primary
   private object, and the corresponding recovery paths. Check target identity,
   policy ID, MIME type, object size, and SHA-256 before taking any repair
   action.
4. Escalate the exact evidence to the ledger owner. Leave the manifest and
   Storage objects untouched unless the owner approves a controlled recovery
   repair; the automation must continue to fail closed.

### Missing or partial durable recovery

For a proven or pruned cycle, both recovery objects are mandatory. If either
object is missing, has the wrong MIME type/size/SHA-256, cannot be privately
downloaded, or the pair is otherwise partial:

1. Do not run `--execute`, register a new proof, overwrite an existing object,
   or start a new archive batch. The primary archive object is not a substitute
   for the recovery pair.
2. Preserve the manifest and the surviving object. Confirm that the expected
   paths are derived from the immutable compressed SHA-256 and that no object
   at either path differs from the expected bytes.
3. With explicit ledger-owner approval, restore only the missing copy from the
   same verified archive/proof evidence using private, no-overwrite Storage
   semantics. If the primary object is unavailable, use an independently
   verified recovery source; never reconstruct bytes from a mutable or
   unverified source.
4. Privately download both recovery objects again and compare bytes and SHA-256
   to the expected values. Only after both copies pass may the normal Stage
   automation be allowed to resume. A mismatch remains blocked and is a manual
   incident.

### Proven without recovery

This is the state `archive_proof_verified_at` is complete while `pruned_at` is
still null and no complete durable pair exists. It is not permission to retry
the prune. Stop the run, preserve the immutable proof and primary manifest,
repair/verify the two private recovery objects through the procedure above,
and then let the normal cycle repeat its dry-run and all revalidation checks.
The next allowed path is proof revalidation followed by recovery verification
and only then execute; there is no operator shortcut.

### Post-commit or already-pruned recovery

If the receipt and mappings are complete, the cycle is revalidated through
`already_pruned`. It still requires the complete recovery pair and immutable
proof. A missing or partial pair is an incident, not a reason to create a new
batch. Keep the environment fail-closed until the pair is restored and passes
private download and byte/SHA verification.

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
