## Current verified Stage checkpoint — 19 October 2026, financial GO completed

Deployed WS Preview runtime remains **d0cca7f5595637a215b61a6104abcbd69fd22ae9**, workflow run39251488130, main-defined V3 LIVE/deploy-context/exact-SHA gates intact. Operator config remains Stage/deploy-preview/3/stage with kcswh:stage:xp:v3; actual LIVE PASS epochPresent0 is NOT cutover attestation. Deletion flag0 and database releasefalse were verified; no configuration, epoch or approval marker changed. Current task now stops for owner review: no further Stage/financial/destructive operations, restart, deployment, Production change or merge.

Real financial GO used exactly three NEW disposable Stage identities, canonical postTransaction MINT funding and real Chromium→WS commands. Funded JOIN/replay/lost JOIN response+reconnect, all-in/showdown/side-pot eligibility, cash-out/LEAVE, automatic deferred finalization and scoped UUID/idempotency checks passed. Two fixture tables CLOSED, both escrows0, active seats0, fixture Auth sessions0. All22 actual transactions balanced with unique keys and matching registry rows; no BURN/Auth delete. USER A/B/C final200/400/600CH; scoped SYSTEM deltas GENESIS−1500 and POKER_BOT_BANKROLL_100+300 preserve totalCH. Three Auth/profile identities and their remaining balances are deliberately retained because destructive account cleanup is forbidden. See research.md for receipts, limits and exact outcomes.

T07b is PARTIAL: real funded Poker covered, not full account-deletion readiness. Full deletion/COMPLETED/re-registration/Google, real provider/storage failure and shared restart/fault tests remain unverified. T05e Storage, T06b HMAC/history/legal and Redis cutover remain OPEN; do not activate deletion or manufacture approvals. Positive-human-winner cash-out and a lost positive-cash-out response were not separately forced; observed showdown winner was a canonical bot, and positive USER cash-outs were100CH each in the first scenario. Historical milestones below retain their original scopes; this checkpoint supersedes earlier authorization/status paragraphs.

# Tasks — #1117 V2

Implementation GO granted in current conversation; destructive Stage/Production/deployment/merge excluded. Supersedes V1 T001–T022 and blocked OTP PoC gates. Only fundamental backend/SQL/WS tests. No generic tooling/dependency cleanup. Keep incomplete items unchecked.

- [x] T01a Synchronize all seven SpecKit artifacts with approved issue V2; remove custom OTP/challenge/receipt and old PoC PASS requirements; preserve ledger/bonus/retention/Storage/writer safety.
- [x] T01b Refresh scoped catalog FK/policies evidence read-only; review exact writer/Storage/WS dependencies. Before migration-bearing Draft PR add draft guard to .github/workflows/db-stage-apply-pr.yml; no intended shared Stage apply.
- [x] T02a Add local-only durable request schema proposal at supabase/manual/1117-account-deletion-requests-v2.sql and shared/account-deletion.mjs request/status/phase/lease foundation with one request/UUID; local PGlite duplicate/ownership/no-table/lease/error tests. Official Auth adapter requires authorized intent and exact-UUID reconciliation. This is not a complete finalizer or canonical applied migration.
- [x] T02d Durable intents/adapters and canonical migration/inventory prepared and applied atomically only to verified Stage. Pruner ACL restoration and real driver JSON encoding fixed/verified. Production equivalence/application still separate; acceptance remains false.
- [x] T02b Integrate netlify/functions/account-delete.mjs POST/GET with verified Supabase owner, strict origin/body/consent and idempotency. Do not activate acceptance until T02c/T04/T05/T06 complete.
- [ ] T02c Integrate ACTIVE guards at SQL effects and RLS, ws-mint-token/WS auth/private sends and active sockets, CH/bonus/XP/profile APIs, store-upstash raw+Lua writes including admin/sync/guest conversion. Durable preparing then confirmed Redis fence; no PG+Redis atomicity claim. Fundamental delayed writer/restart/active socket tests.
- [x] T03 Update account.html, js/account-page.js, js/i18n.js (existing auth client suffices; no client auth rewrite) with explicit owner confirmation and durable-receipt acknowledgement plus sign-out; pending/completed/intervention presentation and watchDeletion polling are superseded. Optional supported isolated password/Google login, no custom OTP. Real Stage smoke separately authorized before activation; no UI snapshot tests.
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
- [x] Operator prepared protected base/bundle/root0600 Stage env; independently verified hashes and actual LIVE PASS. No agent config rewrite or restart.
- [ ] Positive actual V3 preflight, then main-defined exact-SHA WS deploy, browser auth/JOIN/game/Poker/all-in/deletion/recovery fixtures and truthful cleanup evidence.
- [x] Refresh bounded Storage catalog/issuer and hot/archive reward audits read-only; no object/identity/financial mutation.
- [ ] T05e actual issuer+cleanup drain, complete ownership reconciliation and capability/in-flight expiry proof. No cutover marker.
- [ ] T06b authoritative historic verified-email reconciliation and owner legal/LIA/privacy/retention decision. No history_ready approval or key reset.

