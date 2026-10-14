# T018 Production closed-human lifecycle finalization

Batch 4 pruning is correct and irreversible within this task. Closed-human retains registry mappings; null registry-cleanup receipts are intentional. Only its table completion marker is missing.

1. Add `lifecycle-completion` to the Production entrypoint and dispatch workflow. Require owner/main workflow context, exact batch/table/cutoff and a separate `COMPLETE HUMAN RETENTION <batch>` confirmation; reject these inputs in other modes.
2. Reuse Production lock, prune dry-run (`already_pruned`), immutable archive/proof and durable recovery inspection. Verify retained registry identities and complete receipts before calling the existing marker routine in a serializable transaction with batch/table locks and exact cutoff equality. Existing markers are verified without changing them. No migration/dependency/export/prune/registry/account mutation.
3. Finalize and verify lifecycle after future successful closed-human CANARY/automatic pruning. An exact completed CANARY retry verifies the marker without another execute; a missing marker requires the separately authorized completion mode. Automatic can resume its latest completed pruning for marker-only completion, without selecting another batch in that invocation. Neither diagnostic nor PREPARE can complete lifecycle.
4. Extend existing fundamental automation/workflow tests for authorization, complete/missing/existing markers, mismatches, rollback boundaries and no accidental export/execute. Update SpecKit, run existing suites/checks and submit Draft PR; no remote operation.

Operational impact: future closed-human SUCCESS requires a persisted marker, and an explicitly authorized marker-only operation becomes available. Interrupted prune→marker completion remains recoverable without repeating pruning. Existing completion DB function/privileges are sufficient. Production activation/scheduler/cap and #992 cleanup remain separately gated.
