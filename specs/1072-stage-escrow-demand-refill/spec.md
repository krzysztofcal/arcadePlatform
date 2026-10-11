# Feature Specification: Stage escrow demand-refill identity

**Feature Branch**: `fix/stage-escrow-demand-refill`
**Created**: 2026-10-11
**Status**: Draft
**Input**: [Failed Stage run](https://github.com/krzysztofcal/arcadePlatform/actions/runs/38124260046), P8964 in prepare for batch 19314.

## User Scenarios & Testing

### User Story 1 - Retire unrelated historical escrow safely (Priority: P1)

The Stage operator can prepare retirement when a verified demand refill carries a historical table identity only as funding context.

**Why this priority**: Scheduled retirement incorrectly stops on unrelated pool funding.
**Independent Test**: Extend `assertEscrowAccountRetirementContracts(sql)` in `tests/chips/chips.migration.test.mjs` on an isolated database.

**Acceptance Scenarios**:

1. A canonical `poker_bot_pool_refill_demand()` MINT with two SYSTEM entries and no target dependency passes both P8964 and P8965; prepare and retirement preserve its transaction, registry, entries and balances.
2. Actual table/archive mappings, TABLE identities, unknown/malformed refill evidence, target entries or snapshots block retirement.
3. Missing archive proofs, invalid recovery, identity/isolation/GO/canary/lock violations and receipt mutation retain existing denial behavior.

### Edge Cases

MINT alone, prefix alone, missing linked transaction, mismatched hash/key/type, NULL metadata, extra metadata, incomplete or incorrect accounting are not verified refill evidence.

## Requirements

### Functional Requirements

- **FR-001**: Redefine only `public.chips_retire_stage_escrow_accounts(...)` using one Stage-only forward migration; never edit applied migrations.
- **FR-002**: Exempt text matching only for canonical demand-refill transactions with coherent metadata, identity, payload hash, live registry and exactly two opposite SYSTEM GENESIS/bankroll entries; never exempt real table/archive mappings.
- **FR-003**: Preserve every other guard, owner/ACL, locks, gates, isolation, receipts and accounting. No refill, scheduler, Actions, Production runtime or application changes. Required migration inventory maintenance is limited to classifying this file stage-only in `supabase/production-migrations/manifest.json` and updating exact inventory counts in `scripts/check-db-migrations.mjs`; neither deploys Production.
- **FR-004**: Extend existing fundamental tests, reproduce the incident before the fix, and run isolated migration and retention tests.
- **FR-005**: Intentionally allow `DB Stage Apply PR` to redefine the function on shared Stage upon Draft PR creation. Existing active automation may subsequently destructively retire now-eligible escrow accounts, including batch 19314. No manual cleanup execute; subsequent verification is read-only only. Production requires separate authorization.

### Key Entities

- Retirement batch/account: proven archived table ledger and dedicated escrow mapping.
- Refill MINT: immutable live transaction, registry and SYSTEM-only accounting evidence.

## Success Criteria

- **SC-001**: Valid refill fixtures pass; all actual or unknown dependency fixtures fail closed.
- **SC-002**: Refill transaction, registry, entries and SYSTEM balances are identical before and after retirement.
- **SC-003**: Isolated fundamental suites pass; batch 19314 operational outcome is recorded only from post-apply read-only evidence.

## Assumptions

Starting authority: origin/main `1805c2f27a1829c9ea39e0b7c5c3bbfe5ba586da`. Canonical refill metadata follows the existing producer; unknown formats fail closed. No signature/schema/client breaking changes. The dedicated read-only connector cannot execute prepare; the existing Supabase application connector can call it as postgres inside READ ONLY, without broadening ACLs.
