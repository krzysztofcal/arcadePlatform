## Current closeout status

Preview remains blocked by Netlify branch-env write HTTP403; shared V2 and skip marker unchanged. Real Stage RLS, password/official Auth cleanup and same-email Admin recreation verified, distinct from public signup/UI/full deletion. Storage tracking now has a separate pre-activation flag (default off); no schema/config/activation changes. See research.md latest closeout for actual PASS/failed retry/NOT TESTED evidence, legacy issuer constraints, retained bonus-history audit and minimal privacy/key policy.

## Current owner decision / verified Stage scope

Supersedes historical authorization below: isolated Stage schema/test/configuration and exact-SHA Preview deployment are authorized. Shared V2 reset and Production changes/activation, paid resources and merge are not. Free monthly headroom is an accepted risk, not a gate. Canonical migration `20261018184941_account_self_deletion_v2.sql` is applied only to verified Stage, with release=false and no Storage/reward/Redis cutover approvals. Real password/Auth/Postgres/Upstash components and positive-wallet BURN were tested; full deletion/Google/all-in/re-registration remains unverified. See [research.md](research.md) for exact evidence, findings, NOT TESTED matrix and owner decisions; [redis-cutover.md](redis-cutover.md) for protected reset scope. Local fixtures are not real Stage E2E proof.

# Verification — #1117 V2

## Scope

Use local/disposable test databases and memory adapters only. No destructive Stage, deployment, production mutation or automatic migration apply under this task. Keep PR DRAFT; modified Stage migration workflow skips drafts. Do not make ready/dispatch migration until separately authorized. Never use ordinary Preview/personal users as deletion fixtures. Historic OVH/OTP PoC is discontinued, no PASS gate or new mail infrastructure.

## Fundamental checks

1. Verified owner vs arbitrary target UUID, origin/content/body rejection, explicit confirmation; duplicate POST/lost response one request, status cannot enumerate users.
2. Persist SQL intent then Redis fence; delayed writer cannot recreate profile/XP/session/ranking; raw SETEX/ZADD, admin target, sync, guest conversion, Redis epoch restart and already-active WS delivery tested. No cross-store atomicity assertion.
3. Multi-table active/all-in side-pot Leave, normal showdown, opponent/escrow conservation, deferred settlement and final single BURN including late winnings; replay uses frozen original receipt.
4. Retirement satisfies both USER CHECKs, FK deletion, history/idempotency/archive proofs; no new posting to retired wallet or old UUID.
5. Existing tick advances no-table requests; crash/outage/lost successful BURN/Auth response, lease takeover/stale result, bounded retry and financial mismatch incident. No destructive step after unresolved financial inconsistency.
6. Signed upload issued before request/legacy lost row; late PUT before horizon, delayed final cleanup, no false COMPLETED; bucket/issuer cutover gate.
7. Same email/Google new UUID, clean resources/roles/streak; max three Welcome, one Daily per UTC day, one once per campaign; atomic rollback/replay and global quota survive cascade. Privacy retention/rotation approved before release.

Use existing Node test runner/PGlite, extend critical tests where available; no UI snapshot suite. Run npm run syntax and npm run check:csp-inline as appropriate. CI runtime validation is not deployment evidence. Record actual commands/results in PR and tasks, not mocks described as Stage success.

## Later Stage activation

Separate GO for disposable destructive fixtures/migration/deploy. Standard password and genuine Google owner-confirmation smoke before enabling. Exact runtime SHA WS Preview Deploy and smoke required for runtime changes. No requirement to prove old login OTP request binding, no admin nonce reading or provider forgery. Completion requires official Admin hard-delete successful/reconciled and prior obligations satisfied. Production always separate GO.

## Current local evidence and stop conditions

CI account-deletion-fundamentals runs the maintained Node/PGlite endpoint, request/recovery/private-send, Redis/XP, Storage, retirement/WS-buy-in, reward and Leave suites: 146 passed locally. No real Stage/Google/password deletion smoke or PostgreSQL multi-connection contention run. Legacy Vitest-only files cannot run with current declared dependencies; no framework was added.

