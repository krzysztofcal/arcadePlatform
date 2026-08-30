# Stage-only chips-ledger automation

This workflow is related to closed Issue #874 and is intentionally unavailable
for Production. The legacy Stage allowlist tooling is part of this PR but
remains a separate, manual-only mode. The automatic bot-only 7-day cron never
invokes it, and it was not operationally run during the bot-only rollout.
Production has no scheduler path, and no Production operation was performed.
The orchestrator has no target argument: it hardcodes the
canonical Stage project `krydukthwdvccggbyjfw` and PostgreSQL system identifier
`7656985631720456337`. The workflow passes only Stage credentials.

## Policy

- Stage policy `stage-ledger-bot-only-retention-7d-v1` is active. Canary batch
  15 completed and was used to activate the policy.
- `CHIPS_LEDGER_STAGE_AUTOMATION_ENABLED=1` is set. After this change is merged,
  the workflow from the default branch automatically starts the 7-day cleanup
  every 15 minutes. This is intentional: the merge is the operational GO for
  the scheduler, not a request for another activation step.
- The existing 30-day Stage maintenance runs once per day with a strict
  30-day cutoff.
- The 7-day cleanup schedule runs every 15 minutes and processes at most 6
  complete-table batches per invocation. Schema-v2 intentionally keeps one
  table per batch for an atomic lifecycle receipt; the bounded schedule
  provides a theoretical 576-table/day ceiling while preserving job timeout
  margin.
- The first bot-only canary is an explicit prepare/authorize/execute sequence:
  dispatch `bot-only-7d-prepare-only`, record the exact committed `batch_id`,
  then dispatch `bot-only-7d-execute` with both `approved_batch_id` and the
  exact human confirmation `GO <approved_batch_id>`. The execute dispatch must
  also carry `CHIPS_LEDGER_BOT_ONLY_EXECUTE=1`.
- Selection starts at the beginning of `(created_at, id)` on every new cycle and
  chooses the oldest currently hot, unmapped, prunable technical rows. Manual
  manifests without `source_policy_id` never drive the cursor.
- A missing candidate is a successful no-op.

The JSONL is produced by the prunable-only exporter mode. The manual exporter
mode remains unchanged. The database pruner repeats the complete technical,
registry, conservation, table, escrow, proof, receipt and mapping checks before
any delete.

## Exact canary authorization

The first canary is intentionally bound to one prepared batch and never picks
the next candidate during execute:

1. Actions runs `bot-only-7d-prepare-only`. This may export, store, register
   the immutable proof, validate the archive, and persist the two durable
   recovery copies, but it does not write a destructive GO or prune rows.
2. The reviewer copies the committed `batch_id` from the aggregate result and
   enters that ID in `approved_batch_id` on a new `bot-only-7d-execute`
   dispatch. The second input must be exactly `GO <batch_id>` in
   `approved_batch_confirmation`.
3. Before any execute-side export, Storage write, proof registration, or new
   manifest, the runner reads only that `batch_id` and fail-closed checks Stage
   identity, policy, schema v2, committed status, proof, recovery, object/SHA,
   receipts, and active-manifest equality.
4. If the exact batch is committed and unpruned without a GO, the owner-only
   database call
   `public.chips_authorize_bot_only_archive_batch(batch_id, 'GO <batch_id>')`
   persists `destructive_go_at` and `destructive_go_batch_id`. The runner
   reads the manifest again and refuses to execute unless both values are
   present and bound to the same batch. An existing exact GO is reused without
   creating another one.
5. Execute then passes that same ID to the proof-bound cleanup function. A
   retry of a completely pruned-and-cleaned exact batch verifies its receipts,
   returns `already_cleaned`, and does not export, prepare, or select another
   batch. A wrong/nonexistent/inactive ID, wrong confirmation, partial or
   foreign GO, missing proof/recovery, or object/hash/policy mismatch fails
   closed.

