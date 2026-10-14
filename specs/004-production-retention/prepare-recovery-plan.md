# T018 batch 4 PREPARE recovery fix

Scope: repair Production closed-human evidence classification and resume the exact committed partial batch through the existing PREPARE path. No remote operations are authorized by this implementation.

1. Extend `buildPruneEvidence()` in `scripts/ops/chips-ledger-archive-prune.mjs` to recognize both target policy IDs while preserving USER binding, direction and conservation checks.
2. Add a bounded recovery branch to `runProductionArchiveCycle()` in `scripts/ops/chips-ledger-production-automation.mjs`, propagating the explicit prepare `batchId`. Validate identity/policy/status/counts/immutable archive and all receipt/proof states under the existing Production lock. Inspect recovery before writes; register only absent proof, dry-run exact IDs, create or verify both durable copies. Never export, authorize, execute or clean up.
3. Extend existing archive-pruning and automation tests for valid target-bound human evidence, forbidden USER policies, same-batch recovery and fail-closed boundaries.
4. Record the failed batch 4 and the separate post-merge recovery authorization gate in research/tasks/quickstart. Run existing fundamental suites and repository checks; submit Draft PR without merge or deploy.

Operational impact: Production closed-human USER history becomes admissible only under its existing narrow contract. A reviewed PREPARE with exact batch ID may write missing proof and recovery artifacts for that batch. CANARY remains separately authorized. Existing Stage and Production CANARY paths remain unchanged. No migration, runtime configuration, dependency or scheduler change.
