# Review

Base: live main 352aaf8e (merged #1039). Confirmed seed early return with classless legacy resolver. Red tests reproduced NORMAL/SLOW 1000, NORMAL 10M and both structural rollover flows.

## Audit
All runtime uses of isBotFundingAllowedForBuyIn inspected: shared JOIN already passes resolved class; helper preserves actual legacy100/500 contract. Seed now uses its existing single exact funding resolver. Both engine calls were structural eligibility gates and now use the single canonical catalog; engine never selects/debits a pool. Runtime decideSettledBotFunding still enforces current valid Enabled policy, both exact active pools, class and expiry; persistence uses that exact key with no fallback. Continuous repository still fixes buy-in100.

Independent whole-diff review: no correctness/security/scope findings. No other legacy100/500 gate blocks future canonical funding in the audited paths. 208 fundamental tests passed, including no writes for disabled/unknown/missing either pool, exact NORMAL/SLOW debit and no fallback on exhaustion.

## Breaking impact
Intentional: enabled/provisioned canonical tiers above500 now seed and produce replacement/top-up plans rather than silently skipping. This permits the already-authorized exact pool debits. No API/schema/config, legacy no-class100/500, continuous100, accounting/refill/caps or class behavior change. No additional breaking impact identified.

## Pending evidence
Full suite/CI, Netlify Preview, exact latest-runtime-SHA WS Preview deployment and narrow authenticated Stage1000 seed smoke. No Production actions, no merge.
