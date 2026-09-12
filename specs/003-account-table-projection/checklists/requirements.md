# Requirements Quality Checklist: Account Poker Table Projection

**Purpose**: Confirm that the feature requirements are complete, testable, and aligned with the repository's WS authority boundary.
**Created**: 2026-09-12
**Feature**: [spec.md](../spec.md)

## Contract clarity

- [x] CHK001 The opt-in request, response fields, and backward-compatible non-opt-in behavior are explicitly named.
- [x] CHK002 `poker.inPoker`, `poker.tables`, and the numeric `balance` semantics are independently testable.
- [x] CHK003 The full `tableId` requirement is explicit for every backend boundary, with UI-only abbreviation explicitly scoped.
- [x] CHK004 WS projection failure behavior is explicit, including HTTP 200, correct balance preservation, and `poker: null`.

## Authority and safety

- [x] CHK005 The requirement identifies the WS `tableManager` runtime as the sole authoritative source for current table membership.
- [x] CHK006 The internal projection route is required to be read-only and token-protected.
- [x] CHK007 The response explicitly excludes private poker state and access-token logging.
- [x] CHK008 Invalid, stale, unavailable, or mismatched projection data has a defined safe outcome.

## Scope and verification

- [x] CHK009 Existing profile-me GET/PATCH behavior is protected as a compatibility requirement.
- [x] CHK010 Test scope is minimal and names existing backend, WS, and Account-page behavior files rather than requiring a broad suite.
- [x] CHK011 Measurable outcomes cover exact identifiers, failure fallback, UI machine-readable identifiers, and regression compatibility.
- [x] CHK012 Out-of-scope items include migrations, dependencies, production deployment, and speculative poker actions.