## Administrative procedure review checklist

- [x] Replace unsafe /tmp procedure with reviewed repository script, protected-bundle requirement and explicit file allowlist; remove old script/private fragment.
- [x] Strict descriptor/parent/root-mode/single-link checks, fixed Stage settings/deletion0, immutable two-file backup, bounded lock, fsync/rename, resumable apply and rollback, changed-input/target/corrupt-backup NO-GO.
- [x] Existing Stage Netlify source verified read-only via a pipe; no credential value printed/persisted, no Production context exported or Redis operation performed.
- [x] CONFIG-only preflight no longer claims live proof. Separate LIVE mode tests only PING+exact Stage EXISTS with redirect/error/redaction/config-change checks; only mocked tests run.
- [x] Owner approved procedure and operator preparation; current metadata/hashes and LIVE result independently verified.
- [ ] Actual root apply, LIVE proof, then resumed main-defined exact-SHA WS deployment and funded fixtures. NOT RUN in this preparation.

### Administrative review correction tasks
- [x] Audit actual Preview parent, ACLs, intermediates, five roots and copilot access; preserve Phase A model.
- [x] Prepare guarded nonrecursive base-owner correction and explicit unsafe-legacy rollback instructions.
- [x] Enforce V3 LIVE via existing exact no-argument sudo helper; independent workflow gate and both generated contexts; fundamental positive/NO-GO fixtures.
- [x] Owner merged workflow-only #1127 into main fb12d182; integrated here, shared workflow/tests retained once.
- [x] Operator parent/bundle/config preparation and LIVE proof obtained.
- [ ] Next owner GO: main-defined final exact-SHA deployment, runtime smoke and isolated Stage integration; not authorized/executed in this continuation.

## Main integration / pre-deployment review
- [x] Integrate main #1127; resolve only workflow-test conflict, preserve one copy of each main gate/context test plus the two helper-specific fixtures. Workflow identical to merged main; no runtime change.
- [x] Repeat actual read-only LIVE preflight; epoch0 remains NOT a cutover attestation. No protected configuration changed.
- [x] Prepare bounded Stage matrix in quickstart with explicit next-GO prerequisites and full-E2E blockers.
- [ ] Exact-SHA WS Preview Deploy and runtime/browser evidence after next GO. No restart/dispatch in this review.

## Isolated financial Stage GO outcome — 19 October
- [x] Repeat exact-SHA/Stage/V3/LIVE/releasefalse and no-human-seat preflight; use3 NEW isolated fixture users only.
- [x] Canonical funding/replay, actual Chromium WS funded JOIN, lost-response reconnect/replay, real unequal-stack all-in/showdown/side-pot and escrow conservation.
- [x] Verify22 balanced unique transactions/registry receipts, tested UUID ownership/replay rejection, automatic deferred cash-out, canonical closure/escrow0/seats0 and Auth sessions0.
- [x] Record retained3 test identities/1200CH under NO Auth-delete/BURN; preserve receipts/history. No manual data repair or source/runtime change.
- [ ] T07b residual: full safe lifecycle/BURN/Auth-last/re-registration/Google and actual provider fault/restart coverage under new GO; T05e/T06b/Redis cutover still block activation. Positive human-winner payout/lost positive cash-out response not separately covered.


## Read-only T05e/T06b closure work — 19 October 2026

