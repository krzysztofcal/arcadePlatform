# Feature Specification: Historical Missing-Table Bot Identity Retirement

**Feature Branch**: main (specification-only pass on current main)

**Created**: 2026-09-11

**Status**: Draft

**Input**: GitHub issue #978 and its accepted research result from 2026-09-11. This specification preserves the issue's narrowed V1 scope and does not start planning or implementation.

## Context and Verified Baseline

The problem is long-term growth of the chips transaction idempotency registry. The accepted research shows that most rows are bot-internal TABLE identities, while human TABLE identities and non-TABLE full-replay identities have different replay contracts. V1 therefore addresses one historical gap only: bot-internal TABLE identities whose authoritative poker table no longer exists and whose financial transaction has already been archived and pruned with sufficient evidence.

The 2026-09-11 Stage research is a point-in-time baseline, not permission to delete data:

- The registry contained approximately 102,256 rows.
- 99,874 rows were bot-internal TABLE identities in the four observed families: managed-bot-seed-buyin, bot-seed-buyin, poker:bot-replacement-buyin:v1, and poker:bot-terminal-cashout:v1.
- Those bot-internal formats added 21,614 rows in seven days, approximately 3,088 rows per day.
- Human TABLE identities numbered 268.
- Non-TABLE full-replay identities numbered 42.
- Legacy or unknown TABLE identities numbered 2,052.
- Approximately 33,700 TABLE identities older than seven days referenced missing poker tables.
- 10,183 of those missing-table identities were already archive-mapped, had no hot ledger transaction, and came from stage-ledger-auto-retention-30d-v1.
- 10,080 of those 10,183 identities were in batches where the entire batch matched the proposed retirement shape; 103 were in mixed batches.

The current live main was verified at 25d5a7b9 after the Spec Kit bootstrap merge. Its existing ledger behavior still rejects a new TABLE transaction when the referenced table is missing or closed before an economic effect, and it exposes terminal table_closed and idempotency_retired outcomes. The existing replay path still relies on retained registry data for successful historical replay, so retirement intentionally changes the later retry result for the narrow retired class.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Classify registry identities with evidence (Priority: P1)

As a Stage maintainer, I need every material idempotency identity class classified by its replay and lifecycle contract so that only proven-safe historical identities can be considered for retirement.

**Why this priority**: A high row count or old age is not evidence that an identity can be removed. Classification is the safety boundary for all later action.

**Independent Test**: A read-only Stage audit produces a classification for every material identity class, includes the evidence and growth contribution for each class, and leaves any class without sufficient evidence in the unknown/fail-closed category.

**Acceptance Scenarios**:

1. **Given** registry rows from multiple producers, transaction types, key formats, table or account ownership contexts, archive states, and ages, **When** a read-only classification is run, **Then** the result reports each class's producer, key format/version, replay behavior, hot or archived state, age, and rows/day and bytes/day contribution.
2. **Given** a class with an incomplete or conflicting replay, lifecycle, archive, identity, or accounting contract, **When** classification is run, **Then** the class is marked unknown/fail-closed and is not proposed for retirement.
3. **Given** the research baseline and a newer live repository or Stage distribution, **When** the baseline is reconciled, **Then** differences are reported as current measurements and the historical counts are not treated as authorization.

### User Story 2 - Retire one proven historical batch safely (Priority: P1)

As an explicitly authorized Stage operator, I need to retire an exact whole archive batch of eligible missing-table bot-internal identities so that registry growth is reduced without creating a second economic effect.

**Why this priority**: This is the smallest V1 action that closes the finite historical missing-table gap while preserving the existing accounting and replay safety boundary.

**Independent Test**: Prepare one fully eligible historical batch and one batch containing a single disqualifying row. The first can be retired atomically with an exact receipt; the second is rejected without any registry deletion or economic mutation.

**Acceptance Scenarios**:

