# Stage-only chips-ledger automation

This workflow is Stage-only and intentionally unavailable for Production. It
hardcodes the canonical Stage project `krydukthwdvccggbyjfw` and PostgreSQL
system identifier `7656985631720456337`. The workflow passes only Stage
credentials; there is no Production scheduler or Production operation path.

## Active policies and schedules

- The existing 30-day Stage maintenance (`stage-ledger-auto-retention-30d-v1`)
  runs once per day on the native cron:
  - `17 2 * * *`
- The bot-only 7-day retention policy
  (`stage-ledger-bot-only-retention-7d-v1`) is active and runs every 15 minutes
  on the native cron:
  - `7,22,37,52 * * * *`
- Stage escrow account retention is completed and active. It runs on the same
  15-minute native cron.
- `external-scheduled-automatic` is the VPS/external fallback dispatch mode for
  the same bot-only 7-day and escrow account retention automatic steps. It does
  not introduce a separate policy or batch limit.
- The workflow concurrency group is `chips-ledger-stage-automation` with
  `cancel-in-progress: false` and `queue: max`.

The bot-only 7-day cleanup processes at most 6 complete-table batches per
invocation. Schema-v2 intentionally keeps one table per batch for an atomic
lifecycle receipt; the bounded schedule provides a theoretical 576-table/day
ceiling while preserving job timeout margin. Escrow account retention is
similarly bounded by its own script-level limits and fail-closed checks.

## Supported dispatch modes

The remaining manual/operator modes are intentionally limited to supported
ongoing operations:

| Mode | Purpose |
| --- | --- |
| `existing-30d` | Run the existing daily 30-day Stage automation cycle |
| `existing-30d-recovery-diagnostic` | Read-only diagnosis of the current 30-day cycle or an exact 30-day batch |
| `existing-30d-recovery-repair` | Owner-only, exact-batch recovery repair for a proven/unpruned 30-day batch with missing durable recovery |
| `bot-only-7d-summary-diagnostic` | Read-only bot-only table identity summary diagnostic |
| `bot-only-7d-automatic` | Run the activated bot-only 7-day automatic cleanup on demand |
| `escrow-retention-audit` | Read-only Stage escrow retention audit |
| `escrow-retention-verify` | Verify an existing account recovery object |
| `external-scheduled-automatic` | External/VPS fallback for native bot-only + escrow automation |

The rollout-only modes (first bot-only canary prepare/execute, bot-only batch 15
recovery repair, legacy Stage allowlist prepare/orchestrate/batch-13 execute,
and escrow retention canary prepare/authorize/execute/activate) are no longer
exposed through the workflow. The underlying archive/recovery scripts remain in
the repository where they are still needed for immutable evidence, audits, and
controlled recovery operations.

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
Client/auth/not-found responses are not retried during an ordinary read, except
that a not-found result from the bounded post-create verification read may be
rechecked for read-after-write visibility. The create-only Storage `POST` is
never retried. Every successful download still requires the expected MIME type
and byte/SHA-256 verification.

Automatic error reports retain completed batches and the current in-progress
batch. They distinguish `archive_storage_modified` from
`recovery_storage_modified`; `storage_modified` is their explicitly known
aggregate and is null when a partial operation leaves the outcome unknown.
Recovery failures are reported with the batch number, batch ID, recovery
attempts, per-object Storage presence/MIME/size/SHA-256 and an explicit state
such as `both_missing`, `partial`, `mismatch` or `write_not_visible`.

The local working bundle remains `0700` with `0600` files. A partial or
different durable copy is fail-closed.

## 30-day controlled recovery diagnostic/repair

The existing 30-day automation intentionally refuses a blind retry when a
committed, proven, unpruned cycle has no durable recovery. The controlled
operator path is:

1. Run `existing-30d-recovery-diagnostic`.
   - Without a batch ID it detects the current 30-day cycle.
   - If multiple incomplete cycles exist, it reports ambiguity with candidate
     batch IDs rather than choosing one.
   - It is read-only and reports batch identity, object path, SHA-256, proof and
     prune timestamps, recovery paths, `inspectDurableRecoveryState()` results,
     and whether the main immutable archive object exists and matches.
