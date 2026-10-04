# Feature Specification: Admin tier playability

**Feature Branch**: `fix/1038-admin-tier-playability`
**Created**: 2026-10-04
**Status**: Draft implementation specification
**Input**: GitHub Issue #1038, live main `1683847a`.

## User Scenarios & Testing

### User Story 1 — One live operator gate (P1)
The operator enables or disables a canonical tier with Poker Admin's existing Enabled checkbox. There is no separate deployment or environment ceiling.

**Independent Test**: Toggle tier 1000 off/on/off; verify fresh Create/JOIN/Quick Seat and funding decisions follow the committed policy within the existing 30-second propagation bound.

**Acceptance Scenarios**:
1. With 100/500 enabled and 1000 disabled, wealthy players retain [500,100]; 1000 remains visible but cannot be newly created or joined.
2. After enabling provisioned 1000, 1100 CH unlocks [1000,500], while 1099 CH does not unlock 1000.
3. Disabling 1000 blocks new admission and funding; financed rejoin/resume remains legal.

### User Story 2 — Safe canonical progression and pools (P1)
The player sees the full roadmap, while highest available tier has no upper bankroll bound. Operator activation does not bypass bankroll or class rules.

**Independent Test**: Evaluate wealth, unlock boundaries, sparse enabled tiers, missing policy, stale cache and missing exact pools.

**Acceptance Scenarios**:
1. A disabled intermediate tier never becomes fallback.
2. Missing/invalid/unknown policy, stale runtime snapshots or a missing NORMAL/SLOW pool fail closed.
3. Funding stays exact-tier/exact-class, with no TREASURY or cross-tier fallback on unknown activation.

### Edge Cases
No active tier; missing schema; failed cache refresh; malformed policy; unknown/noncanonical buy-in; cached snapshot expiration; financed seats after disable; RESTRICTED human admission still requires active tier but remains bot-free.

## Requirements

### Functional Requirements
- FR-001: Remove `POKER_MAX_PLAYABLE_BUY_IN` and its resolver/defaults as runtime/product gates.
- FR-002: Existing `public.poker_bot_tier_policy.enabled` is the sole operational tier activation gate, subject to exact pre-provisioned NORMAL/SLOW pools and existing bankroll/class rules.
- FR-003: `shared/poker-domain/poker-progression.mjs` remains the single progression/admission engine; full catalog milestones stay visible, availability is highest enabled unlocked tier plus previous enabled unlocked tier.
- FR-004: Create, JOIN, Quick Seat and table preflight must agree on activation; manual Create keeps #788's separation from bankroll JOIN requirements, but now requires an active operator tier.
- FR-005: Reuse bounded policy propagation/cache and existing Admin revision/audit. No new flags, table, migration, scheduler, static ceiling, catalog or per-hand reads.
- FR-006: Thresholds/refill amounts/hourly caps/classification/stakes/fan-out/accounting remain unchanged.
- FR-007: Desired rollout is 100/500/1000 enabled, higher tiers disabled, using existing pools. Stage smoke may use the existing authenticated Admin API; Production rollout is a separately authorized post-merge operation.
- FR-008: Only existing fundamental deterministic suites are extended. Preserve JSP JS and klog; no new inline script/CSS required.

### Key Entities
Canonical tier; revisioned tier policy; exact NORMAL/SLOW pool provisioning; expiring policy snapshot; player bankroll/progression; financed seat.

## Success Criteria
- SC-001: Live toggle is reflected in all new-play decisions within 30 seconds without env changes, restart or deployment.
- SC-002: All specified bankroll boundaries and disabled/missing/stale cases have deterministic critical-domain coverage.
- SC-003: Highest active tier remains available at every bankroll above its unlock threshold; future or disabled tiers never displace it.
- SC-004: Preview smoke proves enable/disable, authoritative admission, bankroll threshold and policy propagation; exact runtime SHA is verified.

## Assumptions
Existing schema and canonical NORMAL/SLOW pools support this change. No Production mutations are authorized. Financed rejoin/resume and already-running human hands are not revoked by disabling a tier. Breaking impact: `poker_bot_tier_policy.enabled` expands from bot funding to playability + bot funding; missing policy/schema denies new play. Legacy ENV is ignored and removed from current deployment instructions.