1. **Given** an archive batch from the existing Stage 30-day policy whose every registry identity is a supported bot-internal TABLE identity, has a null user identity, points to a missing authoritative poker table, and has complete archive, proof, prune, count, and hash evidence with no hot transaction or entry, **When** the exact batch is explicitly confirmed for Stage retirement, **Then** all and only that batch's registry rows are retired in one atomic operation and the result records the exact count and identity-set hash.
2. **Given** an archive batch with any human participant evidence, an existing OPEN or CLOSED table, a hot transaction or entry, an unsupported or unknown key, a non-null user identity, incomplete proof, a count or hash mismatch, or a partial or mixed batch, **When** retirement is audited or attempted, **Then** the operation fails closed and deletes no registry row.
3. **Given** a batch that was already retired with a matching exact receipt, **When** the same retirement is retried, **Then** it returns an idempotent completed outcome and does not change registry counts, balances, ledger conservation, provenance, or receipts.
4. **Given** a retired bot-internal identity whose registry row is no longer hot, **When** its very old request is retried, **Then** it may receive terminal table_closed or retired rejection instead of historical success, and no second transaction, entry, balance mutation, or other economic effect is created.

### User Story 3 - Preserve identities with different replay contracts (Priority: P1)

As a product owner, I need human TABLE, full-replay, and legacy or unknown identities to retain their existing safety and replay behavior while the narrow V1 class is retired.

**Why this priority**: These identities carry product replay, accounting, provenance, or uncertainty guarantees that cannot be inferred from the missing-table bot gap.

**Independent Test**: Exercise representative identities from each protected class against the retirement audit and existing retry behavior; every protected identity remains retained and follows its existing contract.

**Acceptance Scenarios**:

1. **Given** a human TABLE identity, **When** a missing-table bot retirement is audited, **Then** the human identity is excluded and its retained replay behavior is unchanged.
2. **Given** a BUY_IN, CASH_OUT, WELCOME_BONUS, PROMO_BONUS, or ADMIN_ADJUST identity requiring full replay, **When** the V1 audit or retirement is run, **Then** the identity remains retained and its complete replay contract is unchanged.
3. **Given** a legacy or unknown TABLE identity, **When** the V1 audit or retirement is run, **Then** the identity remains retained and the unknown case fails closed rather than being generalized into the bot policy.
4. **Given** a normal CLOSED bot-only TABLE identity covered by #890, **When** the V1 process is run, **Then** #890 remains its owner and V1 does not duplicate, replace, or broaden that cleanup contract.

### User Story 4 - Measure the residual registry horizon (Priority: P2)

As a Stage maintainer, I need a measurable before-and-after view of the registry so that the project can distinguish a finite historical cleanup from ongoing unbounded growth.

**Why this priority**: Retirement is useful only if the remaining hot registry trajectory is understood and no unsupported plateau claim is made.

**Independent Test**: Compare the classified pre-action distribution with the post-action distribution and verify that the report separates safely retired historical rows from identities that must remain hot.

**Acceptance Scenarios**:

1. **Given** the current Stage distribution and the proposed eligible batches, **When** the residual horizon is measured, **Then** the report includes remaining rows/day and bytes/day by identity class and projections for 30 days and one year.
2. **Given** a remaining class with clearly indefinite growth, **When** the horizon is measured, **Then** that class and its blocking contract are named explicitly instead of claiming that the whole database has plateaued.
3. **Given** a V1 rollout or audit, **When** its target is verified, **Then** evidence shows Stage only and no Production mutation or enablement.

### Edge Cases

