## Current verified Stage checkpoint — 19 October 2026, financial GO completed

Deployed WS Preview runtime remains **d0cca7f5595637a215b61a6104abcbd69fd22ae9**, workflow run39251488130, main-defined V3 LIVE/deploy-context/exact-SHA gates intact. Operator config remains Stage/deploy-preview/3/stage with kcswh:stage:xp:v3; actual LIVE PASS epochPresent0 is NOT cutover attestation. Deletion flag0 and database releasefalse were verified; no configuration, epoch or approval marker changed. Current task now stops for owner review: no further Stage/financial/destructive operations, restart, deployment, Production change or merge.

Real financial GO used exactly three NEW disposable Stage identities, canonical postTransaction MINT funding and real Chromium→WS commands. Funded JOIN/replay/lost JOIN response+reconnect, all-in/showdown/side-pot eligibility, cash-out/LEAVE, automatic deferred finalization and scoped UUID/idempotency checks passed. Two fixture tables CLOSED, both escrows0, active seats0, fixture Auth sessions0. All22 actual transactions balanced with unique keys and matching registry rows; no BURN/Auth delete. USER A/B/C final200/400/600CH; scoped SYSTEM deltas GENESIS−1500 and POKER_BOT_BANKROLL_100+300 preserve totalCH. Three Auth/profile identities and their remaining balances are deliberately retained because destructive account cleanup is forbidden. See research.md for receipts, limits and exact outcomes.

T07b is PARTIAL: real funded Poker covered, not full account-deletion readiness. Full deletion/COMPLETED/re-registration/Google, real provider/storage failure and shared restart/fault tests remain unverified. T05e Storage, T06b HMAC/history/legal and Redis cutover remain OPEN; do not activate deletion or manufacture approvals. Positive-human-winner cash-out and a lost positive-cash-out response were not separately forced; observed showdown winner was a canonical bot, and positive USER cash-outs were100CH each in the first scenario. Historical milestones below retain their original scopes; this checkpoint supersedes earlier authorization/status paragraphs.

# Verification — #1117 V2

## Scope

Use local/disposable fixtures for fundamental tests. Current owner GO additionally permits isolated Stage/Preview deployment and disposable funded integration tests after the positive preflight above. No Production mutation, shared V2 reset or activation through forged gates. Keep PR DRAFT; no new migration/apply is needed in this continuation. Never use ordinary Preview/personal users as deletion fixtures. Historic OVH/OTP PoC is discontinued, no PASS gate or new mail infrastructure.

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

### Before current WS Preview smoke

After the administrative procedure review and separate execution GO, require both reviewed CONFIG and actual LIVE verification; neither the earlier PASS string nor CONFIG ONLY is sufficient. Verify protected Stage env and generated artifact pins3/stage/deploy-preview, exact runtime SHA and service target. Dispatch only main workflow, input ref equal exact SHA and xpRedisVersion3; compare installed release metadata and context after success. Do not activate deletion to manufacture an E2E result. Use fresh disposable identities, canonical funding/ledger receipts and known-owner teardown only after that proof. Preserve the original HMAC and all financial history; never clear shared V2 or seed approval markers for smoke.

### Administrative procedure review handoff

Review infra/vps/ws-preview-v3-procedure.md for the exact protected-bundle hashes, filesystem effects, single ROOT-shell FIFO command and separate rollback. Do not use the removed /tmp command. Do not run now: the service-owned parent is a known NO-GO and execution needs separate GO. Resolve the protected-directory decision without blindly breaking WS deployment. After approved apply, only actual PASS LIVE with approved endpoint/credential provenance plus exact artifact pins can resume deployment; CONFIG ONLY or mock results cannot.

## Next-GO real Stage verification matrix — PLAN ONLY

Do not execute this matrix in the current integration task. First obtain explicit GO for main-defined WS Preview deployment/restart; funded/destructive scenarios need explicit disposable-Stage-fixture GO. Do not activate deletion, alter existing VPS config, reset V2, seed epoch/cutover/history/Storage approvals, rotate shared credentials or touch Production to make a scenario pass. Re-run read-only LIVE immediately before dispatch; epochPresent0 is allowed for authenticated configuration verification but does NOT allow deletion cleanup completion.

Planned dispatch parameters (not executed): workflow ws-preview-deploy.yml, workflow ref main, input ref equal the final full pushed #1124 SHA reported in the PR, input xpRedisVersion3. Never use a PR-defined workflow or moving feature branch as runtime ref. Verify the successful run's selected SHA, installed release-metadata releaseSha/ref/environment preview, both generated context copies deploy-preview/3/stage, Stage project and namespace, local/public health and authenticated browser↔WS communication. Present f771972b/unknown/null is the old runtime; it cannot count as evidence for the candidate. A failed gate means stop that scenario, not manual rsync/restart or weaker checks.

