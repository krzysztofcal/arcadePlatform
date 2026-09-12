# Feature Specification: Archive prune retry after registry cleanup

**Feature Branch**: `002-archive-prune-registry-cleaned-retry`
**Created**: 2026-09-12
**Status**: Draft
**Input**: Regression in [run #803](https://github.com/krzysztofcal/arcadePlatform/actions/runs/34666622628); [P1 issue #981](https://github.com/krzysztofcal/arcadePlatform/issues/981), related #978 / PR #980.

## User Scenarios & Testing

### User Story 1 - Safely retry completed retention (Priority: P1)

The Stage operator can retry existing 30-day retention after authorized registry retirement without reporting corruption or repeating economic effects.

**Why this priority**: The regression blocks scheduled retention after successful resource health checks.
**Independent Test**: Exercise the existing database pruning harness with a completed prune and authorized cleanup, and with missing or inconsistent evidence.

**Acceptance Scenarios**:

1. Given committed/proven canonical Stage format-v1 `stage-ledger-auto-retention-30d-v1`, a matching complete prune receipt, a valid complete #980 cleanup receipt and zero hot rows/mappings, retry returns `already_pruned` in both execute and dry-run modes.
2. Given no cleanup receipt, full matching registry mappings remain required; missing mappings fail closed.
3. Given partial/invalid cleanup evidence, incorrect count, residual/wrong/extra mappings or another policy/format/target, the cleanup exception does not authorize success.

### Edge Cases

NULL receipt fields and policy, malformed cleanup hash, leftover unmapped identities, mismatching prune/archive IDs, and closed-human retries must retain fail-closed behavior.

## Requirements

### Functional Requirements

- **FR-001**: `public.chips_prune_committed_archive_batch_internal(...)` MUST recognize only the authorized Stage v1 cleanup terminal state described above, requiring all three `registry_cleaned_*` fields, `registry_cleaned_key_count = transaction_count`, a lowercase 64-hex digest and no residual mappings.
- **FR-002**: With no cleanup receipt, complete registry mappings MUST remain mandatory. Missing, partial or inconsistent cleanup evidence MUST fail closed.
- **FR-003**: The change MUST preserve first prune, eligibility, archive proof/hash/count checks, balances, conservation, TABLE fence, all later closed-human guards, ownership/ACLs and existing policies outside the exception.
- **FR-004**: Scope MUST be one new forward-only migration, fundamental tests in `tests/chips/chips.migration.test.mjs` and this new spec directory. No applied migrations, historical spec, application JS, Production, schedulers, retries, dependencies or generic configuration changes.
- **FR-005**: Validation MUST run existing fundamental migration/pruning/automation tests and review the effective function diff. Operational acceptance separately requires the exact existing-30d Stage path after migration through existing authorized CI gates.

### Key Entities

- Archive batch: immutable committed archive proof and complete prune/cleanup receipts.
- Registry mapping: replay identity tied to a transaction and archive batch; absence requires authorized retirement evidence.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every valid cleanup retry fixture reports completion without new mutations.
- **SC-002**: Every missing/partial/inconsistent evidence fixture is rejected; accounting snapshots remain unchanged.
- **SC-003**: Existing fundamental tests pass. Operational recovery is reported only after the failed Stage path succeeds after application.

## Assumptions

- Live main `7a23aa0820654d18a8bb06ece8688f31495fec2e` is the starting authority; `002` is the next available spec number.
- #980 receipt writes are protected by existing immutable mutation guards and authorized exact-batch retirement; a digest cannot be recomputed from deleted keys. This fix relies on that existing contract, not a new retirement permission.
- Potential breaking impact: malformed cleanup states previously accepted with retained mappings will now fail closed; legal ordinary and closed-human retries remain unchanged. No signature/schema/client changes.
