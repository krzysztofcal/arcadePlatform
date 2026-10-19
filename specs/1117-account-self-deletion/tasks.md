## Current verification — 19 October 2026

Owner authorizes Stage/Preview deployment and disposable funded Poker/deletion tests after positive isolation preflight. Production, shared V2 reset, paid resources and merge remain forbidden. Main now contains #1125 and #1126; their workflow/ESCROW guard changes are integrated without reverting either Stage migration. Successful main Stage automation runs are observable (e.g.39221672570); this agent only read their results.

WS Preview is still runtime f771972b with generated context unknown/null V3 pins. The existing root-owned environment checker returns PASS for its old Stage checks, but does not inspect Redis. Its root0600 environment is not readable/editable by the agent; permitted sudo covers only the fixed checker and restart. Thus required runtime Redis V3/credential identity is unverified: **NO-GO for deploy**. The existing checker now has a reviewed V3-aware implementation and a fundamental executable regression; operator must install it and configure matching Stage V3 using existing credentials before the agent can prove preflight. Require explicit `PASS Redis V3 stage kcswh:stage:xp:v3`, then dispatch the main-defined WS workflow with exact PR runtime SHA and xpRedisVersion3. No feature/cutover marker is inferred from this configuration.

Read-only Stage: deletion release=false, redis_cutover empty, avatar markers0, reward configs0, deletion requests0. Full frontend/Poker/deletion tests on the new WS remain BLOCKED, not PASS. Prior local/actual Stage component results retain their original scope. See research.md for the current evidence and Storage/HMAC closure conditions.

## Current owner authorization (supersedes historical restrictions below)

Stage-only schema/configuration/exact-SHA Preview deployment and integration tests on new disposable fixtures are authorized after verified isolation. Production, shared V2 reset, paid resources and merge remain unauthorized. One existing Free database with stage/prod namespaces; monthly quota/headroom is an accepted risk, not GO/NO-GO. T02d includes one forward-only canonical migration assembled from reviewed proposals, additive classification in the existing inventory/guard (no historical hashes changed), transactional Stage preflight and explicit Stage application while release remains false. T05d4 can verify isolated V3 components but must not attest shared legacy reset or drain without evidence.

# Tasks — #1117 V2

Implementation GO granted in current conversation; destructive Stage/Production/deployment/merge excluded. Supersedes V1 T001–T022 and blocked OTP PoC gates. Only fundamental backend/SQL/WS tests. No generic tooling/dependency cleanup. Keep incomplete items unchecked.

