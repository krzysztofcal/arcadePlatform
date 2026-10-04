# Issue #1038 final review

Reviewed the whole implementation diff against current #1038 and live main `a922ce05` (including the CI routing update merged while work was in progress). Independent review found no remaining findings after fixing malformed-policy coverage, fixture array USER lookup, known-denied absent-schema funding assertion and WS-only test dependency isolation.

## Contract audit

- Removed ENV frontier resolver, default, call sites and dependent tests/docs. No replacement max, flag, catalog, table, migration or scheduler.
- Admin Enabled is the only operational activation control. Valid normalized canonical policy and both existing exact active NORMAL/SLOW pools are required. Revision/audit/mutation contract remains unchanged.
- Shared progression/access select the two highest enabled unlocked tiers, skip disabled gaps and retain the full future roadmap. The highest playable tier has no upper bankroll bound. Current and Quick Seat Create fallback already use availableBuyIns[0]. Existing human-first matchmaking can legally recommend a lower available tier.
- JOIN replaces its two selected-tier reads with two batched catalog reads; transaction-local reuse avoids repeated reads. Manual Create gains activation only and retains #788 bankroll independence. Financed rejoin precedes fresh-admission checks.
- WS refreshes the full canonical catalog through the existing 25-second refresh/30-second expiry. No per-hand DB reads added. Exact-tier/class funding, demand refill, hourly caps, class rules, stakes, fan-out and accounting remain unchanged except for the required activation/fail-closed gate.
- No browser/inline script, CSS or CSP changes. No UI/CSS/JSP/glue tests added; existing required WS fixtures were adapted.

## Departures and limitations

1. Existing file-backed SQL fixture adapter needed explicit current policy/access/pool rows to preserve required WS admission tests. It never infers activation when absent. A seven-line pure fixture helper avoids pulling Netlify's postgres dependency into WS-only CI.
2. Confirmed absent policy schema is a known-denied funding decision, allowing already financed rollover without funding. Missing/expired snapshots and unknown individual policy retain existing retry behavior. This avoids stalling financed hands while removing the historical TREASURY funding fallback.
3. Stage had an existing 2000 CH SLOW threshold. Smoke used the existing audited Admin override on one isolated wealthy fixture to test NORMAL tier activation; it was restored to AUTO during cleanup. Global class policy was unchanged. Empty-table Preview retirement required fresh tables for positive JOIN scenarios.
4. Stage target was applied through existing Admin Enabled mutations, preserving refill fields/caps and existing pools. Production target is documented but unapplied because Production requires separate authorization. No Production deployment/mutation and no PR merge.

These are the complete departures from the initial implementation plan; no outstanding product/code deviations from #1038 remain.

## Breaking impacts

`poker_bot_tier_policy.enabled` expands from a bot-funding gate to the shared playability + bot-funding gate. Disabled, invalid, unknown or unprovisioned tiers now reject manual Create/fresh human JOIN. Missing policy schema denies fresh admission/funding. Financed rejoin remains legal. Progression removes maxPlayableBuyIn and exposes enabledBuyIns/per-tier enabled; callers use availableBuyIns for playable decisions. No further breaking impact was identified.

## Verification

- Targeted existing fundamental suites: 178 tests, zero failures. Full npm test, structural guards and unit checks passed. Required CI on runtime/integration head `47580b48` passed, including core, verify, actionlint, WS harness, PostgreSQL persistence and pool/retention integration, games and CodeQL.
- Draft [PR #1039](https://github.com/krzysztofcal/arcadePlatform/pull/1039); [Netlify Deploy Preview](https://deploy-preview-1039--playkcswh.netlify.app).
- Final [WS Preview Deploy](https://github.com/krzysztofcal/arcadePlatform/actions/runs/37219577434): RELEASE_SHA == DEPLOY_REF == installed releaseSha/deployRef == `47580b48fea31830579338ffe01783a772b85824`. Local/public health passed. Later commits contain documentation/spec evidence only.
- Authenticated Netlify Preview → WS Preview smoke on that SHA: 1100 CH fresh JOIN 1000 accepted; 1099 CH rejected; Quick Seat Create fallback selected 1000 while enabled. After live disable and the existing propagation bound, wealthy fresh JOIN 1000 rejected, financed rejoin accepted, Quick Seat fallback selected 500, wealthy fresh JOIN 500 accepted and 550 CH fresh JOIN 500 accepted. Live re-enable left Stage [100,500,1000] enabled and all higher tiers disabled.
- Preview process PID/start timestamp stayed unchanged throughout the final Admin toggles (PID 2681589, start 2026-10-04 17:12:29 UTC). No deploy/restart or ENV change during those toggles. Policy refill/cap fields were checked unchanged after each toggle. Isolated human fixture funding/refunds used the existing ledger, never direct balance edits or new bot bankroll pools.
