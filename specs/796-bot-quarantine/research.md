# Research: #1018 NORMAL/SLOW periodic pools with manual RESTRICTED

**Date**: 2026-09-27. Requirements: [live snapshot](issue-source.md), updated 2026-09-27T17:10:33Z. Code inspected against the current implementation branch; relevant runtime files match this PR extension. Read live `agents.md`, `skills.md`, constitution and active Spec Kit skills/templates. These decisions are the accepted implementation contract; local evidence is recorded in [quickstart.md](quickstart.md). T001–T029 are historical evidence; the manual RESTRICTED amendment requires T030–T036 and a new exact-SHA WS gate.

## R1 — Classification and current runtime

**Decision**: Extend `shared/poker-domain/join.mjs::executePokerJoinAuthoritative` and `ws-server/server.mjs::runSettledRolloverCommand`, using `ws-server/poker/table/table-manager.mjs::prepareSettledHandRollover/commitSettledHandRollover`. The purpose-specific `shared/poker-domain/bot-access.mjs` shares validation, effective-class and threshold rules between JOIN, runtime and Admin. Runtime cache lifecycle stays in the existing server; no new settlement service.

**Rationale**: JOIN already reads authoritative wallet and serializes admission. Existing settled stacks close the stay-at-table detection gap without wallet queries each hand. Keep automatic state separate from override; FORCE_NORMAL and FORCE_RESTRICTED change only effective state; threshold checks still persist automatic NORMAL→SLOW while either is active. Return to AUTO immediately derives effective SLOW from stored state without another threshold check; it never resets a sticky table marker. Known effective SLOW makes the current table sticky; UNKNOWN is not evidence. RESTRICTED is never automatic.

**Alternatives considered**: Wallet-only classification misses continuous players. Every-hand DB policy/account reads violate #1018. Global wealth scanning and #869 allowance accounting are outside scope. A third automatic class, RESTRICTED bankroll or new table lifecycle would add policy that the issue explicitly excludes.

## R2 — Policy/access cache and Admin propagation

**Decision**: Hydrate policy and user access at authoritative JOIN/reconnect; one bounded background refresh at most every 30 seconds refreshes policy and batched IDs for connected or still-seated humans, outside rollover. Cache entries expire after 30 seconds; never extend freshness on failed fetch. Revisions cannot regress. Admin Save returns committed revision plus a maximum 30-second refresh interval; the next relevant control point after refresh uses it. Changes do not require deploy. Missing/expired snapshots are UNKNOWN for new admission/funding and do not block settlement/leave/cash-out. This uses the issue's permitted bounded low-frequency refresh option, not instantaneous push propagation.

**Rationale**: No general policy distribution/invalidation service exists. A small server-local refresh avoids adding one. Publish a self-only access update on authenticated WS connection/refresh, independent of the shared lobby table inventory. Detect actual NORMAL→SLOW from settled stack in memory; persist the automatic transition regardless of override and change the table marker only when effective SLOW requires it, via the existing persistence transaction. On an actual transition only, revision-check/reconcile under row locks so concurrent Admin override cannot be overwritten. No unchanged-hand classification read/write. Update local snapshots after confirmed commit; unknown commit follows existing recovery.

**Alternatives considered**: Targeted admin→WS invalidation adds an authenticated transport and multi-instance complexity. No new endpoint or generic config bus is needed for bounded refresh. Refresh must include disconnected seated players, not just sockets, and batch by IDs with bounded page sizes; never sweep all accounts or tables for wealth.

## R3 — Admission, Create and 4+4 limits

**Decision**: Add one small shared `shared/poker-domain/table-participation.mjs` for the PostgreSQL user-scoped transaction advisory lock and active/pending predicates, consumed by final JOIN and `netlify/functions/_shared/poker-table-init.mjs::createPokerTableWithState`. Direct `poker-create-table.mjs` and Quick Seat `createAndRecommend` must use that helper. Lock namespace `poker-table-slots:v1` plus canonical user UUID, identical across adapters; lock before counts and table/state/account locks. Quick Seat acquires user lock before its existing `quickseat:${maxPlayers}` matching lock. Transactions use fresh READ COMMITTED count statements after lock acquisition.

**Rationale**: Per-table locks cannot stop simultaneous fifth joins to different tables. Existing `selectExistingActiveSeat` checks OPEN + ACTIVE participation; freshness predicates belong to `selectCandidate` and must not define active slot usage. Disconnected but financed participation still counts. First accepted human JOIN removes the pending predicate and creates active membership atomically. Another user joining an owner's pending table only decreases owner's pending count; joiner's lock and table serialization suffice. Leave/close only release slots; a temporarily conservative count may reject but cannot exceed limits.