- [x] T01a Synchronize all seven SpecKit artifacts with approved issue V2; remove custom OTP/challenge/receipt and old PoC PASS requirements; preserve ledger/bonus/retention/Storage/writer safety.
- [x] T01b Refresh scoped catalog FK/policies evidence read-only; review exact writer/Storage/WS dependencies. Before migration-bearing Draft PR add draft guard to .github/workflows/db-stage-apply-pr.yml; no intended shared Stage apply.
- [x] T02a Add local-only durable request schema proposal at supabase/manual/1117-account-deletion-requests-v2.sql and shared/account-deletion.mjs request/status/phase/lease foundation with one request/UUID; local PGlite duplicate/ownership/no-table/lease/error tests. Official Auth adapter requires authorized intent and exact-UUID reconciliation. This is not a complete finalizer or canonical applied migration.
- [x] T02d Durable intents/adapters and canonical migration/inventory prepared and applied atomically only to verified Stage. Pruner ACL restoration and real driver JSON encoding fixed/verified. Production equivalence/application still separate; acceptance remains false.
- [x] T02b Integrate netlify/functions/account-delete.mjs POST/GET with verified Supabase owner, strict origin/body/consent and idempotency. Do not activate acceptance until T02c/T04/T05/T06 complete.
- [ ] T02c Integrate ACTIVE guards at SQL effects and RLS, ws-mint-token/WS auth/private sends and active sockets, CH/bonus/XP/profile APIs, store-upstash raw+Lua writes including admin/sync/guest conversion. Durable preparing then confirmed Redis fence; no PG+Redis atomicity claim. Fundamental delayed writer/restart/active socket tests.
- [x] T03 Update account.html, js/account-page.js, js/i18n.js (existing auth client suffices; no client auth rewrite) with explicit owner confirmation and real pending/completed/intervention status. Optional supported isolated password/Google login, no custom OTP. Real Stage smoke separately authorized before activation; no UI snapshot tests.
- [ ] T04a Reuse Poker Leave/settlement for all tables/unresolved hand participants, preserve all-in showdown/side-pot; fundamental multi-table/conservation/deferred-restart tests.
- [ ] T04b Final canonical single balanced BURN including positive balance/winnings, freeze idempotency receipt; retired USER and both CHECKs/FK/history/archive proof compatibility, no old wallet recreation. Fundamental financial replay/late credit/mismatch tests.
- [ ] T05a Existing profile/avatar/Storage/XP/cache cleanup with signed capability tracking and legacy cutover gate; prevent late resurrection, preserve audit history. Exact owner Auth hard-delete last via official API; not-found reconciliation after lost response.
- [ ] T05b Existing WS tick/startup advances all/no-table durable requests, bounded lease/backoff/operator incident; financial mismatch halts destructive steps. Fundamental outage/restart/stale worker/lost BURN/Auth response tests.
- [ ] T06 Private common HMAC recognized email proof: three paid Welcome/no cooldown, Daily identity UTC day, once identity campaign, global quota independent of cascade; atomically ledger+proof+bonus_claims. New UUID/streak independent. Fundamental concurrency/rollback/re-registration tests; privacy/legal/retention/rotation remains release gate.
- [ ] T07a Run appropriate local and CI syntax/CSP/fundamental suites and deep cross-domain review; record actual outcomes/remaining work, prepare Draft PR, disclose breaking effects. No destructive shared-environment tests.
- [ ] T07b Separate authorized Stage migration/fixtures, genuine password/Google smoke, exact-SHA WS Preview Deploy and smoke, privacy/legal approval, then separate Production GO. Stage/Preview-only execution is authorized after isolation; Production and merge remain separately gated.

Dependencies: T01 before code; T02a before endpoint/fences/finalizer. T02c and T04/T05/T06 before feature activation/T03 user exposure. T07a is code review evidence, not T07b release evidence. No new automatic migration is intended in this continuation; previously authorized Stage migrations are already applied.

## Historical delivery milestones (current Stage outcomes below supersede restrictions)

Second preparation milestone implements endpoint/UI, read-only status capability, SQL/Redis fences on identified paths, WS auth/private enqueue, existing-tick phase adapters, wallet BURN/retirement, reward HMAC and Storage tracking/cleanup proposals. Feature is OFF by default: runtime flag plus a separate database release row (default false) govern new requests. No schema has been applied and no deployment performed. The full local fixture now completes. Operational integration/release evidence is unfinished; this Draft is not merge-ready.

