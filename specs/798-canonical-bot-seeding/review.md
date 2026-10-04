# Review

Base: live main 352aaf8e (merged #1039). Confirmed seed early return with classless legacy resolver. Red tests reproduced NORMAL/SLOW 1000, NORMAL 10M and both structural rollover flows.

## Audit
All runtime uses of isBotFundingAllowedForBuyIn inspected: shared JOIN already passes resolved class; helper preserves actual legacy100/500 contract. Seed now uses its existing single exact funding resolver. Both engine calls were structural eligibility gates and now use the single canonical catalog; engine never selects/debits a pool. Runtime decideSettledBotFunding still enforces current valid Enabled policy, both exact active pools, class and expiry; persistence uses that exact key with no fallback. Continuous repository still fixes buy-in100.

Independent whole-diff review: no correctness/security/scope findings. No other legacy100/500 gate blocks future canonical funding in the audited paths. 208 fundamental tests passed, including no writes for disabled/unknown/missing either pool, exact NORMAL/SLOW debit and no fallback on exhaustion.

## Breaking impact
Intentional: enabled/provisioned canonical tiers above500 now seed and produce replacement/top-up plans rather than silently skipping. This permits the already-authorized exact pool debits. No API/schema/config, legacy no-class100/500, continuous100, accounting/refill/caps or class behavior change. No additional breaking impact identified.

## Runtime verification
Full npm test and ci:guards passed; required CI and Netlify Deploy Preview passed on ad24546ba6a51d85a99f0b3a631655d2d38b30f1. Draft [PR1040](https://github.com/krzysztofcal/arcadePlatform/pull/1040).

[WS Preview Deploy](https://github.com/krzysztofcal/arcadePlatform/actions/runs/37228596375) succeeded. Installed releaseSha == deployRef == RELEASE_SHA == DEPLOY_REF == ad24546ba6a51d85a99f0b3a631655d2d38b30f1.

Authenticated Netlify Preview → WS Preview Stage smoke: 1100 CH NORMAL/AUTO human, enabled/provisioned1000, fresh JOIN accepted; observed three initial bot seats and exactly three initial seed ledger debits of1000 CH from POKER_BOT_BANKROLL_1000. No cross-class/tier/TREASURY debit. The initial harness assumed Preview WS MAX_PER_TABLE=2 from Netlify ENV and failed its count assertion; these runtimes have separate ENV. The WS environment file/process environment is not readable by this account, so its configured value is unverified. Subsequent same-table verification confirmed exact seed debits and successful leave; the Production MAX_PER_TABLE=2 case is explicitly covered by deterministic JOIN regression. No runtime change was made to address this smoke-only assumption.

Isolated human left, active seats0, wallet refunded through existing ledger to0 (1100 CH); no global policy/ENV mutation. SLOW1000 and10M verified deterministically, without toggling Stage higher tiers/class overrides. No Production action/deploy or merge. Later commits update evidence only and do not change deployed runtime.

## P2 review corrections
The original SLOW1000 fixture could recover to NORMAL under its real bankroll policy. It now uses automatic NORMAL plus FORCE_SLOW at1100CH, so the effective class is unambiguously SLOW without a mocked automatic transition. Exact POKER_BOT_SLOW_BANKROLL_1000-only debit assertions remain. All54 authoritative JOIN fundamental tests passed.

Only stale funding/catalog fragments in docs/poker-deployment.md and docs/poker-bots.md changed: Enabled canonical tiers, both exact active pools, resolver key names, no cross-tier/class/TREASURY fallback and existing demand refill/caps. No runtime/config/migration change. Diff since ad24546ba6a51d85a99f0b3a631655d2d38b30f1 contains tests/docs/SpecKit evidence only; its successful exact-SHA deploy and recorded smoke remain valid. No additional Preview deploy or Production action.

Final whole-diff review after both P2 corrections found no remaining findings; independently reran78 changed-suite tests. Required CI passed on correction commit d95a652c4354c8f0ae7f9e66ebc63279f9918564. Runtime verification remains valid; no additional breaking impact or scope departure. PR is technically merge-ready, retained as draft for human review; no merge.
