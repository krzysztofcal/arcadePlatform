# Implementation Plan: NORMAL/SLOW periodic per-tier pools with manual RESTRICTED

**Branch**: `docs/issue-1018-bot-quarantine` | **Date**: 2026-09-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/796-bot-quarantine/spec.md`, solely live #1018.

## Summary

Extend existing authoritative JOIN and settled rollover with NORMAL/SLOW plus manual-only FORCE_RESTRICTED, sticky SLOW-only table compatibility and shared user-lock 4-active/4-pending limits. Runtime spends exact pre-existing tier/class bankroll funds; RESTRICTED has no bankroll or refill policy. A separate three-hour systemd-dispatched job refills each eligible pool once by configured amount. Existing Admin tunes access/refill policy and override, WS live lobby adds only minimal occupancy compatibility, and DB Quick Seat stays DB-backed. This is economic containment; Sybil and split wealth remain accepted. T001–T029 are historical implementation/evidence; T030–T035 implement the final live #1018 amendment, T036 is its new exact-SHA WS/Caddy/runtime gate, and T037 is the required pre-merge Stage acceptance.

## Technical Context

**Language/Version**: Existing JavaScript .mjs backend/global browser JS; Node 20 workflow baseline, existing repository manifests authoritative at implementation.

**Primary Dependencies**: Existing postgres client, ws, Netlify functions, ledger helpers; no new packages/frameworks.

**Storage**: Existing PostgreSQL/Supabase persistence; the applied #1018 schema remains immutable and the amendment adds one forward-only CHECK extension migration accepting `FORCE_RESTRICTED`. No new tables, columns, bankrolls, policy rows, receipt/counter service or table marker are introduced for RESTRICTED; existing balances and provenance remain preserved.

**Testing**: Existing node:test behavioral suites, one isolated local PostgreSQL concurrency suite; no UI/CSS/JSP/glue suites. T016/T019/T020 also extend existing `tests/chips/chips-ledger-stage-automation.workflow.guard.test.mjs` and `ws-tests/infra-vps-workflow.guard.test.mjs` with small deterministic security/authority guards, using their existing YAML/source assertion and local stub patterns, without a new framework or broad scheduler suite. Verify refill workflow has only workflow_dispatch, canonical repository/ref and actor/environment/feature mutation gates, dry-run/read-only default and separate Production GO; inputs alone cannot authorize mutation. Verify exact VPS repo/workflow/ref/mode dispatch, GitHub credential only, no Supabase/DB secrets or SQL/ledger writes and timer only waking dispatch. Verify new artifacts install only under fresh/rebuilt bootstrap contract without enable --now/start/dispatch; existing-host targeted install stays separate and installation/deploy cannot activate. Scope bootstrap assertions to new refill artifacts. Include negative unauthorized-input cases on the guarded path; tests perform no real dispatch/systemd/DB actions. These are fundamental financial-authority guards, not rendering/glue tests.

**Target Platform**: WS on Ubuntu/systemd, Netlify adapters, GitHub-hosted operational jobs dispatched by VPS.

**Project Type**: Existing realtime poker web application with operational refill job.

**Performance Goals**: Zero extra classification DB reads/writes for unchanged below-threshold settled hands; O(active humans at this table) in-memory comparison. One batched pending-first/connected/still-seated access refresh per ≤30s, policy read in same background cycle; bounded paging and no global account scan. No viewer×table SQL. Mandatory narrow user_id-leading poker_seats active-membership and created_by-leading poker_tables pending-owner access paths matched to final status/participation predicates, limited to five qualifying distinct tables with selective indexed EXISTS probes. No global seat/table scan on fresh JOIN/Create. T002 provides missing indexes; an existing sufficient path requires recorded SQL/index/EXPLAIN evidence instead of a duplicate. T027 verifies query shape and EXPLAIN on representative local PostgreSQL fixtures. Indexed exact pool/bucket refill lookup; no ledger history scan.

**Constraints**: Cached access/policy max age 30s, missing/stale fail-closed only for new admission/funding. No per-hand wallet/policy/override/refill-policy reads. No runtime MINT. 4 active + 4 pending per user. Fixed current 3h UTC bucket, one amount/pool, no catch-up. JSP/global JS, klog, single-line CSS selectors, CSP SHA for any future inline script.

**Scale/Scope**: Current bot tiers 100/500 only; explicitly provision pair+policy before future bot-tier enablement. Admin Users/Ops, current lobby/Quick Seat, one small refill worker and dedicated dispatcher assets; #869/#1017 untouched.

## Constitution Check

*GATE: Checked before research and rechecked after design.*

- **I — PASS**: Extend existing JOIN/Create/rollover/source/ledger/Admin/dispatcher. Only two shared helpers are justified by reuse across adapters (`bot-access`, `table-participation`), two narrow Admin endpoints and one operational job; no generic framework or new game service.
- **II — PASS**: WS retains game/lifecycle/live inventory authority. Existing DB-backed Quick Seat suggests only; final authoritative JOIN validates. Settled hook stays inside prepare/persist/commit, not a second settlement path.
- **III — PASS**: Unknown denies new admission/funding/refill; atomic rollback/unknown-commit recovery, payout retains existing legality. No merge or Production authorization. Local tests use isolated PostgreSQL; shared Stage was migrated by automatic DB Stage Apply PR. No Stage refill/MINT, Production operation, live-VPS installation/activation or merge was performed; prior Preview health evidence is recorded separately and the current amendment still requires its final exact-SHA gate.
- **IV — PASS**: External global `js/admin-page.js` and existing poker scripts; klog only. CSS one selector per line; any new inline script requires CSP SHA in the same future change.
- **V — PASS**: Tests limited to deterministic critical classification, real transaction races, ledger, lifecycle and backend authorization. No UI/glue suite. Concrete paths and functions below/tasks; no full implementation or Git commands.
- **Deployment — PASS**: Publishing this branch's `supabase/migrations/**` intentionally mutates shared Stage through DB Stage Apply PR; the effect is declared in the feature artifacts and applied migrations are forward-only. WS runtime changes require manual exact runtime SHA WS Preview Deploy, verified workflow success for that SHA and targeted runtime smoke. The Stage-only refill canary is **AUTHORIZED FOR PRE-MERGE STAGE ACCEPTANCE / NOT RUN** and must use the official workflow with an exact reviewed PR SHA after the WS/Caddy gate; it is a separate acceptance gate, not a post-merge action. Production migration, pool seed, refill/scheduler activation need separate explicit GO. Automatic Stage apply completed as recorded in quickstart; no Stage refill/MINT, Production operation, live-VPS installation/activation or merge was performed. Prior Preview health evidence is historical; the current amendment still requires its own exact-SHA gate.

## Project Structure

### Documentation (this feature)

```text
specs/796-bot-quarantine/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── issue-source.md
├── quickstart.md
├── contracts/bot-quarantine.md
├── checklists/requirements.md
├── checklists/finance.md
└── tasks.md
```

### Source Code (repository root)

| Existing path / entry | Planned change |
| --- | --- |
| `shared/poker-domain/join.mjs::executePokerJoinAuthoritative` | User lock, active cap, wallet classification, accepted owner promotion, compatibility, accepted-only human marker |
| `netlify/functions/poker-create-table.mjs`, `_shared/poker-table-init.mjs::createPokerTableWithState` | Same user-lock pending cap before empty STANDARD initialization, no classifier/MINT |
| `netlify/functions/poker-quick-seat.mjs::selectExistingActiveSeat/selectCandidate/recommendSeatAtTable/createAndRecommend` | Resume first, fresh class filter, user→match lock order and shared limited Create fallback |
| `ws-server/server.mjs::runSettledRolloverCommand` | Cached settled-stack evaluation, actual-change persistence, effective class before positive funding, safe exhaustion fallback |
| `ws-server/poker/table/table-manager.mjs::prepareSettledHandRollover/commitSettledHandRollover` | Carry authoritative settled evidence and committed marker through existing prepare/persist/commit/restore |
| `ws-server/poker/persistence/persisted-state-writer.mjs::writeViaDb/writeReplacementFundings/writeManagedBotTopUps` | Actual-change access/marker persistence before positive funds/CAS, exact pools, generalize 500-only no-funding handling |
| `shared/poker-domain/table-economy.mjs::getBotFundingSystemKeyForBuyIn`, `bots.mjs::seedBotsForJoin`, `ws-server/poker/persistence/continuous-bot-table-repository.mjs` | Exact tier/class and enabled/provisioned pair, no fallback/MINT |
| `shared/poker-domain/terminal-close.mjs::normalizeFundingRows`, `leave.mjs`, WS/Netlify chips-ledger adapters | Preserve source attribution/legal payouts; do not replace original source with current table class |
| `ws-server/poker/bootstrap/persisted-bootstrap-repository.mjs`, `persisted-bootstrap-db.mjs`, `persisted-bootstrap-adapter.mjs::normalizeTableMeta` | Load/map is_slow_only into runtime metadata and recovery |
| `ws-server/server.mjs::buildLobbyTableEntry/syncLobbyTable/buildLobbySnapshotPayload`, `activeLobbyTablesById` | Shared slowOnly plus minimal bot occupancy/lifecycle facts, no personalized inventory; authenticated self access snapshot on connect/refresh |
| `poker/poker.js::canViewLobbyTable`, `poker/poker-ws-client.js` (the repository's realtime client) | NORMAL/SLOW/RESTRICTED-aware fresh targets, bot-free RESTRICTED filtering, existing resume, self snapshot handling, final JOIN still authority |
| `netlify/functions/admin-user-details.mjs::loadUserDetails`, `admin-users-list.mjs`, `admin-ops-summary.mjs::loadOpsSummary`, `js/admin-page.js` | Minimal Users/Ops fields/controls, optional existing-path pool balances |
| `netlify/functions/_shared/admin-auth.mjs::requireAdminUser`, `admin-bonus-campaigns.mjs::createAdminBonusCampaignsHandler` | Reuse authorization/validation patterns; no generic framework |
| `netlify/functions/_shared/chips-ledger.mjs::validateEntries/postTransaction` | Narrow trusted scheduled SYSTEM MINT capability; existing balanced ledger/idempotency remains |
| `infra/vps/arcade-chips-ledger-dispatch.sh/.service/.timer`, `infra/vps/bootstrap.sh` | Reuse external dispatch pattern; bootstrap additions only for future fresh/rebuilt VPS. Existing live VPS must use separate owner-approved targeted install, never bootstrap; installation cannot enable/start timer |

New implementation files are `shared/poker-domain/bot-access.mjs`, `shared/poker-domain/table-participation.mjs`, `netlify/functions/admin-user-poker-access.mjs`, `netlify/functions/admin-poker-policy.mjs`, `scripts/ops/poker-bot-pool-refill.mjs`, `.github/workflows/poker-bot-pool-refill.yml`, `infra/vps/arcade-poker-pool-dispatch.sh/.service/.timer`, and `tests/chips/poker-pool-policy.transaction.test.mjs`; the original `supabase/migrations/20260927100000_poker_bot_quarantine_policy.sql` is immutable and the amendment adds only `supabase/migrations/20260927110000_poker_force_restricted.sql` to extend its override CHECK. The original migration was applied to shared Stage by automatic DB Stage Apply PR (36310279719: 97→98, smoke PASS; 36310527312: 98/0, smoke PASS); the new migration intentionally follows the same forward-only DB Stage Apply path. Production remains separate GO. Existing test files are enumerated in tasks/quickstart.

**Structure Decision**: Keep current packages and authority boundaries. Legacy feature/contract filenames are retained so #1019 links remain valid; all contents are rewritten. No dependencies, generic setup files or unrelated cleanup.

## Phase 0 — Research decisions

[research.md](research.md) R1–R8 resolves control points, cache, limits, pool isolation, bucket replay, Admin/dispatcher, discovery and validation. No unresolved design placeholders. Main findings: current 100→TREASURY routing changes for future funds; current ledger does not yet allow the scheduled SYSTEM MINT shape; current JOIN human marker must move after actual acceptance; current exhaustion paths have 500-specific logic.

## Phase 1 — Design and contracts

[data-model.md](data-model.md) defines fields and transitions; [contract](contracts/bot-quarantine.md) defines lock, cache, funding, refill and API behavior; [quickstart.md](quickstart.md) defines later validation. Essential sequence:

1. **Create/JOIN capacity**: canonical user advisory lock→Quick Seat match lock if used→table/state→ordered account locks. Fresh count after lock; fifth rejected before any consuming mutations. Rejoin bypasses fresh-slot/class denial but not existing authentication/financial correctness. No user advisory lock acquired later from rollover while holding table locks. Leave/close release only; safe conservative counts are acceptable.
2. **JOIN**: read authoritative policy/access/wallet at existing admission transaction; persist threshold-driven automatic SLOW independently of policy denial and even under FORCE_NORMAL, then derive effective state from override and check cap/compatibility and safe owner promotion. Only accepted seat/rejoin changes human marker. Promotion and new seat/buy-in are atomic; failure does not leave false ownership claims. No Create classifier.
3. **Settled rollover**: use existing authoritative settled human stacks before planning new bot funding; compare only fresh cached snapshots. Actual changes persist through existing writer with revision reconciliation even when FORCE_NORMAL keeps effective NORMAL; it cannot suppress the automatic SLOW write. Confirmed effective class (not automatic state alone) and sticky marker drive next funding. Return to AUTO immediately derives SLOW from stored automatic state without another threshold check, subject only to existing revision propagation; FORCE_NORMAL never reverses the marker. Below threshold, no new classification SQL. Failure preserves already settled result, performs no new funds, and follows existing restore/retry; never publish uncommitted classification. UNKNOWN cannot promote table.
4. **Cache**: Admin access Save performs authenticated WS pre-invalidation, exactly one DB mutation, then at most three synchronous WS confirmations (each capped at 4 seconds, no sleep or DB-write retry). HTTP 200 requires ok/refreshed true, pending/failClosed false and the exact committed revision and requested override. A committed pending mutation is recovered synchronously by the next request; stale caller revision returns 409 stale_revision with current access and no new write/barrier. Truly concurrent uncommitted mutations remain 409 poker_access_mutation_pending. The bounded background refresh prioritizes pending IDs (including offline/nonseated users), then active sessions and seated humans, deduplicated to 512; it is a safety backstop, not Save confirmation. Authoritative SLOW persistence and cache/socket updates complete before barrier release and positive ACK. Failed confirmation remains fail-closed; lawful settlement/rejoin/leave/cash-out are unchanged.
5. **Funding**: locked table marker plus effective cached humans select exact provisioned tier/class. Sticky SLOW-only remains SLOW-funded even after FORCE_NORMAL, and old bots retain old-source attribution. Empty/unknown/disabled exact pool uses existing no-funding prepare/persist/restore; do not invent success or mint. Ordinary managed inventory remains NORMAL; existing transitioned managed table does not require a new lifecycle.
6. **Refill**: current policy FOR SHARE→exact pool advisory serialization→ordered ledger accounts; fresh balance and pool/bucket lookup; if below threshold and unused bucket, one MINT amount through narrow ledger capability. Pool+bucket unique metadata guard spans revisions; key also includes revision. Policy edit uses FOR UPDATE; disable/re-enable does not reopen consumed bucket. No table funding link or new receipt table.
7. **Admin/discovery/scheduler**: reuse authorization and small controls, WS inventory plus slowOnly, DB Quick Seat plus class filter; independent 3h dispatch-only job with no VPS DB credentials/SQL. Add installation wiring to bootstrap.sh only for future fresh/rebuilt VPS; never run bootstrap on existing live hosts. Existing-host installation follows the owner-approved targeted inventory/install/rollback flow in infra/vps/README.md and docs/chips-ledger-stage-automation.md, documented in quickstart. Installation and activation are separate; neither code deploy nor installation automatically enables/starts the timer. No activation during planning.

## Phases / handoff and breaking impacts

Spec→research/design→tasks→read-only analyze→accepted implementation; T001 records the explicit implementation instruction and no drift against live #1018. T027 proves the concurrency/index contract on a disposable local PostgreSQL fixture, and T028 records focused evidence, baseline comparison and the no-runtime-MINT/fallback review. The old sync blocker is obsolete; snapshot records current live requirements.

Implementation order: foundation→classification→limits→exact funding→scheduled refill→Admin→discovery→focused integration/cutover. T029 records the historical WS gate; T036 is the final amendment WS/Caddy/runtime gate; T037 is the separate **pre-merge Stage acceptance** gate. The Stage refill canary is tracked as `AUTHORIZED FOR PRE-MERGE STAGE ACCEPTANCE / RUN: NO-OP; owner acceptance incomplete` and is required before merge approval, but it does not replace WS runtime evidence. Production remains separate GO. Each story has an independent local test; do not activate partially migrated old/new funding writers. During authorized cutover, pause new admission/funding, allow legal hands/payouts, provision only missing pools at zero and policies, preserve existing account IDs/balances/provenance, deploy all writers/readers, verify and explicitly enable. Rollback must not restore TREASURY fallback or writers ignoring class/limits; keep affected new funding disabled until repaired. Applied schema is forward-only. Do not rewrite historical ledger or sources.

Breaking impacts: 100 NORMAL leaves shared TREASURY; every enabled tier has class isolation; SLOW fresh joins require SLOW-only but still support bots; tables never revert after override; 4+4 caps apply to both classes; cache propagation has a declared bound; pool exhaustion can pause bot availability until a later 3h refill. Admin gains live tuning and overrides. Native GitHub cron is not refill authority. Existing hands/payouts unchanged. Accepted economic gaps are explicit in spec; this is not fraud detection.

## Complexity Tracking

No constitution violations. No new receipt registry, generic policy/moderation service, personalized matchmaking, per-user bot allowance, global wealth aggregator or second settlement path. Final plan review confirms each new helper has multiple concrete callers and each operational artifact has a distinct required responsibility.

## Final live #1018 amendment — manual RESTRICTED sequence

The following sequence is additive to the completed T001–T029 history and is the implementation plan for the current Issue #1018 amendment. It does not introduce a third automatic class: `bot-access.mjs` continues to normalize automatic state to NORMAL/SLOW, while `FORCE_RESTRICTED` derives only the effective state RESTRICTED. Threshold evidence remains durable under every override, including FORCE_RESTRICTED, and Return to AUTO immediately reveals the stored automatic state.

1. **Source/spec sync (T030)** — retain the exact live snapshot in `issue-source.md`, then align spec, research, data model, contracts, quickstart and checklists with the manual-only override, no RESTRICTED funding/table marker, legal financed rejoin/settlement and the new Stage effect.
2. **Forward-only schema (T031)** — add one migration extending only `chips_accounts_poker_access_override_chk` with `FORCE_RESTRICTED`; update the exhaustive Production manifest/inventory as `needs-production-equivalent`. The already applied `20260927100000...` file remains immutable.
3. **Access/Admin/cache (T032)** — extend existing normalization, Admin endpoints/select/actions and WS self-cache payload to accept FORCE_RESTRICTED/effective RESTRICTED while automatic normalization remains NORMAL/SLOW; retain `requireAdmin`, revision/audit and legacy capability behavior.
4. **Admission/discovery (T033)** — update `executePokerJoinAuthoritative`, `poker-quick-seat.mjs`, `buildLobbyTableEntry`/`lobby_snapshot` and `canViewLobbyTable` so fresh RESTRICTED targets are ordinary, STANDARD and bot-free, with `botCount` occupancy compatibility; preserve existing financed resume and final JOIN authority.
5. **Settled funding (T034)** — use the existing cached settled status and `runSettledRolloverCommand`/prepare/commit flow to allow legal settlement but no new seed, replacement or managed top-up for an effective RESTRICTED human; CONTINUOUS_BOT remains NORMAL and no hand-loop reads are added.
6. **Focused validation (T035)** — extend only existing fundamental access, Admin, JOIN, Quick Seat, lobby, table-manager and migration contract tests; run migration guard and relevant local PostgreSQL checks without Stage refill/MINT or broad UI/glue tests.
7. **New runtime gate (T036)** — after CI, deploy the exact latest runtime-affecting SHA to WS Preview, verify matching release/deploy SHA and health, then run the narrow RESTRICTED smoke through the reviewed Infra VPS route. The prior T029 run is historical evidence only.
8. **Pre-merge Stage acceptance (T037)** — after T036, perform read-only Stage preflight, enable only the minimum supported tier, dispatch the already registered `chips-ledger-stage-scheduled-automation.yml` in its owner-only `poker-bot-pool-refill-canary` mode from the PR ref with the exact reviewed SHA and confirmation, and require dispatched SHA == checkout HEAD == worker reviewed ref before the one Stage worker invocation. The canary pins `POKER_BOT_REFILL_POOL_CLASS=NORMAL` so the NORMAL acceptance does not fund SLOW solely for the test; the standalone scheduler continues to evaluate both classes. Then hand off the narrow manual NORMAL/Play Now acceptance followed by read-only ledger/table verification. Stage refill is `AUTHORIZED FOR PRE-MERGE STAGE ACCEPTANCE / RUN: NO-OP; owner acceptance incomplete`; the standalone `poker-bot-pool-refill.yml` and `arcade-poker-refill-dispatch` remain the post-merge scheduler path, while VPS timer activation and Production migration/cutover remain separate unauthorized gates.

Production compatibility is a hard constraint through every step: a missing #1018 schema retains pre-migration poker behavior and legacy 100 CH provenance, while unrelated SQL errors propagate. The new migration is the only automatic Stage schema effect in this amendment; T037 separately authorizes the official Stage refill/bot-pool funding needed for pre-merge acceptance, while Production and VPS activation remain outside scope.