- [x] T02e Local endpoint tests: consent/origin/owner/replay/gates; bounded status token after Auth deletion; private WS enqueue checks lifecycle inside enqueue transaction.
- [x] T04c Backend and separate WS buy-in ledger guards; positive/zero/absent-wallet retirement, canonical BURN receipt/replay, retired USER historical lookup and scoped deferred cash-out. Existing all-in reducer/domain tests retained.
- [x] T05c Concrete existing WS tick adapters and no-table recovery; exact-target official Auth reconciliation; avatar manifests/capability wait and legacy cutover rejection; guarded Redis raw/Lua and guest conversion writes.
- [x] T06a Atomic private reward identity/paid proof/campaign totals integrated; unapproved HMAC key/version/history fails closed. No annual welcome reset.
- [x] T02f Current supported writer inventory and effect guards completed locally; see writer-audit.md. Includes raw UUID rate limiter, privileged owned-row triggers, initiating admin actor, gift recipient, new-hand start, WS binding/resume and session/replay purge. SQL proposal apply, real PostgreSQL contention and deployed runtime smoke remain separate gates. Arbitrary future owner-level SQL must use lifecycle guards.
- [x] T04d Retired USER archive/pruning compatibility: forward-only local SQL proposal preserves effective #981 pruner and changes only closed-human ownership/status predicate; exporter resolves historical owner and supports pre-retirement schemas. Positive BURN/replay, exact production export shape and unchanged prune definition outside narrow patch covered locally. Applying schema and real archive/prune smoke remain separate GO.
- [x] T05d Code/local preparation: Redis V3 owner standard, controlled XP-only reset plan and complete local-flow fixture. Live cutover is NOT complete: T05d4 remains unchecked. Legacy cleanup and V3 without attestation stay fail-closed; no full-SCAN runtime workaround.
- [x] T05d0 Read-only configured-target inventory: SCAN/TYPE/PTTL aggregates, no values/writes. Netlify all-context Stage/Production share endpoint+namespace; 571 keys, including 359 opaque migration markers without TTL. This is one shared dataset, not independent environment proof.
- [x] T05d1 Owner selected historical XP-only reset over migration, including owner/friend XP; single existing Free database with distinct stage/prod namespaces (later owner decision supersedes the second-database preference). No provisioning or purchase. Monthly headroom is accepted risk; shared V2 backup/reset still requires separate GO. Isolated Stage configuration is now authorized.
- [x] T05d2 Implement environment-versioned UUID private generators across xp-ledger/store-upstash/xp-identity/leaderboard/start-session/calculate-xp/admin; finite transient TTL, distinct anonymous owner prefix, environment-scoped infrastructure. No new framework or permanent dual-read path.
- [x] T05d3 Implement/verify local XP-only reset allowlist, preservation of mixed/non-XP data and cutover/drain proof; then owner-prefix cleanup with final empty verification, preserving other UUID/shared boards/fences. Full end-to-end local fixtures with positive wallet and all-in; no unconditional cleanup stub.
- [ ] T05d4 Separate GO for target-specific live backup/XP reset/configuration/Stage WS preview; Production separate. Current runtime remains unchanged and deletion disabled.
- [ ] T05e Reconcile old upload issuers/unknown paths/uncertain signing, prove bucket scope and install reviewed cutover marker only after attestation; real provider in-flight bounds remain operator evidence.
- [ ] T06b Approve retention/legal/LIA/rights and HMAC rotation bridge; reconcile historical payouts/global quotas before history_ready. Wrong key/version must never silently reset recognition.

Earlier milestone: 137 fundamental tests passed with green CI at 325d0f72. Current V3/full-flow suite and core CI results are recorded below after verification. This is local evidence, not real PostgreSQL/Redis contention, provider integration or Stage smoke. T07b Stage-only verification is now authorized but incomplete; T02d/T05d4/T05e/T06b remain release gates.

T05d verification explicitly extends `.github/workflows/ci.yml` account-deletion-fundamentals with the V3/reset and complete local-flow fixture tests. No dependencies, new workflow or live jobs.

### 18 October V3 delivery evidence

146/146 local CI-equivalent fundamentals passed. Final focused review rerun: 8/8 V3/reset/session tests and 1/1 full all-in/positive-wallet deletion flow passed, including main/side-pot eligibility, one cash-out/BURN and response-loss Auth reconciliation. CSP guard: 55 documents; syntax: 228 files. Existing core suite/remote CI results are reported in PR #1124. T05d0–T05d3 are local preparation; T05d4 (live config/drain/reset/attestation) is deliberately not done. No automatic live reset runner is shipped.

Local existing `npm test` completed successfully. `npm run ci:guards`, syntax/CSP and canonical migration validation passed (111 sealed migrations / 9 Production replacements). Optional broad `check:all` reports five pre-existing badge-anchor omissions in unchanged design mockups; required `ci:guards` checks the served scope and passes. No unrelated mockup edits were made.

