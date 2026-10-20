# Implementation / remaining rollout plan — #1117

## Binding owner decision — per-UUID bonuses / #1131 (20 October 2026)

Cross-account anti-farming is OUT OF SCOPE for #1117 and deferred to #1131. Welcome must work for every eligible new UUID under existing amount/start-date rules, including same-email/Google re-registration; one payout per UUID, no lifetime email cap. Daily UTC/streak and once/campaign remain per UUID. Owner accepts cross-account farming. No HMAC key, verified-email-at-payout, history_ready, protected-payout pause or anti-farming privacy/LIA decision blocks Account Deletion. Global campaign max_total_claims and financial/idempotency retention remain unchanged. Do not delete ledger evidence or reset a campaign quota with Auth/claims cascade.

Redis V3 is COMPLETED on Stage+Production (#1129/#1130); no new reset or credential rotation. Account Deletion stays OFF and #1124 DRAFT. Invisible late upload is accepted MVP limitation#1128; real uncertain operations/ownership still fail closed. Current permission is local code/tests/documentation and read-only review, not activation/destructive E2E/Production deployment/merge.

## Code and schema

1. Restore netlify/functions/_shared/welcome-bonus.mjs to existing UUID welcome-bonus:<UUID> ledger path; remove reward-identities.mjs and all HMAC/release wrappers. Existing ledger lifecycle/idempotency does the security work.
2. bonus-campaigns.mjs keeps normal UUID policy/UTC decision clock/streak, campaign serialization and one transaction for ledger+bonus_claims. Read retained private.bonus_campaign_paid_totals for lifetime campaign quota. No cross-account lookup or JS counter increment.
3. Read-only migration history proved20261020094949 unapplied Stage+Production; delete that pending HMAC fence and unused manual proposal, preserve applied20261018184941 byte-for-byte. New forward20261020190000_account_bonus_uuid_policy.sql removes only unused EMPTY reward identity tables, seeds monotonic campaign totals from actual distinct claim/hot/registry receipt IDs, and installs independent deferred PROMO quota guard + zero initializer for new campaigns. No release flag/HMAC dependency; Welcome is excluded. Unexpected populated recognition data -> migration NO-GO for review, never silent deletion. Known archival replay does not increment count.
4. Existing shared/account-deletion.mjs, ws-server/poker/runtime/account-deletion.mjs, CH retirement/retention, Storage v3 tracking/reconciliation, exact Auth-last and Redis V3 remain intact. No runtime Storage refactor for accepted#1128 edge.

## Remaining execution sequence (separate GO)

- Stage identity/hash/guard/flags preflight; expected115 applied, exactly pending20261020094224_account_avatar_reconciliation.sql +20261020190000_account_bonus_uuid_policy.sql. No automatic Stage apply from Draft; Production schema/config unchanged.
- Review/apply only these forward migrations on Stage while deletion OFF; verify campaign counter baseline against real evidence, no recognition tables, no payout blockage by release/HMAC. Deploy matched Netlify Preview and main-defined exact-SHA WS Preview/V3; do not deploy Production.
- Finish T05e authority proof for five no-SHA artifacts (provenance or individually approved retirement with alias safety), exact inventory/cutoff and actual capability horizon. Record existing Redis migration evidence in deletion-specific proof; no reset/epoch change. Real known uncertain rows need genuine request/lease reconciliation, not fake receipts. Clean new E2E subject may proceed only with global truthful inventory/cutoff and its own operations closed; retained fixtures are not automatically included.
- One separate conditional Stage E2E GO: disposable subject+controls, canonical funding/all-in/side-pot/settlement/cash-out, accepted deletion→old UUID denial→one balanced BURN→exact Storage/Redis/profile cleanup→Auth-last, same-email new UUID→normal Welcome, independent Daily/once, preserved global quota/control ledger. Fault/retry limited to fixture; shared restart requires window approval. End flags OFF. Dedicated Google identity separately; otherwise NOT TESTED.

## Breaking impact / forward fix

New UUID intentionally receives Welcome again; farming risk accepted, no existing CH removed. Campaign max_total_claims no longer replenishes on Auth/claims deletion (preserves intended global semantics). Quota SQL is independent of deletion release, so deploy schema before matched code and test legacy atomic writers; a missing claim for new PROMO cannot commit. Empty unused HMAC tables are dropped only by new forward migration, applied hashes unchanged. Never roll back ledger/counter history or switch to an older counter writer/disable guards. Feature stays OFF if readiness fails; preserve evidence and forward-fix. Account Deletion-specific privacy/financial retention remains existing policy; HMAC policy belongs solely to#1131.

Validation uses existing PGlite/UUID bonus, Welcome/Daily/campaign, ledger/retirement, Storage/full local flow, Redis and WS fundamentals, syntax/CSP/guards/migration manifest/CI. No new package, service, table, OTP or infrastructure.