**Access-path evidence**: Live migrations `20260116120000_poker_tables.sql` and `20260117090000_poker_phase1_authoritative_seats.sql` define table-leading seat uniqueness `(table_id,user_id)` and table status/activity indexes; review of all live migration index definitions found no user-leading seat index or creator-leading table index for these global per-user counts. Require a narrow `poker_seats` user_id-leading active-human membership access path and `poker_tables` created_by-leading pending-owner path, aligned with final status/lifecycle/participation predicates; stop at five qualifying distinct tables with indexed per-table EXISTS probes, never a global seat/table scan. T002 provides missing indexes and T009 aligns SQL; T027 records local PostgreSQL EXPLAIN on representative fixtures. If a later schema already supplies an adequate path, document the final SQL/index/EXPLAIN evidence and avoid a duplicate; the access-path requirement is unconditional.

**Alternatives considered**: Browser, lobby and application-only counts race. Persistent counters/reservations or a generic quota service add unnecessary state. Create classification is removed: existing empty STANDARD initialization remains; SLOW promotion happens only at successful final JOIN under locked proof of ownership, empty state/seats and absence of prior bot funding. Closed/retired/ambiguous historical tables are not promotable.

## R4 — Exact pool source and historical attribution

**Decision**: Extend `shared/poker-domain/table-economy.mjs::getBotFundingSystemKeyForBuyIn`, `bots.mjs::seedBotsForJoin`, `ws-server/poker/persistence/persisted-state-writer.mjs::writeReplacementFundings/writeManagedBotTopUps` and managed initial seed in `continuous-bot-table-repository.mjs`. Resolve an explicitly enabled provisioned tier and sticky table class before every positive funding. No MINT in these paths.

**Rationale**: Current 100 funding uses TREASURY; switching new 100 NORMAL to POKER_BOT_BANKROLL_100 is a deliberate breaking cutover. Keep 500 POKER_BOT_BANKROLL. Existing 500-only exhaustion handling in server/writer must generalize to exact configured pools and retain no-funding restore/prepare/persist flow. `shared/poker-domain/terminal-close.mjs::normalizeFundingRows` and ledger source records preserve old/new returns; table becoming SLOW never relabels already funded stacks.

**Alternatives considered**: A shared SLOW pool allows high-tier starvation. TREASURY fallback defeats isolation. Progression catalog is not authorization to enable future bot tiers. No new managed SLOW lifecycle; an existing occupied managed table can become sticky SLOW-only while retaining lifecycle, but must not rotate participants into fresh ordinary funding.

## R5 — Refill ledger and cross-revision bucket guard

**Decision**: `scripts/ops/poker-bot-pool-refill.mjs` evaluates only the current UTC bucket. Under exact bankroll serialization and a stable policy revision, it checks existing committed ledger MINT metadata for pool+bucket across all revisions before posting one amount. It reuses `_shared/chips-ledger.mjs::postTransaction`, payload hash and `chips_transaction_idempotency`; deterministic key `poker-pool-refill:<system-key>:<revision>:<bucket>`. A narrow indexed pool/bucket identity on existing `chips_transactions` protects this purpose without a new receipt registry.

**Rationale**: Revision in idempotency key alone permits two refills after an edit; pool+bucket guard is additionally required. Current `validateEntries` rejects user-less MINT with `missing_user_entry`, so explicitly extend only backend-authorized scheduled GENESIS→exact provisioned pool MINT, never arbitrary metadata-based public MINT. Existing ledger/audit retains these low-volume system operations; no table binding or 7d/30d refill-MINT extension.

**Alternatives considered**: Per-funding exact deficit, composite mint/buy-in, permanent receipts, weekly allocation, refill-until-target and backlog catch-up all contradict live #1018. Shared policy row locked FOR SHARE during each refill and FOR UPDATE by Admin keeps a complete revision; accounts locked in stable ID order. A committed pool/bucket stays consumed after policy edit/disable/re-enable.

## R6 — Admin and scheduler reuse

**Decision**: Reuse `netlify/functions/_shared/admin-auth.mjs::requireAdminUser`, `admin-user-details.mjs::loadUserDetails`, `admin-users-list.mjs`, `admin-ops-summary.mjs::loadOpsSummary`, external `js/admin-page.js`. Add two narrow endpoints `admin-user-poker-access.mjs` and `admin-poker-policy.mjs`, following validated `admin-bonus-campaigns.mjs::createAdminBonusCampaignsHandler` patterns; row actor/time/revision metadata, no generic moderation or repurposing table-specific `insertTableAdminAction`.

Refill wake-up reuses `infra/vps/arcade-chips-ledger-dispatch.sh/.service/.timer`, `docs/chips-ledger-stage-automation.md` patterns in a small dedicated pool dispatcher/service/timer and dispatch-only workflow. `infra/vps/README.md` and the fresh-vps guard in `infra/vps/bootstrap.sh` restrict bootstrap to future fresh/rebuilt VPS; new files may be installed there only for that case. Never run bootstrap on an existing live VPS. Existing-host installation uses a separate owner-approved targeted upgrade/install flow: read-only inventory, reviewed artifact/rollback manifest, install only the dispatcher/units disabled, reload/verify without dispatch; activation is separately authorized. No code deploy, installation or bootstrap may automatically enable/start this new timer. VPS authenticates GitHub dispatch; GitHub-hosted job holds environment-scoped DB access. Review repo/actor/ref/environment/feature gate as in `.github/workflows/chips-ledger-production-scheduled-automation.yml`.