Remote CI exposed an existing Playwright backend-fixture loader using `e2e:*` without forced-memory XP_TEST_MODE. The loader now explicitly selects the existing memory test mode; V3 environment validation is unchanged. These are the two existing backend award scenarios, not new UI tests.

## Owner review follow-up: single Free database (18 October)

- [x] F1 Fail-closed V3: extend existing generated deploy-context and scripts/generate-build-info.js with immutable version/environment pin plus committed per-environment activation floor (still 2/2 until separate GO); strict resolver rejects missing/conflicting runtime config after cutover. Existing WS Docker/manual artifact packaging must include the resolver dependency and pinned generated context. No workflow dispatch/configuration change. Fundamental runtime/build/artifact tests only.
- [x] F2 Reset manifest expiry: capture Redis observation time, compare type/value and elapsed expiration deadline with bounded clock tolerance; persistent↔expiring/renewed/uncertain changes deny, natural expiry skips only as absent. Future executor must perform final check+effect atomically and preserve current TTL on mixed records. No live executor/reset.
- [x] F3 Free-only audit: one current Upstash database, exact stage/prod namespaces, no provisioning/purchase/subscription. INFO stats/memory + DBSIZE read-only aggregate metrics and public primary documentation; distinguish actual monthly quota unavailable from observed cumulative counters. Record combined environment command budget, Lua/index costs and no-cost optimizations without weakening fences.

Follow-up local evidence: 150/150 CI-equivalent fundamentals passed, including the retained full all-in/positive-wallet/BURN/Auth flow; 39 focused V3/config/reset/artifact/dependency guards passed. CSP 55 served documents, required ci:guards and canonical migration validation (111/9) passed. F3 is an audit completion, not a capacity PASS: monthly Free quota/headroom and reliable storage usage remain unverified. Pin configuration, build/package/deploy, reset, live schema and activation all require separate GO. No new resources, dependencies or live changes.

### P2: missing Redis credentials after V3 activation (2026-10-18)

- [x] P2 credential failure: deny V3 Redis reads/writes/rate limits without URL/token; return 503 from XP HTTP paths; preserve V2/test memory and Poker/CH isolation. Fundamental configuration regression: missing URL/token/blank URL, real module imports, no network, HTTP 503, V2/test compatibility. Existing TTL tests retained.
- [ ] Operational gates remain: approve allowlisted reset, authorize exact-SHA Stage deployment and real integration smoke; no live action performed.

## Current real-service task outcomes

- [x] Stage identity/isolation preflight, canonical schema apply/history/hash, release false, real password Auth fixtures and official cleanup.
- [x] Real Upstash readonly Lua fix; real driver JSON phase/retirement fix; positive 75 CH canonical BURN once/retired USER; control UUID preserved in owner-index component teardown.
- [ ] T05d4 full cutover: shared V2 reset/drain remains unauthorized; no false attestation or done:true. Isolated V3 component verification completed.
- [ ] T05e: correct bucket configuration/current inventory verified; old issuer drain, signed capabilities/uncertain paths and expiry evidence still missing.
- [ ] T06b: surviving-history aggregates verified; archived/deleted coverage, legal/LIA/rights/privacy and rotation continuity remain unapproved. history_ready not seeded.
- [ ] T07b: partial real services verified; live all-in deletion, Google, public re-registration, frontend-to-COMPLETED and actual Redis/VPS restart not verified. Exact-SHA Preview deploy/CI evidence recorded after workflow completion.

- [x] T02d follow-up: additional forward-only exact USER-trigger compatibility for existing escrow retirement, applied on Stage without editing old migration hashes. Existing unknown-dependency tests retained; real-driver deletion receipt regression added to existing PostgreSQL CI.
- [x] WS exact-runtime SHA f771972b Preview deployment succeeded (run 39156649252); basic health/helloAck only. Authenticated frontend/Poker/delete smoke remains NOT TESTED; current main packaging lacks PR's new activation dependencies.

## Current continuation outcomes

