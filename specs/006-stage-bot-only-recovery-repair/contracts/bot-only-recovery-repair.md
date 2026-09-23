# Controlled Bot-Only Recovery Repair Contract

## Manual workflow contract

The workflow exposes one new manual mode:

```text
mode: bot-only-7d-recovery-repair
bot_only_recovery_batch_id: 9923
bot_only_recovery_confirmation: REPAIR 9923
```

The dispatch is accepted only when all of the following are true:

- repository is `krzysztofcal/arcadePlatform`;
- event is `workflow_dispatch`, ref is `refs/heads/main`, and actor is the repository owner;
- the Stage read-only fence preflight passes;
- batch input and confirmation match the exact values above;
- bot-only execute and automatic gates are empty.

## CLI contract

```text
node scripts/ops/chips-ledger-stage-automation.mjs \
  --policy bot-only-7d \
  --repair-recovery \
  --batch-id 9923
```

The bot-only repair CLI accepts only `15` for the existing batch-15 implementation or `9923` for this incident-specific implementation. No arbitrary batch ID is accepted.

## Successful result

The repair reports recovery-only success after confirming:

- primary archive and existing recovery archive have matching bytes, MIME, size, and SHA-256;
- the missing manifest was created with `x-upsert:false`, or a 504 was reconciled to an already-created matching object;
- both recovery objects are complete and canonical;
- no prune receipt, cleanup receipt, destructive GO, or database mutation was produced.

## Failure result

Any identity, proof, lock, lifecycle, object, byte, MIME, SHA-256, canonical-content, timeout-reconciliation, or environment mismatch fails closed. A 504 followed by an absent or differing manifest is not retried blindly.