**Rationale**: Existing Admin authorization and external systemd scheduler already solve these responsibilities. Production dispatch/refill activation remains separately authorized; adding the artifacts does not activate them.

**Alternatives considered**: Generic config framework, native GitHub cron dependency and self-hosted runner are unnecessary. Never place DB credentials or mutation SQL on VPS.

## R7 — Live lobby and DB Quick Seat

**Decision**: Keep `tableManager → activeLobbyTablesById → buildLobbySnapshotPayload → lobby_snapshot`; extend `buildLobbyTableEntry`, `syncLobbyTable`, bootstrap repository/db/adapter and `poker/poker.js::canViewLobbyTable` with slowOnly. Self effective access is a separate authenticated cached snapshot, not personalized inventory. Keep `netlify/functions/poker-quick-seat.mjs::selectExistingActiveSeat/selectCandidate/recommendSeatAtTable/createAndRecommend` DB-backed with class predicate, resume preference and shared Create limits.

**Rationale**: Current architecture is already live WS inventory plus DB recommendations. Final JOIN remains security authority; stale offers may fail. No second lobby, personalized WS offers/proofs or viewer×table DB work.

**Alternatives considered**: #869 personalized WS matchmaking and SQL replacement of live inventory would unnecessarily broaden scope.

## R8 — Validation and breaking impacts

**Decision**: Extend existing JOIN, table-manager, persisted-state-writer, Quick Seat, Admin and ledger behavioral tests; one small new local PostgreSQL transaction suite verifies real slot/refill races. No UI/CSS/JSP/glue test suite. Use existing Node/postgres tooling, no package/framework additions.

**Rationale**: Pure mocks cannot prove cross-table cap serialization or duplicate-dispatch issuance; T027 therefore uses one disposable local PostgreSQL database with two connections, barriers and planner statistics and records 6/6 passing subtests with no skip after the pre-migration capability regression was added. T028 reruns the focused implementation groups and compares the declared Vitest failures with the base checkout. Exact-SHA manual WS Preview Deploy, successful workflow verification and targeted smoke form the remaining WS runtime gate. Stage refill canary is a separate conditional operational validation that performs real ledger MINT only after explicit user authorization; withholding that authorization cannot block WS gate completion. Production remains a separate GO. The shared Stage migration effect is declared before publication; applied migration corrections are forward-only.

**Alternatives considered**: Broad test rewrites or Stage experiments during this docs task are unnecessary. Accepted risks remain Sybil, split wealth, below-threshold farming and depletion before next refill. Breaking changes are new 100 source, class segregation/sticky tables, 4+4 caps, bounded policy propagation and external periodic refill dependency.

## R9 — Manual RESTRICTED amendment

**Decision**: Add `FORCE_RESTRICTED` only to the existing override enum and derive effective `RESTRICTED`; leave `ACCESS_CLASSES` and automatic threshold normalization as NORMAL/SLOW. Extend the already applied access CHECK with one forward-only migration. Existing Admin revision/audit/cache paths remain authority.

Fresh RESTRICTED admission is a human-only compatibility rule: ordinary `STANDARD`, `is_slow_only=false`, `botCount=0`, and no authoritative bot funding claim. A user's own empty Create table is valid because Create remains unclassified and bot-free; final `executePokerJoinAuthoritative` rechecks all facts. SLOW-only, bot-populated and CONTINUOUS_BOT targets reject before buy-in or bot funding. Existing financed rejoin/resume, settlement, leave and cash-out are grandfathered.

Settled rollover reads effective RESTRICTED from the existing cached seated-human snapshots. It permits the existing legal settlement transaction but passes `allowBotFunding=false`, yielding zero replacement and managed top-up plans. No per-hand policy read, new eviction lifecycle, escrow unwind or runtime MINT is added. If cache state is unknown, existing fail-closed no-new-funding recovery remains authoritative.

`lobby_snapshot` carries only the minimal authoritative occupancy fact `botCount` plus existing lifecycle metadata; browser filtering is UX and does not replace JOIN authority. DB Quick Seat keeps its existing rejoin-first and Create fallback flow, adding only an indexed candidate predicate for ordinary bot-free RESTRICTED targets. CONTINUOUS_BOT remains NORMAL and is never a RESTRICTED fresh target.

The new migration is classified `needs-production-equivalent` and intentionally causes one automatic Stage Apply effect (expected source inventory 98→99 applied after the existing 98 baseline). Production compatibility continues to probe capability per transaction: missing #1018 schema keeps legacy JOIN/rejoin, progression, Quick Seat, bootstrap and 100 CH provenance, while unrelated SQL errors propagate. The required exact-SHA Preview gate is new after T029; Stage refill/MINT, VPS activation, Production and merge remain separate gates.
