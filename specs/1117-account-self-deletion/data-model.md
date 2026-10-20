## Current verification — 19 October 2026

Owner authorizes Stage/Preview deployment and disposable funded Poker/deletion tests after positive isolation preflight. Production, shared V2 reset, paid resources and merge remain forbidden. Main now contains #1125 and #1126; their workflow/ESCROW guard changes are integrated without reverting either Stage migration. Successful main Stage automation runs are observable (e.g.39221672570); this agent only read their results.

WS Preview is still runtime f771972b with generated context unknown/null V3 pins. The existing root-owned environment checker returns PASS for its old Stage checks, but does not inspect Redis. Its root0600 environment is not readable/editable by the agent; permitted sudo covers only the fixed checker and restart. Thus required runtime Redis V3/credential identity is unverified: **NO-GO for deploy**. The existing checker now has a reviewed V3-aware implementation and a fundamental executable regression; operator must install it and configure matching Stage V3 using existing credentials before the agent can prove preflight. Require explicit `PASS Redis V3 stage kcswh:stage:xp:v3`, then dispatch the main-defined WS workflow with exact PR runtime SHA and xpRedisVersion3. No feature/cutover marker is inferred from this configuration.

Read-only Stage: deletion release=false, redis_cutover empty, avatar markers0, reward configs0, deletion requests0. Full frontend/Poker/deletion tests on the new WS remain BLOCKED, not PASS. Prior local/actual Stage component results retain their original scope. See research.md for the current evidence and Storage/HMAC closure conditions.

## Current closeout status

Netlify Preview #1124 uses verified Stage Supabase and branch-only Redis V3 configuration, with deletion disabled. The earlier403/skip blocker is resolved. Current blocker is protected WS runtime V3 verification; see the current verification section above and research.md. Historical component smoke is not full deployed E2E.

## Current owner decision / verified Stage scope

Supersedes historical authorization below: isolated Stage schema/test/configuration and exact-SHA Preview deployment are authorized. Shared V2 reset and Production changes/activation, paid resources and merge are not. Free monthly headroom is an accepted risk, not a gate. Canonical migration `20261018184941_account_self_deletion_v2.sql` is applied only to verified Stage, with release=false and no Storage/reward/Redis cutover approvals. Real password/Auth/Postgres/Upstash components and positive-wallet BURN were tested; full deletion/Google/all-in/re-registration remains unverified. See [research.md](research.md) for exact evidence, findings, NOT TESTED matrix and owner decisions; [redis-cutover.md](redis-cutover.md) for protected reset scope. Local fixtures are not real Stage E2E proof.

# Data model — V2, proposed schema only

## Private deletion request

`account_deletion_requests`: request_id UUID PK, old_user_id unique UUID without Auth FK, status PENDING/PROCESSING/RETRY/ERROR/COMPLETED, phase, accepted_at, progress/completed times, next_attempt_at, wait reason/not_before, lease owner/generation/until, redacted error/incident. One UUID has one request; replay returns its real state. Store frozen per-table/financial receipts, required cleanup paths and cursors only. No email/password/JWT/OTP or wholesale profile snapshots. RLS/revoked client grants; no public UUID enumeration. No account_deletion_challenges table, verification receipt or custom proof token.

PENDING/preparing intent blocks SQL immediately; accepted_at requires Redis fence acknowledgement too. Original owner may query minimal status while Auth exists. A 24-hour read-only status capability after Auth removal is implemented with a stored SHA-256 hash and expiry; plaintext is returned only to the verified owner; never make status bearer a financial authority. Missing post-delete access must not prevent background recovery or falsely claim completion.

## Retired USER wallet

Keep chips_accounts id/type USER, entries, sequence and provenance. Add retired_user_id/retired_at; live USER has user_id and no retired fields/system_key. Retired USER has null user_id, retired UUID/time, status closed, balance zero and null system_key. Replace both ownership CHECKs consistently; keep live FK, no FK from retired UUID to Auth. Enforce monotonic retirement and prevent wallet recreation for old UUID. Retention/snapshot/archive proofs recognize historical USER identity without rewriting hashes or reclassifying SYSTEM. Campaign creator FKs must be scrubbed/SET NULL without destroying others' campaign data.

## Recognized reward identity

Private versioned HMAC verified-email identity, welcome paid count saturated at three, Daily family+UTC-day receipt, once campaign UUID receipt, historical source dedupe. No Auth cascade and no raw email. Lock identity/campaign and write ledger, proof and bonus_claims atomically; quota paid count independent of Auth cascade. Welcome no rolling 12-month reset or 24h cooldown; policy retention/legal/rotation determines actual recognizable horizon and is a release gate, not a lifetime-recognition promise. Daily rejects backdated payout after proof pruning; once campaign rename/pause/reopen retains identity. New UUID never inherits streak or permissions.

