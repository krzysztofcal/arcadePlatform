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

Prepared code is disabled and unfinished. Redis V3/reset preparation is locally implemented; live cutover and release evidence remain gated; retired USER archive compatibility is prepared locally. New acceptance requires both runtime flag and default-false database release row. None of the local-only schema proposals is applied. Focused local tests do not authorize activation or establish all R1–R8 PASS.

## Owner addition — Redis standard, 2026-10-18

T05d now requires a lasting versioned per-owner key contract, not a permanent whole-Redis scan workaround. Proposed private namespaces: `kcswh:stage:xp:v3:user:<UUID>:...` and `kcswh:prod:xp:v3:user:<UUID>:...`; anonymous state has a separate hashed-anonymous-owner prefix. Owner comes from verified server identity/session. Shared leaderboards/IP limits/infrastructure stay shared inside the environment namespace; deletion removes only a member/fragment and preserves lifecycle fences. Transient state has justified finite TTL; permanent XP/profile and account-scoped conversion proof remain attributable until deletion. No email/session secret in keys.

All generators/writers must switch together after approved drain and legacy reconciliation. Historical XP reset is approved in principle; no live reset, configuration or runtime switch is authorized by the current GO. Stage and Production cutovers require separate GO. The read-only inventory found the current Netlify all-context Redis/namespace is shared, so a Stage-labelled reset is unsafe. T05d code/local verification is prepared; live cutover is OPEN; the owner has selected XP reset over migration, with live execution separately gated.

### Latest Redis decision — 18 October 2026

Use one reviewed V3 per-environment contract and a controlled XP-only legacy reset, not historical XP migration. No dual-read/import from legacy after cutover. Use the existing single Upstash Free database with stage/prod namespaces; shared endpoint/credentials are explicitly accepted. No new database/account/instance/subscription or paid upgrade. Immutable build pins plus runtime configuration must reject cross-environment/downgrade errors; combined Free quota verification remains an operational gate. Keep T04d/T02f and financial retention unchanged. Detailed scope, drain, backup, rollback and GO/NO-GO are in [redis-cutover.md](redis-cutover.md); live reset/configuration/deploy/apply remain unauthorized.

### Follow-up review: Free-only / immutable configuration / elapsed TTL

One existing Free database is the approved topology, with exact stage/prod namespaces and shared credentials. No provisioning/purchase/plan change. V3 cutover requires the existing generated artifact's immutable version/environment pins plus complete matching runtime variables; deleting runtime variables cannot silently choose V2 or Production. Netlify, WS and background imports share the resolver. Legacy/unpinned artifacts remain supported only before the authorized cutover; all old issuers must then be retired. The reset manifest captures Redis TIME/expiry and content hash, not a future exact PTTL expectation: natural countdown/verified expiry is allowed, unknown absence/ownership-content/type/expiry-policy change is NO-GO, and the future executor must atomically check+mutate with current TTL preservation. Read-only Free usage evidence is incomplete (see research.md); this does not authorize a paid alternative. T04d/T02f, bonus proofs, all-in/BURN/Auth-last and release guards are unchanged.
