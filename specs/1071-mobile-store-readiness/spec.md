# Feature Specification: Poker mobile store readiness audit

**Feature Branch**: `docs/1071-mobile-readiness`
**Created**: 2026-10-09
**Status**: Audit complete; release gates pending
**Input**: [Issue #1071](https://github.com/krzysztofcal/arcadePlatform/issues/1071): Android first, iOS later, no advertising, optional purchases of nonredeemable CH, permanent cosmetics and VIP. Audit/plan only.

## User Scenarios & Testing

### User Story 1 - Choose the smallest viable mobile route (Priority: P1)

The owner can choose an Android route while preserving the existing Poker experience and understand the additional work for iOS.

**Why this priority**: Prevent a premature rewrite or a wrapper that cannot meet the product requirements.
**Independent Test**: Read the route comparison and inspect each code finding against the pinned revision.

**Acceptance Scenarios**:

1. **Given** the current browser app, **When** the owner compares four packaging routes, **Then** each has prerequisites, tradeoffs and an explicit recommendation.
2. **Given** an interrupted game, **When** mobile testing is planned, **Then** session recovery, authoritative state and layout are covered without claiming unperformed device tests.

### User Story 2 - Decide whether a release is permitted (Priority: P1)

The owner can distinguish free release readiness from monetized readiness and identify the accountable approver for each blocker.

**Why this priority**: Store approval and legal eligibility are independent of technical packaging.
**Independent Test**: Every compliance row has a primary source, a concrete gap and a release gate.

**Acceptance Scenarios**:

1. **Given** no cash-out, **When** evaluating purchased CH, **Then** no legal or store approval is inferred solely from nonredeemability.
2. **Given** free release approval, **When** adding purchases, **Then** monetization and each target store require separate authorization and evidence.

### User Story 3 - Prepare a bounded handoff (Priority: P2)

The implementer receives documented dependencies, purchase recovery boundaries and a small physical-device acceptance matrix.

**Why this priority**: Future implementation needs concrete gates without authorizing payment integration or submission now.
**Independent Test**: Follow the handoff checklist and identify all pending owner decisions.

**Acceptance Scenarios**:

1. **Given** a duplicated or delayed purchase event, **When** designing fulfillment, **Then** verified purchase ownership and once-only grants are required.
2. **Given** this documentation PR, **When** checking its scope, **Then** it changes documentation and feature selection only, with no runtime, database, billing, registration or submission changes.

### Edge Cases

- Store rejects the simulated-gambling classification or requires a higher regional rating.
- Paid CH is usable in other Arcade games; no assumed exception to store currency restrictions.
- App resumes after token expiry, socket loss, seat retirement or operating-system process termination.
- Email recovery opens a different browser storage context; guest identity must not become a purchase owner.
- Purchased CH must survive retention/expiry routines; refund occurs after CH has been spent; permanent cosmetics are restored after reinstall; VIP cancels but remains valid until its paid period ends.
- Account deletion encounters an active hand, retained ledger records or an independently renewing subscription.
- Ad or checkout routes are reachable through account, legal or shared navigation pages.

## Requirements

### Functional Requirements

- **FR-001**: Audit MUST compare PWA, Android TWA, a narrow cross-platform shell and native rebuild; recommend a least-complex route for free Android and a conditional route for monetized Android/iOS.
- **FR-002**: Audit MUST inspect lobby/table, authentication, CSP/session/redirects, WS recovery, background/resume, orientation/safe-area, notifications, accessibility and assets against a pinned live-repository revision.
- **FR-003**: Audit MUST distinguish observed code, external policy, recommendations and unverified runtime behavior.
- **FR-004**: Audit MUST assess simulated gambling, CH, cosmetics, recurring VIP, age/regions, deletion/privacy, consent/refunds and media rights using dated primary sources.
- **FR-005**: Audit MUST separate web checkout, Android billing and Apple purchases; no mobile external-payment route without a confirmed applicable program/market agreement.
- **FR-006**: Plan MUST define verification, ownership, fulfillment, recovery and reconciliation boundaries without implementing billing.
- **FR-007**: Plan MUST define a bounded physical-device matrix using the existing BrowserStack process, with no new broad UI suites.
- **FR-008**: Deliverables MUST include SpecKit spec/plan/tasks, recommendation/compliance matrix, dependencies, breaking-impact disclosure and separately owner-gated free and monetized release checklists.
- **FR-009**: Work MUST remain audit/documentation only; Production, store registration/submission, payments and implementation require subsequent authorization.

### Key Entities

- **Audit finding**: evidence revision/source, affected surface, recommendation, status and gate owner.
- **Release gate**: free/monetized mode, Android/iOS target, approver and required evidence.
- **Purchase entitlement proposal**: provider ownership, CH grant/cosmetic ownership/VIP validity; conceptual only.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Four routes compared, with a recommendation for each release mode and no assumed store acceptance.
- **SC-002**: Every FR-002 surface and FR-004 policy topic has a finding or an explicitly pending evidence item.
- **SC-003**: Free and monetized checklists each specify accountable roles and independently executable release decisions.
- **SC-004**: All audit artifacts are mutually consistent and the Draft PR contains only the documented scope.

## Assumptions

- The issue description is the available agreement; earlier conversational decisions could not be recovered, and the owner supplied no additional decisions in this session.
- Poland is the initial proposed market, not automatic EU-wide clearance. Adult-only product targeting is a recommendation pending owner approval; actual regional rating comes from each store.
- CH has no cash-out or real-world prizes as the intended product constraint; actual transferability, wider Arcade use and resale need review.
- Free release precedes monetization only if the owner chooses that sequence. No advertising means the complete reachable mobile experience, not merely the table.
- Store rules must be rechecked before submission. Completing the audit does not complete its future release gates.