- A single non-eligible row makes an otherwise eligible archive batch partial or mixed; the whole batch is rejected.
- The authoritative poker table is missing, OPEN, CLOSED, or otherwise ambiguous; only the missing-table case is eligible for V1, and all other states are rejected or delegated to the existing owner.
- A key's table identity does not agree with stored table ownership or other immutable evidence; retirement fails closed.
- Archive, proof, prune, receipt, count, hash, Stage database identity, or lifecycle evidence is absent, stale, inconsistent, or unverifiable; no deletion occurs.
- A transaction or entry remains hot even though the registry row is old or archive-mapped; the identity remains retained.
- A batch has already been retired, is concurrently being evaluated, or has a mismatching retry receipt; the result is idempotent only for the exact matching receipt, and all other cases fail closed.
- A human TABLE, full-replay, legacy, unknown, payment-capable, bonus, or adjustment identity appears in a candidate set; it is excluded and remains hot.
- The Stage audit finds no eligible batch; it reports no-op rather than applying a generic age-based deletion.
- The current measured distribution differs from the 2026-09-11 research baseline; the current evidence controls classification, while the baseline remains historical context.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Stage audit MUST inventory the registry by transaction type, user identity presence, producer or runtime path, key format and version, table or account ownership, hot versus archived or pruned transaction state, archive policy, age, and observed rows/day and bytes/day contribution.
- **FR-002**: Every material identity class MUST be explicitly classified as hot-forever required, bounded-hot then retireable, lifecycle-retireable, or unknown/fail-closed, with code and data evidence recorded for the classification.
- **FR-003**: V1 MUST consider only historical bot-internal TABLE identities in the four research-identified key families: managed-bot-seed-buyin, bot-seed-buyin, poker:bot-replacement-buyin:v1, and poker:bot-terminal-cashout:v1.
- **FR-004**: A V1 candidate MUST have a null user identity, a TABLE transaction type, an absent authoritative poker table, an existing archive and prune record from the Stage 30-day policy, no hot transaction or entry, and complete immutable identity, lifecycle, archive, proof, count, and hash evidence.
- **FR-005**: V1 MUST retire only a complete archive batch in which every included registry identity satisfies every candidate condition; per-key or partial-batch retirement is prohibited.
- **FR-006**: A destructive Stage action MUST require an exact batch selection and explicit human confirmation, and MUST verify the target Stage identity before any mutation.
- **FR-007**: A successful retirement MUST remove exactly the proven registry identity set and record an immutable cleanup result containing the exact count and identity-set hash as one atomic outcome.
- **FR-008**: If any required validation is missing, ambiguous, inconsistent, unauthorized, or fails, the operation MUST fail closed with no registry deletion and no economic mutation.
- **FR-009**: Retrying the same exact completed retirement MUST be idempotent; a different key set, proof, receipt, batch, or target MUST not be accepted as that retry.
- **FR-010**: After a bot-internal identity is retired, a later retry MAY lose historical successful replay and return terminal table_closed or retired rejection, but it MUST NOT create a second transaction, entry, balance mutation, or other economic effect.
- **FR-011**: Human TABLE identities MUST remain retained and preserve their existing successful replay and duplicate-prevention behavior.
- **FR-012**: BUY_IN, CASH_OUT, WELCOME_BONUS, PROMO_BONUS, and ADMIN_ADJUST full-replay identities MUST remain retained with their existing replay snapshots and retry behavior.
- **FR-013**: Legacy or unknown identity formats MUST remain retained and MUST fail closed when evidence is insufficient.
- **FR-014**: Normal CLOSED bot-only TABLE cleanup owned by #890 MUST remain unchanged; V1 MUST reuse its ownership boundary rather than duplicating or broadening it.
- **FR-015**: V1 MUST NOT introduce a generic TTL, a generic registry archive, one permanent tombstone per retired key, a new permanent scheduler, or an automatic backlog-draining loop.
- **FR-016**: Any V1 destructive path MUST be Stage-only. It MUST NOT mutate, enable, or roll out to Production.
- **FR-017**: The outcome MUST report the residual hot registry rows/day and bytes/day by identity class and 30-day and one-year capacity projections, without claiming a full database plateau.

### Key Entities

