## Current verification — 19 October 2026

Owner authorizes Stage/Preview deployment and disposable funded Poker/deletion tests after positive isolation preflight. Production, shared V2 reset, paid resources and merge remain forbidden. Main now contains #1125 and #1126; their workflow/ESCROW guard changes are integrated without reverting either Stage migration. Successful main Stage automation runs are observable (e.g.39221672570); this agent only read their results.

WS Preview is still runtime f771972b with generated context unknown/null V3 pins. The existing root-owned environment checker returns PASS for its old Stage checks, but does not inspect Redis. Its root0600 environment is not readable/editable by the agent; permitted sudo covers only the fixed checker and restart. Thus required runtime Redis V3/credential identity is unverified: **NO-GO for deploy**. The existing checker now has a reviewed V3-aware implementation and a fundamental executable regression; operator must install it and configure matching Stage V3 using existing credentials before the agent can prove preflight. Require explicit `PASS Redis V3 stage kcswh:stage:xp:v3`, then dispatch the main-defined WS workflow with exact PR runtime SHA and xpRedisVersion3. No feature/cutover marker is inferred from this configuration.

Read-only Stage: deletion release=false, redis_cutover empty, avatar markers0, reward configs0, deletion requests0. Full frontend/Poker/deletion tests on the new WS remain BLOCKED, not PASS. Prior local/actual Stage component results retain their original scope. See research.md for the current evidence and Storage/HMAC closure conditions.

## Current closeout status

Preview is now deployed with branch-only Stage configuration: `XP_REDIS_VERSION=3`, `XP_REDIS_ENV=stage`, `XP_KEY_NS=kcswh:stage:xp:v3`, `ACCOUNT_DELETION_ENABLED=0`. Netlify Free accepts default all scopes; the earlier403 was the paid granular-scopes restriction, not missing branch access. Other contexts retain V2 and Production is unchanged. The committed Stage build floor is3; Production remains2. This is isolated Preview preparation, not a legacy reset/cutover attestation or deletion activation. See research.md latest evidence for automatic real-Stage BURN recovery and remaining gates.

## Current owner decision / verified Stage scope

Supersedes historical authorization below: isolated Stage schema/test/configuration and exact-SHA Preview deployment are authorized. Shared V2 reset and Production changes/activation, paid resources and merge are not. Free monthly headroom is an accepted risk, not a gate. Canonical migration `20261018184941_account_self_deletion_v2.sql` is applied only to verified Stage, with release=false and no Storage/reward/Redis cutover approvals. Real password/Auth/Postgres/Upstash components and positive-wallet BURN were tested; full deletion/Google/all-in/re-registration remains unverified. See [research.md](research.md) for exact evidence, findings, NOT TESTED matrix and owner decisions; [redis-cutover.md](redis-cutover.md) for protected reset scope. Local fixtures are not real Stage E2E proof.

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

Use one reviewed V3 per-environment contract and a controlled XP-only legacy reset, not historical XP migration. No dual-read/import from legacy after cutover. Use the existing single Upstash Free database with stage/prod namespaces; shared endpoint/credentials are explicitly accepted. No new database/account/instance/subscription or paid upgrade. Immutable build pins plus runtime configuration must reject cross-environment/downgrade errors; owner accepts combined Free-quota exhaustion risk; billing/monthly headroom is not a release gate. Keep T04d/T02f and financial retention unchanged. Detailed scope, drain, backup, rollback and GO/NO-GO are in [redis-cutover.md](redis-cutover.md); shared V2 reset and Production remain unauthorized; isolated Stage operations follow the current GO.

### Follow-up review: Free-only / immutable configuration / elapsed TTL

One existing Free database is the approved topology, with exact stage/prod namespaces and shared credentials. No provisioning/purchase/plan change. V3 cutover requires raising the committed per-environment minimum-version floor from 2 to 3 under separate GO, the generated artifact's immutable version/environment pins and complete matching runtime variables; deleting runtime variables cannot silently choose V2 or Production. Netlify, WS and background imports share the resolver. Legacy/unpinned artifacts remain supported only before the authorized cutover; all old issuers must then be retired. The reset manifest captures Redis TIME/expiry and content hash, not a future exact PTTL expectation: natural countdown/verified expiry is allowed, unknown absence/ownership-content/type/expiry-policy change is NO-GO, and the future executor must atomically check+mutate with current TTL preservation. Read-only Free usage evidence is incomplete (see research.md); this does not authorize a paid alternative. T04d/T02f, bonus proofs, all-in/BURN/Auth-last and release guards are unchanged.

### P2: missing Redis credentials after V3 activation (2026-10-18)

After V3 activation, missing/blank Redis URL or token MUST return service unavailability for Redis-dependent XP operations, never volatile fallback, false zero XP or weaker rate limits. Explicit `XP_TEST_MODE=1` memory fixtures and pre-cutover V2 compatibility remain. Independent Poker/CH settlement MUST continue.
