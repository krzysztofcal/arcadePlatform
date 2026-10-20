# Minimal Stage rollout / E2E — #1117

## Binding owner decision — per-UUID bonuses / #1131 (20 October 2026)

Cross-account anti-farming is OUT OF SCOPE for #1117 and deferred to #1131. Welcome must work for every eligible new UUID under existing amount/start-date rules, including same-email/Google re-registration; one payout per UUID, no lifetime email cap. Daily UTC/streak and once/campaign remain per UUID. Owner accepts cross-account farming. No HMAC key, verified-email-at-payout, history_ready, protected-payout pause or anti-farming privacy/LIA decision blocks Account Deletion. Global campaign max_total_claims and financial/idempotency retention remain unchanged. Do not delete ledger evidence or reset a campaign quota with Auth/claims cascade.

Redis V3 is COMPLETED on Stage+Production (#1129/#1130); no new reset or credential rotation. Account Deletion stays OFF and #1124 DRAFT. Invisible late upload is accepted MVP limitation#1128; real uncertain operations/ownership still fail closed. The approved matched Stage Preview rollout is completed below. Activation/destructive E2E/Production deployment/merge still require separate GO.

## 1. Read-only preflight

Pin Stage krydukthwdvccggbyjfw/system7656985631720456337; compare all applied hashes. Current Stage117 applied/hashes verified, zero pending:20261020094224_account_avatar_reconciliation.sql and20261020190000_account_bonus_uuid_policy.sql are ALREADY APPLIED. Do not reapply. Removed20261020094949 was never applied; never restore it. Unexpected drift/data in unused recognition tables -> NO-GO. Do not run migrator as read-only check.

Verify guards v2/v3 ready, tracking1, Netlify/WS deletion0 and DB releasefalse, Stage Redis V3 LIVE/current epoch and no shared Preview conflict. Redis migration is completed; retain protected backup/journal. Current hosted Stage Netlify/WS source is91c329558f90cb8cc525777bc621f56242dfeca0; Production82aee39d is unchanged.

## 2. Matched schema/runtime — completed Stage Preview rollout

The two approved forward migrations are installed with deletion OFF; verify hashes/catalog without reapplying. Owner explicitly allowed existing balanced bot-only activity. The matched rollout below passed; that activity alone is not a financial STOP. Unexpected USER effects, unbalanced transactions, unsafe pending actions or escrow mismatch remain STOP conditions. UUID policy migration preserves already-applied hashes, fails if recognition tables unexpectedly contain data, initializes durable global campaign counts from actual claim/hot/registry receipts without decrementing retained totals, installs PROMO-only quota/replay guard and drops unused HMAC structures. No history_ready/key/version/privacy approval exists or is needed. Global max_total_claims is unchanged; retired claims cannot replenish it.

Approved runtime91c32955 is now deployed to [Netlify Preview](https://deploy-preview-1124--playkcswh.netlify.app), deploy6ad7c906436059f74f296e2c, and [main-defined WS Preview run39488749067](https://github.com/krzysztofcal/arcadePlatform/actions/runs/39488749067), input ref91c329558f90cb8cc525777bc621f56242dfeca0/xpRedisVersion3. CLI alias deploy metadata has commit_ref=null/context branch-deploy; exact detached source plus served BUILD_INFO proves source SHA, and generated Functions context is deploy-preview/3/stage. Do not report a provider commit_ref that does not exist.

Actual WS release metadata matches exact91c32955; both generated contexts deploy-preview/3/stage, protected LIVE Redis PASS (epochPresent1), local/public health200, browser password Auth/profile/XP refresh/WS auth+ping PASS. Tracking1/guardreadytrue, DB releasefalse/Netlify0/protected WS0. No new upload/finalize or bonus payout was executed. Existing avatar-v3 tracking/schema were preserved, not re-proved with a new upload.

Before restart:0human seats/0pending requests/0Preview sockets, five continuous bot tables with handSeed and escrow conservation. No SIGTERM drain handler exists: standard workflow restart uses transactionally persisted state/action/settlement plus bootstrap recovery;55local recovery tests passed. Active-phase liability is stacks+contributionsByUserId; SETTLED stacks already include awards (do not double-count contributions or rely on state.pot). After restart all five bot tables progress, escrow remains consistent, USER fingerprint/claims18/totalCH300 unchanged, hot unbalanced0. Archive commits/background bot turnover may change hot row count; row-count equality is not a financial invariant. Read-only campaign paid totals18 across4campaigns equal18claims. No test payout, BURN or Auth deletion. Production deployment/configuration unchanged.

## 3. Actual Storage / deletion-readiness evidence

Resolve five specific no-SHA artifacts in research using provenance or separately approved exact retirement after current published/alias safety checks. Do not disable1626known deployments. Account for actual legacy authority/invocations; inventory exact user_profiles/profile_avatar_uploads/account_avatar_objects ownership. Wait genuine cutoff7200s and every longer capability_until. No provider terminal-write guarantee/grace/support required for accepted#1128 edge.

Record truthful Storage inventory/cutoff and deletion-specific Redis evidence (actual existing endpoint hash/epoch/manifest/drain/reset) under scoped operator GO; do not invent markers or reinitialize epochs. Known unfinished signing/output, ownership gaps or failed DELETE remain blocking. Existing canonical reconciliation RPC requires genuine owner/request/lease and records NEW exact DELETE+authenticated absence observations; no fake request/receipt/terminal state. Retained old fixtures are excluded unless individually authorized.

## 4. One conditional destructive Stage E2E GO

After real prerequisites, authorize one disposable subject+two unequal-stack players/control, canonical funding and feature window. UI confirmation→durable accept/signout; old JWT/WS/private writes/JOIN denied, backend independent of browser. Preserve all-in showdown/main+side-pot, normal cash-out, exactly one balanced BURN including winnings. Verify immutable ledger/idempotency/retired USER and unaffected control.

Worker exact-owner Storage DELETE+authenticated absence, indexed Redis/profile cleanup and official Auth hard-delete LAST; retry/lost responses cannot double effects. Re-register same confirmed email→new UUID→normal Welcome payment, zero inherited CH/XP/profile/streak before that new payout; a second Welcome on same UUID denied. DailyUTC/once are independent on new UUID, global campaign lifetime cap still applies. Dedicated Google identity/mailbox or explicitly labelled Admin fixture confirmation must be authorized; no private/ordinary Preview identities. Google absence -> NOT TESTED, not a password-test blocker.

Shared restart/fault needs explicit impact window. Financial mismatch -> incident/STOP, no manual repair. End feature OFF and preserve financial/bonus receipts. Teardown only explicitly scoped fixture resources. No Production deployment/activation/merge included.

## 5. Failure / forward fix

Keep feature OFF on unmet prerequisites; preserve manifests and ledger/counter history. No HMAC fallback, bonus pause, arbitrary timeout, fake completion, guard disable, V2 rollback or global sweep. Correct through reviewed forward code/schema. History/real Stage evidence remains in research.md; old HMAC and pending-reset proposals there are superseded, not executable instructions.