The canary path is distinct from the activated automatic policy. The 15-minute
schedule is the only automatic 7-day trigger; the existing 30-day policy keeps
its once-daily schedule. Automatic cleanup remains bounded at 6 batches per
run, which is at most 576 complete tables per day.

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

Authenticated Storage `GET` requests use at most three total attempts with a
short backoff, and retry only 5xx responses or transient network failures.
Client/auth/not-found responses are not retried, and Storage writes are never
retried. Every successful download still requires the expected MIME type and
byte/SHA-256 verification.

Automatic error reports retain both completed `processed_batches` and the
current in-progress batch. They distinguish `archive_storage_modified` from
`recovery_storage_modified`; `storage_modified` is their explicitly known
aggregate and is null when a partial operation leaves the outcome unknown.

The local working bundle remains `0700` with `0600` files. A partial or
different durable copy is fail-closed. Automatic mode may reconstruct a pair
only for a canonical committed, proven, unpruned and uncleaned bot-only Stage
batch with no destructive GO, a ready read-only dry-run, and both recovery
objects explicitly confirmed absent. It re-downloads the primary object,
requires byte/SHA equality with the dry-run and committed proof, generates the
canonical manifest, and uses create-only uploads followed by full verification.
After a post-commit runner failure, receipt/mappings and the normal
`already_cleaned` path are used; no blind retry or new batch is created.

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

### Partial or ambiguous durable recovery

For a proven or pruned cycle, both recovery objects are mandatory. If exactly
one object is present, either object has the wrong MIME type/size/SHA-256,
cannot be privately downloaded, or the pair is otherwise partial:

1. Do not run `--execute`, register a new proof, overwrite an existing object,
   or start a new archive batch. The primary archive object is not a substitute
   for a partial recovery pair.
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

This is the state `archive_proof_verified_at` is complete while `pruned_at`,
`registry_cleaned_at`, the destructive GO, and the TABLE lifecycle marker are
still null and both recovery objects are absent. Automatic mode may recover
this state only after a ready read-only dry-run revalidates the primary object
and proves that its bytes and ID evidence match the committed SHA/proof. It
then creates both deterministic recovery objects with `x-upsert:false` and
rechecks their MIME, bytes, SHA-256, gzip, JSON, and canonical manifest before
the normal double-cycle executes. A partial/ambiguous pair, any lifecycle
receipt or GO, missing/foreign primary object, or any proof/manifest mismatch
remains blocked and requires owner-approved recovery.

### Post-commit or already-pruned recovery

If the receipt and mappings are complete, the cycle is revalidated through
`already_pruned`. It still requires the complete recovery pair and immutable
proof. A missing or partial pair is an incident, not a reason to create a new
batch. Keep the environment fail-closed until the pair is restored and passes
private download and byte/SHA verification.

## Resume and locking

GitHub Actions concurrency is complemented by a target-specific PostgreSQL
session advisory lock held for the entire cycle. All modes share the
`chips-ledger-stage-automation` concurrency group with
`cancel-in-progress: false` and `queue: max`, so scheduled and manual work
remains serialized without replacing an older pending run. A busy lock is a
no-op; a lost lock session aborts the cycle. Pending, partial, mismatched or otherwise
ambiguous own manifests stop the run and are reported in the aggregate Job
Summary. A committed manifest with no proof can resume only through the normal
proof/dry-run path. A proven unpruned, uncleaned manifest with no GO may create
its pair only through the constrained automatic reconstruction path above; all
other proven manifests require a complete durable pair. With a pair it is
fully revalidated before execute, while a missing or partial pair after prune,
cleanup, GO, or an ambiguous Storage result is fail-closed. A completed
manifest is rechecked through `already_cleaned`. Every allowed resume repeats
identity, policy, archive, recovery, proof, receipt and mapping verification.

Logs and Job Summary contain only aggregate counts, sizes, hashes and state. They
never contain ledger records, credentials, DB URLs, service keys or recovery
contents. No Actions artifact is used for recovery.
