## Current gate — P4 Production activation preparation (#1132)

P2/P3 and T07b remain PASS; #1124 is merged. Earlier before-merge checkpoints below are historical, not pending reset or repeat-E2E instructions. [Current ordered release and protected ON/OFF proposal](production-activation.md).

- [x] PA1 Read-only Production66 ACL/RLS/role/RPC audit: API roles cannot write acceptance, but actual backend shares postgres owner identity; strict operator-only isolation is NOT proven.
- [x] PA2 Prepare forward-only Production equivalent, manifest provenance and bounded identity/catalog/lock guards; no remote application.
- [x] PA3 Test isolated Production66→67, rollback/drift, unchanged finance/routines/ACL/triggers/RLS and API-role denial; update full-process fixture schema.
- [x] PA4 Specify minimal protected Production operator/preflight change, ordered tracking→v3→readiness→runtime flags→DB admission and recovery-safe OFF.
- [x] PA4b Owner accepts existing trusted-backend postgres boundary; no new DB role/HTTP/RPC setter or claim of strict backend isolation.
- [x] PA5a Local Production-only ON/OFF operator and protected preflight implemented; existing SecureFiles, anchored OFF, exact derived ON, atomic backup/journal/lock and interruption tests. No installation.
- [ ] PA5b Separate root GO: install reviewed bundle, dry-run/prepare/verify OFF and LIVE; no activation or restart implied.
- [ ] PA6 Separate exact-file Production67 apply/backup/preflight, authorized Stage source application, owner merge and exact-SHA deployment OFF; no automatic apply implied.
- [ ] PA7 Separate activation GO: real Production Storage/Redis readiness and risk acceptance, tracking before guards, protected runtime flags, DB release LAST; bounded owner-authorized monitoring.

## Current gate — Production compatibility before standard merge

T07b PASS is CLOSED. No additional functional/Poker tests. P1 local Production-equivalent/harness PASS; no remote application. [Reviewed read-only plan](production-compatibility.md); P1 local implementation is authorized/completed; no shared-environment apply authorized.

- [x] PC0 Audit actual pinned Stage117/Production65 histories/schema/functions/ACL/policies, financial aggregates and current runtimes. Stage hashes117/117 match; Production has no per-file hash catalog, so applied-byte equivalence not asserted.
- [x] PC0 Identify six source dependencies and prove Stage archive4-argument patch/ESCROW function cannot be blindly applied to Production5-argument implementation/Production ESCROW contract. Existing manifest keeps needs-production-equivalent.
- [x] PC1 Local GO completed: ONE final-state Production equivalent, existing manifest entry, identity/definition guards; no HMAC/intermediate Stage history; preserve wrapper/retention and legacy avatars with v3DISABLED. Fundamental old/new-runtime-OFF/retention/quota/RLS tests on isolated fixtures.
- [ ] PC2 Separate exact-file Production schema GO: backup/fresh drift+finance preflight, apply transactionally, compatibility verify with old runtime and deletionOFF; no merge/deploy.
- [ ] PC3 Separate owner standard merge/automatic WS+Netlify release GO only after PC2PASS and CI; bounded nonfinancial smoke/deletionOFF. No skip-CI/skip-Netlify workaround.
- [ ] PC4 Separate later Production activation/preparation GO; genuine Production tracking/authority/inventory/Redis readiness, protected flags, DB releaseLAST. Not a merge prerequisite for disabled deployment, never implied by merge.

Google NOT TESTED; accepted#1128 late-upload limitation and deferred#1131 anti-farming unchanged. Earlier Draft/OPEN T07b/Stage pending checkpoints below are historical.

# Active tasks — #1117

## Binding owner decision — per-UUID bonuses / #1131 (20 October 2026)

Cross-account anti-farming is OUT OF SCOPE for #1117 and deferred to #1131. Welcome must work for every eligible new UUID under existing amount/start-date rules, including same-email/Google re-registration; one payout per UUID, no lifetime email cap. Daily UTC/streak and once/campaign remain per UUID. Owner accepts cross-account farming. No HMAC key, verified-email-at-payout, history_ready, protected-payout pause or anti-farming privacy/LIA decision blocks Account Deletion. Global campaign max_total_claims and financial/idempotency retention remain unchanged. Do not delete ledger evidence or reset a campaign quota with Auth/claims cascade.

