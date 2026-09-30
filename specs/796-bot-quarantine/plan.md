# Implementation Plan: NORMAL/SLOW periodic per-tier pools with manual RESTRICTED

**Branch**: `docs/issue-1018-bot-quarantine` | **Date**: 2026-09-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/796-bot-quarantine/spec.md`, solely live #1018.

## Summary

Extend existing authoritative JOIN and settled rollover with NORMAL/SLOW plus manual-only FORCE_RESTRICTED, sticky SLOW-only table compatibility and shared user-lock 4-active/4-pending limits. Runtime spends exact pre-existing tier/class bankroll funds; RESTRICTED has no bankroll or refill policy. A separate three-hour systemd-dispatched job refills each eligible pool once by configured amount. Existing Admin tunes access/refill policy and override, WS live lobby adds only minimal occupancy compatibility, and DB Quick Seat stays DB-backed. This is economic containment; Sybil and split wealth remain accepted. T001–T029 are historical implementation/evidence; T030–T035 implement the final live #1018 amendment, T036 is its new exact-SHA WS/Caddy/runtime gate, and T037 is the required pre-merge Stage acceptance.

## Technical Context

**Language/Version**: Existing JavaScript .mjs backend/global browser JS; Node 20 workflow baseline, existing repository manifests authoritative at implementation.

**Primary Dependencies**: Existing postgres client, ws, Netlify functions, ledger helpers; no new packages/frameworks.

**Storage**: Existing PostgreSQL/Supabase persistence; the applied #1018 schema remains immutable and the amendment adds one forward-only CHECK extension migration accepting `FORCE_RESTRICTED`. No new tables, columns, bankrolls, policy rows, receipt/counter service or table marker are introduced for RESTRICTED; existing balances and provenance remain preserved.

**Testing**: Existing node:test behavioral suites, one isolated local PostgreSQL concurrency suite; no UI/CSS/JSP/glue suites. T016/T019/T020 also extend existing `tests/chips/chips-ledger-stage-automation.workflow.guard.test.mjs` and `ws-tests/infra-vps-workflow.guard.test.mjs` with small deterministic security/authority guards, using their existing YAML/source assertion and local stub patterns, without a new framework or broad scheduler suite. Verify refill workflow has only workflow_dispatch, canonical repository/ref and actor/environment/feature mutation gates, dry-run/read-only default and separate Production GO; inputs alone cannot authorize mutation. Verify exact VPS repo/workflow/ref/mode dispatch, separate chips/poker GH_CONFIG_DIR values and required `arcade-poker-refill-dispatch` actor, no Supabase/DB secrets or SQL/ledger writes and timer only waking dispatch. Verify new artifacts install only under fresh/rebuilt bootstrap contract without enable --now/start/dispatch; existing-host targeted install stays separate and installation/deploy cannot activate. Scope bootstrap assertions to new refill artifacts. Include negative unauthorized-input cases on the guarded path; tests perform no real dispatch/systemd/DB actions. These are fundamental financial-authority guards, not rendering/glue tests.

**Target Platform**: WS on Ubuntu/systemd, Netlify adapters, GitHub-hosted operational jobs dispatched by VPS.

**Project Type**: Existing realtime poker web application with operational refill job.

**Performance Goals**: Zero extra classification DB reads/writes for unchanged below-threshold settled hands; O(active humans at this table) in-memory comparison. One batched pending-first/connected/still-seated access refresh per ≤30s, policy read in same background cycle; bounded paging and no global account scan. No viewer×table SQL. Mandatory narrow user_id-leading poker_seats active-membership and created_by-leading poker_tables pending-owner access paths matched to final status/participation predicates, limited to five qualifying distinct tables with selective indexed EXISTS probes. No global seat/table scan on fresh JOIN/Create. T002 provides missing indexes; an existing sufficient path requires recorded SQL/index/EXPLAIN evidence instead of a duplicate. T027 verifies query shape and EXPLAIN on representative local PostgreSQL fixtures. Indexed exact pool/bucket refill lookup; no ledger history scan.

**Constraints**: Cached access/policy max age 30s, missing/stale fail-closed only for new admission/funding. No per-hand wallet/policy/override/refill-policy reads. No runtime MINT. 4 active + 4 pending per user. Fixed current 3h UTC bucket, one amount/pool, no catch-up. JSP/global JS, klog, single-line CSS selectors, CSP SHA for any future inline script.

**Scale/Scope**: Current bot tiers 100/500 only; explicitly provision pair+policy before future bot-tier enablement. Admin Users/Ops, current lobby/Quick Seat, one small refill worker and dedicated dispatcher assets; #869/#1017 untouched.

## Constitution Check

*GATE: Checked before research and rechecked after design.*

- **I — PASS**: Extend existing JOIN/Create/rollover/source/ledger/Admin/dispatcher. Only two shared helpers are justified by reuse across adapters (`bot-access`, `table-participation`), two narrow Admin endpoints and one operational job; no generic framework or new game service.
- **II — PASS**: WS retains game/lifecycle/live inventory authority. Existing DB-backed Quick Seat suggests only; final authoritative JOIN validates. Settled hook stays inside prepare/persist/commit, not a second settlement path.
- **III — PASS**: Unknown denies new admission/funding/refill; atomic rollback/unknown-commit recovery, payout retains existing legality. No merge or Production authorization. Local tests use isolated PostgreSQL; shared Stage was migrated by automatic DB Stage Apply PR. Pre-merge Stage acceptance and continuous table restoration have completed on Stage (T084). Production operation, live-VPS installation/activation and PR merge remain strictly unauthorized.
- **IV — PASS**: External global `js/admin-page.js` and existing poker scripts; klog only. CSS one selector per line; any new inline script requires CSP SHA in the same future change.
- **V — PASS**: Tests limited to deterministic critical classification, real transaction races, ledger, lifecycle and backend authorization. No UI/glue suite. Concrete paths and functions below/tasks; no full implementation or Git commands.
- **Deployment — PASS**: Publishing this branch's `supabase/migrations/**` intentionally mutates shared Stage through DB Stage Apply PR; the effect is declared in the feature artifacts and applied migrations are forward-only. WS runtime changes require manual exact runtime SHA WS Preview Deploy, verified workflow success for that SHA and targeted runtime smoke. The Stage-only refill canary supports NORMAL/SLOW with optional buy-in filtering; pre-merge Stage acceptance and T084 continuous inventory restoration have completed on Stage. Production migration, pool seed, refill/scheduler activation need separate explicit GO; PR merge remains separately unauthorized.

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
4. **Cache / Single-owner mutation**: Admin access override mutation is a single WS-owned operation (§25 of #1018): Admin UI → Netlify Admin auth → one internal WS request → WS fail-close → one DB transaction (`SELECT ... FOR UPDATE`, expectedRevision check, atomic row update, read policy, persist SLOW if applicable) → WS cache/socket update → release fail-close → exact ACK. Netlify authenticates the admin and forwards the actor ID with zero local DB write, zero pre-invalidation, zero confirmation retries, and zero recovery polling. WS owns the runtime guard (`activePokerAccessMutations`), short-lived fail-close lifecycle, single DB transaction, authoritative cache and socket broadcast. Stale expectedRevision returns 409 stale_revision with zero DB update; truly concurrent requests return 409 poker_access_mutation_in_progress. Guard and fail-close are cleaned up in finally. The 25s periodic refresh and 30s cache TTL are decoupled from Admin Save correctness.
5. **Funding**: locked table marker plus effective cached humans select exact provisioned tier/class. Sticky SLOW-only remains SLOW-funded even after FORCE_NORMAL, and old bots retain old-source attribution. Empty/unknown/disabled exact pool uses existing no-funding prepare/persist/restore; do not invent success or mint. Ordinary managed inventory remains NORMAL; existing transitioned managed table does not require a new lifecycle.
6. **Refill**: current policy FOR SHARE→exact pool advisory serialization→ordered ledger accounts; fresh balance and pool/bucket lookup; if below threshold and unused bucket, one MINT amount through narrow ledger capability. Pool+bucket unique metadata guard spans revisions; key also includes revision. Policy edit uses FOR UPDATE; disable/re-enable does not reopen consumed bucket. No table funding link or new receipt table.
7. **Admin/discovery/scheduler**: reuse authorization and small controls, WS inventory plus slowOnly, DB Quick Seat plus class filter; independent 3h dispatch-only job with no VPS DB credentials/SQL. Add installation wiring to bootstrap.sh only for future fresh/rebuilt VPS; never run bootstrap on existing live hosts. Existing-host installation follows the owner-approved targeted inventory/install/rollback flow in infra/vps/README.md and docs/chips-ledger-stage-automation.md, documented in quickstart. Installation and activation are separate; neither code deploy nor installation automatically enables/starts the timer. No activation during planning.

## Phases / handoff and breaking impacts

Spec→research/design→tasks→read-only analyze→accepted implementation; T001 records the explicit implementation instruction and no drift against live #1018. T027 proves the concurrency/index contract on a disposable local PostgreSQL fixture, and T028 records focused evidence, baseline comparison and the no-runtime-MINT/fallback review. The old sync blocker is obsolete; snapshot records current live requirements.

Implementation order: foundation→classification→limits→exact funding→scheduled refill→Admin→discovery→focused integration/cutover. T029 records the historical WS gate; T036 is the final amendment WS/Caddy/runtime gate; T037 is the separate **pre-merge Stage acceptance** gate. The Stage refill canary is tracked as completed for pre-merge acceptance (including NORMAL verification and T084 SLOW 100 CH restoration). Production remains separate GO; VPS timer activation and PR merge remain strictly unauthorized. Each story has an independent local test; do not activate partially migrated old/new funding writers. During authorized cutover, pause new admission/funding, allow legal hands/payouts, provision only missing pools at zero and policies, preserve existing account IDs/balances/provenance, deploy all writers/readers, verify and explicitly enable. For the 100 CH managed inventory, keep `CONTINUOUS_BOT_DEFAULT` disabled (`enabled=false`, `desired_table_count=0`) while tier 100 is temporarily enabled for the separately authorized seed/refill; verify both exact 100 CH NORMAL/SLOW pools are active and funded before re-enabling managed inventory. Stage/Preview must then restore `enabled=true`, `desired_table_count=5` and observe normal supervisor convergence (at most two creates per reconcile) to exactly five OPEN `CONTINUOUS_BOT` tables with canonical 100 CH / 1/2 stakes, three funded bots per table, NORMAL funding from `POKER_BOT_BANKROLL_100`, and no seed-failure/churn loop. Production retains its existing maximum of two managed tables and must not copy the Stage/Preview target of five. Rollback disables the affected tier and managed profile and uses graceful retirement; it must not restore TREASURY fallback, force table rows/funds with direct SQL, or allow writers ignoring class/limits. Applied schema is forward-only. Do not rewrite historical ledger or sources.

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
8. **Pre-merge Stage acceptance (T037)** — after T036, perform read-only Stage preflight, enable only the minimum supported tier, dispatch the already registered `chips-ledger-stage-scheduled-automation.yml` in its owner-only `poker-bot-pool-refill-canary` mode from the PR ref with the exact reviewed SHA and confirmation, and require dispatched SHA == checkout HEAD == worker reviewed ref before the one Stage worker invocation. The canary supports `NORMAL` and `SLOW` with optional buy-in filtering (100 or 500 CH); pre-merge Stage acceptance and T084 continuous inventory restoration have completed on Stage. The standalone `poker-bot-pool-refill.yml` and `arcade-poker-refill-dispatch` remain the post-merge scheduler path, while VPS timer activation, Production migration/cutover/refill, and PR merge remain strictly unauthorized.

Production compatibility is a hard constraint through every step: a missing #1018 schema retains pre-migration poker behavior and legacy 100 CH provenance, while unrelated SQL errors propagate. The new migration is the only automatic Stage schema effect in this amendment; T037 separately authorizes the official Stage refill/bot-pool funding needed for pre-merge acceptance, while Production and VPS activation remain outside scope.

## §26 Corrective pre-merge amendment — Settled rollover retry and Continuous Bot Table controlled inactivity (T047–T052)

Addresses the two remaining P1 blockers from Issue #1018 following the successful resolution and owner validation of T036 (Admin Save §25 single-owner deterministic WS mutation):

1. **T047 — Funding decision split**:
   In `ws-server/poker/runtime/settled-bot-funding.mjs`, `decideSettledBotFunding()` explicitly classifies outcomes into:
   - `unknown`: missing or expired snapshot, unknown tier policy -> `{ known: false, allowed: false, reason }`.
   - `authoritative no-funding`: RESTRICTED participant, tier disabled, tier unprovisioned, invalid buy-in -> `{ known: true, allowed: false, reason }`.
   - `allowed`: enabled + provisioned exact class/tier -> `{ known: true, allowed: true, systemKey, poolClass, reason: "funding_allowed" }`.
   Maintains `resolveSettledBotFundingSystemKey(options)` as a compatibility wrapper.

2. **T048 — Rollover retry without bot-funding bypass**:
   In `ws-server/server.mjs::runSettledRolloverCommand()`:
   - When DB state is required (`hasSupabaseDbUrl && !isGuestTableId(tableId)`):
     - If `settledAccessStatus.known !== true` or `fundingDecision.known !== true`: do NOT call `prepareSettledHandRollover(allowBotFunding: false)` and do NOT advance state; schedule existing `scheduleSettledRolloverRetry({ tableId, generationKey, attempt: attempt + 1 })` and return `{ ok: true, changed: false, retryable: true, reason }`.
     - If authoritative no-funding: `allowBotFunding = false` remains correct; `prepareSettledHandRollover` evaluates players and returns `not_enough_players` without endless retry.
   - When standalone / guest (`!hasSupabaseDbUrl || isGuestTableId(tableId)`):
     - Uses default known access and legacy unbacked funding snapshot (`Number.MAX_SAFE_INTEGER`), avoiding false retries.

3. **T049 — Continuous bot tables controlled inactivity**:
   In `ws-server/poker/persistence/continuous-bot-table-repository.mjs`:
   - In `reconcile()`: verify schema-backed tier 100 policy and provisioning.
   - If tier 100 is disabled or unprovisioned: supervisor treats the profile as controlled inactive (`desiredCount = 0`, zero table creation, zero seed, graceful retirement of open tables below minimum occupancy), returning `{ ok: true, controlledInactive: true, reason: "tier_disabled" | "tier_unprovisioned", status }` with zero rollback or churn.
   - In `createManagedTable()`: defense-in-depth preflight throws `tier_disabled` / `tier_unprovisioned` fast.

4. **T050 — SpecKit synchronization**:
   Update `plan.md`, `tasks.md`, `quickstart.md`, and `contracts/bot-quarantine.md`. T036 marked complete; Phase 11 added for T047–T052. (Subsequent pre-merge acceptance T037 and continuous inventory restoration T084 have both completed as PASS).

5. **T051 — Validation, deployment & read-only Stage verification**:
   Run full focused behavioral tests, CI guards, push to PR branch, dispatch exact-SHA WS Preview Deploy, verify runtime health, and verify Stage read-only invariant (tier 100 disabled, no supervisor seed errors, chips ledger unchanged).

6. **T052 — Reporting & Handoff**:
   Document verification results and STOP before owner manual smoke T037.

### Phase 12 — Truthful Admin mutation vs refresh outcome contract (§26, T053–T058)

1. **Decouple mutation outcome from best-effort refresh**:
   Audit and update all Admin POST/PATCH handlers in `js/admin-page.js` to ensure confirmed backend mutations are not displayed as errors if subsequent read-only status refresh fails. Display warning without retrying mutation.
2. **Handle stale_revision and reload gracefully**:
   Silently reload current state on stale revision and prompt operator review before saving again.
3. **Decouple maintenance outcome from status refresh**:
   Confirmed maintenance action + failed refresh yields warning status without wiping error state.
4. **Support silent / throwOnError in loaders**:
   Allow loaders to run silently or propagate errors explicitly when required by callers.

### Phase 13 — Pre-merge Production rollout preparation (§27, T075–T083)

1. **T075 — Production-equivalent #1018 contract (P1)**:
   Author `supabase/production-migrations/20260929201500_poker_bot_quarantine_production_contract.sql` consolidating the final schema of the four Stage migrations into one dark/off Production migration under canonical project `otbqfijerkieoxwpxjnm` and system identifier `7575202818581710058`.
2. **T076 — Inventory and Guard updates**:
   Update `supabase/production-migrations/manifest.json`, `scripts/check-db-migrations.mjs`, and `specs/004-production-retention/migration-inventory.md`. Map the four Stage source migrations to P1 as their prepared Production equivalent (`awaiting-production-go`).
3. **T077 — Fundamental disposable PostgreSQL proof**:
   Extend `tests/chips/chips.migration.test.mjs` with `assertProductionQuarantineContract`, proving identity preflight, prerequisite fail-closed, dark/off defaults, zero transactions/entries, existing pool preservation, override CHECK, sticky `is_slow_only`, indexes, RLS, and migration history.
4. **T078 — Post-merge cutover runbook**:
   Check in the exact future 15-step Production order and keep Production execution forbidden.
5. **T079 — VPS scheduler readiness**:
   Clarify existing-host targeted installation procedure in `infra/vps/README.md`.
6. **T080 — Continuous table restoration contract**:
   Define future Production continuous inventory invariants (target 2 tables, NORMAL 100 funding only).
7. **T081 — Runtime and Caddy boundary**:
   Confirm no runtime, deployable, Caddy or browser protocol changes are introduced.
8. **T082 — Validation & CI verification**:
   Run repo guards, syntax checks, migration verification, and ensure all CI checks pass.
9. **T083 — Handoff**:
   Report exact SHA256 of P1, verification evidence, and confirmation that Production and live VPS remain untouched.

### Phase 14 — Stage continuous inventory restoration (T084)

1. Run owner-gated Stage refill canary exclusively for `SLOW / buy_in=100` (`POKER_BOT_SLOW_BANKROLL_100: 0 -> 2000 CH`).
2. Verify refill MINT read-only (`GENESIS -> POKER_BOT_SLOW_BANKROLL_100`).
3. Restore `CONTINUOUS_BOT_DEFAULT` (enabled=true, desired=5) via existing authorized maintenance path.
4. Await natural supervisor convergence to 5 OPEN `CONTINUOUS_BOT` tables with 3 bots each funded from `POKER_BOT_BANKROLL_100`.
5. Verify zero supervisor churn and record evidence before returning PR #1019 as merge-ready.

### Phase 15 — Canonical tier catalog expansion and initial seed (T085–T092)

1. **T085 — Domain and Catalog Mapping**:
   Define `CANONICAL_POKER_BUY_IN_TIERS` (11 tiers) in `shared/poker-domain/table-economy.mjs` and re-export in `poker-progression.mjs`. Update `getBotFundingSystemKeyForBuyIn` to support all 11 tiers for explicit `poolClass` while preserving legacy path for 100/500/unsupported >500. Define `CANONICAL_POKER_BOT_POOL_KEYS` (22 exact keys).
2. **T086 — Ledger Validation & Refill Script**:
   Update `netlify/functions/_shared/chips-ledger.mjs` to dynamically map all 22 pools. Update `scripts/ops/poker-bot-pool-refill.mjs` to validate buyIns against canonical tiers, add owner-gated Production `initial-seed-all` (dispatcher forbidden, target production, mutate mode, main ref, owner actor, checked SHA, production GO, explicit confirmation). Allow seeding disabled tiers without enabling them.
3. **T087 — WS Runtime & Admin Surfaces**:
   Update `ws-server/poker/persistence/persisted-state-writer.mjs`, `netlify/functions/admin-poker-policy.mjs`, and `netlify/functions/admin-ops-summary.mjs` to consume `CANONICAL_POKER_BOT_POOL_KEYS`.
4. **T088 — Stage & Production Migrations**:
   Add forward-only Stage migration `20260930075513_poker_bot_tier_catalog_expansion.sql` provisioning 9 higher tiers disabled and 18 zero-balance accounts. Zero MINT. Update Production P1 contract `20260929201500_poker_bot_quarantine_production_contract.sql` to provision all 11 policies disabled and all 22 pools.
5. **T089 — Manifest & Inventory Update**:
   Update `manifest.json` (48 missing entries, new P1 hash, 20260930075513 mapping), `scripts/check-db-migrations.mjs` (48 missing, 27 needs-production-equivalent), and `specs/004-production-retention/migration-inventory.md`.
6. **T090 — Test Suite Extension**:
   Extend fundamental behavior tests: progression (11 tiers, pool keys, non-canonical rejection), refill (canonical buy-in filter, initial-seed-all authorization, disabled tier execution), chips-ledger (max-tier 10M refill accepted, uncataloged pool rejected), and chips.migration (22 accounts, 11 policies, higher-tier drift, 20260930075513 history gap).
7. **T091 — CI, DB Stage Apply, WS Preview Deploy & Smoke**:
   Push to PR branch, await green CI and automatic DB Stage Apply PR. Trigger WS Preview Deploy for new exact SHA, verify health and execute smoke (continuous tables healthy, 100/500 work, disabled high tier cannot fund).
8. **T092 — Final Handoff**:
   Report final HEAD SHA, new P1 SHA256, Stage migration name, CI, exact-SHA Preview run, and read-only proof of 5 healthy Stage continuous tables.