## Storage and cache

Preserve signed upload paths through all saved capability horizons and confirmed API-visible removal; the owner accepts invisible post-expiry in-flight completion risk for MVP, with no provider proof or arbitrary grace requirement. Five-minute finalize TTL is not upload capability expiry. Quiesce all legacy issuers before cutoff; prove bucket temporary-only before global orphan sweep, include records already lost. Known unfinished/uncertain writes, missing ownership/inventory and unconfirmed removal still block completion; an unknown theoretical post-expiry write alone does not. Existing request manifest holds only required paths. Redis permits/epoch guard every UUID-associated create/renew write including admin/sync/guest conversion and memory parity. Removal-only operations remain exact-target and do not remove fences.

Local-only initial schema proposal: `supabase/manual/1117-account-deletion-requests-v2.sql`; executed only in PGlite tests. No automatic migration or live schema has changed. Additional local-only wallet-retirement, reward-identities and avatar-tracking proposals accompany it. No canonical migration or live schema changes. Private reward config requires approved key/version/history; avatar cutover attestation is not auto-seeded. Read-only status token is not financial authority. Retired USER archive compatibility is prepared locally; Redis V3 is locally implemented and not switched; live cutover remains gated.

## Redis V3 owner contract (implemented locally, NOT switched)

Private prefix: `kcswh:<stage|prod>:xp:v3:user:<server UUID>:` with total, daily:<period>, session:<digest>, sync:<digest>, state:<digest>, server-session:<digest>, profile, hidden, ratelimit:<window>, lock:<digest>, conversion receipt. Anonymous keys use `...:anon:<sha256(anonId)>:` and cannot alias authenticated/deleted/retired UUIDs. Existing createXpLedgerKeys centralizes V3 formulas, including fixed kcswh:xp:user profile prefix. No raw session token/email in key.

Shared: environment-scoped leaderboard sets, IP limiter and lifecycle epoch/permits. Never DEL shared board/fence during user cleanup. Sessions/state keep the existing seven-day default with finite positive bounds; lock five seconds; user/IP rate window sixty seconds. Daily counter expiry must preserve current Warsaw daily cap and existing weekly reconciliation/projection horizon; do not change UTC CH bonus rules. Lifetime/profile and one account-scoped conversion receipt have explicit account-lifetime purpose and remain owner-addressable; no permanent unowned pair markers.

Current legacy data has not been reset; no new approval row is silently seeded. Completion proof must bind approved environment namespace/epoch/drained writers and verified legacy outcome. An operator assertion alone is not evidence that unknown hashes belong to a user.

### Latest Redis decision — 18 October 2026

Use one reviewed V3 per-environment contract and a controlled XP-only legacy reset, not historical XP migration. No dual-read/import from legacy after cutover. Use the existing single Upstash Free database with stage/prod namespaces; shared endpoint/credentials are explicitly accepted. No new database/account/instance/subscription or paid upgrade. Immutable build pins plus runtime configuration must reject cross-environment/downgrade errors; owner accepts combined Free-quota exhaustion risk; billing/monthly headroom is not a release gate. Keep T04d/T02f and financial retention unchanged. Detailed scope, drain, backup, rollback and GO/NO-GO are in [redis-cutover.md](redis-cutover.md); shared V2 reset and Production remain unauthorized; isolated Stage operations follow the current GO.

### Follow-up review: Free-only / immutable configuration / elapsed TTL

One existing Free database is the approved topology, with exact stage/prod namespaces and shared credentials. No provisioning/purchase/plan change. V3 cutover requires raising the committed per-environment minimum-version floor from 2 to 3 under separate GO, the generated artifact's immutable version/environment pins and complete matching runtime variables; deleting runtime variables cannot silently choose V2 or Production. Netlify, WS and background imports share the resolver. Legacy/unpinned artifacts remain supported only before the authorized cutover; all old issuers must then be retired. The reset manifest captures Redis TIME/expiry and content hash, not a future exact PTTL expectation: natural countdown/verified expiry is allowed, unknown absence/ownership-content/type/expiry-policy change is NO-GO, and the future executor must atomically check+mutate with current TTL preservation. Read-only Free usage evidence is incomplete (see research.md); this does not authorize a paid alternative. T04d/T02f, bonus proofs, all-in/BURN/Auth-last and release guards are unchanged.
