# Implementation Plan: Admin tier playability

**Branch**: `fix/1038-admin-tier-playability` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
Replace the ENV ceiling with the existing enabled tier policy and exact pool provisioning. Batch the canonical tier snapshot in `shared/poker-domain/bot-access.mjs`, reusing its normalizer and WS funding snapshot shape. Keep JOIN transaction-based and the existing 25s refresh/30s expiry outside hands.

## Technical Context
Node 20 ESM shared/WS/Netlify, existing postgres + ws; PostgreSQL existing tier policy/accounts; node:test/assert existing suites; JSP-compatible plain browser JS. No dependencies, migrations, setup/ignore/tooling changes.

## Constitution Check
PASS before research and after design: central domain engine, exact WS authority, no duplicate catalog/cache/scheduler, no Production action. Planned tests only progression, admission/Create/matchmaking, tier snapshots, existing Admin audit/provisioning and bot funding decisions. No UI/CSS/JSP/glue tests. No generic setup changes. Explicit Stage smoke through existing Admin mutation, preserving non-enabled policy fields; separate Production rollout required.

## Project Structure and Changes
1. `shared/poker-domain/bot-access.mjs`: add batched transaction-local `readPokerTierPolicySnapshot()` and fresh exact-pool activation predicate. Keep existing single-tier readers/normalizer for other consumers; unknown/missing schema produces no enabled tiers.
2. `shared/poker-domain/poker-progression.mjs`: remove resolver/ceiling; accept `enabledBuyIns` in `evaluatePokerProgression()`/`evaluatePokerBuyInAccess()`. Select highest + previous enabled unlocked indexes; expose activation in roadmap and active buy-ins. `readPokerProgression()` loads/reuses the snapshot; no duplicate eligibility engine.
3. `shared/poker-domain/join.mjs`: replace its existing two requested-tier policy/provisioning reads in `resolveJoinAccess()` with the batched snapshot (same two data reads); retain selected policy/provisioning for existing bot seeding. Rejoin stays before new-play checks.
4. `netlify/functions/poker-create-table.mjs`: operator activation check inside transaction before table creation; retain manual Create's bankroll independence.
5. `netlify/functions/poker-quick-seat.mjs`: pass progression enabled tiers into existing shared access check; automatic creation remains `availableBuyIns[0]`. `netlify/functions/poker-progression.mjs` continues consuming availability and earlier rejoin path.
6. `ws-server/poker/runtime/settled-bot-funding.mjs`: delegate reader to shared full-catalog snapshot; existing cache includes 1000 before a table exists. Existing expiry checks and exact-class source selection remain. Known missing schema denies funding without blocking already financed hand rollover; missing/expired policy snapshots retain the existing retry behavior.
7. `ws-server/poker/bootstrap/persisted-bootstrap-db.mjs`: extend its existing file-backed fixture adapter to read explicit policy/access rows and exact SYSTEM accounts; never infer enablement when absent. Update existing WS JOIN fixtures, preserving lifecycle scenarios.
8. `netlify/functions/admin-poker-policy.mjs`: reuse existing enabled checkbox, both-pool validation, revision/audit and 30s propagation contract without changing mutation shape. `poker/poker.js` retains full catalog and playable Current semantics.
9. `docs/poker-deployment.md`: replace ENV frontier instructions with live Admin playability semantics, bounded propagation, missing-policy behavior and Stage/Production rollout boundary.

## Verification
Extend existing progression, bot-access, JOIN, Create, Quick Seat, endpoint and table-manager snapshot suites. Run targeted fundamental tests, full required CI and Netlify Preview. Review complete diff against #1038. Deploy exact latest runtime SHA to WS Preview, verify RELEASE_SHA == DEPLOY_REF, smoke authenticated live 1000 disable/enable/disable plus bankroll boundary, then leave Stage at 100/500/1000 enabled and higher disabled through existing Admin API. No account provisioning/direct-balance edits. Production remains pending separate authorization. Draft PR only, no merge.
