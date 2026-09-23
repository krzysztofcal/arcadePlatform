# Feature Specification: Stage Bot-Only Recovery Repair for Batch 9923

**Feature Branch**: `fix/stage-bot-only-recovery-9923`

**Created**: 2026-09-23

**Status**: Draft

**Input**: Controlled Stage-only repair of the partial durable recovery copy for bot-only batch `9923` after the 504 incident, without changing batch `15`, Production, eligibility, or the cleanup schedule.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Repair the exact partial recovery pair (Priority: P1)

As the Stage automation owner, I need to repair the missing recovery manifest for batch `9923` after verifying the immutable evidence and existing recovery archive, so that the batch can safely return to the normal automation path.

**Why this priority**: The missing manifest blocks the bot-only retention path while the batch remains unpruned and has no destructive authorization.

**Independent Test**: Exercise the repair against a deterministic fixture containing the approved batch row, a byte-identical recovery archive, and no recovery manifest. The result must create only the missing manifest and report both recovery objects complete.

**Acceptance Scenarios**:

1. **Given** Stage identity, policy, proof, lock, and exact batch `9923` are valid, the primary archive and recovery archive match the committed bytes, and only the recovery manifest is absent, **when** the owner runs the controlled repair, **then** the missing manifest is created and both recovery objects are verified complete.
2. **Given** the repair has been requested, **when** Storage reports a timeout or ambiguous upload result, **then** the repair rereads the actual object state before deciding whether another create-only request is safe.

### User Story 2 - Preserve the fail-closed lifecycle (Priority: P2)

As a retention operator, I need an incomplete or mismatched recovery pair to remain blocked, so that a repair can never authorize cleanup from uncertain evidence.

**Why this priority**: Recovery repair is safety-critical; an incorrect repair is more dangerous than a continued block.

**Independent Test**: Supply mismatched archive bytes, an unexpected existing manifest, or the wrong partial state and verify that the operation stops before any Storage write, database mutation, prune, cleanup, or GO action.

**Acceptance Scenarios**:

1. **Given** any recovery state other than the approved “archive present, manifest missing” state, **when** repair is attempted, **then** the operation fails closed without destructive work or overwriting either recovery object.

### User Story 3 - Resume normal automation without broadening scope (Priority: P3)

As the Stage automation owner, I need the repaired batch to be consumed by the existing normal automation path, while the existing batch `15` repair and all other retention paths remain unchanged.

**Why this priority**: The repair should remove the incident-specific block without creating a new generic retention mechanism.

**Independent Test**: Verify the new manual entry point accepts only `9923`, the existing batch `15` behavior remains covered by its current tests, and no scheduled or Production path is changed.

**Acceptance Scenarios**:

1. **Given** both recovery objects are complete and verified, **when** the next normal bot-only automation cycle evaluates batch `9923`, **then** it may proceed through the existing lifecycle gates without a repair-specific cleanup authorization.

### Edge Cases

- A 504 or other ambiguous response occurs after a create-only request: reread the target object and accept it only if its bytes, MIME, size, and SHA-256 match the expected content.
- The existing recovery archive is absent, has unexpected MIME/size, or has a different SHA-256: stop before creating a manifest.
- A recovery manifest already exists: verify the actual state; never overwrite it. A complete matching pair is read-only success, while a mismatched or unsupported state is blocked.
- The caller supplies batch `15`, another batch, an execute/automatic gate, a fork, a non-`main` ref, or a non-Stage target: reject the request without Storage or database mutation.
- A second process holds the retention lock: fail closed and do not attempt a concurrent repair.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The repair MUST target exactly Stage bot-only batch `9923`; it MUST reject every other batch ID and every non-Stage target.
- **FR-002**: Before any Storage write, the repair MUST revalidate the committed batch row, Stage identity, bot-only policy, immutable proof, active manifest, unpruned/un-cleaned lifecycle, destructive-GO absence, and exclusive retention lock.
- **FR-003**: The repair MUST download and verify the original archive and existing recovery archive byte-for-byte against the committed compressed size, MIME, and SHA-256. The existing recovery archive MUST remain unchanged.
- **FR-004**: The only repairable state MUST be “recovery archive present and verified; recovery manifest absent.” Both-missing, archive-missing, mismatched, malformed, or ambiguous states MUST fail closed.
- **FR-005**: The repair MUST create only the missing recovery manifest using create-only Storage semantics and MUST verify the resulting bytes, MIME, size, canonical content, and SHA-256 after the request.
- **FR-006**: After any timeout or ambiguous Storage response, the repair MUST inspect actual Storage state before deciding whether another request is safe; it MUST never assume that a failed response means the object is absent.
- **FR-007**: The repair MUST perform no destructive cleanup, prune, lifecycle mutation, destructive GO, manifest reset, object deletion, or object overwrite.
- **FR-008**: The manual entry point MUST be owner-gated on `main`, require an explicit exact-batch confirmation, preserve the Stage read-only fence preflight, and run without execute or automatic gates.
- **FR-009**: Existing batch `15` repair behavior, bot-only eligibility, cleanup schedule, closed-human/escrow paths, and Production behavior MUST remain unchanged.
- **FR-010**: Regression coverage MUST remain limited to deterministic fundamental tests for successful missing-manifest repair, mismatch detection, timeout-state reconciliation, and no destructive action on incomplete recovery.
- **FR-011**: The feature documentation MUST describe the incident cause, exact repair preconditions, verification sequence, owner confirmation, and post-repair handoff to normal automation.

### Key Entities

- **Committed batch evidence**: The immutable Stage row containing batch identity, archive path, byte counts, archive SHA-256, and bot-only proof hashes.
- **Recovery pair**: The content-addressed recovery archive and canonical recovery manifest that together establish durable recovery completeness.
- **Controlled repair request**: An owner-authorized request for exactly batch `9923`, subject to Stage identity, lock, and fail-closed validation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The fundamental regression suite proves the successful repair creates exactly one previously missing manifest and leaves the existing recovery archive bytes unchanged.
- **SC-002**: Every mismatch, unsupported state, timeout without verified matching state, unauthorized invocation, and lock failure results in zero destructive operations and zero object overwrites.
- **SC-003**: The repair entry point accepts exactly one batch ID (`9923`) and does not alter the existing batch `15` path.
- **SC-004**: After a successful repair, an independent full recovery inspection reports both objects complete, matching the committed archive and proof evidence.
- **SC-005**: The change introduces no Production target, database migration, eligibility change, or schedule change.

## Assumptions

- The committed Stage row and bot-only proof for batch `9923` remain immutable and valid until the owner-approved repair is run.
- The existing private Storage API, create-only semantics, advisory lock, and normal automation path are reused; no schema migration is required.
- The repair is prepared and tested in the repository first. Any Stage Storage write requires a separate explicit owner GO after PR review.
- Runtime confirmation that normal automation consumes batch `9923` is a post-PR operational step, not part of repository tests.

## Out of Scope

- Production, other Stage batches, generic recovery repair, eligibility rules, retention duration, cleanup schedule, database schema, and replacement of the existing batch `15` implementation.