2. If the report confirms exactly:
   - batch is `proven`;
   - `pruned_at` is null;
   - the main archive object exists and matches the committed SHA;
   - recovery state is exactly `BOTH_MISSING`;
   then an owner may run `existing-30d-recovery-repair` with the exact
   `stage_30d_recovery_batch_id`.
3. The repair is recovery-only:
   - re-loads the exact batch from the DB after lock and again after dry-run;
   - revalidates policy, object path, SHA, proof, unpruned state, and
     `BOTH_MISSING`;
   - uses the already committed/proven archive to create both deterministic
     recovery objects through `persistDurableRecovery(...)`;
   - uses create-only Storage writes, canonical recovery manifest, and
     read-after-write byte/SHA verification;
   - never prunes, never writes a GO, never cleans registry state, and never
     exports a new batch.
4. Only after both recovery objects verify as `complete` may the normal 30-day
   workflow resume.

This repair is not a state-skipping mode: `assertResumeRecoveryState()` remains
unchanged and the normal automation continues to fail closed whenever durable
recovery is missing.

## Operator runbook

The automation has no force, repair, or state-skipping mode beyond the
controlled exact-batch recovery repair described above. Do not invoke the
pruner with `--execute` by hand, edit an archive manifest, clear an idempotency
mapping, delete a Storage object, or enable a kill switch to get past a blocked
state. Keep the Stage cycle blocked and preserve all evidence until the
condition is resolved.

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

1. Do not run destructive cleanup, register a new proof, overwrite an existing
   object, or start a new archive batch. The primary archive object is not a
   substitute for a partial recovery pair.
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

This is the state where `archive_proof_verified_at` is complete, `pruned_at` is
null, and both recovery objects are absent. Automatic mode may recover this
state only after a ready read-only dry-run revalidates the primary object and
proves that its bytes and ID evidence match the committed SHA/proof. It then
creates both deterministic recovery objects with `x-upsert:false` and rechecks
their MIME, bytes, SHA-256, gzip, JSON, and canonical manifest before the normal
cycle continues. A partial/ambiguous pair, any lifecycle receipt or GO,
missing/foreign primary object, or any proof/manifest mismatch remains blocked
and requires owner-approved recovery.

For the existing 30-day policy, use the controlled
`existing-30d-recovery-diagnostic` + `existing-30d-recovery-repair` path rather
than relying on automatic reconstruction. The 30-day automation remains
fail-closed until durable recovery is complete.

### Post-commit or already-pruned recovery

If the receipt and mappings are complete, the cycle is revalidated through its
already-completed state. It still requires the complete recovery pair and
immutable proof. A missing or partial pair is an incident, not a reason to
create a new batch. Keep the environment fail-closed until the pair is restored
and passes private download and byte/SHA verification.

## Resume and locking

GitHub Actions concurrency is complemented by a target-specific PostgreSQL
session advisory lock held for the entire cycle. All modes share the
`chips-ledger-stage-automation` concurrency group with
`cancel-in-progress: false` and `queue: max`, so scheduled and manual work
remains serialized without replacing an older pending run. A busy lock is a
no-op; a lost lock session aborts the cycle.

Pending, partial, mismatched or otherwise ambiguous own manifests stop the run
and are reported in the aggregate Job Summary. A committed manifest with no
proof can resume only through the normal proof/dry-run path. A proven unpruned,
uncleaned manifest with no GO may create its recovery pair only through the
constrained reconstruction/repair paths described above; all other proven
manifests require a complete durable pair. Every allowed resume repeats
identity, policy, archive, recovery, proof, receipt and mapping verification.

Logs and Job Summary contain only aggregate counts, sizes, hashes and state.
They never contain ledger records, credentials, DB URLs, service keys or
recovery contents. No Actions artifact is used for recovery.
