# Minimal Stage rollout / E2E — #1117

## Binding owner decision — per-UUID bonuses / #1131 (20 October 2026)

Cross-account anti-farming is OUT OF SCOPE for #1117 and deferred to #1131. Welcome must work for every eligible new UUID under existing amount/start-date rules, including same-email/Google re-registration; one payout per UUID, no lifetime email cap. Daily UTC/streak and once/campaign remain per UUID. Owner accepts cross-account farming. No HMAC key, verified-email-at-payout, history_ready, protected-payout pause or anti-farming privacy/LIA decision blocks Account Deletion. Global campaign max_total_claims and financial/idempotency retention remain unchanged. Do not delete ledger evidence or reset a campaign quota with Auth/claims cascade.

Redis V3 is COMPLETED on Stage+Production (#1129/#1130); no new reset or credential rotation. Account Deletion stays OFF and #1124 DRAFT. Invisible late upload is accepted MVP limitation#1128; real uncertain operations/ownership still fail closed. Current permission is local code/tests/documentation and read-only review, not activation/destructive E2E/Production deployment/merge.

## 1. Read-only preflight

Pin Stage krydukthwdvccggbyjfw/system7656985631720456337; compare all applied hashes. Baseline115 applied, two pending:20261020094224_account_avatar_reconciliation.sql and20261020190000_account_bonus_uuid_policy.sql. Removed20261020094949 was never applied; never restore it. Unexpected drift/data in unused recognition tables -> NO-GO. Do not run migrator as read-only check.

Verify guards v2/v3 ready, tracking1, Netlify/WS deletion0 and DB releasefalse, Stage Redis V3 LIVE/current epoch and no shared Preview conflict. Redis migration is completed; retain protected backup/journal. Current hosted sourceStage13481825/Production82aee39d is historical component evidence, not this new runtime.

## 2. Matched schema/runtime (next scoped Stage GO)

Apply only the two pending forward migrations while deletion OFF. UUID policy migration preserves already-applied hashes, fails if recognition tables unexpectedly contain data, initializes durable global campaign counts from actual claim/hot/registry receipts without decrementing retained totals, installs PROMO-only quota/replay guard and drops unused HMAC structures. No history_ready/key/version/privacy approval exists or is needed. Global max_total_claims is unchanged; retired claims cannot replenish it.

Deploy supported Netlify Preview and main-defined WS Preview with ref=<reviewed exact runtime SHA>, xpRedisVersion3. Check actualSHA/dual deploy-preview/3/stage contexts, LIVE Redis/health/browser Auth/ping. Keep deletion OFF. Verify normal per-UUID Welcome/Daily/once independently of release/HMAC; tests must not silently spend real bonus budget on non-disposable identities.

## 3. Actual Storage / deletion-readiness evidence

Resolve five specific no-SHA artifacts in research using provenance or separately approved exact retirement after current published/alias safety checks. Do not disable1626known deployments. Account for actual legacy authority/invocations; inventory exact user_profiles/profile_avatar_uploads/account_avatar_objects ownership. Wait genuine cutoff7200s and every longer capability_until. No provider terminal-write guarantee/grace/support required for accepted#1128 edge.

Record truthful Storage inventory/cutoff and deletion-specific Redis evidence (actual existing endpoint hash/epoch/manifest/drain/reset) under scoped operator GO; do not invent markers or reinitialize epochs. Known unfinished signing/output, ownership gaps or failed DELETE remain blocking. Existing canonical reconciliation RPC requires genuine owner/request/lease and records NEW exact DELETE+authenticated absence observations; no fake request/receipt/terminal state. Retained old fixtures are excluded unless individually authorized.

## 4. One conditional destructive Stage E2E GO

After real prerequisites, authorize one disposable subject+two unequal-stack players/control, canonical funding and feature window. UI confirmation→durable accept/signout; old JWT/WS/private writes/JOIN denied, backend independent of browser. Preserve all-in showdown/main+side-pot, normal cash-out, exactly one balanced BURN including winnings. Verify immutable ledger/idempotency/retired USER and unaffected control.

Worker exact-owner Storage DELETE+authenticated absence, indexed Redis/profile cleanup and official Auth hard-delete LAST; retry/lost responses cannot double effects. Re-register same confirmed email→new UUID→normal Welcome payment, zero inherited CH/XP/profile/streak before that new payout; a second Welcome on same UUID denied. DailyUTC/once are independent on new UUID, global campaign lifetime cap still applies. Dedicated Google identity/mailbox or explicitly labelled Admin fixture confirmation must be authorized; no private/ordinary Preview identities. Google absence -> NOT TESTED, not a password-test blocker.

Shared restart/fault needs explicit impact window. Financial mismatch -> incident/STOP, no manual repair. End feature OFF and preserve financial/bonus receipts. Teardown only explicitly scoped fixture resources. No Production deployment/activation/merge included.

## 5. Failure / forward fix

Keep feature OFF on unmet prerequisites; preserve manifests and ledger/counter history. No HMAC fallback, bonus pause, arbitrary timeout, fake completion, guard disable, V2 rollback or global sweep. Correct through reviewed forward code/schema. History/real Stage evidence remains in research.md; old HMAC and pending-reset proposals there are superseded, not executable instructions.
