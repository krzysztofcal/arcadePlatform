# Contract: Generic bot-only Stage recovery repair

## Workflow dispatch contract

The existing workflow remains the only supported live entry point:

```text
mode: bot-only-7d-recovery-repair
bot_only_recovery_batch_id: <positive decimal batch id>
bot_only_recovery_confirmation: REPAIR <same batch id>
ref: refs/heads/main
repository: krzysztofcal/arcadePlatform
actor: repository owner
```

The workflow also requires the existing read-only Stage fence preflight and
empty `CHIPS_LEDGER_BOT_ONLY_EXECUTE` /
`CHIPS_LEDGER_BOT_ONLY_AUTOMATIC` gates. The mode is not selected by schedule
or by the automatic step.

## Script contract

The CLI accepts:

```text
node scripts/ops/chips-ledger-stage-automation.mjs \
  --policy bot-only-7d \
  --repair-recovery \
  --batch-id <positive decimal batch id>
```

The implementation invokes the generic exact-batch repair for the missing
manifest contract. The existing historical batch-15 corrected-manifest
compatibility path remains separate because it has a different known-content
replacement contract.

## Result contract

Successful result:

| Field | Meaning |
|---|---|
| `state` | `recovery_repaired` after one missing-manifest create/reconcile, or `recovery_already_repaired` for a complete pair on an otherwise eligible unpruned/uncleaned row |
| `recoveryState` | `complete` |
| `initialRecoveryState` | `partial` or `complete` |
| `recoveryVerified` | `true` only after both recovery objects are freshly verified |
| `storageModified` | `true` only for the repair write path; `false` for idempotent read-only resume |
| `receipt` | `recovery-manifest-repair-only` or `recovery-already-repaired-read-only` |
| object fields | Derived archive/manifest paths and verified SHA-256 values |

Failure contract:

- `partial` is returned/attached only as a diagnostic state; it is never a
  success result unless it is exactly the approved archive-present,
  manifest-absent state before the one manifest write.
- `mismatch`, `unavailable`, `write_not_visible`, `both_missing`, and
  identity/fence/lock/proof/lifecycle failures throw and write the existing
  aggregate error summary. In particular, a row with `pruned_at`, completed
  registry cleanup, destructive GO, or a completed-retention marker is rejected
  before recovery inspection/result classification, even when both objects are
  complete.
- A failure summary includes the batch, state, per-object presence/details, and
  required action. It never authorizes cleanup.

## Storage write contract

- Initial and final reads use authenticated private Storage GETs.
- The only repair write targets the derived recovery manifest.
- The request includes `content-type: application/gzip` and
  `x-upsert:false`.
- A POST 504 or transient network error causes a bounded read reconciliation,
  never a second POST.
- A matching observed object is accepted as reconciled; absent, unavailable,
  or different content remains blocked.
- No archive or manifest is overwritten or deleted by this repair.
