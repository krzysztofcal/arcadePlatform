# Account Danger Zone — issue #1117, V2

Source of truth: https://github.com/krzysztofcal/arcadePlatform/issues/1117 (owner V2 decision, 2026-10-17). Current task grants implementation and fundamental local/CI tests; no destructive Stage, Production migration/deployment or merge. This replaces V1's request-bound OTP/challenge/receipt design. PR #1123 is historical PoC evidence, not an implementation prerequisite.

## User journeys

1. An authenticated owner opens Danger Zone in account.html, acknowledges permanent loss of all CH, XP, achievements and other resources, and explicitly confirms DELETE_ACCOUNT. Server derives UUID from verified Auth, validates origin and request, and durably accepts one request per UUID. Acceptance and completion are distinct.
2. Acceptance blocks old HTTP JWTs, new WS tokens, active sockets, game entry, transfers/purchases/bonuses/XP/profile writes. Trusted internal settlement may finish existing obligations. No manual Leave or continued browser session required.
3. Existing authoritative Poker Leave/settlement handles every table. Non-all-in follows normal fold; all-in remains eligible for showdown and side-pots. Cash-out and winnings return before one atomic balanced idempotent BURN of the final wallet balance. Never directly zero balances or delete ledger history.
4. Cleanup removes permitted profile/Storage/cache/XP/session data, prevents resurrection, retires financial USER without changing historical identity/classification, then calls official backend Supabase Admin hard-delete. Retry uncertain outcomes; never report completed on mere dispatch/error.
5. After completion same verified email or Google can register a new independent UUID, empty wallet/XP/streak/roles. Re-registration may be unavailable while deleting. Bonus eligibility survives UUID recreation without blocking signup.

## Acceptance and gates

- R1: ledger/escrow/conservation/idempotency and both USER CHECKs/FK/history preserved, including positive balances and late settlement credits.
- R2: ACTIVE authorization at actual SQL/Redis commit and WS delivery boundary; guard direct Redis writers, admin targets, sync, guest conversion, missing permit and restart epoch. No PostgreSQL+Redis atomicity claim. Preparing fence is durable; accepted=true only after complete fence acknowledgement.
- R3: existing WS tick resumes no-table and table requests after restart/outage/lost response; leases fence stale workers. Financial discrepancy stops destructive stages and creates operator incident; no endless invisible pending.
- R4: hard-delete verified old UUID last, confirmed successful outcome or documented not-found reconciliation; new UUID has no old resources.
- R5: minimum private versioned HMAC of verified email, no raw email/IP/fingerprint. Privacy/legal decides justified retention, basis, rights and key rotation before release. Do not promise lifelong recognition or arbitrary annual resets.
- R6 V2: ordinary verified owner plus explicit irreversible confirmation, no custom OTP/challenge/proof infrastructure. Fresh login, when selected, uses supported isolated password login or genuine Google OAuth with server UUID match. Refresh/redirect/checkbox is not claimed as fresh authentication. Real password/Google Stage smoke before activation requires separately authorized fixtures; old OTP PoC PASS is not required.
- R7: at most three confirmed Welcome payouts per recognized verified email; no 24h cooldown; count committed ledger payouts only, no rolling timeout reset while evidence is retained under approved policy.
- R8: Poker Daily once per recognized identity/UTC day; once campaigns once per identity/stable campaign UUID. Preserve global max_total_claims after Auth cascade; unrelated campaigns unchanged, recreated user starts fresh streak.

## Non-goals and release requirements

No new service/worker/framework, no Google account deletion or provider physical-erasure certificate, no blanket financial cascade, no custom email infrastructure. Storage signed-upload capabilities issued before deletion must expire and be safely cleaned before COMPLETED; track paths beyond five-minute finalize eligibility, including legacy missing records. Real cleanup/smoke, exact-SHA WS Preview Deploy, privacy approval and Production GO remain separate gates. Fundamental backend/SQL/WS tests only; no UI snapshots.

## Current implementation boundary

Prepared code is disabled and unfinished. Legacy Redis standardization/cutover remains the implementation blocker; retired USER archive compatibility is prepared locally. New acceptance requires both runtime flag and default-false database release row. None of the local-only schema proposals is applied. Focused local tests do not authorize activation or establish all R1–R8 PASS.
