# Account Deletion V2 — #1117

## Binding owner decision — per-UUID bonuses / #1131 (20 October 2026)

Cross-account anti-farming is OUT OF SCOPE for #1117 and deferred to #1131. Welcome must work for every eligible new UUID under existing amount/start-date rules, including same-email/Google re-registration; one payout per UUID, no lifetime email cap. Daily UTC/streak and once/campaign remain per UUID. Owner accepts cross-account farming. No HMAC key, verified-email-at-payout, history_ready, protected-payout pause or anti-farming privacy/LIA decision blocks Account Deletion. Global campaign max_total_claims and financial/idempotency retention remain unchanged. Do not delete ledger evidence or reset a campaign quota with Auth/claims cascade.

Redis V3 is COMPLETED on Stage+Production (#1129/#1130); no new reset or credential rotation. Account Deletion stays OFF and #1124 DRAFT. Invisible late upload is accepted MVP limitation#1128; real uncertain operations/ownership still fail closed. Current permission is local code/tests/documentation and read-only review, not activation/destructive E2E/Production deployment/merge.

## User flow

Settings → Danger Zone → Delete Account. One confirmation explains permanent loss of account, all CH including Poker winnings, XP, achievements and profile; Cancel does nothing. No typed DELETE_ACCOUNT/password/OTP/re-login challenge. Standard verified owner JWT and origin validation remain mandatory. POST carries internal confirmation=DELETE_ACCOUNT and acknowledgeForfeiture=true.

Only after durable acceptance (or one-shot owner GET recovery of a lost response), show “Przyjęliśmy żądanie usunięcia konta. Nie musisz wykonywać żadnych dodatkowych czynności.” and SDK signout. No browser polling/status tracking/technical completion UI. Backend continues without the browser. Do not promise immediate physical erasure or immediate re-registration.

## Safety / acceptance criteria

- Durable request fences new old-UUID JWT/WS/HTTP/SQL/XP/profile/bonus/admin-recipient operations. Active sockets cannot continue; trusted internal settlement may finish. No claimed Postgres+Redis atomicity.
- Existing authoritative Poker Leave handles all tables. All-in stays eligible for showdown/main+side-pot; only after final settlement/cash-out burn final USER balance including winnings exactly once through balanced canonical ledger. Financial mismatch stops destruction and raises incident.
- Retired USER, both ownership CHECK constraints/Auth FK, ledger/receipts/idempotency/archive retention stay compatible. Never zero balances/delete financial history directly.
- Existing WS tick/start/retry/lease handles requests even with no tables, lost BURN/Auth response and service restart. Durable incidents are preserved. No new worker/cron/framework.
- Storage v3 manifest is written before capability/output operation; receipts require RETURNING. Guard preserves owner/path/security fields; old manifest removal/untracked finalization denied. Wait known capability_until/cutoff7200s, confirm exact owned DELETE+authenticated absence, preserve real uncertain operations and canonical owner/request/lease purge. No arbitrary grace, provider attestation or false done/COMPLETED.
- Indexed Redis V3 cleanup is exact UUID/environment scope, preserves global boards/other owners/sticky fences, validates real endpoint/epoch/cutover evidence. Missing config/provider result is fail-closed; XP outage cannot interrupt CH/Poker settlement.
- Auth hard-delete via official backend Admin API LAST; reconcile absence on lost response. Re-registration same email/Google creates new UUID with independent profile/XP/CH/streak. Welcome for new UUID is normal behaviour; previously deleted UUID never becomes active again.
- Bonuses use normal UUID idempotency and balanced CH. Once/campaign and Daily UTC do not double-pay the same account/period. Campaign lifetime quota survives deleting claims; counter and ledger/claim commit atomically, historical registry replay is not new payment. No email recognition/HMAC requirement, even when deletion enabled.

## Verification / release gates

T04d/T02f and Redis V3 are implemented; real Poker/Storage API/XP component evidence is in research.md. T05e still needs truthful authority/inventory/cutover and scoped canonical reconciliation. T07b needs matched pending schema/runtime and separately authorized real Stage deletion/BURN/Auth-last/re-registration/control/retry E2E. Google NOT TESTED without dedicated authorized identity. Local fixtures/green CI do not prove hosted completion. Production activation and merge require separate GO.

Only fundamental tests, existing packages, JSP-compatible frontend, klog, CSP hashes for new inline code and one-line CSS selectors. Current change adds no UI scripts/CSS/infrastructure. Historical superseded HMAC decisions/evidence remain in research.md, not active requirements.
