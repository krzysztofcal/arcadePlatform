# Feature Specification: Account Poker Table Projection

**Feature Branch**: `003-account-table-projection`

**Created**: 2026-09-12

**Status**: Accepted

**Input**: An authenticated Account page needs a read-only list of the current user's poker tables. The WebSocket runtime remains authoritative for poker membership and the existing chips ledger remains authoritative for balance. The optional `includePoker=1` profile response must preserve a valid balance when the WS projection is unavailable.

## User Scenarios & Testing

### User Story 1 - Read my authoritative poker tables (Priority: P1)

As an authenticated user, I can request my Account data with `includePoker=1` and receive my current poker membership from the authoritative WS runtime, together with my normal chips balance.

**Why this priority**: The backend contract and authority boundary are the foundation for every Account-page representation of poker state.

**Independent Test**: Call the authenticated `GET /.netlify/functions/profile-me?includePoker=1` handler with deterministic profile, balance, and WS projection dependencies, and inspect the returned JSON.

**Acceptance Scenarios**:

1. **Given** the authenticated user is a member of one authoritative WS table, **When** the Account profile request includes `includePoker=1`, **Then** the successful response contains the normal numeric `balance`, `poker.inPoker: true`, and `poker.tables` with the complete, unabridged `tableId`.
2. **Given** the authenticated user has no authoritative WS table membership, **When** the Account profile request includes `includePoker=1`, **Then** the successful response contains the normal numeric `balance`, `poker.inPoker: false`, and `poker.tables: []`.
3. **Given** the authoritative WS projection is unavailable or fails, **When** the Account profile request includes `includePoker=1`, **Then** the request still succeeds with the correct ledger `balance` and `poker: null`; it does not substitute `0` for the balance and does not turn the complete request into a 500 response.
4. **Given** a request does not include `includePoker=1`, **When** the existing profile-me GET or PATCH behavior is used, **Then** the existing owner-profile response shape and behavior remain unchanged.

### User Story 2 - See table membership on Account (Priority: P2)

As an authenticated user, I can see my current poker tables on the Account page and distinguish an active table list from an unavailable WS projection.

**Why this priority**: This exposes the backend value in the accepted Account-page design while keeping the UI read-only and bounded to the existing profile flow.

**Independent Test**: Run the existing Account-page behavior harness with a deterministic `ProfileClient` response containing `poker.tables` and inspect the rendered table rows.

**Acceptance Scenarios**:

1. **Given** `poker` contains tables, **When** the Account page renders the response, **Then** it shows one row per table, keeps the complete `tableId` in machine-readable attributes or navigation targets, and may abbreviate the visible label only in this UI.
2. **Given** `poker: null`, **When** the Account page renders the response, **Then** it shows an unavailable/try-again state without inventing table membership or a replacement balance.

### Edge Cases

- A valid zero ledger balance is returned as `0`; only a failed balance read may not be silently converted to zero.
- A malformed, unauthorized, mismatched-user, non-2xx, timed-out, or unavailable WS projection is treated as unavailable and produces `poker: null`.
- Empty or non-string table identifiers are excluded from the WS projection; valid identifiers are returned exactly as received by the authoritative runtime.
- Bot-only seats and tables where the requested user is not an authoritative member do not make `inPoker` true.
- The Account UI must not use the abbreviated label as the table identifier for links, actions, or data attributes.

## Requirements

### Functional Requirements

- **FR-001**: `GET /.netlify/functions/profile-me?includePoker=1` MUST authenticate the caller using the existing Supabase JWT path and return the existing owner profile plus a numeric ledger `balance` and a `poker` field.
- **FR-002**: When the authoritative WS projection is available, `poker` MUST be `{ inPoker: boolean, tables: [...] }`, where `inPoker` is true exactly when at least one returned table belongs to the authenticated user.
- **FR-003**: Every backend `tables` entry MUST contain the complete `tableId`; neither the WS server, the Netlify function, nor shared projection code may abbreviate it.
- **FR-004**: Each table entry MUST be a sanitized read-only projection containing the complete `tableId`, authoritative table status, the user's seat/status when present, current public stack when present, table stakes when present, maximum seats when present, and state version; private cards and other private state MUST NOT be exposed.
- **FR-005**: The WS server MUST expose the projection through a read-only internal, token-protected route backed by `tableManager` authoritative runtime state; Netlify and the database MUST remain adapters rather than a competing table source.
- **FR-006**: If the WS projection call fails, times out, is unavailable, or fails validation, the profile-me request MUST still return HTTP 200 with the correct ledger `balance` and `poker: null`.
- **FR-007**: A failed WS projection MUST be observable through the existing `klog` path without logging private poker state or access tokens.
- **FR-008**: Existing profile-me requests without `includePoker=1`, including PATCH requests, MUST retain their current response and error behavior.
- **FR-009**: The Account page MUST request the opt-in projection only for the authenticated Account flow, render the returned table list or unavailable state, and abbreviate a table ID only for visible UI text; full IDs MUST remain in DOM data and navigation values.
- **FR-010**: Critical deterministic coverage MUST extend existing behavior tests for the profile function, WS server/table manager, and Account page; no broad new test suite is required.

### Key Entities

- **Account Poker Projection**: The authenticated response projection containing `balance` and either `poker: null` or `{ inPoker, tables }`.
- **Poker Table Projection**: A sanitized, read-only representation of one authoritative WS table with a complete `tableId` and only public/current-user fields.
- **Authoritative Table Membership**: The WS runtime's current core membership and seat metadata used to decide whether a user is in poker.

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of successful `includePoker=1` responses with an available projection preserve the exact authoritative `tableId` in every table entry.
- **SC-002**: 100% of deterministic WS-failure cases return the correct injected/ledger balance and `poker: null` with HTTP 200.
- **SC-003**: 100% of Account-page table rows retain the complete table identifier in their machine-readable target while visible labels may use the UI abbreviation.
- **SC-004**: Existing profile-me behavior tests remain green for requests without the opt-in query and for PATCH requests.

## Assumptions

- The existing Supabase JWT verification, chips ledger, profile-me handler, Account page, and WS internal token configuration are reused.
- The WS runtime only projects tables already materialized in its authoritative `tableManager`; persistence is not queried by the Account projection to create a second source of truth.
- The projection is read-only in this feature; joining, leaving, rebuying, and table actions remain on their existing WS paths.
- A valid balance of zero is allowed and is distinct from an unavailable balance; this feature only defines the required graceful fallback for WS projection failure.
- No new browser module, dependency, database migration, production deployment, or broad test suite is in scope.
