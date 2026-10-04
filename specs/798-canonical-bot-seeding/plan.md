# Plan

## Technical context
JavaScript ESM, node:test, existing shared SQL/ledger adapters and authoritative WS runtime. Base live main 352aaf8e.

## Constitution Check
PASS: fundamental deterministic JOIN/funding/engine tests only; no UI/CSS/JSP/glue suites. Reuse existing resolver/catalog/snapshot; klog; no migrations/dependencies/setup/config changes. Preview/Stage only; no Production or merge.

## Changes
1. shared/poker-domain/bots.mjs::seedBotsForJoin: remove redundant classless eligibility check; exact existing resolver decides funding key.
2. ws-server/poker/engine/poker-engine.mjs::replaceBrokeBotsForNextHand/topUpManagedBotsForNextHand: structural plans use CANONICAL_POKER_BUY_IN_TIERS. These pure functions do not resolve or debit pools; unchanged runtime snapshot/persistence gate authorizes actual funding.
3. Extend shared/poker-domain/join.behavior.test.mjs and demand-refill.behavior.test.mjs plus ws-server/poker/engine/engine-rollover.behavior.test.mjs.
4. Run targeted suites/CI, audit all legacy calls, draft PR, exact-SHA Preview deploy and narrow Stage JOIN smoke. Stage smoke uses isolated ledger-funded human, existing Enabled 1000/pools; refund after leave. No global policy/config mutation.