Use at most three NEW isolated Stage test players for a genuine unequal-stack main/side-pot (one short all-in, two deeper stacks). Keep a UUID/table/request/ledger-transaction receipt inventory privately; no email/password/token/OTP in GitHub. Use existing Auth clients, Poker HTTP/WS contracts, ledger helpers and fixture tooling; no new service/framework or direct balance edits. Normal password login/re-registration uses fresh disposable identities; Google is NOT TESTED unless a dedicated authorized real OAuth identity exists. Ordinary Preview/personal users are never fixtures. Funding must use the approved canonical test funding path and receipts under the next GO; no existing user's funds, bonus-history fabrication or bonus farming.

| Scenario | Required action after GO | Pass evidence / stop condition |
| --- | --- | --- |
| Exact-SHA browser/WS JOIN | Login disposable players against Stage, connect browser to WS Preview, create/join a fixture-only table. | Exact release/context/host; authenticated JOIN/state, no cross-environment request. Stop on foreign project/namespace or old runtime. |
| All-in / showdown / side-pot | Three fixture players, unequal canonical funded stacks; short player all-in, two deeper players contest side-pot, finish real hand. | All-in is never auto-folded; main/side-pot eligibility, full chip conservation, one settlement and identical replayed state/receipts. |
| Leave / cash-out | Leave one ordinary participant and separately the all-in participant; settle obligations before final cash-out. | Leave cannot steal pending showdown entitlement; one cash-out, no duplicate wallet/escrow effect, other players unchanged. |
| Deletion with/without active hand | Exercise normal owner UI/API on a fresh funded fixture, plus a no-table fixture, ONLY after actual lifecycle/Storage/HMAC/cutover gates and separate Stage activation GO. | Until then acceptance-disabled rejection may be checked under test GO; full E2E is BLOCKED/NOT TESTED. After legitimate activation: DELETING fence, internal settlement allowed, old JWT/socket/JOIN denied, winnings included in one balanced BURN, retired USER/history preserved, Auth hard-delete last and only after safe cleanup. |
| Retry / response loss / recovery | Use existing request/tick paths; drop only fixture client responses/disconnect its socket, then observe automatic recovery without manual financial retry. | Durable same request/transaction IDs, no double cash-out/BURN, automatic progress or correct blocking incident. A shared service restart or fault injection requires its own explicit scope; do not interrupt other users. |
| Redis V3 cleanup / XP failure | Verify fixture UUID index/private keys and unaffected second UUID; probe only Stage V3 paths with existing helpers. Keep fault simulation local/client-isolated; no shared-provider outage or credential/config change. | Correct bounded UUID cleanup, retry safety and no resurrection; second account/namespace intact, XP failure does not halt Poker/CH. Missing epoch/cutover prevents final cleanup/completion: report BLOCKED, never force done:true. |
| Password re-registration / RLS / history | After legitimate full deletion, register same disposable email again; use owner/other-player sessions for profile/favorites/Poker/CH reads. | New UUID, no inherited private data/wallet, correct RLS; ledger/idempotency/retention intact. Do not claim anti-farming history continuity without T06b evidence; Google remains separately gated. |

Record actual PASS/FAIL/BLOCKED/NOT TESTED per row, exact deployed SHA and sanitized run/transaction references. Health/green CI/fixture mocks are not Stage E2E proof. For recovery, bound the observation window using configured retry/lease behavior and record reason if it stalls; never manually approve unresolved financial mismatches.

Teardown after the next approved tests: finish all fixture hands, leave/cash-out via canonical paths, reconcile ledger/escrow/idempotency, then remove only proven-owned objects/private UUID data and test Auth identities when the lifecycle allows it. Preserve required financial history/receipts. If deletion/Storage/HMAC/cutover gates prevent safe finalization, keep the fixture resources tracked and report the exact residue rather than bypass Auth-last or delete unknown objects. No broad cleanup, no V2 reset or non-fixture mutation.

Remaining activation gates: T05e complete legacy issuer AND cleanup retirement/drain, proven object ownership and at least7200s plus reviewed grace/in-flight bounds before tracking/cutover; T06b authoritative historical payout/email mapping, stable key/version/rotation continuity and owner/legal LIA/retention/privacy/rights approval; T07b exact-SHA deployed runtime plus this actual-service matrix. Current verified LIVE configuration closes none of these gates.