- [x] Audit current/history avatar issuer+cleanup source, existing cleanup uncertainty gates and fresh aggregate Stage bucket/profile/tracking metadata; inspect reward source and scoped receipt/claim/archive aggregates. No values/objects exported or markers changed.
- [ ] T05e-a: operational inventory of all immutable Netlify issuer/cleanup revisions, aliases and privileged tools; record exact access-retirement/drain proof. Prepare only; execution needs separate GO.
- [ ] T05e-b: establish provider-side in-flight upload completion bound (not client abort); choose evidence-based grace for profile-avatar.mjs and cleanupDeletionAvatars. Missing bound => NO-GO. Add only a fundamental boundary/uncertainty regression if behavior needs correction.
- [ ] T05e-c: reconcile both bucket metadata sets with user_profiles/profile_avatar_uploads/account_avatar_objects; unresolved ownership or lost manifests blocks attestation. Output UUID filename/empty pending bucket are insufficient. Drain legacy cleanup before enabling tracking. Execute only after GO; confirm exact paths again after all horizons before cutover proposal.
- [ ] T06b-a: reconcile hot/registry/replay/archive receipts once per transaction UUID; scope Daily/once and private global paid totals; prove verified-email-at-payout provenance including deleted identities. Missing history remains UNKNOWN/history_ready false, never fabricated seed.
- [ ] T06b-b OWNER: approve lawful basis/LIA, minimal program/campaign retention, daily replay horizon, rights handling/privacy notice and historical-gap policy. Recommended preserve caps and pause protected claims pending evidence; changed business promise is separate approval.
- [ ] T06b-c: prove restricted key/version backup continuity without exposing bytes; use existing key-check/fail-closed tests. Real key rotation requires old/new recognition/locking/receipt-dedupe design and separate GO before changing code/config.
- [ ] SECURITY OWNER: establish snapshot scope/time/access/copy evidence where available, review potential Production/shared credential exposure and authorize coordinated rotation; assess incident duties. Exact deleted path absence does not prove no disclosure. No automatic rotation.
- [ ] Before T05e/T06b completion: separate operational GO, real isolated Stage evidence and owner decisions; do not substitute local tests or financial Poker PASS for these gates.


## T05e-a/b read-only evidence increment — 19 October

- [x] T05e-a progress: traverse all20 Netlify API pages (1964 retained records), classify1937 ready deploys by source helper blob, retain exact URL/SHA/context manifest and fingerprint; distinguish mutable aliases from immutable IDs. This is inventory progress, not retirement PASS.
- [x] T05e-a progress: nonmutating GET of5 immutable source families and5 aliases confirms405 on signer/finalize/remove. Current55-function metadata has no scheduled entries; source search finds no independent avatar worker. Authenticated storage write, historical target/config validity and external tools remain unproved.
- [ ] T05e-a remaining: resolve32 missing/unavailable source SHAs, verify uploaded bundle/effective target/tracking state for candidates and scope external issuers; retain full manifest before execution.267 no-helper-at-current-path versions are not excluded solely by that path test. Produce exact Stage-only retirement allowlist; Production impact requires separate GO. Then actual ingress fence+accepted-handler/retry drain, not authorized here.
- [x] T05e-b progress: confirm standard REST+PUT application flow/no discovered TUS; docs/SDK7200s and upstream configurable lifetime; inspect pinned provider expiry-before-stream and post-body commit behavior. No Stage boundary experiment executed.
- [ ] T05e-b remaining UNKNOWN: hosted provider version/effective TTL and hard stream/commit/retry bounds or effective revocation proof. Separately authorize two-capability isolated boundary experiment as described in research; observations alone are not an upper-bound guarantee. Do not choose arbitrary grace or certify PASS.
- [ ] Execute six-step closure table only after scoped GO, including actual drain, tracking rollout, ownership reconciliation, proven horizons and repeat inventory. T05e remains OPEN; T06b OPEN and T07b PARTIAL unchanged. No new documentation-only tests required.


## T05e simplified follow-up (supersedes per-deploy retirement requirement)

- [x] Compare A/B against existing SQL intent/profile guards, service_role bypass and path-bound token authority; common guard blocks new intents for deleting UUID but does not revoke earlier capabilities. No runtime/Stage operation.
- [ ] Identify/prove ONE supported common fence per legacy authority family (preferred B), its supported current consumers and impact; resolve unknown versions only for bypass/target coverage, not exhaustive per-deploy proof once covered. No implicit Production/secret-change GO.
- [ ] Preserve tracking manifests across remaining legacy cleanup paths. If operational fence suffices, no code change; otherwise propose minimal forward-only public.profile_avatar_uploads DELETE guard plus canonical lease/progress-bound cleanup exception and fundamental regression. Do not alter Storage managed schema/applied migrations.
- [ ] Obtain provider TTL/admitted-I/O guarantees, execute separately approved isolated multi-assertion Stage campaign, reconcile ownership and use existing exact cleanup/cutover proposal. No arbitrary grace or happy-path-only PASS.
- [ ] T05e OPEN: no activation until actual fence/drain/ownership/cleanup evidence. Per-deploy manual removal, visitor SSO and blanket key rotation are not universal prerequisites; independent incident handling, Redis/HMAC/T07b gates remain.


