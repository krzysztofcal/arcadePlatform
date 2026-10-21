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
- T05e authority/inventory/cutover evidence completed on21October: only the2explicitly approved CLI artifacts retired after publication/alias/split checks; real DB cutoff05:08:31.517Z, expiry07:08:31.517Z,7220.119s elapsed and unchanged5manifest/4object inventory verified. Stage metadata marker stage-avatar-authority-20261021 recorded with real reconciliation inventory/provider fieldsNULL; REDIS-RELEASE already recorded, no reset/epoch change. Feature staysOFF. Still require separately approved matched runtime marker/configuration window and genuine request/lease/DELETE+absence reconciliation of the retained subject, plus actual full Stage E2E; no fixture receipt or cleanup is implied by readiness metadata. See current quickstart/research for exact scope.
- One separate conditional Stage E2E GO: disposable subject+controls, canonical funding/all-in/side-pot/settlement/cash-out, accepted deletion→old UUID denial→one balanced BURN→exact Storage/Redis/profile cleanup→Auth-last, same-email new UUID→normal Welcome, independent Daily/once, preserved global quota/control ledger. Fault/retry limited to fixture; shared restart requires window approval. End flags OFF. Dedicated Google identity separately; otherwise NOT TESTED.

## Breaking impact / forward fix

New UUID intentionally receives Welcome again; farming risk accepted, no existing CH removed. Campaign max_total_claims no longer replenishes on Auth/claims deletion (preserves intended global semantics). Quota SQL is independent of deletion release, so deploy schema before matched code and test legacy atomic writers; a missing claim for new PROMO cannot commit. Empty unused HMAC tables are dropped only by new forward migration, applied hashes unchanged. Never roll back ledger/counter history or switch to an older counter writer/disable guards. Feature stays OFF if readiness fails; preserve evidence and forward-fix. Account Deletion-specific privacy/financial retention remains existing policy; HMAC policy belongs solely to#1131.

Validation uses existing PGlite/UUID bonus, Welcome/Daily/campaign, ledger/retirement, Storage/full local flow, Redis and WS fundamentals, syntax/CSP/guards/migration manifest/CI. No new package, service, table, OTP or infrastructure.

## Protected Stage deletion window (local implementation, 21 October)

Use the fixed `infra/vps/stage-deletion-window.py`, existing SecureFiles primitives and separately protected window record; do not repurpose Redis0 configuration apply. Prepare backs up OFF/helper and installs reviewed preflight without activation; activate changes only flag/authority marker; restore returns exact OFF bytes. Original preparation remains immutable. Helper independently derives ON from approved OFF, rejects missing/foreign/transitional authority and keeps LIVE Redis/Stage checks. A crash resumes only known hashes; no arbitrary hash override.

Follow the installation/Netlify scope/activation/closure contract in quickstart.md. Read-only provider metadata confirmed branch-specific deletion0/tracking1 overrides and absent marker; Functions need alias-specific ON and OFF deploys. No site-wide override; preserve other contexts/scopes. Account for newly created ON immutable deployment before a subsequent window. DB release last ON/first OFF; WS worker remains enabled until every accepted operation is actually terminal. Existing scan is independent of DB release. Operator performs no restart, DB, Netlify, Redis, finance or Auth operation. Installation/restart/runtime verification and E2E remain pending separate GO. Historical cutover proof is retained, no re-wait/reset.

## Accepted Stage fixture confirmation contract — 21 October

Previous protected window is actually closed and its sole ON immutable deployment retired with204/404 proofs; no subject deletion/funding occurred. Owner resolved the reserved-email test setup constraint: only after genuine old Auth-last deletion and COMPLETED may a normal public signUp create the replacement UUID. Check persisted UUID differs, exact email matches, then official Admin email confirmation for ONLY that new fixture UUID. Never replace signup with Admin creation/SQL, never patch old/existing identities, and STOP on rejected signup. Deliverability/link confirmation remains NOT TESTED. Normal login, initial CH/XP/profile isolation and normal Welcome are still real app checks. This changes test setup authorization, not Auth configuration or bonus policy. Next window prepared on Netlify6ad8913597cbf65ecb017f0a/served91c while WS and DB remainOFF until guarded activation.

## Stage E2E recovery checkpoint — 21 October

The real accepted request is blocked by a terminal historical Poker seat (`stack_ambiguous`); DB releasefalse prevents new requests, while WS and Netlify stayON for recovery. Do not perform OFF restore/restart or ON-deploy retirement before terminal completion. No BURN/Storage deletion/Auth deletion has occurred.

Minimal local correction: `shared/account-deletion.mjs::deletionPokerSeatPendingSql`, reused by `createAccountDeletionRuntime.steps.poker` and `chips-ledger.mjs::retireUserForDeletion`. Exclude only fully proven CLOSED, terminal, INACTIVE0, stack-key-absent, ESCROW0 history. All unknown/live/value-bearing conditions still block. Preserve historical rows and all accounting behavior. Extend existing PGlite fixtures and one real-coordinator/ledger regression; no migration, service, config or Production change.

Separate next GO: exact-SHA WS Preview deployment and safe shared-service drain; retain DBfalse and recover the same durable request automatically. Check retry/idempotency and one balanced BURN, canonical Storage ownership/DELETE/re-read, Redis/profile cleanup and Auth-last. Then actual public same-email signUp; only after real new UUID may the approved Admin email-confirmation fixture setup run. Email delivery remains NOT TESTED. Re-registration and full E2E are not PASS until executed. Complete closure in existing order after all accepted requests are terminal.

## Recovery executed; remaining closure/review gates

Exact503be776 WS deployment39597072168 and natural same-request recovery completed on real Stage at2026-10-21T12:10:22.640Z, preserving incidenttrue. One balanced400CH BURN, canonical Storage receipts, two existing objects removed/seven exact paths absent, Redis/profile cleanup and official Auth-last succeeded. No manual ledger/lease/request edits. Details/private evidence boundaries are in research.md.

Same-email public signupHTTP400 stopped the re-registration stage; no new UUID/admin confirmation/Welcome. Do not substitute Admin creation. Review a new deliverable disposable identity procedure separately. Before merge review retained historical Poker rows (actual seats lack AuthFK) and completed+historicalincident API presentation; no remote repair authorized.

DBfalse/requests terminal and Netlify branchOFF verified on6ad8ac5e86ce1c2d1e5c96ee. Next is owner protected root restore, then authorized safe Preview restart/processOFF verification. Only then verify alias/fallback detachment and retire exact ON6ad8913597cbf65ecb017f0a. No migration/reset/re-wait/Production deployment. This docs/test-message-only checkpoint does not require another runtime deploy; installed503be776 remains the verified runtime.

## Closure verified —21 October

Owner root restored the exact protected OFF baseline; fresh WS Preview process20592/LIVE/health/browser Auth+WS and unchanged USER/CH/claims verified. DBfalse, requests terminal, NetlifyOFF6ad8ac5e86ce1c2d1e5c96ee. Retired ONLY detached ON6ad8913597cbf65ecb017f0a (204, metadata/functions404), aliases and Production unchanged. No further operator action or worker recovery is pending. Remaining signup/retention/presentation findings still require review before merge; this closure documentation does not change verified runtime503be776.
