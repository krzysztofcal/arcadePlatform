# Account Deletion API / internal contracts

## Binding owner decision — per-UUID bonuses / #1131 (20 October 2026)

Cross-account anti-farming is OUT OF SCOPE for #1117 and deferred to #1131. Welcome must work for every eligible new UUID under existing amount/start-date rules, including same-email/Google re-registration; one payout per UUID, no lifetime email cap. Daily UTC/streak and once/campaign remain per UUID. Owner accepts cross-account farming. No HMAC key, verified-email-at-payout, history_ready, protected-payout pause or anti-farming privacy/LIA decision blocks Account Deletion. Global campaign max_total_claims and financial/idempotency retention remain unchanged. Do not delete ledger evidence or reset a campaign quota with Auth/claims cascade.

Redis V3 is COMPLETED on Stage+Production (#1129/#1130); no new reset or credential rotation. Account Deletion stays OFF and #1124 DRAFT. Invisible late upload is accepted MVP limitation#1128; real uncertain operations/ownership still fail closed. Current permission is local code/tests/documentation and read-only review, not activation/destructive E2E/Production deployment/merge.

## HTTP

POST /account-delete: standard owner bearer JWT, approved origin, JSON {confirmation:"DELETE_ACCOUNT",acknowledgeForfeiture:true}. Server derives UUID; reject unknown fields/wrong owner/origin. One durable request per UUID; repeated POST recovers existing job rather than creating another. Return202 only after SQL commit. Status response includes requestId,status,phase,accepted,completed,retryable,requiresIntervention and one read-only statusToken.

GET /account-delete: owner bearer, or Authorization:Deletion <token> with requestId (never token in URL). Used once for lost POST-response recovery; no frontend polling/sessionStorage tracking. Duplicate POST can rotate status capability. No table IDs/financial/internal error details in response.400invalid consent/body;401unauthorized;403wrong origin/owner;405unsupported;503unavailable. Feature defaultsOFF.

UI: one confirmation/Cancel; no typed phrase/password/OTP/re-auth. After durable acceptance show agreed message and sign out. Browser may close; backend proceeds. No technical progress/completion/ETA promise.

## Durable runtime

Existing WS tick/start/callback claims bounded real leases, fences SQL/Redis/socket admission, resolves trusted Poker Leave/settlement without folding all-in, then cash-out/one balanced idempotent BURN/retired USER. Cleanup verifies exact owned avatar absence and indexed UUID Redis removal before official Auth hard-delete LAST. Lost external response is reconciled; financial mismatch blocks destructive steps/raises incident. No client-controlled phase/lease/done override and no Postgres+Redis atomicity claim.

Storage reconciliation RPC validates real owner/request/generation/phase/lease, inventory/snapshot/capability horizon. New observed removal receipt never overwrites old missing write acknowledgement. Purge requires validated original or reconciliation evidence; unknown owner/operation remains NO-GO. Accepted invisible late upload#1128 is not a guarantee of physical deletion of every provider copy.

## Bonus contract

welcome-bonus:<UUID> is independent for each newly registered UUID, including same email/Google. Existing amount/start-date, normal UUID idempotency, DailyUTC/streak and once/campaign behaviour preserved. No HMAC/history_ready/recognized-email/AccountDeletion-release dependency. New UUID starts empty; normal Welcome then credits CH. Reusing old JWT/UUID never bypasses lifecycle.

Global campaign paid_total is independent of surviving bonus_claims. Deferred PROMO SQL guard owns exactly one increment in the ledger+claim transaction; JS does not increment. Existing immutable completed registry replay restores history without a new charge. SQL quota/claim mismatch or exhausted cap rolls back payout; Welcome is excluded from this guard. Matched pending schema/runtime rollout is required, with deletionOFF. No bonus freeze or cross-account historical backfill approval.

Production activation, destructive Stage E2E and merge remain separate GO. Existing tokens/session/profile/accounting/storage/Redis gates are not weakened by moving anti-farming to#1131.