- [x] Preview preflight and skip cause identified; branch-only configuration attempted and denied HTTP403; prior values/scopes verified unchanged. Skip intentionally retained, no unsafe deployment.
- [x] Independent real Stage RLS/favorites/positive-CH/profile/control tests and same-email Admin recreation/password login; three identities cleaned. Public registration/UI and live Poker deletion remain NOT TESTED. Initial financial RETRY recovered by a scoped operator retry, not proof of automatic recovery.
- [x] T05e engineering: independent pre-activation avatar tracking flag + previous-path manifests + fundamental retention test; no flag applied.
- [ ] T05e operational: old issuers/cleanup still reachable; no full inventory/drain/expiry proof or marker.
- [x] T06b scoped retained history audit: 8 Welcome/18 Promo match registry/replays; archived reward batch unpruned. Minimum rights/retention/key-continuity plan documented.
- [ ] T06b approval/coverage: historical verified-email-at-payout and legal/LIA/privacy decisions unresolved; history_ready remains false.
- [ ] T05d4 coordinated V2 retirement/backup/reset/attestation; final ordered plan below redis-cutover.md, no live reset.
- [ ] T07b full E2E/Google/live all-in/provider expiry/restart proof and working Preview.

- [ ] Owner/security review: agent temporary Netlify snapshot had local0664 permissions and included Production contexts; removed, never published. Access by another local actor cannot be excluded. Any shared/Production credential rotation requires separate GO; see research.md incident.


## Current continuation — Preview and automatic recovery

- [x] Netlify403 diagnosed: paid granular scopes, resolved with default all scopes and branch-only values. Stage Supabase verified; other contexts retain V2. Stage floor3/Production2; skip removed; actual Preview and password UI smoke PASS.
- [x] BURN automatic Stage recovery: real own-wallet row-lock timeout at5s, durable30s retry, coordinator reconstruction, committed-response loss and receipt replay; exactly one75CH BURN, retired USER, no operator retry/timeout increase. Redacted SQLSTATE/duration diagnostic added. Shared WS service recovery is not yet verified.
- [x] Dedicated workflow-only Draft #1125 prepared from main, with exact-runtime SHA packaging/config generation and explicit Stage Redis version input. Owner merge required before main-defined dispatch; no branch-definition bypass.
- [x] Disposable Stage identities/sessions and exact Redis fixture resources removed; financial history retained. Password UI created an empty control wallet, retired canonically before Auth deletion.
- [ ] T05e remains operationally blocked by legacy issuers/old cleanup retirement and actual expiry/ownership proof; technical code audited, no false marker.
- [ ] T06b remains blocked by unprovable historical verified-email-at-payout coverage and owner legal/LIA/privacy/key-continuity decisions; no fabricated proofs/history_ready.
- [ ] T07b full frontend-to-COMPLETED, real all-in deletion and authenticated Google remain NOT TESTED. Shared WS exact-SHA redeploy awaits workflow integration and matching protected Stage runtime configuration.

## Current continuation checklist (19 October)

- [x] Integrate main #1125/#1126; preserve both conflict sides/evidence, exact ESCROW guard/tests and immutable migrations. Only research.md conflicted.
- [x] Existing protected-env checker gains pinned Stage/V3 validation and explicit nonsecret V3/legacy result; fundamental regression covers complete configuration, missing fields, foreign namespace/project, test mode and Production context.
- [ ] Operator installs reviewed checker and updates root0600 Stage Preview environment; no restart until exact artifact is ready. No sudo/environment permission bypass.
- [ ] Positive actual V3 preflight, then main-defined exact-SHA WS deploy, browser auth/JOIN/game/Poker/all-in/deletion/recovery fixtures and truthful cleanup evidence.
- [x] Refresh bounded Storage catalog/issuer and hot/archive reward audits read-only; no object/identity/financial mutation.
- [ ] T05e actual issuer+cleanup drain, complete ownership reconciliation and capability/in-flight expiry proof. No cutover marker.
- [ ] T06b authoritative historic verified-email reconciliation and owner legal/LIA/privacy/retention decision. No history_ready approval or key reset.