Do not enable the runtime flag/release row before legacy Redis standardization/cutover are complete. Redis cleanup currently explicitly reports unproven legacy ownership and prevents Auth deletion. Do not override this as an operator shortcut. HMAC approval/history and avatar legacy cutover rows require independent reviewed evidence; proposals seed no such approval. Stop new acceptance via database release=false while preserving guards/recovery; never roll back to old unfenced writers after acceptance.

## Required Redis cutover gate

Read research.md inventory first: current Preview/Production Redis configuration is shared. Do not perform a Stage-only reset against it. No existing keys/values were copied, deleted or reset; no backup or drain was performed. Before writes, owner must approve target isolation, exact XP-only reset scope, owner/friend XP loss and XP-session rotation (Auth/profile preserved), protected backup/restore and the test plan.

Local V3 fixtures cover separate UUID/anonymous prefixes, raw/Lua indexing, wrong target, delayed writes, epoch restart, corrupt index, missing attestation and bounded cleanup/retry without SCAN. `tests/account-deletion.e2e.test.mjs` runs actual request/phase adapters, Poker Leave/showdown/main+side-pot/deferred cash-out, ledger BURN/retirement, Storage safety queries, real indexed local cleanup and official Auth HTTP adapter with lost-response reconciliation. Positive wallet 75 + main pot 200 burns exactly 275 once; another UUID and side pot remain intact. Only Redis memory and provider HTTP are local fixtures; this does not prove deployed Stage behavior or real Redis/PostgreSQL contention.

### Latest Redis decision — 18 October 2026

Use one reviewed V3 per-environment contract and a controlled XP-only legacy reset, not historical XP migration. No dual-read/import from legacy after cutover. Use the existing single Upstash Free database with stage/prod namespaces; shared endpoint/credentials are explicitly accepted. No new database/account/instance/subscription or paid upgrade. Immutable build pins plus runtime configuration must reject cross-environment/downgrade errors; owner accepts combined Free-quota exhaustion risk; billing/monthly headroom is not a release gate. Keep T04d/T02f and financial retention unchanged. Detailed scope, drain, backup, rollback and GO/NO-GO are in [redis-cutover.md](redis-cutover.md); shared V2 reset and Production remain unauthorized; isolated Stage operations follow the current GO.

## Local validation of this delivery

Run the existing account-deletion-fundamentals CI command from `.github/workflows/ci.yml`; it now includes `tests/xp-redis-v3.behavior.test.mjs` and `tests/account-deletion.e2e.test.mjs`. Focused reruns after index-corruption review: 8 V3/reset/session tests + 1 complete local flow passed. Existing core suite, syntax and CSP checks are also required. These tests never connect to configured Stage/Production: Redis is forced in memory, databases are local PGlite and provider HTTP is a fixture. The reset module is a pure allowlist/manifest planner, not a live reset command. Never turn a local attestation fixture into a live approval row.

### Follow-up review: Free-only / immutable configuration / elapsed TTL

One existing Free database is the approved topology, with exact stage/prod namespaces and shared credentials. No provisioning/purchase/plan change. V3 cutover requires raising the committed per-environment minimum-version floor from 2 to 3 under separate GO, the generated artifact's immutable version/environment pins and complete matching runtime variables; deleting runtime variables cannot silently choose V2 or Production. Netlify, WS and background imports share the resolver. Legacy/unpinned artifacts remain supported only before the authorized cutover; all old issuers must then be retired. The reset manifest captures Redis TIME/expiry and content hash, not a future exact PTTL expectation: natural countdown/verified expiry is allowed, unknown absence/ownership-content/type/expiry-policy change is NO-GO, and the future executor must atomically check+mutate with current TTL preservation. Read-only Free usage evidence is incomplete (see research.md); this does not authorize a paid alternative. T04d/T02f, bonus proofs, all-in/BURN/Auth-last and release guards are unchanged.

### P2: missing Redis credentials after V3 activation (2026-10-18)

Run `node --test tests/xp-redis-v3.behavior.test.mjs`: credential-failure fixture imports an isolated pinned V3 artifact with missing URL/token/blank URL; Redis reads/writes/limiter reject and XP endpoints return 503 without network access. It also checks explicit test memory and pre-cutover V2 compatibility. Before real Stage tests obtain separate GO for exact-SHA deployment/configuration/migrations as needed; use isolated fixtures and verify Poker/CH continue during XP unavailability. Local fixtures are not Stage evidence.
