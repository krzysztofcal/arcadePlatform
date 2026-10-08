# Feature Specification: Terminal cash-out for seated sit-out human

**Feature Branch**: `fix/1066-terminal-sitout`  
**Created**: 2026-10-08  
**Status**: Draft  
**Issue**: https://github.com/krzysztofcal/arcadePlatform/issues/1066

## User Scenarios & Testing

### User Story 1 — Automatically close stale standard table (P1)
A seated human who sits out retains ownership of their chips even when absent from the latest hand. Automatic cleanup must cash out their authoritative balance and close the abandoned standard table safely.

**Independent test**: Existing inactive-cleanup harness with real terminal close, STANDARD/SETTLED, ACTIVE sit-out human absent from state.seats and handSeats, positive stack 940, bots 710/1350, escrow 3000; cash-out and close succeed.

**Acceptance scenarios**:
1. Given that fixture and a deliberately different persisted seat stack, cleanup returns CLOSED, credits human 940, returns bot funds to their proven SYSTEM source, and leaves escrow zero.
2. Given ambiguous identity/seat ownership, inconsistent conserved funds or missing/conflicting bot provenance, existing accounting guards still reject cleanup before writes.

## Requirements
- FR-001: Recognize an unambiguous persisted ACTIVE human sit-out seat absent from the latest hand, not marked left, with retained authoritative ownership.
- FR-002: Cash-out amounts come solely from authoritative state.stacks; never poker_seats.stack.
- FR-003: Preserve identity uniqueness, seat conflict, escrow conservation, bot provenance/funding and transaction safety.
- FR-004: Reuse classifyClaims() in shared/poker-domain/terminal-close.mjs and existing executeInactiveCleanup()/terminal close primitives. Do not change janitor schedulers/timers, engine participation, protocol, UI, migrations or configuration.
- FR-005: Add only one fundamental regression in the existing cleanup harness; run existing terminal accounting/cleanup tests and required checks.
- FR-006: No Production writes, deployment or manual cleanup. The incident table is reserved for automatic janitor smoke after a separately authorized Production deployment. Draft only, no merge.

## Key Entities
- Persisted seat: locked identity, seat number, status and human/bot classification; stack is secondary.
- Hand seats: participants, not the full set of funded seated owners.
- Authoritative stacks and escrow: conserved claims; bot funds retain proven ledger source.

## Success Criteria
- SC-001: The conserved incident fixture returns human 940 and bots 2060, closes once and leaves escrow zero.
- SC-002: Existing fail-closed accounting coverage passes without changing its expectations.
- SC-003: No Production writes; Draft handoff separates exact WS Preview deployment from pending manual runtime acceptance.

## Assumptions and Scope
The fallback requires SETTLED with valid state.seats/handSeats, explicit sit-out and ACTIVE persisted human ownership, absence from both hand collections and no conflicting seat occupant. Matching existing state seats keep the original path. Shared terminal callers receive the same narrow correction; no second cleanup model.
