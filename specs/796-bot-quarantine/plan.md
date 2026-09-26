# Implementation Plan: NORMAL/SLOW periodic per-tier pools

**Branch**: `docs/issue-1018-bot-quarantine` | **Date**: 2026-09-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/796-bot-quarantine/spec.md`, solely live #1018.

## Summary

Extend existing authoritative JOIN and settled rollover with NORMAL/SLOW plus manual override, sticky SLOW-only table compatibility and shared user-lock 4-active/4-pending limits. Runtime spends exact pre-existing tier/class bankroll funds. A separate three-hour systemd-dispatched job refills each eligible pool once by configured amount. Existing Admin tunes access/refill policy, WS live lobby adds slowOnly, and DB Quick Seat stays DB-backed. This is economic containment; Sybil and split wealth remain accepted. All described implementation is future work.

## Technical Context

**Language/Version**: Existing JavaScript .mjs backend/global browser JS; Node 20 workflow baseline, existing repository manifests authoritative at implementation.

**Primary Dependencies**: Existing postgres client, ws, Netlify functions, ledger helpers; no new packages/frameworks.

**Storage**: Existing PostgreSQL/Supabase persistence; additive USER/table fields, two small policy tables, new zero-balance pool accounts (existing balances preserved) and narrow existing-ledger index. No new receipt/counter service.

**Testing**: Existing node:test behavioral suites, one isolated local PostgreSQL concurrency suite; no UI/CSS/JSP/glue suites.

**Target Platform**: WS on Ubuntu/systemd, Netlify adapters, GitHub-hosted operational jobs dispatched by VPS.

**Project Type**: Existing realtime poker web application with operational refill job.

**Performance Goals**: Zero extra classification DB reads/writes for unchanged below-threshold settled hands; O(active humans at this table) in-memory comparison. One batched connected/still-seated access refresh per ≤30s, policy read in same background cycle; bounded paging and no global account scan. No viewer×table SQL. Indexed count-to-five membership/pending checks and indexed exact pool/bucket refill lookup; no ledger history scan.

**Constraints**: Cached access/policy max age 30s, missing/stale fail-closed only for new admission/funding. No per-hand wallet/policy/override/refill-policy reads. No runtime MINT. 4 active + 4 pending per user. Fixed current 3h UTC bucket, one amount/pool, no catch-up. JSP/global JS, klog, single-line CSS selectors, CSP SHA for any future inline script.

**Scale/Scope**: Current bot tiers 100/500 only; explicitly provision pair+policy before future bot-tier enablement. Admin Users/Ops, current lobby/Quick Seat, one small refill worker and dedicated dispatcher assets; #869/#1017 untouched.

## Constitution Check

*GATE: Checked before research and rechecked after design.*

- **I — PASS**: Extend existing JOIN/Create/rollover/source/ledger/Admin/dispatcher. Only two shared helpers are justified by reuse across adapters (`bot-access`, `table-participation`), two narrow Admin endpoints and one operational job; no generic framework or new game service.
- **II — PASS**: WS retains game/lifecycle/live inventory authority. Existing DB-backed Quick Seat suggests only; final authoritative JOIN validates. Settled hook stays inside prepare/persist/commit, not a second settlement path.
- **III — PASS**: Unknown denies new admission/funding/refill; atomic rollback/unknown-commit recovery, payout retains existing legality. No merge or Production authorization. This PR changes only feature documents.
- **IV — PASS**: External global `js/admin-page.js` and existing poker scripts; klog only. CSS one selector per line; any new inline script requires CSP SHA in the same future change.
- **V — PASS**: Tests limited to deterministic critical classification, real transaction races, ledger, lifecycle and backend authorization. No UI/glue suite. Concrete paths and functions below/tasks; no full implementation or Git commands.
- **Deployment — PASS**: Future same-repo `supabase/migrations/**` intentionally mutates shared Stage through DB Stage Apply PR; declare before publication, forward-only once applied. Future WS work requires exact runtime SHA Preview deployment and targeted runtime verification. Production migration, pool seed, refill/scheduler activation need separate explicit GO. No such actions now.

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
| `ws-server/server.mjs::buildLobbyTableEntry/syncLobbyTable/buildLobbySnapshotPayload`, `activeLobbyTablesById` | Shared slowOnly entries, no personalized inventory; authenticated self access snapshot on connect/refresh |
| `poker/poker.js::canViewLobbyTable`, `poker/poker-realtime.js` | Class-aware fresh targets, existing resume, self snapshot handling, final JOIN still authority |
| `netlify/functions/admin-user-details.mjs::loadUserDetails`, `admin-users-list.mjs`, `admin-ops-summary.mjs::loadOpsSummary`, `js/admin-page.js` | Minimal Users/Ops fields/controls, optional existing-path pool balances |
| `netlify/functions/_shared/admin-auth.mjs::requireAdminUser`, `admin-bonus-campaigns.mjs::createAdminBonusCampaignsHandler` | Reuse authorization/validation patterns; no generic framework |
| `netlify/functions/_shared/chips-ledger.mjs::validateEntries/postTransaction` | Narrow trusted scheduled SYSTEM MINT capability; existing balanced ledger/idempotency remains |
| `infra/vps/arcade-chips-ledger-dispatch.sh/.service/.timer`, `infra/vps/bootstrap.sh` | Reuse external dispatch pattern and explicit opt-in install for dedicated pool timer |

Planned new files, only in later implementation: `shared/poker-domain/bot-access.mjs`, `shared/poker-domain/table-participation.mjs`, `netlify/functions/admin-user-poker-access.mjs`, `netlify/functions/admin-poker-policy.mjs`, `scripts/ops/poker-bot-pool-refill.mjs`, `.github/workflows/poker-bot-pool-refill.yml`, `infra/vps/arcade-poker-pool-dispatch.sh/.service/.timer`, `tests/chips/poker-pool-policy.transaction.test.mjs`. Additive migrations belong only to later implementation. Existing test files are enumerated in tasks/quickstart.

**Structure Decision**: Keep current packages and authority boundaries. Legacy feature/contract filenames are retained so #1019 links remain valid; all contents are rewritten. No dependencies, generic setup files or unrelated cleanup.

## Phase 0 — Research decisions

[research.md](research.md) R1–R8 resolves control points, cache, limits, pool isolation, bucket replay, Admin/dispatcher, discovery and validation. No unresolved design placeholders. Main findings: current 100→TREASURY routing changes for future funds; current ledger does not yet allow the scheduled SYSTEM MINT shape; current JOIN human marker must move after actual acceptance; current exhaustion paths have 500-specific logic.

## Phase 1 — Design and contracts

[data-model.md](data-model.md) defines fields and transitions; [contract](contracts/bot-quarantine.md) defines lock, cache, funding, refill and API behavior; [quickstart.md](quickstart.md) defines later validation. Essential sequence:

1. **Create/JOIN capacity**: canonical user advisory lock→Quick Seat match lock if used→table/state→ordered account locks. Fresh count after lock; fifth rejected before any consuming mutations. Rejoin bypasses fresh-slot/class denial but not existing authentication/financial correctness. No user advisory lock acquired later from rollover while holding table locks. Leave/close release only; safe conservative counts are acceptable.
2. **JOIN**: read authoritative policy/access/wallet at existing admission transaction; persist actual automatic change independently of policy denial, classify effective state, check cap/compatibility and safe owner promotion. Only accepted seat/rejoin changes human marker. Promotion and new seat/buy-in are atomic; failure does not leave false ownership claims. No Create classifier.
3. **Settled rollover**: use existing authoritative settled human stacks before planning new bot funding; compare only fresh cached snapshots. Actual changes persist through existing writer with revision reconciliation, then confirmed marker/class drives next funding. Below threshold, no new classification SQL. Failure preserves already settled result, performs no new funds, and follows existing restore/retry; never publish uncommitted classification. UNKNOWN cannot promote table.
4. **Cache**: single bounded ≤30s background batch, no hand-driven policy/account reads. Snapshot refresh on JOIN/reconnect and known local writes; expired data denies new admission/funding. Admin exposes committed revision and propagation interval, not a false instantaneous guarantee; next control point after refresh uses new revision. Refreshed FORCE_SLOW drives sticky marker at next authoritative point without interrupting legal actions.
5. **Funding**: locked table marker plus effective cached humans select exact provisioned tier/class. Sticky SLOW-only remains SLOW-funded even after FORCE_NORMAL, and old bots retain old-source attribution. Empty/unknown/disabled exact pool uses existing no-funding prepare/persist/restore; do not invent success or mint. Ordinary managed inventory remains NORMAL; existing transitioned managed table does not require a new lifecycle.
6. **Refill**: current policy FOR SHARE→exact pool advisory serialization→ordered ledger accounts; fresh balance and pool/bucket lookup; if below threshold and unused bucket, one MINT amount through narrow ledger capability. Pool+bucket unique metadata guard spans revisions; key also includes revision. Policy edit uses FOR UPDATE; disable/re-enable does not reopen consumed bucket. No table funding link or new receipt table.
7. **Admin/discovery/scheduler**: reuse authorization and small controls, WS inventory plus slowOnly, DB Quick Seat plus class filter; independent 3h dispatch-only job with no VPS DB credentials. No activation during planning.

## Phases / handoff and breaking impacts

Spec→research/design→tasks→read-only analyze→independent approval; T001 requires separate implementation instruction and no drift against live #1018. The old sync blocker is obsolete; snapshot records current live requirements.

Implementation order: foundation→classification→limits→exact funding→scheduled refill→Admin→discovery→focused integration/cutover. Each story has an independent local test; do not activate partially migrated old/new funding writers. During authorized cutover, pause new admission/funding, allow legal hands/payouts, provision only missing pools at zero and policies, preserve existing account IDs/balances/provenance, deploy all writers/readers, verify and explicitly enable. Rollback must not restore TREASURY fallback or writers ignoring class/limits; keep affected new funding disabled until repaired. Applied schema is forward-only. Do not rewrite historical ledger or sources.

Breaking impacts: 100 NORMAL leaves shared TREASURY; every enabled tier has class isolation; SLOW fresh joins require SLOW-only but still support bots; tables never revert after override; 4+4 caps apply to both classes; cache propagation has a declared bound; pool exhaustion can pause bot availability until a later 3h refill. Admin gains live tuning and overrides. Native GitHub cron is not refill authority. Existing hands/payouts unchanged. Accepted economic gaps are explicit in spec; this is not fraud detection.

## Complexity Tracking

No constitution violations. No new receipt registry, generic policy/moderation service, personalized matchmaking, per-user bot allowance, global wealth aggregator or second settlement path. Final plan review confirms each new helper has multiple concrete callers and each operational artifact has a distinct required responsibility.