- **Idempotency registry identity**: A transaction key and its immutable transaction, user, type, ownership, age, archive state, and replay contract.
- **Archive batch evidence**: The immutable archive, proof, prune, identity-set, count, hash, and target evidence that establishes whether a batch is eligible.
- **TABLE lifecycle identity**: The relationship between a registry identity and its table ID, table existence or state, human participation, and lifecycle ownership.
- **Retirement outcome**: The exact accepted, rejected, or already-completed result of a whole-batch decision, including its safety evidence and later retry semantics.

## Scope Boundaries and Exclusions

V1 includes only the historical missing-table gap for bot-internal TABLE identities that have already passed the existing Stage 30-day archive and prune boundary and are eligible as a complete batch.

V1 explicitly excludes human TABLE identities, full-replay identities, legacy or unknown formats, OPEN or existing tables, normal CLOSED bot-only cleanup owned by #890, hot ledger transactions or entries, partial or mixed batches, and any identity whose evidence is incomplete or ambiguous.

V1 does not establish a generic retention policy. It does not add generic TTL deletion, a new generic registry archive, per-key tombstones, a permanent scheduler, an automatic draining loop, a new archive-read architecture, or a second accounting source of truth. It does not change browser behavior, runtime gameplay behavior, or Production.

This specification defines behavior, safety boundaries, acceptance criteria, and measurable outcomes. It intentionally does not design the detailed SQL function, migration structure, storage operation, or operator interface; those decisions belong to the later $speckit-plan phase.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of material identity classes found by the Stage audit are assigned one of the four required classifications with evidence, and 0 identities in the unknown or fail-closed class are retired.
- **SC-002**: The current audit reconciles the historical estimate of approximately 10,080 whole-batch eligible identities against a fresh measurement and reports every material difference before any destructive action.
- **SC-003**: 100% of successful V1 retirements remove only complete exact batches and record matching exact counts and identity-set hashes; 0 partial or mixed batches are deleted.
- **SC-004**: 100% of tested unsafe cases involving missing, ambiguous, conflicting, hot, human, full-replay, legacy, unknown, existing-table, mixed-batch, proof, receipt, or wrong-target evidence fail without registry deletion or economic mutation.
- **SC-005**: For every identity exercised in a retired-batch replay probe, a later retry produces either the documented terminal table_closed or retired rejection and creates 0 second transactions, entries, balance mutations, or provenance changes.
- **SC-006**: All representative human TABLE and full-replay retry scenarios retain their pre-feature behavior, and 0 protected identities are included in a V1 retirement result.
- **SC-007**: The post-action report quantifies remaining hot rows/day and bytes/day by class plus 30-day and one-year projections; if the trajectory is not bounded or clearly sustainable, it identifies the exact blocking class and follow-up instead of claiming completion.
- **SC-008**: 100% of destructive V1 actions are demonstrably targeted at Stage, with 0 Production mutations or enablement under this issue.

## Assumptions

- The 2026-09-11 research comment is the primary research input. Its Stage counts are historical measurements and must be rechecked against the live repository and current Stage evidence before planning or any owner-confirmed action.
- The live GitHub repository and current main are authoritative for current code behavior. The existing archive, proof, prune, receipt, lifecycle, and TABLE-fence mechanisms remain the preferred evidence and safety boundaries where the later plan confirms they apply.
- Existing #890 remains the owner of normal CLOSED bot-only TABLE cleanup.
- A retired historical bot-internal identity is allowed to lose successful historical replay; terminal table_closed or retired rejection is an accepted V1 semantic outcome when it prevents a second economic effect.
- Unknown, legacy, human, full-replay, payment-capable, bonus, and adjustment contracts are retained when evidence does not prove safe retirement.
- Any Stage operator action requires explicit owner confirmation for the exact batch. V1 is manual and bounded; no new scheduler or automatic draining behavior is assumed.
- The later plan will choose the smallest implementation that satisfies these requirements and will not widen the scope to a generic retention framework.