## No-rotation T05e verification outcome (latest direction)

- [x] Trace identified legacy INSERT-before-sign, independent admitted signing, global old cleanup, consume/output/profile ordering and SQL-only final cleanup snapshot. Existing lifecycle trigger coverage confirmed; capability cancellation not claimed.
- [x] Run6 existing Storage tests plus3 temporary PGlite/helper probes: new intent/profile writes denied, admitted legacy signing still returns, legacy cleanup loses live proof and legacy finalize can lose output ownership. Reproduction PASS is security NO-GO. No provider calls/implementation performed.
- [ ] Review minimal forward-only public manifest protocol guard (new intent + consumption + proof preservation + canonical safe purge), not DELETE-only. Proposed <new_timestamp>_account_avatar_manifest_guards.sql; never edit applied migrations or Storage managed schema.
- [ ] After separate GO, update existing consumePendingUpload/finalizeAvatar/finishSigning and canonical runtime purge/cleanup checks; promote audit reproductions into fundamental fixed-behavior regressions. No new table/service/secret rotation.
- [ ] Obtain provider TTL/admitted-request/commit/retry closure evidence and separately approved exact-path isolated Stage campaign. UNKNOWN bound/direct uncontrolled writer => NO-GO; neither repeated cleanup nor finite sample proves no late recreation.
- [ ] Keep T05e OPEN/COMPLETED unavailable until actual protocol, ownership and closure proofs. Shared credential retirement preference above is superseded; any alternative fence requires owner review if no-rotation proof remains impossible. Redis/HMAC/T07b unchanged.


## T05e local implementation (latest checkpoint)

- [x] T05e-1 prepare forward-only20261019170000_account_avatar_manifest_guards.sql: disabled-install v3 guard, immutable manifests, atomic consumption protocol, existing-table provider evidence fields, readiness and lease-bound prepare-purge/Auth-cascade path. No remote apply. Append only new source hash in Production inventory.
- [x] T05e-2 existing profile-avatar signing/consume/finalize and Storage/runtime cleanup updated; exact output intent before I/O, RETURNING receipts, no lost manifest success, unknown provider evidence blocks done. No user-profile change, table/service/secret rotation or history-deploy edits.
- [x] T05e-3 permanent fundamental regressions cover late signing/preserved legacy NO-GO, legacy DELETE, rejected untracked finalize, uncertain supported output, successful path/retry, wrong/expired lease and legitimate Auth cascade. Full local all-in/BURN/Auth fixture retained; not actual Stage proof.
- [x] T05e-4 document deploy-supported-writer/tracking readiness BEFORE guard activation, legacy ownership/drain, separate provider evidence/cutover, forward-only rollback and breaking effects. PR Draft prevents automatic Stage apply; suppress Netlify deploys for this no-deploy task.
- [ ] Real Stage migration/protocol activation, provider bounds, legacy reconciliation and isolated integration campaign require separate GO. No markers or evidence filled remotely; T05e OPEN/COMPLETED NO-GO, T06b/T07b/Redis gates unchanged.


## Simplified UX and Stage runbook — latest local GO

- [x] T03 UX: remove watchDeletion/timers, persisted status/capability storage and technical lifecycle/duration messages. Keep one-shot owner GET recovery and in-memory confirmed intent for safe retry; guard asynchronous account switches and acknowledge only confirmed durable receipt. One-time removal of the old sessionStorage key is cleanup, not tracking.
- [x] Use existing account-delete contract; allow authenticated Origin-less GET without CORS grant for same-origin browser recovery, while preserving POST origin/consent and all owner/release/lifecycle checks. Add only fundamental endpoint commit/lost-response/GET-origin regressions; no UI snapshots/framework.
- [x] Prepare quickstart A–E exact Stage gates, migration allowlist/hash handling, writer-first readiness, disabled-install then explicit guard activation, scoped object tests, exact-SHA main WS workflow, provider blocker and forward-fix/rollback constraints. No operational execution.
- [ ] A–E execution needs separate Stage/Preview GO, including fixture provisioning/storage effects/config/migration/deployment as applicable. No destructive account-delete/BURN/Auth cleanup or release activation is included. T05e OPEN/NO-GO; T06b privacy/history/key continuity, Redis cutover and T07b readiness remain open.