Redis V3 is COMPLETED on Stage+Production (#1129/#1130); no new reset or credential rotation. Account Deletion stays OFF and #1124 DRAFT. Invisible late upload is accepted MVP limitation#1128; real uncertain operations/ownership still fail closed. Matched Stage Preview rollout is completed; activation/destructive E2E/Production deployment/merge still require separate GO.

- [x] T04d Retired USER archive/receipt/idempotency compatibility retained.
- [x] T02f Final writer lifecycle guards retained; internal Poker settlement stays allowed.
- [x] T05d4 Redis V3 COMPLETED Stage+Production; no further reset.
- [x] T06b REMOVED from#1117: cross-account HMAC/history/privacy policy deferred to#1131, not a release prerequisite. No protected-payout pause.
- [x] BONUS-UUID Restore ordinary per-UUID Welcome/Daily/once with deletion ON or OFF and no HMAC; remove unused runtime/manual proposal/pending fence. Preserve applied migration hashes; prepare20261020190000 forward cleanup + independent campaign lifetime quota. Fundamental rollback/replay/cascade/concurrency tests.
- [ ] T05e Execution remains OPEN: canonical cleanup of retained subject requires the next genuine request/lease/Stage E2E GO. Authority/inventory/cutover PASS: exact2CLI deployments retired/404, real7200s wait and unchanged5manifests/4objects, metadata markerstage-avatar-authority-20261021 recorded with provider fieldsNULL and deletionOFF. No fixture deletion/receipt fabrication; set matching runtime marker only under future configuration GO.
- [x] BONUS-SCHEMA Stage20261020094224 and20261020190000 applied once;117/117 hashes/no drift, guardsO, recognition schema absent, retained campaign counts18/claims18. No HMAC approval or feature flag change.
- [x] BONUS-ROLLOUT Matched91c32955 Netlify deploy6ad7c906436059f74f296e2c + main-defined WS Preview run39488749067 PASS; exact release/dual contexts/LIVE/health/password Auth/profile/browser XP refresh/WS auth+ping verified. Owner allows balanced bot background activity; no USER/claims/conservation changes. Deletion OFF; no funded payout or destructive E2E.
- [x] REDIS-RELEASE Genuine Stage metadata recorded with release OFF: actual endpoint SHA256/current existing epoch/reset manifest; backup/checksum +570 intent/done pairs verified, old token denied/new accepted,0legacy keys. Independent readback matches. No Redis reset/write/rotation/epoch initialization. See research readiness record.
- [ ] T07a Final matched-release review/CI after remaining rollout; current local/CI evidence is recorded in PR/research, not hosted E2E proof.
- [ ] T07b Separate explicit disposable Stage destructive E2E: positive wallet/all-in/showdown/side-pot→cash-out→one BURN→cleanup→Auth-last→same email new UUID→normal Welcome, control/global-quota/retry checks. Google needs dedicated identity. End feature OFF; no Production or merge.

## Historical audit trail — evidence only, superseded instructions must not be executed

The entries below preserve chronological decisions, limitations and test evidence. Checkbox notation was removed deliberately: use only the active checklist above and current quickstart for operational work. In particular old proposals to repeat Redis reset, obtain provider terminal-write guarantees, or redo completed Storage guard rollout are superseded.

Current Stage checkpoint: v3 guard ENABLED under explicit GO; deletion OFF. Latest campaign results at end supersede earlier disabled checkpoints.

> **Owner GO — 20 October, shared XP reset and both environments:** the latest owner instruction authorizes the one-time historical XP hard reset, coordinated Stage + Production V3 configuration/deploy and necessary shared credential rotation. It supersedes earlier “Production/reset not authorized” statements below, which describe historical audit boundaries. Only the independent Redis-only PR #1129 may be merged after required checks and operational readiness; #1124 remains Draft and must not be merged. No Storage/HMAC/deletion activation or financial/Auth cleanup is included. Actual reset/cutover has **not** happened: old-token retirement and protected WS administration remain blocked.


## Binding MVP decision — accepted invisible late-upload risk (20 October 2026)

This owner decision supersedes earlier provider-terminal-bound/write-fence/support requirements below. Do not contact Supabase. MVP accepts the narrow possibility that an upload admitted before deletion completes invisibly after signed-URL expiry and after the final API-visible absence check. Neither COMPLETED nor this decision guarantees physical erasure of every provider copy. This exception does **not** waive observed incomplete signing/output writes, missing ownership, legacy/unknown manifests, or failed/unconfirmed Storage operations.

Keep v3 admission/manifest guards and lifecycle fences, verified legacy inventory/cutover, the 7200-second cutover capability wait, every saved `capability_until` (including longer historical values), exact UUID-owned paths, checked DELETE plus authenticated exact-object re-read, durable receipts/retry/lease, financial reconciliation and Auth hard-delete last. No fabricated `provider_evidence`, receipts, timestamps or approval markers. Provider maximum-token/completion fields remain historical evidence, no longer prerequisites for MVP closure.

Local-only forward migration `20261020082604_account_avatar_mvp_closure.sql` changes only `private.account_avatar_prepare_purge`; applied migrations remain immutable. No remote apply, deployment, activation, retirement, reconciliation, Redis reset or fixture cleanup is authorized in this continuation. Draft PR skips automatic Stage apply; keep Draft and `[skip netlify]` until separately authorized deployment. All current hosted runtime evidence predates this change: a new exact-SHA WS Preview deployment and Netlify Preview deployment are required before integration PASS.


## Current verified Stage checkpoint — 19 October 2026, financial GO completed

Deployed WS Preview runtime remains **d0cca7f5595637a215b61a6104abcbd69fd22ae9**, workflow run39251488130, main-defined V3 LIVE/deploy-context/exact-SHA gates intact. Operator config remains Stage/deploy-preview/3/stage with kcswh:stage:xp:v3; actual LIVE PASS epochPresent0 is NOT cutover attestation. Deletion flag0 and database releasefalse were verified; no configuration, epoch or approval marker changed. Current task now stops for owner review: no further Stage/financial/destructive operations, restart, deployment, Production change or merge.

Real financial GO used exactly three NEW disposable Stage identities, canonical postTransaction MINT funding and real Chromium→WS commands. Funded JOIN/replay/lost JOIN response+reconnect, all-in/showdown/side-pot eligibility, cash-out/LEAVE, automatic deferred finalization and scoped UUID/idempotency checks passed. Two fixture tables CLOSED, both escrows0, active seats0, fixture Auth sessions0. All22 actual transactions balanced with unique keys and matching registry rows; no BURN/Auth delete. USER A/B/C final200/400/600CH; scoped SYSTEM deltas GENESIS−1500 and POKER_BOT_BANKROLL_100+300 preserve totalCH. Three Auth/profile identities and their remaining balances are deliberately retained because destructive account cleanup is forbidden. See research.md for receipts, limits and exact outcomes.

T07b is PARTIAL: real funded Poker covered, not full account-deletion readiness. Full deletion/COMPLETED/re-registration/Google, real provider/storage failure and shared restart/fault tests remain unverified. T05e Storage, T06b HMAC/history/legal and Redis cutover remain OPEN; do not activate deletion or manufacture approvals. Positive-human-winner cash-out and a lost positive-cash-out response were not separately forced; observed showdown winner was a canonical bot, and positive USER cash-outs were100CH each in the first scenario. Historical milestones below retain their original scopes; this checkpoint supersedes earlier authorization/status paragraphs.

# Tasks — #1117 V2

Implementation GO granted in current conversation; destructive Stage/Production/deployment/merge excluded. Supersedes V1 T001–T022 and blocked OTP PoC gates. Only fundamental backend/SQL/WS tests. No generic tooling/dependency cleanup. Keep incomplete items unchecked.

- Historical verified: T01a Synchronize all seven SpecKit artifacts with approved issue V2; remove custom OTP/challenge/receipt and old PoC PASS requirements; preserve ledger/bonus/retention/Storage/writer safety.
- Historical verified: T01b Refresh scoped catalog FK/policies evidence read-only; review exact writer/Storage/WS dependencies. Before migration-bearing Draft PR add draft guard to .github/workflows/db-stage-apply-pr.yml; no intended shared Stage apply.
- Historical verified: T02a Add local-only durable request schema proposal at supabase/manual/1117-account-deletion-requests-v2.sql and shared/account-deletion.mjs request/status/phase/lease foundation with one request/UUID; local PGlite duplicate/ownership/no-table/lease/error tests. Official Auth adapter requires authorized intent and exact-UUID reconciliation. This is not a complete finalizer or canonical applied migration.
- Historical verified: T02d Durable intents/adapters and canonical migration/inventory prepared and applied atomically only to verified Stage. Pruner ACL restoration and real driver JSON encoding fixed/verified. Production equivalence/application still separate; acceptance remains false.
- Historical verified: T02b Integrate netlify/functions/account-delete.mjs POST/GET with verified Supabase owner, strict origin/body/consent and idempotency. Do not activate acceptance until T02c/T04/T05/T06 complete.
- Historical unresolved: T02c Integrate ACTIVE guards at SQL effects and RLS, ws-mint-token/WS auth/private sends and active sockets, CH/bonus/XP/profile APIs, store-upstash raw+Lua writes including admin/sync/guest conversion. Durable preparing then confirmed Redis fence; no PG+Redis atomicity claim. Fundamental delayed writer/restart/active socket tests.
- Historical verified: T03 Update account.html, js/account-page.js, js/i18n.js (existing auth client suffices; no client auth rewrite) with explicit owner confirmation and durable-receipt acknowledgement plus sign-out; pending/completed/intervention presentation and watchDeletion polling are superseded. Optional supported isolated password/Google login, no custom OTP. Real Stage smoke separately authorized before activation; no UI snapshot tests.
- Historical unresolved: T04a Reuse Poker Leave/settlement for all tables/unresolved hand participants, preserve all-in showdown/side-pot; fundamental multi-table/conservation/deferred-restart tests.
- Historical unresolved: T04b Final canonical single balanced BURN including positive balance/winnings, freeze idempotency receipt; retired USER and both CHECKs/FK/history/archive proof compatibility, no old wallet recreation. Fundamental financial replay/late credit/mismatch tests.
- Historical unresolved: T05a Existing profile/avatar/Storage/XP/cache cleanup with signed capability tracking and legacy cutover gate; prevent late resurrection, preserve audit history. Exact owner Auth hard-delete last via official API; not-found reconciliation after lost response.
- Historical unresolved: T05b Existing WS tick/startup advances all/no-table durable requests, bounded lease/backoff/operator incident; financial mismatch halts destructive steps. Fundamental outage/restart/stale worker/lost BURN/Auth response tests.
- Historical unresolved: T06 Private common HMAC recognized email proof: three paid Welcome/no cooldown, Daily identity UTC day, once identity campaign, global quota independent of cascade; atomically ledger+proof+bonus_claims. New UUID/streak independent. Fundamental concurrency/rollback/re-registration tests; privacy/legal/retention/rotation remains release gate.
- Historical unresolved: T07a Run appropriate local and CI syntax/CSP/fundamental suites and deep cross-domain review; record actual outcomes/remaining work, prepare Draft PR, disclose breaking effects. No destructive shared-environment tests.
- Historical unresolved: T07b Separate authorized Stage migration/fixtures, genuine password/Google smoke, exact-SHA WS Preview Deploy and smoke, privacy/legal approval, then separate Production GO. Stage/Preview-only execution is authorized after isolation; Production and merge remain separately gated.

Dependencies: T01 before code; T02a before endpoint/fences/finalizer. T02c and T04/T05/T06 before feature activation/T03 user exposure. T07a is code review evidence, not T07b release evidence. No new automatic migration is intended in this continuation; previously authorized Stage migrations are already applied.

## Historical delivery milestones (current Stage outcomes below supersede restrictions)

Second preparation milestone implements endpoint/UI, read-only status capability, SQL/Redis fences on identified paths, WS auth/private enqueue, existing-tick phase adapters, wallet BURN/retirement, reward HMAC and Storage tracking/cleanup proposals. Feature is OFF by default: runtime flag plus a separate database release row (default false) govern new requests. No schema has been applied and no deployment performed. The full local fixture now completes. Operational integration/release evidence is unfinished; this Draft is not merge-ready.

- Historical verified: T02e Local endpoint tests: consent/origin/owner/replay/gates; bounded status token after Auth deletion; private WS enqueue checks lifecycle inside enqueue transaction.
- Historical verified: T04c Backend and separate WS buy-in ledger guards; positive/zero/absent-wallet retirement, canonical BURN receipt/replay, retired USER historical lookup and scoped deferred cash-out. Existing all-in reducer/domain tests retained.
- Historical verified: T05c Concrete existing WS tick adapters and no-table recovery; exact-target official Auth reconciliation; avatar manifests/capability wait and legacy cutover rejection; guarded Redis raw/Lua and guest conversion writes.
- Historical verified: T06a Atomic private reward identity/paid proof/campaign totals integrated; unapproved HMAC key/version/history fails closed. No annual welcome reset.
- Historical verified: T02f Current supported writer inventory and effect guards completed locally; see writer-audit.md. Includes raw UUID rate limiter, privileged owned-row triggers, initiating admin actor, gift recipient, new-hand start, WS binding/resume and session/replay purge. SQL proposal apply, real PostgreSQL contention and deployed runtime smoke remain separate gates. Arbitrary future owner-level SQL must use lifecycle guards.
- Historical verified: T04d Retired USER archive/pruning compatibility: forward-only local SQL proposal preserves effective #981 pruner and changes only closed-human ownership/status predicate; exporter resolves historical owner and supports pre-retirement schemas. Positive BURN/replay, exact production export shape and unchanged prune definition outside narrow patch covered locally. Applying schema and real archive/prune smoke remain separate GO.
- Historical verified: T05d Code/local preparation: Redis V3 owner standard, controlled XP-only reset plan and complete local-flow fixture. Live cutover is NOT complete: T05d4 remains unchecked. Legacy cleanup and V3 without attestation stay fail-closed; no full-SCAN runtime workaround.
- Historical verified: T05d0 Read-only configured-target inventory: SCAN/TYPE/PTTL aggregates, no values/writes. Netlify all-context Stage/Production share endpoint+namespace; 571 keys, including 359 opaque migration markers without TTL. This is one shared dataset, not independent environment proof.
- Historical verified: T05d1 Owner selected historical XP-only reset over migration, including owner/friend XP; single existing Free database with distinct stage/prod namespaces (later owner decision supersedes the second-database preference). No provisioning or purchase. Monthly headroom is accepted risk; shared V2 backup/reset still requires separate GO. Isolated Stage configuration is now authorized.
- Historical verified: T05d2 Implement environment-versioned UUID private generators across xp-ledger/store-upstash/xp-identity/leaderboard/start-session/calculate-xp/admin; finite transient TTL, distinct anonymous owner prefix, environment-scoped infrastructure. No new framework or permanent dual-read path.
- Historical verified: T05d3 Implement/verify local XP-only reset allowlist, preservation of mixed/non-XP data and cutover/drain proof; then owner-prefix cleanup with final empty verification, preserving other UUID/shared boards/fences. Full end-to-end local fixtures with positive wallet and all-in; no unconditional cleanup stub.
- Historical unresolved: T05d4 Separate GO for target-specific live backup/XP reset/configuration/Stage WS preview; Production separate. Current runtime remains unchanged and deletion disabled.
- Historical unresolved: T05e Reconcile old upload issuers/unknown paths/uncertain signing, prove bucket scope and install reviewed cutover marker only after attestation; real provider in-flight bounds remain operator evidence.
- Historical unresolved: T06b Approve retention/legal/LIA/rights and HMAC rotation bridge; reconcile historical payouts/global quotas before history_ready. Wrong key/version must never silently reset recognition.

Earlier milestone: 137 fundamental tests passed with green CI at 325d0f72. Current V3/full-flow suite and core CI results are recorded below after verification. This is local evidence, not real PostgreSQL/Redis contention, provider integration or Stage smoke. T07b Stage-only verification is now authorized but incomplete; T02d/T05d4/T05e/T06b remain release gates.

T05d verification explicitly extends `.github/workflows/ci.yml` account-deletion-fundamentals with the V3/reset and complete local-flow fixture tests. No dependencies, new workflow or live jobs.

### 18 October V3 delivery evidence

146/146 local CI-equivalent fundamentals passed. Final focused review rerun: 8/8 V3/reset/session tests and 1/1 full all-in/positive-wallet deletion flow passed, including main/side-pot eligibility, one cash-out/BURN and response-loss Auth reconciliation. CSP guard: 55 documents; syntax: 228 files. Existing core suite/remote CI results are reported in PR #1124. T05d0–T05d3 are local preparation; T05d4 (live config/drain/reset/attestation) is deliberately not done. No automatic live reset runner is shipped.

Local existing `npm test` completed successfully. `npm run ci:guards`, syntax/CSP and canonical migration validation passed (111 sealed migrations / 9 Production replacements). Optional broad `check:all` reports five pre-existing badge-anchor omissions in unchanged design mockups; required `ci:guards` checks the served scope and passes. No unrelated mockup edits were made.

Remote CI exposed an existing Playwright backend-fixture loader using `e2e:*` without forced-memory XP_TEST_MODE. The loader now explicitly selects the existing memory test mode; V3 environment validation is unchanged. These are the two existing backend award scenarios, not new UI tests.

## Owner review follow-up: single Free database (18 October)

- Historical verified: F1 Fail-closed V3: extend existing generated deploy-context and scripts/generate-build-info.js with immutable version/environment pin plus committed per-environment activation floor (still 2/2 until separate GO); strict resolver rejects missing/conflicting runtime config after cutover. Existing WS Docker/manual artifact packaging must include the resolver dependency and pinned generated context. No workflow dispatch/configuration change. Fundamental runtime/build/artifact tests only.
- Historical verified: F2 Reset manifest expiry: capture Redis observation time, compare type/value and elapsed expiration deadline with bounded clock tolerance; persistent↔expiring/renewed/uncertain changes deny, natural expiry skips only as absent. Future executor must perform final check+effect atomically and preserve current TTL on mixed records. No live executor/reset.
- Historical verified: F3 Free-only audit: one current Upstash database, exact stage/prod namespaces, no provisioning/purchase/subscription. INFO stats/memory + DBSIZE read-only aggregate metrics and public primary documentation; distinguish actual monthly quota unavailable from observed cumulative counters. Record combined environment command budget, Lua/index costs and no-cost optimizations without weakening fences.

Follow-up local evidence: 150/150 CI-equivalent fundamentals passed, including the retained full all-in/positive-wallet/BURN/Auth flow; 39 focused V3/config/reset/artifact/dependency guards passed. CSP 55 served documents, required ci:guards and canonical migration validation (111/9) passed. F3 is an audit completion, not a capacity PASS: monthly Free quota/headroom and reliable storage usage remain unverified. Pin configuration, build/package/deploy, reset, live schema and activation all require separate GO. No new resources, dependencies or live changes.

### P2: missing Redis credentials after V3 activation (2026-10-18)

- Historical verified: P2 credential failure: deny V3 Redis reads/writes/rate limits without URL/token; return 503 from XP HTTP paths; preserve V2/test memory and Poker/CH isolation. Fundamental configuration regression: missing URL/token/blank URL, real module imports, no network, HTTP 503, V2/test compatibility. Existing TTL tests retained.
- Historical unresolved: Operational gates remain: approve allowlisted reset, authorize exact-SHA Stage deployment and real integration smoke; no live action performed.

## Current real-service task outcomes

- Historical verified: Stage identity/isolation preflight, canonical schema apply/history/hash, release false, real password Auth fixtures and official cleanup.
- Historical verified: Real Upstash readonly Lua fix; real driver JSON phase/retirement fix; positive 75 CH canonical BURN once/retired USER; control UUID preserved in owner-index component teardown.
- Historical unresolved: T05d4 full cutover: shared V2 reset/drain remains unauthorized; no false attestation or done:true. Isolated V3 component verification completed.
- Historical unresolved: T05e: correct bucket configuration/current inventory verified; old issuer drain, signed capabilities/uncertain paths and expiry evidence still missing.
- Historical unresolved: T06b: surviving-history aggregates verified; archived/deleted coverage, legal/LIA/rights/privacy and rotation continuity remain unapproved. history_ready not seeded.
- Historical unresolved: T07b: partial real services verified; live all-in deletion, Google, public re-registration, frontend-to-COMPLETED and actual Redis/VPS restart not verified. Exact-SHA Preview deploy/CI evidence recorded after workflow completion.

- Historical verified: T02d follow-up: additional forward-only exact USER-trigger compatibility for existing escrow retirement, applied on Stage without editing old migration hashes. Existing unknown-dependency tests retained; real-driver deletion receipt regression added to existing PostgreSQL CI.
- Historical verified: WS exact-runtime SHA f771972b Preview deployment succeeded (run 39156649252); basic health/helloAck only. Authenticated frontend/Poker/delete smoke remains NOT TESTED; current main packaging lacks PR's new activation dependencies.

## Current continuation outcomes

- Historical verified: Preview preflight and skip cause identified; branch-only configuration attempted and denied HTTP403; prior values/scopes verified unchanged. Skip intentionally retained, no unsafe deployment.
- Historical verified: Independent real Stage RLS/favorites/positive-CH/profile/control tests and same-email Admin recreation/password login; three identities cleaned. Public registration/UI and live Poker deletion remain NOT TESTED. Initial financial RETRY recovered by a scoped operator retry, not proof of automatic recovery.
- Historical verified: T05e engineering: independent pre-activation avatar tracking flag + previous-path manifests + fundamental retention test; no flag applied.
- Historical unresolved: T05e operational: old issuers/cleanup still reachable; no full inventory/drain/expiry proof or marker.
- Historical verified: T06b scoped retained history audit: 8 Welcome/18 Promo match registry/replays; archived reward batch unpruned. Minimum rights/retention/key-continuity plan documented.
- Historical unresolved: T06b approval/coverage: historical verified-email-at-payout and legal/LIA/privacy decisions unresolved; history_ready remains false.
- Historical unresolved: T05d4 coordinated V2 retirement/backup/reset/attestation; final ordered plan below redis-cutover.md, no live reset.
- Historical unresolved: T07b full E2E/Google/live all-in/provider expiry/restart proof and working Preview.

- Historical unresolved: Owner/security review: agent temporary Netlify snapshot had local0664 permissions and included Production contexts; removed, never published. Access by another local actor cannot be excluded. Any shared/Production credential rotation requires separate GO; see research.md incident.


## Current continuation — Preview and automatic recovery

- Historical verified: Netlify403 diagnosed: paid granular scopes, resolved with default all scopes and branch-only values. Stage Supabase verified; other contexts retain V2. Stage floor3/Production2; skip removed; actual Preview and password UI smoke PASS.
- Historical verified: BURN automatic Stage recovery: real own-wallet row-lock timeout at5s, durable30s retry, coordinator reconstruction, committed-response loss and receipt replay; exactly one75CH BURN, retired USER, no operator retry/timeout increase. Redacted SQLSTATE/duration diagnostic added. Shared WS service recovery is not yet verified.
- Historical verified: Dedicated workflow-only Draft #1125 prepared from main, with exact-runtime SHA packaging/config generation and explicit Stage Redis version input. Owner merge required before main-defined dispatch; no branch-definition bypass.
- Historical verified: Disposable Stage identities/sessions and exact Redis fixture resources removed; financial history retained. Password UI created an empty control wallet, retired canonically before Auth deletion.
- Historical unresolved: T05e remains operationally blocked by legacy issuers/old cleanup retirement and actual expiry/ownership proof; technical code audited, no false marker.
- Historical unresolved: T06b remains blocked by unprovable historical verified-email-at-payout coverage and owner legal/LIA/privacy/key-continuity decisions; no fabricated proofs/history_ready.
- Historical unresolved: T07b full frontend-to-COMPLETED, real all-in deletion and authenticated Google remain NOT TESTED. Shared WS exact-SHA redeploy awaits workflow integration and matching protected Stage runtime configuration.

## Current continuation checklist (19 October)

- Historical verified: Integrate main #1125/#1126; preserve both conflict sides/evidence, exact ESCROW guard/tests and immutable migrations. Only research.md conflicted.
- Historical verified: Existing protected-env checker gains pinned Stage/V3 validation and explicit nonsecret V3/legacy result; fundamental regression covers complete configuration, missing fields, foreign namespace/project, test mode and Production context.
- Historical verified: Operator prepared protected base/bundle/root0600 Stage env; independently verified hashes and actual LIVE PASS. No agent config rewrite or restart.
- Historical unresolved: Positive actual V3 preflight, then main-defined exact-SHA WS deploy, browser auth/JOIN/game/Poker/all-in/deletion/recovery fixtures and truthful cleanup evidence.
- Historical verified: Refresh bounded Storage catalog/issuer and hot/archive reward audits read-only; no object/identity/financial mutation.
- Historical unresolved: T05e actual issuer+cleanup drain, complete ownership reconciliation and capability/in-flight expiry proof. No cutover marker.
- Historical unresolved: T06b authoritative historic verified-email reconciliation and owner legal/LIA/privacy/retention decision. No history_ready approval or key reset.

## Administrative procedure review checklist

- Historical verified: Replace unsafe /tmp procedure with reviewed repository script, protected-bundle requirement and explicit file allowlist; remove old script/private fragment.
- Historical verified: Strict descriptor/parent/root-mode/single-link checks, fixed Stage settings/deletion0, immutable two-file backup, bounded lock, fsync/rename, resumable apply and rollback, changed-input/target/corrupt-backup NO-GO.
- Historical verified: Existing Stage Netlify source verified read-only via a pipe; no credential value printed/persisted, no Production context exported or Redis operation performed.
- Historical verified: CONFIG-only preflight no longer claims live proof. Separate LIVE mode tests only PING+exact Stage EXISTS with redirect/error/redaction/config-change checks; only mocked tests run.
- Historical verified: Owner approved procedure and operator preparation; current metadata/hashes and LIVE result independently verified.
- Historical unresolved: Actual root apply, LIVE proof, then resumed main-defined exact-SHA WS deployment and funded fixtures. NOT RUN in this preparation.

### Administrative review correction tasks
- Historical verified: Audit actual Preview parent, ACLs, intermediates, five roots and copilot access; preserve Phase A model.
- Historical verified: Prepare guarded nonrecursive base-owner correction and explicit unsafe-legacy rollback instructions.
- Historical verified: Enforce V3 LIVE via existing exact no-argument sudo helper; independent workflow gate and both generated contexts; fundamental positive/NO-GO fixtures.
- Historical verified: Owner merged workflow-only #1127 into main fb12d182; integrated here, shared workflow/tests retained once.
- Historical verified: Operator parent/bundle/config preparation and LIVE proof obtained.
- Historical unresolved: Next owner GO: main-defined final exact-SHA deployment, runtime smoke and isolated Stage integration; not authorized/executed in this continuation.

## Main integration / pre-deployment review
- Historical verified: Integrate main #1127; resolve only workflow-test conflict, preserve one copy of each main gate/context test plus the two helper-specific fixtures. Workflow identical to merged main; no runtime change.
- Historical verified: Repeat actual read-only LIVE preflight; epoch0 remains NOT a cutover attestation. No protected configuration changed.
- Historical verified: Prepare bounded Stage matrix in quickstart with explicit next-GO prerequisites and full-E2E blockers.
- Historical unresolved: Exact-SHA WS Preview Deploy and runtime/browser evidence after next GO. No restart/dispatch in this review.

## Isolated financial Stage GO outcome — 19 October
- Historical verified: Repeat exact-SHA/Stage/V3/LIVE/releasefalse and no-human-seat preflight; use3 NEW isolated fixture users only.
- Historical verified: Canonical funding/replay, actual Chromium WS funded JOIN, lost-response reconnect/replay, real unequal-stack all-in/showdown/side-pot and escrow conservation.
- Historical verified: Verify22 balanced unique transactions/registry receipts, tested UUID ownership/replay rejection, automatic deferred cash-out, canonical closure/escrow0/seats0 and Auth sessions0.
- Historical verified: Record retained3 test identities/1200CH under NO Auth-delete/BURN; preserve receipts/history. No manual data repair or source/runtime change.
- Historical unresolved: T07b residual: full safe lifecycle/BURN/Auth-last/re-registration/Google and actual provider fault/restart coverage under new GO; T05e/T06b/Redis cutover still block activation. Positive human-winner payout/lost positive cash-out response not separately covered.


## Read-only T05e/T06b closure work — 19 October 2026

- Historical verified: Audit current/history avatar issuer+cleanup source, existing cleanup uncertainty gates and fresh aggregate Stage bucket/profile/tracking metadata; inspect reward source and scoped receipt/claim/archive aggregates. No values/objects exported or markers changed.
- Historical unresolved: T05e-a: operational inventory of all immutable Netlify issuer/cleanup revisions, aliases and privileged tools; record exact access-retirement/drain proof. Prepare only; execution needs separate GO.
- Historical unresolved: T05e-b: establish provider-side in-flight upload completion bound (not client abort); retain provider evidence gating for profile-avatar tracking and cleanupDeletionAvatars, without configurable grace. Missing bound => NO-GO. Add only a fundamental boundary/uncertainty regression if behavior needs correction.
- Historical unresolved: T05e-c: reconcile both bucket metadata sets with user_profiles/profile_avatar_uploads/account_avatar_objects; unresolved ownership or lost manifests blocks attestation. Output UUID filename/empty pending bucket are insufficient. Drain legacy cleanup before enabling tracking. Execute only after GO; confirm exact paths again after all horizons before cutover proposal.
- Historical unresolved: T06b-a: reconcile hot/registry/replay/archive receipts once per transaction UUID; scope Daily/once and private global paid totals; prove verified-email-at-payout provenance including deleted identities. Missing history remains UNKNOWN/history_ready false, never fabricated seed.
- Historical unresolved: T06b-b OWNER: approve lawful basis/LIA, minimal program/campaign retention, daily replay horizon, rights handling/privacy notice and historical-gap policy. Recommended preserve caps and pause protected claims pending evidence; changed business promise is separate approval.
- Historical unresolved: T06b-c: prove restricted key/version backup continuity without exposing bytes; use existing key-check/fail-closed tests. Real key rotation requires old/new recognition/locking/receipt-dedupe design and separate GO before changing code/config.
- Historical unresolved: SECURITY OWNER: establish snapshot scope/time/access/copy evidence where available, review potential Production/shared credential exposure and authorize coordinated rotation; assess incident duties. Exact deleted path absence does not prove no disclosure. No automatic rotation.
- Historical unresolved: Before T05e/T06b completion: separate operational GO, real isolated Stage evidence and owner decisions; do not substitute local tests or financial Poker PASS for these gates.


## T05e-a/b read-only evidence increment — 19 October

- Historical verified: T05e-a progress: traverse all20 Netlify API pages (1964 retained records), classify1937 ready deploys by source helper blob, retain exact URL/SHA/context manifest and fingerprint; distinguish mutable aliases from immutable IDs. This is inventory progress, not retirement PASS.
- Historical verified: T05e-a progress: nonmutating GET of5 immutable source families and5 aliases confirms405 on signer/finalize/remove. Current55-function metadata has no scheduled entries; source search finds no independent avatar worker. Authenticated storage write, historical target/config validity and external tools remain unproved.
- Historical unresolved: T05e-a remaining: resolve32 missing/unavailable source SHAs, verify uploaded bundle/effective target/tracking state for candidates and scope external issuers; retain full manifest before execution.267 no-helper-at-current-path versions are not excluded solely by that path test. Produce exact Stage-only retirement allowlist; Production impact requires separate GO. Then actual ingress fence+accepted-handler/retry drain, not authorized here.
- Historical verified: T05e-b progress: confirm standard REST+PUT application flow/no discovered TUS; docs/SDK7200s and upstream configurable lifetime; inspect pinned provider expiry-before-stream and post-body commit behavior. No Stage boundary experiment executed.
- Historical unresolved: T05e-b remaining UNKNOWN: hosted provider version/effective TTL and hard stream/commit/retry bounds or effective revocation proof. Separately authorize two-capability isolated boundary experiment as described in research; observations alone are not an upper-bound guarantee. Do not choose arbitrary grace or certify PASS.
- Historical unresolved: Execute six-step closure table only after scoped GO, including actual drain, tracking rollout, ownership reconciliation, proven horizons and repeat inventory. T05e remains OPEN; T06b OPEN and T07b PARTIAL unchanged. No new documentation-only tests required.


## T05e simplified follow-up (supersedes per-deploy retirement requirement)

- Historical verified: Compare A/B against existing SQL intent/profile guards, service_role bypass and path-bound token authority; common guard blocks new intents for deleting UUID but does not revoke earlier capabilities. No runtime/Stage operation.
- Historical unresolved: Identify/prove ONE supported common fence per legacy authority family (preferred B), its supported current consumers and impact; resolve unknown versions only for bypass/target coverage, not exhaustive per-deploy proof once covered. No implicit Production/secret-change GO.
- Historical unresolved: Preserve tracking manifests across remaining legacy cleanup paths. If operational fence suffices, no code change; otherwise propose minimal forward-only public.profile_avatar_uploads DELETE guard plus canonical lease/progress-bound cleanup exception and fundamental regression. Do not alter Storage managed schema/applied migrations.
- Historical unresolved: Obtain provider TTL/admitted-I/O guarantees, execute separately approved isolated multi-assertion Stage campaign, reconcile ownership and use existing exact cleanup/cutover proposal. No arbitrary grace or happy-path-only PASS.
- Historical unresolved: T05e OPEN: no activation until actual fence/drain/ownership/cleanup evidence. Per-deploy manual removal, visitor SSO and blanket key rotation are not universal prerequisites; independent incident handling, Redis/HMAC/T07b gates remain.


## No-rotation T05e verification outcome (latest direction)

- Historical verified: Trace identified legacy INSERT-before-sign, independent admitted signing, global old cleanup, consume/output/profile ordering and SQL-only final cleanup snapshot. Existing lifecycle trigger coverage confirmed; capability cancellation not claimed.
- Historical verified: Run6 existing Storage tests plus3 temporary PGlite/helper probes: new intent/profile writes denied, admitted legacy signing still returns, legacy cleanup loses live proof and legacy finalize can lose output ownership. Reproduction PASS is security NO-GO. No provider calls/implementation performed.
- Historical unresolved: Review minimal forward-only public manifest protocol guard (new intent + consumption + proof preservation + canonical safe purge), not DELETE-only. Proposed <new_timestamp>_account_avatar_manifest_guards.sql; never edit applied migrations or Storage managed schema.
- Historical unresolved: After separate GO, update existing consumePendingUpload/finalizeAvatar/finishSigning and canonical runtime purge/cleanup checks; promote audit reproductions into fundamental fixed-behavior regressions. No new table/service/secret rotation.
- Historical unresolved: Obtain provider TTL/admitted-request/commit/retry closure evidence and separately approved exact-path isolated Stage campaign. UNKNOWN bound/direct uncontrolled writer => NO-GO; neither repeated cleanup nor finite sample proves no late recreation.
- Historical unresolved: Keep T05e OPEN/COMPLETED unavailable until actual protocol, ownership and closure proofs. Shared credential retirement preference above is superseded; any alternative fence requires owner review if no-rotation proof remains impossible. Redis/HMAC/T07b unchanged.


## T05e local implementation (latest checkpoint)

- Historical verified: T05e-1 prepare forward-only20261019170000_account_avatar_manifest_guards.sql: disabled-install v3 guard, immutable manifests, atomic consumption protocol, existing-table provider evidence fields, readiness and lease-bound prepare-purge/Auth-cascade path. No remote apply. Append only new source hash in Production inventory.
- Historical verified: T05e-2 existing profile-avatar signing/consume/finalize and Storage/runtime cleanup updated; exact output intent before I/O, RETURNING receipts, no lost manifest success, unknown provider evidence blocks done. No user-profile change, table/service/secret rotation or history-deploy edits.
- Historical verified: T05e-3 permanent fundamental regressions cover late signing/preserved legacy NO-GO, legacy DELETE, rejected untracked finalize, uncertain supported output, successful path/retry, wrong/expired lease and legitimate Auth cascade. Full local all-in/BURN/Auth fixture retained; not actual Stage proof.
- Historical verified: T05e-4 document deploy-supported-writer/tracking readiness BEFORE guard activation, legacy ownership/drain, separate provider evidence/cutover, forward-only rollback and breaking effects. PR Draft prevents automatic Stage apply; suppress Netlify deploys for this no-deploy task.
- Historical unresolved: Real Stage migration/protocol activation, provider bounds, legacy reconciliation and isolated integration campaign require separate GO. No markers or evidence filled remotely; T05e OPEN/COMPLETED NO-GO, T06b/T07b/Redis gates unchanged.


## Simplified UX and Stage runbook — latest local GO

- Historical verified: T03 UX: remove watchDeletion/timers, persisted status/capability storage and technical lifecycle/duration messages. Keep one-shot owner GET recovery and in-memory confirmed intent for safe retry; guard asynchronous account switches and acknowledge only confirmed durable receipt. One-time removal of the old sessionStorage key is cleanup, not tracking.
- Historical verified: Use existing account-delete contract; allow authenticated Origin-less GET without CORS grant for same-origin browser recovery, while preserving POST origin/consent and all owner/release/lifecycle checks. Add only fundamental endpoint commit/lost-response/GET-origin regressions; no UI snapshots/framework.
- Historical verified: Prepare quickstart A–E exact Stage gates, migration allowlist/hash handling, writer-first readiness, disabled-install then explicit guard activation, scoped object tests, exact-SHA main WS workflow, provider blocker and forward-fix/rollback constraints. No operational execution.
- Historical unresolved: A–E execution needs separate Stage/Preview GO, including fixture provisioning/storage effects/config/migration/deployment as applicable. No destructive account-delete/BURN/Auth cleanup or release activation is included. T05e OPEN/NO-GO; T06b privacy/history/key continuity, Redis cutover and T07b readiness remain open.

- Historical verified: T03 confirmation simplification: replace typed prompt with existing native confirm pattern; cancel sends no POST, internal consent fields/JWT/idempotency/recovery unchanged. No new challenge, component, CSS or endpoint. Local verification recorded in research; actual Stage UI remains separately gated.

### Executed A/E read-only checkpoint — no rollout GO

- Historical verified: A evidence: actual Stage identity,113/113 applied/hash inventory (no drift), only20261019170000 pending, existing guards/schema, releasefalse/Netlify deletion0, Stage/V3 LIVE+both contexts, old WS/Preview SHAs and aggregate avatar tracking/ownership inventory. Direct WS process flag is unreadable; approved config proof is documented separately, not represented as direct observation.
- Historical verified: E evidence: actual hosted Storage1.80.2/healthy, version-matched upstream db422805 source and metadata-only config. Documented7200s versus configurable effective TTL distinguished; no guarantee for whole accepted I/O established.
- Historical unresolved: Before B: revalidate pending/hash/disabled flags; fresh protected WS config proof and DB releasefalse; direct process flag is optional. Separate GO for disabled migration+supported branch Preview, tracking/ordinary fixture smoke; later guard activation ONLY after supported-writer PASS. No B/C/D action performed.
- Historical unresolved: T05e remains OPEN/COMPLETED NO-GO: effective hosted TTL, admitted-stream+commit/retry bound or effective provider write fence; historical ownership/drain/closure evidence and genuine attestation still missing. No fake markers.

- Historical verified: Limited B mandatory preflight repeated: Stage identity113/113 matching history and manifest hash PASS; releasefalse/branch deletion0/StageV3 LIVE PASS; Draft apply skipped.
- Historical verified: Historical limited B STOP recorded (superseded locally by no-grace refactor): no migration/deploy/tracking/fixture was executed and no residue created. Owner now accepts fresh protected WS config + releasefalse for disabled installation; direct process flag remains unobserved, optional evidence.

- Historical verified: Remove ACCOUNT_DELETION_AVATAR_GRACE_SECONDS dependency/helper/validation from avatar signing and cleanup; no replacement setting. Fixed7200000 provisional horizon, preserve stored longer horizons/provider completion wait. Fundamental local no-config/missing-evidence/longer-horizon regressions; migration unchanged.
- Historical unresolved: B remains NOT EXECUTED: after separate review/GO, revalidate preflight and install disabled migration, supported Preview/tracking and ordinary fixture smoke WITHOUT grace config. No guard activation, provider attestation or deletion implied.

### Autonomous limited B actual execution

- Historical verified: Repeated mandatory preflight; applied ONLY20261019170000 with existing migrator; verified114/114 hashes/no pending, guardD, v2O, releasefalse.
- Historical verified: Supported Netlify Preview first0c5e376b (trackingOFF), then56048623 (branch trackingON/default scopes; no-cost granular-scope403 remedy); actual Stage config/build-info checked, Production unchanged.
- Historical verified: Real Stage subject/control password login + normal synthetic HTTP upload/PUT/finalize; v3 exact7200s manifests, output intent/receipt/profile links and cross-UUID404 PASS; pre-existing Storage metadata unchanged, no financial/bonus/deletion effects.
- Historical verified: Record retained2 identities/sessions/profiles/manifests/synthetic outputs privately; no destructive teardown or capability closure claim.
- Historical unresolved: T05e still OPEN: ENABLE guard only under next GO, then scoped C legacy/fault/isolation proof, historical ownership/drain, provider admitted-I/O closure guarantee and authentic attestation. Ordinary B PASS is not closure.
- Historical unresolved: D WS Preview exact-SHA deployment/smoke remains separate GO; old deployed d0cca7f not latest Storage runtime. Redis cutover/HMAC/privacy/history and destructive T07b remain separately blocked.

### Authorized legacy/fault C outcome

- Historical verified: Fresh Stage114/114+guardD/v2O/deletionOFF/Preview+RedisV3 preflight; no observed non-fixture pending uploads, SQL writers or conflicting Preview rollout.
- Historical verified: Activate ONLY manifest guard on Stage; actualO/readytrue/v2O verified. No migrator/rollback.
- Historical verified: Real fixture SQL legacy INSERT/consume/DELETE rejection, supported Netlify happy upload, UUID isolation, prior manifests/control unchanged.
- Historical verified: Pre-admitted legacy signing after protocol fence succeeds but remains uncertain; one Stage token TTL7200 observed, no universal completion guarantee.
- Historical verified: Current-helper real Stage POST + scoped injected lost response/failed compensation; retained output/manifest/no finish receipt; actual retry404/no second effect.
- Historical verified: Preserve private fixture residue (same2 users,4 sessions,5 manifests/3 real synthetic outputs), deletionOFF/no attestations/financial effects. No full deletion/provider-gated cleanup claim.
- Historical unresolved: T05e OPEN: provider accepted-I/O bound/fence, historical/global ownership and narrow authoritative reconciliation for legacy/uncertain rows; no fabricated receipts. Separate GO before reconciliation/destructive teardown.
- Historical unresolved: Separate D WS deployment, HMAC/legal/history, Redis cutover and actual full deletion T07b still gated.

### 20 October bundled D / Storage / HMAC outcome

- Historical verified: D actual main-defined exact-SHA WS Preview7aac5d01/run39386163624; preflight zero sockets/human seats, contexts/LIVE/health, browser password owner mint/WS auth/ping/lobby PASS. No JOIN/CH/deletion; guardreadytrue/releasefalse retained.
- Historical verified: T05e concrete variant/closure/reconciliation/fixture-teardown proposal and copy-ready UNSENT support questions. No retirement, storage-schema change, new capability or Stage reconciliation.
- Historical verified: T06b final technical/business/legal decision table; actual hot counts8 Welcome/18 Promo/18 claims, config/proofs/history_ready0; no reset/rotation/policy activation.
- Historical unresolved: T05e NO-GO: provider terminal-write/physical-orphan bound or effective fence; exceptional legacy authority proof; approved local narrow reconciliation before any Stage destructive action.
- Historical unresolved: T06b NO-GO: owner/legal acceptance, provenance completeness/gap handling, restricted key backup continuity; conditional Daily proof pruning and future rotation bridge not implemented/approved.
- Historical unresolved: Redis cutover/real full deletion+Google/re-registration T07b remain gated. Next proposed GO bundles support contact/questions+local-only reconciliation/Daily-retention PoCs after policy acceptance; NOT Stage cleanup or feature activation.

### Current MVP closure work (supersedes provider-support task)
- Historical verified: Local Storage closure no longer requires provider terminal guarantee. New forward-only purge SQL and adapter agree; no fake evidence and no remote apply.
- Historical verified: Exact DELETE response + authenticated `NoSuchKey` verification before receipts; final SQL snapshot confirms all paths have receipts. Ambiguous 404, live object, outage, missing manifest/guard, unknown legacy/write state remain fail-closed.
- Historical verified: New Welcome private proof uses opaque transaction UUID, not user-bearing ledger idempotency key. Existing immutable keys/proofs and paid counting remain valid; no historical quota reset.
- Historical unresolved: T05e operational: separately apply reviewed migration, deploy supported Preview/WS exact SHA, verify ordinary closure, reconcile retained legacy/uncertain fixture ownership only with actual terminal receipts and scoped GO. Inventory/cutover remains unproved; theoretical post-expiry completion is accepted risk, not a release gate.
- Historical unresolved: T06b: historical verified-email provenance and global counts, original key continuity, approved LIA/privacy/retention/rights. Missing trustworthy history/key continues to reject protected payouts; no history_ready marker generated. No automated pruner/rotation bridge without approved policy/need.
- Historical unresolved: T05d4: live legacy-writer drain, protected backup and reviewed XP-only allowlist/reset, V3 epoch/cutover proof remain separate GO; reset is shared with Production and cannot be relabelled Stage-only.
- Historical unresolved: T07b: new exact-SHA deployment and actual deletion/re-registration E2E await separate Stage activation/fixture/financial/Auth cleanup GO after real Redis/Storage/HMAC prerequisites. Local fixture completion is not Stage PASS.

### Authorized Stage MVP closure campaign — actual API evidence (20 October)

Pinned Stage/system ID preflight PASS; applied only20261020082604_account_avatar_mvp_closure.sql using existing migrator (exact reviewed hash). Post-check115/115 migrations/hashes, no drift/pending, v2/v3 guards enabled and readytrue, DB releasefalse, Netlify deletion0/tracking1 and protected WS deletion0 unchanged. LIVE RedisV3 Stage PASS/epoch0/not cutover. No conflicting active human seats or established WS Preview connections observed before deployment.

Actual Storage1.80.2 info route returns HTTP400 with `{statusCode:"404",code:"NoSuchKey",error:"not_found",message:"Object not found"}`. This is the version-matched legacy error-handler contract (non-500 renderable errors map to HTTP400), not a missing-object assumption. Minimal adapter correction accepts this exact semantic absence in addition to HTTP404/NoSuchKey; HTTP400 without embedded404, bucket/auth/infrastructure errors remain rejected. One regression case RED→GREEN in existing Storage suite16/16. No new dependencies/helpers/secret/configuration change.

Real API test PASS: created four NEW synthetic objects (subject+control in each avatar bucket), POST200 and info200. Exact DELETE200 array1 followed by info HTTP400/embedded404/NoSuchKey; repeat DELETE200 empty array followed by same absence. Both controls retained same object ID/version until separately deleting only these newly created controls; final new-object residue0. Wrong bucket HTTP400/NoSuchBucket is NOT absence. Exact paths/content hashes/provider object IDs kept only in private0700/0600 campaign inventory. Synthetic owner identifiers record campaign provenance, not an Auth/SQL ownership assertion. No test user or profile/manifest was created. Earlier fixture/manifest inventories untouched.

Ambiguous response rejection is a local deterministic fault-response test, NOT an induced provider outage. Canonical cleanup adapter/purge with real lease/request and complete account deletion NOT TESTED on Stage: feature remains OFF and this GO prohibits those operations. No fake marker/lease/receipt/provider evidence. Hypothetical late-upload edge remains accepted MVP risk tracked in#1128; no support contact.

### Stage campaign delivery (20 October; runtime13481825)
- Historical verified: Stage-only new MVP closure migration applied once;115/115 hashes/no drift, guard v3/v2ON/readytrue/releasefalse.
- Historical verified: Netlify deploy6ad72ce21a858095b3e06e0f READY + main-defined WS run39397138112 SUCCESS at identical runtime134818252375239acb8356163a0b454222d99ef8; contexts/LIVE/health and real nonfinancial browser auth/ping/lobby PASS.
- Historical verified: Actual isolated Storage object API create/delete/re-read/repeat/control campaign:4new objects,0residue; observed legacyHTTP400/embedded404/NoSuchKey, minimal adapter fix+regression; bucket/auth/infrastructure not accepted. Existing manifests/fixtures untouched.
- Historical verified: Local fundamentals166/166, Storage16/16, syntax/CSP/guards/migration inventory PASS.
- Historical unresolved: T05e full canonical cleanup/lease + true legacy ownership/inventory/cutover still OPEN; no fake markers. Known pending/uncertain operations remain blocking, accepted invisible late-upload risk is tracked in#1128.
- Historical unresolved: T06b actual history/key continuity/privacy approval, Redis live cutover and T07b destructive E2E/re-registration remain separate GO. No feature activation/Auth-delete/BURN performed in this campaign.

## Dependency closure delivery — current local/read-only scope
- Historical verified: T05e inventory: Stage115/115, four objects uniquely attributed, five manifests; exact two exceptional fixture matches in private inventory. No remote changes; all-family authority/drain still unproved.
- Historical verified: T05e local canonical reconciliation: forward-only SQL + existing adapter/progress, actual lease/inventory/snapshot binding, exact DELETE+absence and separate new receipt, original evidence unchanged; legacy/v3/ownership/retry/failed-delete/localAuth-cascade tests.
- Historical unresolved: T05e operational closure: review/apply new migration, real writer drain/cutover inventory approval and scoped canonical fixture cleanup under separately authorized genuine deletion jobs. No marker set.
- Historical verified: T06b hot/registry/archive-metadata/claims/proofs audit; no verified-email-at-payout coverage or configured HMAC key; no made-up backfill. Proposed one purpose-based policy documented in research.
- Historical verified: T06b local SQL commit fence for protected legacy rewards + durable global Promo quota, JS double-increment removed, flag-skew fail-closed, historical registry replay not a new payout. No new multi-key/pruner framework.
- Historical unresolved: T06b owner LIA/privacy/rights/retention + missing-history protected-payout pause; genuine key/history/global-total readiness separately approved. No history_ready seed or real key change.
- Historical verified: T05d4 complete read-only572-key metadata scan; refined exact570legacy XP-cache scope, source-proven conversion/anon fields; unknown fields still preserved; pure atomic CAS command preparation + tamper tests, no live execution.
- Historical unresolved: T05d4 isolated real CAS validation, old-writer credential/authority fence and coordinated ProductionXP reset/cutover/backup/recovery need explicit separate GO. Metadata inventory is not backup; missing write-fence means NO-GO.
- Historical unresolved: T07b next full Stage E2E prerequisite matrix in quickstart; no previous smoke rerun and no destructive E2E performed. Remains PARTIAL, not merge-ready.

- Historical verified: T05e additional source closure:27/27missing commits fetched locally, all known avatar family;264unique no-helper commits have no matching standard Storage source. No environment mutations or new mass endpoint inventory.
- Historical unresolved: Five manual no-SHA deployments remain an exact authority gap; obtain per-deploy source proof or separately approve their scoped retirement after alias safety checks (three historical Production-context artifacts, none current published). No blanket1626retirement.

### Redis hard-reset execution preparation (owner GO, 20 October)

Independent Redis-only Draft [#1129](https://github.com/krzysztofcal/arcadePlatform/pull/1129), from current main, excludes Account Deletion and SQL migrations. V3-required builds/runtime, guarded owner indexes, non-importing conversion, fail-closed config and Production LIVE deployment gate are tested separately. Actual shared Upstash CAS/restore scratch passed; restricted570-key value backup/checksum verified,7scratchkeysremoved. Complete evidence and exact reset scope are in redis-cutover.md and the independent operator contract. T05d4 remains OPEN: no old credential revocation, final drain/reset, epoch initialization or Stage+Production V3 smoke has occurred. Installed Production preflight is legacy PASS, root-owned protected configurations cannot be edited by current command-specific sudo, and no Upstash control-plane credential is configured. Do not merge/deploy/reset until operator readiness. No new Storage/HMAC work, financial operation or Account Deletion activation was performed.

- Historical verified: T05d4 operator preparation: independent #1129 durable dry-run/apply/verify executor, root-owned configuration/credential procedure, restricted Netlify adapter;570-record real read-only dry-run PASS. Local fundamental regression coverage for ambiguity/lock/retry/config safety. No password reset or historical deletion.
- Historical unresolved: T05d4 actual window: protected root prepare; exact supported Stage avatar-v3 artifact readiness; Upstash owner reset only after READY; hidden-token root commit; scoped Netlify distribution/drain; final snapshot/CAS reset; both V3 deployment/epoch/smoke. Follow independent operator document. #1124 remains Draft, deletion OFF.

- Historical verified: T05d4 real owner credential rotation/configuration, final protected570-key backup, dry-run, journaled CAS570DELETED, independentverify, retained2V3 values, namespaceepochsNX,0V2repopulation.
- Historical verified: T05d4 supported Stage13481825 Netlify+WS release and real login/XP0→30/anonconversion→60/rank/profile/browserrefresh/authenticatedWS ping smoke; no financial operation or deletion activation.
- Historical unresolved: T05d4 Production completion BLOCKED by GitHub token ready/merge permissions: owner Ready+merge only #1129, then standard Production exact-SHA Netlify/WS deployment and actual nonfinancial V3 smoke. Production XPcurrentlyHTTP500/oldruntime; do not call migration complete. Both projects Auth/profile counts/balance sums stable,0unbalanced hot ledgertransactions; scope/limits in redis-cutover.md.

## Protected Stage E2E window — 21 October local preparation

- [x] T07b-window-code Separate fixed Stage operator reuses SecureFiles/lock/atomic backup; preflight/dry-run, prepare, activate, verify, deactivate/restore; whole-file baseline and restricted ON derivation; interruption/drift/foreign-environment fundamentals.
- [x] T07b-window-plan Document exact protected installation/hash pins, actual Netlify branch scopes, required Functions deployment, ordered release/worker-safe closure and immutable ON authority handling (quickstart.md). No configuration changed.
- [ ] T07b-window-install Separate GO: protected bundle install/prepare and actual OFF/LIVE baseline proof; never execute staging source as root.
- [ ] T07b-window-run Separate GO: Stage alias-only ON/OFF deployment, fixed WS activation/restore and safe Preview restart, DB release last/first; preserve recovery until actual terminal completion. Revalidate fixture/financial scope before destructive E2E. Retire only the window-created ON deploy after OFF alias/fallback checks under explicit GO.
- [ ] T07b remains OPEN: no new E2E/activation evidence from local tests. PR remains Draft, no Production or merge.

Local verification for window preparation:13 Python window/configuration tests,7 unchanged Redis operator tests,11 workflow/preflight tests and32 deletion/Storage/local-E2E regression tests passed (`XP_TEST_MODE=1`, local fixtures only). Syntax227/CSP55 passed; lifecycle, games-XP hook and authoritative transport guards passed. Full check:all reaches five existing missing-badge mockup HTML violations; unrelated paths unchanged. Local privileged rsync contract cannot finish without passwordless sudo; retain CI root-run result separately. No Stage E2E or activation performed.

## Conditional final E2E GO — interrupted RESTORE gate (21 October)

- [x] Added one fundamental interrupted-restore regression: interruption after OFF replace leaves phase restoring, verify/preflight refuses the transition, restore resumes and matches the exact original OFF SHA-256. Existing preflight test also rejects OFF bytes with restoring authority. Operator/helper code and all three reviewed installation hashes remain unchanged.
- [ ] Protected installation is BLOCKED by actual VPS privileges: copilot sudo permits fixed preflight/restart commands, not root installation/Python operator. Root-owned environment metadata remains0600 and parent0755; no broad sudo or credential escalation. Prepare/activate/restore require the authorized root operator session; do not bypass through Redis operators. No activation, funding, BURN, Storage DELETE or Auth delete performed.

## Final E2E attempt — fixture confirmation blocker

- [x] Protected window prepare/activation owner-root proof, safe authorized WS restart and exact91c LIVE/health/browser Auth+WS smoke; branch-only Netlify ON runtime verified.
- [x] STOP before first destructive operation: reserved subject email plus Stage confirmation requirement makes ordinary verified same-email re-registration unavailable. DB release never enabled, requests0, BURN/Storage DELETE/Auth delete0; subject/control/July data preserved.
- [x] Netlify branch OFF/prior marker absence restored and OFF immutable6ad88b82d4dc63d285f15c0f verified; Production unchanged.
- [ ] Owner root restore exact protected WS baseline, agent safe Preview restart/processOFF proof, then retire only window-created ON deploy6ad889618f2adbfbd14859db after alias safety checks. No worker disable during an accepted unfinished operation (none accepted here).
- [ ] Owner decision: allow official Admin confirmation ONLY for newly re-registered disposable UUID as declared test setup, or approve a deliverable identity procedure; no speculative email/OTP infrastructure or global configuration changes.
- [ ] T07b destructive E2E remains NOT RUN/NO-GO until this fixture prerequisite is resolved. No code defect or successful deletion is claimed.

## Previous window CLOSED; confirmation exception accepted (21 October)

- [x] Owner root restore/verify OFF, protected LIVE proof, safe Preview restart at10:10:45UTC/newPID11501; health/browser Auth+WS PASS; ledger unchanged/escrow conserved. Original DB releasefalse/requests0; NetlifyOFF6ad88b82d4dc63d285f15c0f.
- [x] Retired ONLY ON deploy6ad889618f2adbfbd14859db: DELETE204, metadata/immutable root/account-delete GET+POST/avatar POST404, active alias fingerprints and Production unchanged; verified10:13:41.280518UTC. Previous window fully closed before beginning next.
- [x] Owner explicitly approved official Admin email confirmation ONLY for the actual new disposable UUID after old subject real hard-delete and successful ordinary public same-email signUp. No Admin createUser/SQL fallback; signup rejection is STOP. Email delivery/confirmation link NOT TESTED. Old subject/other existing users must not be administratively confirmed.
- [x] Fresh117/117/guards/REDIS-RELEASE/original subject checks; following Netlify branch-only ON deploy6ad8913597cbf65ecb017f0a READY/served91c, real subject password login/read-only account-delete404; Production/unrelated contexts unchanged.
- [ ] Next window WS activation requires owner root fixed operator; WS currentlyOFF and DB releasefalse. No destructive E2E/funding/new players/BURN/Auth delete yet. Retain exact new ON identity for safe terminal closure.

## Current accepted Stage request — historical-seat recovery blocker (21 October)

- [x] Reviewed protected activation, safe Preview restart and live exact91c/Stage/V3 smoke; three normal Welcome/replay checks, subject XP, funded JOIN and real unequal-stack all-in/showdown/cash-outs executed.
- [x] Real UI Cancel no-request and confirmed durable POST202; fixture-scoped lost HTTP response retained private capability. DB releasefalse after STOP; recovery remainsON.
- [x] Diagnose CLOSED/HAND_DONE/ESCROW0, INACTIVE0 historical seat without state stack key causing canonical Leave `stack_ambiguous`; no manual data/finance correction.
- [x] Local shared predicate for runtime drain and independent retirement guard; reproduce before fix and fundamental fail-closed/replay regression. No migration or remote runtime change.
- [ ] Separately authorized exact-SHA WS Preview deployment and automatic recovery of the SAME accepted request, with DBfalse and safety/drain checks. No new request, fake receipts or manual incident clearing.
- [ ] Actual one BURN, canonical Storage/Redis/profile cleanup, Auth-last; then normal same-email signUp/new UUID, approved Admin confirmation of ONLY that new UUID, normal Welcome once. Currently BURN0/Storage DELETE0/Auth delete0; old Auth still present.
- [ ] Active-all-in deletion timing remains unproven (acceptance snapshot SETTLED). Google/email delivery NOT TESTED.
- [ ] All accepted requests terminal, verified Netlify/WS OFF and safe current ON retirement. WS/Netlify deliberatelyON during recovery; do not mark closure complete. T07b remainsOPEN/blocked, PRDraft.

## Real same-request recovery result —21 October

- [x] Accepted known age-only incident, fresh pinned read-only preflight, main-defined exact503be776 WS Preview Deploy39597072168, new actual process, both contexts/LIVE/healthPASS. No Netlify deployment for recovery.
- [x] Natural SAME request poker→burn→cleanup→auth→COMPLETED; incidenttrue retained and no manual lease/status/progress edits. One balanced400CH BURN/one registry receipt; retiredUSER0, peers/escrow/conservationPASS.
- [x] Canonical four-manifest cleanup/reconciliation, two existing outputs removed, seven exact authenticated NoSuchKey reads, control/July objects/profile/Auth unchanged. Redis per-UUID cleanup and sticky fencePASS; Auth-last/oldAuthabsentPASS.
- [x] Ordinary same-email signup attempted AFTER completion:HTTP400, zero new accounts; STOP without Admin fallback/confirmation/payment.
- [ ] Actual new-UUID registration/login/Welcome remains NOT TESTED after rejected signup; deliverable fixture procedure needs review. Email delivery/Google NOT TESTED.
- [ ] Review actual retained two historical INACTIVE0/CLOSED/ESCROW0 seats (no AuthFK), their old-UUID retention/cleanup policy; correct prior cascade assumption. No manual remote seat/state delete authorized.
- [ ] Review completedtrue+requiresInterventiontrue status presentation; keep historical incidenttrue. User UI has no status polling.
- [x] All accepted requests terminal, DBfalse; branch-only NetlifyOFF6ad8ac5e86ce1c2d1e5c96ee ready/Functions503/marker absent/Production unchanged.
- [ ] Owner protected root restore → agent safe Preview restart and actual processOFF → alias-safe retirement ONLY ON6ad8913597cbf65ecb017f0a. WS stillON pending this step; do not claim complete closure or full E2EPASS.
- [ ] T07b/merge-readiness remainOPEN; PRDraft. No Production change/migration/reset/new financial policy.

## Terminal window closure —21 October

- [x] Owner protected root restore/verifyOFF; pinned LIVE preflight, actual safe Preview restart PID20592, health and browser Auth+WSPASS; all accepted requests terminal/DBfalse.
- [x] USER fingerprint/peer balances/claims18/totalCH300/unbalanced0 unchanged. Resumed bot-only activity remains balanced, no human/pending settlement interrupted.
- [x] ONLY ON6ad8913597cbf65ecb017f0a retired204 after publish/branches/split/alias/fallback checks; metadata/immutable root/functions404, active OFF alias/Production unchanged. Retain OFF6ad8ac5e86ce1c2d1e5c96ee and private backups/receipts.
- [ ] T07b full E2E remainsOPEN for real same-email re-registration after signupHTTP400; historical seat data disposition and completed+incident status presentation remain review findings. No new activation/destructive action authorized by closure.

## Review follow-up (no environment writes)

- [x] Read-only provider logs confirm signup400/email_address_invalid on pinned Stage; audit SDK redirect versus direct harness (no redirect). No retries/Admin workaround.
- [x] Audit exact two states/seats, dependencies and caches; discover both table.created_by references. Save private evidence; define field-aware per-UUID projection/CAS and repair safety in plan.md.
- [x] Local deletionStatus hides active-intervention flag for COMPLETED while preserving DBincident; one fundamental red/green PGlite test.
- [ ] Separate GO BEFORE implementing/executing Poker privacy cleanup. Preserve active all-in, other users, table history/finance/idempotency and RAM/SQL consistency; include OPEN-table/positive peer escrow case, not CLOSED-only blocking.
- [ ] Separate bounded repair GO for original COMPLETED fixture request: exact TWO audited tables, no phase/lease reset, no new request/BURN/Auth action. All flags remainOFF.
- [ ] Full E2E requires supported deliverable identity signup first, real post-delete new UUID/login/Welcome once, no inherited state, zero residual operational UUID in seats/state/created_by, control/financial invariants and correct COMPLETED status presentation. Financial/audit retention exceptions remain explicit. Google/email delivery cannot be silently markedPASS.


## Accepted Poker privacy implementation — local scope

- [x] Implement owner-scoped operational cleanup after actual retired wallet proof and before Auth-last; actual residual-reference query gates Auth. Preserve all other players and immutable finance/history.
- [x] Coordinate table queue, row locks/version+JSON CAS and cache restore; quarantine failed resync and recover even after SQL owner references disappear.
- [x] Support released owner on OPEN tables with other-player escrow; block unsettled all-in/pending settlement/unknown references.
- [x] Add bounded, idempotent completed-request repair through existing Preview-only private maintenance operation, exact two-table scope, no invented request/lease or financial/Auth action. CODE ONLY.
- [x] Fundamental local regressions for CLOSED/retry, OPEN/escrow peers, all-in, unknown fields, CAS failure, cache resync, completed repair and unchanged financial receipts.
- [ ] Separate GO: exact-SHA WS Preview deployment and repair of original completed fixture's two audited tables; verify actual cache and operational UUID absence. No remote repair performed.
- [ ] Full hosted E2E/new UUID/ordinary Welcome with supported test address; Google/email delivery NOT TESTED. PR remains Draft and merge-readiness OPEN.

Earlier unchecked implementation-before-GO and status-presentation findings are superseded by this accepted local implementation and the COMPLETED API regression; historical hosted results above are preserved unchanged.


## Final review: two bounded fixes

- [x] Read/state/snapshot/resync/publication fence during privacy quarantine; invalidate captured pre-await views and clear snapshot/replay caches. Fundamental failed-restore → unavailable read → canonical restore regression.
- [x] Root-owned protected repair manifest, fixed path/O_NOFOLLOW/metadata checks, exact raw SHA pin and approved table/version/state hashes. Both tables repair atomically with CAS; approved exact clean-state retry only. Fundamental drift/hash rejection and unchanged finance regression.
- [ ] Separate final GO: install reviewed manifest, exact-SHA WS Preview deploy and bounded two-table repair per plan.md. All Stage/Production writes and deployments remain unexecuted in this review.


## Actual bounded repair attempt — STOP

- [x] Owner installed approved root-owned manifest; fresh Stage117/117/no-drift/guards/LIVE/OFF preflight and exact15b5666f Preview deployment verified.
- [x] One canonical repair attempt; HTTP500/poker_privacy_conflict. Read-only proof confirms complete SQL rollback, original versions5/45 and all financial/peer/immutable history invariants unchanged. No automatic retry.
- [x] Diagnose serialized JSON double-encoding through actual Stage driver SELECT; minimal local text-first JSON casts and fundamental binding regression.
- [ ] Review corrected runtime SHA, then controlled deployment and same-manifest repair. Existing operational references remain; no root reinstall, new deletion request/BURN/Auth action or migration.


## Current final minimal T07b — supersedes stale follow-up gates above

- [x] Accepted Stage Poker privacy repair CLOSED; no repeat historical-table/manifest/all-in work.
- [x] Dedicated deliverable disposable identity: actual public signUp/new UUID, delivered confirmation link, normal password login; no Admin workaround.
- [x] Ordinary Welcome500 exactly once and retry denied/same receipt; one balanced ledger transaction/two entries/one registry receipt; global campaign counts unchanged; XP0/no avatar.
- [x] Read-only readiness:117/117 hashes/guards, Stage Redis V3 LIVE, DB/Netlify/WS OFF, no unfinished request or unsafe human/pending Poker operations. Protected installed sources match approved hashes.
- [ ] Separate GO: existing root window dry-run/verify, branch-only exact-runtime Netlify ON, protected WS activation/safe restart and DB admission LAST. Existing admission is Stage-wide; only this subject may be submitted operationally.
- [ ] Minimal real deletion → Auth-last → same-email ordinary signup/real confirmation/new UUID/zero inherited data/Welcome once; no repeat Poker tests. Close DB admission after durable acceptance and preserve worker until terminal completion.
- [ ] Verify all layers/process OFF and alias-safe retirement of only the new ON immutable deployment. Full T07b/merge-readiness OPEN; PR remains Draft, Google NOT TESTED.


### Owner-selected final alias supersedes earlier fixture selection

The exact dedicated alias subsequently specified by the owner is now the ONLY intended final T07b deletion/re-registration subject. Its full address, UUID and credentials remain in the protected private owner-alias campaign record, never in public artifacts. Read-only Stage lookup first proved it unused. Ordinary browser public signUp returned200/new UUID; the actual Gmail confirmation message was delivered and its signup link followed (provider303). Normal password login PASS; ordinary Welcome500 CH paid exactly once, retry denied with the same receipt. No Admin API confirmation/createUser or validation bypass. The previously prepared alternate-alias account and the base-address account are outside deletion scope and remain untouched.

The same exact owner-selected alias must be reused after the separately authorized deletion; do not substitute the base address or any other alias. No activation/deployment/deletion occurred in this prerequisite campaign; existing separate-GO Stage-window plan is unchanged.


## Final owner-alias T07b campaign — deletion PASS; re-registration STOP429

Fresh Stage117/117 hashes/guards/Redis V3/financial readiness passed; approved subject had500 CH, no avatar or Poker participation. Branch-only Netlify ON6ad8f8addfc234640dcb686e served exacta6e8e4dda45e2908b385d3242691bf3f6cc0ba4b; protected owner activation and safe Preview restart installed the same WS runtime, LIVE/health/browser Auth+WS PASS. DB admission enabled last, one ordinary authorized POST returned202 and durable request; DB admission immediately returnedfalse. No new Poker scenario/history repair was performed.

Automatic worker progressed preparing→poker→burn→cleanup→auth→COMPLETED with incidentfalse, no operator retry. Exactly one500 CH balanced BURN/two entries/one idempotency receipt; retired USER0. Auth remained present before auth phase, official Admin lookup404 at terminal completion; prerequisites/receipts confirm Auth-last. Profile/Redis absent, sticky lifecycle fenceBLOCKED, zero operational Poker references. Avatar objects/manifests0, so actual Storage DELETE count0 (not a repeated nonzero Storage test). Other USER wallets/profiles and global campaign counters equal the protected pre-window snapshot. Old JWT profile access401. All accepted requests terminal.

Ordinary public same-alias signUp was attempted exactly once after COMPLETED and returned429/over_email_send_rate_limit. Read-only lookup confirms no replacement Auth account exists. No Admin workaround/config change/retry; newUUID/login/Welcome after re-registration NOT TESTED. Earlier successful registration/mail/Welcome remains prerequisite evidence, not proof of re-registration. Full T07b remains OPEN, not merge-ready. STOP triggers safe window closure because no request/recovery is unfinished: DBfalse, branch Netlify OFF restoration/deployment in progress, protected WS restore and actual processOFF verification still required before ON retirement. Runtime/Production untouched outside approved Stage operations; retain protected evidence.


### Owner-alias campaign CLOSED — 21 October 2026,18:13 UTC

Root operator restored/verified exact OFF baseline and LIVE. After fresh terminal-request/financial/no-active-human/no-pending-Poker checks, WS Preview safely restarted at18:12:30UTC, processPID43714, exactruntimea6e8e4dda45e2908b385d3242691bf3f6cc0ba4b; systemd uses the protected restored EnvironmentFile. Local/public health, LIVE and ordinary control Auth/profile/browser↔WS PASS. No direct process-environ read is claimed. DB releasefalse; all requestsCOMPLETED; other USER balances/profiles/campaign counters unchanged. Netlify OFF immutable6ad8fce33ac6254e49494b9f serves the same runtimeSHA, account-delete503. Only campaign ON6ad8f8addfc234640dcb686e retired204; metadata/root/GET+POST Functions404, aliases/published Production and unrelated preview fingerprints unchanged. No recovery outstanding. Do not rerun activation/restore/deletion or retire any other deployment.

Remaining final T07b step ONLY: after provider email-send quota permits, separately approve one ordinary same-owner-alias public signUp, delivered link confirmation, password login/new UUID/no inherited CH/XP/profile and ordinary Welcome500 once plus denied retry. No deletion window/Poker/Storage operation is needed for that remaining check. Previous429 created no account; no administrative bypass or quota/config change was performed. Full T07b and merge-readiness remain OPEN; Google NOT TESTED. PR staysDraft.


## Final T07b same-email re-registration PASS — 21 October 2026

Supersedes the429 blocker above. Read-only Management API confirmed Stage built-in email provider, rate_limit_email_sent2/hour, smtp_max_frequency60s, confirmation required. Selected Auth logs showed confirmation sends17:06:18/17:17:00UTC and the prior signup429 at17:56:18, no later sends through18:30. The owner-authorized ONE retry was therefore made after the documented one-hour quota window, not on an arbitrary timer. Official rate-limit reference: https://supabase.com/docs/guides/auth/rate-limits . Previous429 headers were not captured; available logs have no Retry-After. The new attempt captured selected Date/Retry-After/status privately. No SMTP/rate-limit settings changed.

Actual ordinary browser public signUp200 for EXACT same owner-selected alias produced a distinct UUID. Real Gmail signup message arrived, actual provider confirmation link303 and normal password login PASS, no Admin create/confirm/bypass. Before ordinary Welcome, new wallet absent/zero and no Welcome receipt; new profile default/no avatar and XP0. Welcome500 once, second POST denied/alreadyClaimed with same receipt. SQL verifies one balanced transaction/two entries/one idempotency receipt for the NEW UUID. Old Auth UUID remains absent; old lifecycle fence and completed deletion history remain separate, with no inherited CH/XP/profile ownership. Sensitive alias/UUID/password/token/mail link remain outside public artifacts.

Final read-only checks:117/117 hashes/guards, Redis V3 LIVE, DB releasefalse, no unfinished requests, active humans0/pending Poker0, unbalanced transactions0; all other USER balances/profiles and campaign totals unchanged. Netlify flag values all0/temporary marker absent/published Production unchanged; WS process43714 still the restored OFF process, health/LIVE PASS. No new deletion request/BURN/deploy/migration/reset/root operation was made in this final registration step.

- [x] Final minimal password/email T07b: actual deletion/Auth-last plus same-email public re-registration/newUUID/real email confirmation/login/Welcome-once PASS across the documented controlled campaign. Accepted earlier Poker/privacy evidence is not rerun.
- [x] All layers OFF and no recovery outstanding; only this campaign ON deploy already retired.
- [ ] Google OAuth remains NOT TESTED without a separately authorized dedicated identity; do not infer Google PASS from password evidence.

Ready for owner review after final CI; this is not authorization to merge, deploy Production or activate Account Deletion. Prior Draft/OPEN/429 checkpoints above are historical and superseded only for the completed minimal email/password T07b. Accepted MVP late-upload risk remains separately tracked in#1128; cross-account anti-farming remains#1131, Welcome remains per UUID.


### PC1 local result (no push)

- [x] One Production-equivalent20261021191104, final disabled schema/manifest provenance, no historical migration edits.
- [x] Existing disposable PostgreSQL17 harness: equivalent apply/late rollback/drift/replay, old82aee39d+current modules, five historical synthetic PROMO without repay, unchanged accounting/archives, legacy avatars/RLS/Production pruner-wrapper/ESCROW contracts.
- [x] Separate managed-role NOSUPERUSER local apply PASS; grant/CREATE restoration and OFF/v3D validated.
- [x] Local syntax/CSP/guards/manifest PASS; standard harness path without old checkout PASS.
- [x] PC2/P2 Production exact-file apply under subsequent owner GO:65→66, schema/ACL/retention/quota/read-only smoke PASS; see production-compatibility.md P2 result.
- [ ] PC3/P3 merge/automatic deployment and PC4/P4 feature activation remain separate owner approvals. No push, new CI run, merge or deployment performed.


### P3 release readiness review —22October2026

- [x] Fresh Production66/P2 catalog compatibility,OFF/v3D,RedisV3 LIVE and current82aee39d runtimes verified read-only.
- [x] Main push workflow/deployment/restart/rollback surfaces and strict branch rules reviewed; see production-compatibility.md P3.
- [ ] Owner approves publication of local applied-equivalent/provenance/tests/docs plus final Stage Preview/CI and explicit treatment of Ready-PR Stage apply.
- [ ] Real Netlify required Preview status for finalHEAD (currently absent); final CI after publication.
- [ ] Owner supplies current CHIPS_INTEGRATION_ENABLED absent/0 evidence, or separately authorizes reviewed target/fixture; API403/current condition unknown.
- [ ] Owner selects standard merge+automatic OFF deployment(recommended) or temporary strict merge-only pause; no skip-token/protection bypass.
- [ ] After separate GO: exact mergeSHA deployments,nonfinancial smoke,recovery verification; Production activation remains independentP4.


### Production activation policy update (2026-10-22)

Owner accepts unobserved previously issued avatar capabilities. A truthful, privileged cutover acceptance may waive only the fixed global 7200-second delay; every known `capability_until`, uncertain operation, ownership, receipt and lease guard remains mandatory. Existing markers without acceptance retain the original wait. See `research.md`, section “Production activation: owner-accepted unobserved capability risk”.

Local implementation: `20261022091126_account_avatar_known_capability_policy.sql` and `private.account_avatar_safe_after(marker)`. No remote apply, acceptance marker or activation has occurred. Production-equivalent SQL after history 66 and a reviewed protected Production ON/OFF procedure are still prerequisites. Current protected Production preflight refuses ON; do not bypass it. New changes must be reviewed separately because #1124 is already merged. Default behavior remains OFF.

### Production recovery — missing WS service-role key (2026-10-22)

- [x] Confirm owner root proof of missing key, guarded DB admission OFF, real RETRY/cleanup/one balanced BURN500; retain worker and evidence.
- [x] Verify existing Netlify Production key identity by role/ref and read-only pinned provider API; never publish the value.
- [x] Prepare local fixed credential-extension modes in existing Production operator and matching preflight, preserving original anchor/backups/manifest; fundamental interruption/drift/OFF/ON tests.
- [x] Separate owner GO A: install reviewed bundle, pipe-only dry-run/prepare/verify; no restart or admission.
- [x] Separate owner GO B: restart exact runtime with key, natural recovery of SAME durable request through cleanup/Auth-last; prove one BURN only and other users unaffected. No manual state/financial repair.
- [x] Separate owner GO C: reopen admission only after real terminal recovery and final checks. Do not close #1117 based on the accepted earlier Stage T07b or local tests.

Earlier preparation-only status notes are historical. Production currently has schema67 and deployed59cb0998, tracking/guards/readiness PASS, runtime flags ON but DB admission OFF for this recovery. #1128 remains accepted scope limitation, #1131 deferred, Google OAuth NOT TESTED. No remote changes are part of this local preparation task.

### Production final acceptance and repository publication (2026-10-22)

Owner accepted Production Account Deletion LIVE as PASS. A installed the reviewed credential extension without changing historical anchor/backups; B restarted the exact59cb0998 runtime and naturally completed the same durable request; C enabled DB admission at 2026-10-22 22:25:18 UTC after fresh readiness/finance checks. Previous preparation-only OFF/RETRY statements above are historical, not current operating instructions.

- [x] Production request COMPLETED; exactly one balanced BURN500; retired USER closed0; Auth-last verified; no incomplete requests or unbalanced transactions.
- [x] Netlify/WS flags ON, DB admission ON, schema67, tracking/guards ready, Redis V3 LIVE; limited login/profile/CH/XP/ranking/browser-WS smoke PASS with no new deletion.
- [x] Reviewed operator/helper/primitive bytes match installed VPS SHA-256; no secrets, protected manifests or backup files included in publication.
- [ ] Publish this existing service-role correction through a separate reviewed PR and green CI; owner merges separately. Keep #1117 open until publication.

Explicit limitations: **Storage DELETE with a real avatar NOT TESTED** in the final Production deletion E2E (subject had no avatar); **Google OAuth NOT TESTED**; late upload #1128 and cross-account antifarming #1131 remain outside accepted MVP scope. Do not represent these as PASS. No new Production operation is authorized by this documentation PR.
