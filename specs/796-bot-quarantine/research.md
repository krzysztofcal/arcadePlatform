# Research: #1018 NORMAL/SLOW periodic pools with manual RESTRICTED

**Date**: 2026-09-27. Requirements: [live snapshot](issue-source.md), updated 2026-09-27T17:10:33Z. Code inspected against the current implementation branch; relevant runtime files match this PR extension. Read live `agents.md`, `skills.md`, constitution and active Spec Kit skills/templates. These decisions are the accepted implementation contract; local evidence is recorded in [quickstart.md](quickstart.md). T001–T029 are historical evidence; the manual RESTRICTED amendment requires T030–T036 and a new exact-SHA WS gate.

## R1 — Classification and current runtime

**Decision**: Extend `shared/poker-domain/join.mjs::executePokerJoinAuthoritative` and `ws-server/server.mjs::runSettledRolloverCommand`, using `ws-server/poker/table/table-manager.mjs::prepareSettledHandRollover/commitSettledHandRollover`. The purpose-specific `shared/poker-domain/bot-access.mjs` shares validation, effective-class and threshold rules between JOIN, runtime and Admin. Runtime cache lifecycle stays in the existing server; no new settlement service.

**Rationale**: JOIN already reads authoritative wallet and serializes admission. Existing settled stacks close the stay-at-table detection gap without wallet queries each hand. Keep automatic state separate from override; FORCE_NORMAL and FORCE_RESTRICTED change only effective state; threshold checks still persist automatic NORMAL→SLOW while either is active. Return to AUTO immediately derives effective SLOW from stored state without another threshold check; it never resets a sticky table marker. Known effective SLOW makes the current table sticky; UNKNOWN is not evidence. RESTRICTED is never automatic.

**Alternatives considered**: Wallet-only classification misses continuous players. Every-hand DB policy/account reads violate #1018. Global wealth scanning and #869 allowance accounting are outside scope. A third automatic class, RESTRICTED bankroll or new table lifecycle would add policy that the issue explicitly excludes.

## R2 — Policy/access cache and Admin propagation

**Decision**: Hydrate policy and user access at authoritative JOIN/reconnect; one bounded background refresh at most every 30 seconds refreshes policy and batched IDs for connected or still-seated humans, outside rollover. Cache entries expire after 30 seconds; never extend freshness on failed fetch. Revisions cannot regress. Admin access Save is confirmed synchronously against the exact committed revision/override; the 25s periodic refresh is only a safety backstop. Changes do not require deploy. Missing/expired snapshots are UNKNOWN for new admission/funding and do not block settlement/leave/cash-out. Admin access Save performs authenticated WS pre-invalidation, exactly one DB mutation, then at most three synchronous WS confirmations (each capped at 4 seconds, no sleep or DB-write retry). HTTP 200 requires ok/refreshed true, pending/failClosed false and the exact committed revision and requested override. A committed pending mutation is recovered synchronously by the next request; stale caller revision returns 409 stale_revision with current access and no new write/barrier. Truly concurrent uncommitted mutations remain 409 poker_access_mutation_pending. The bounded background refresh prioritizes pending IDs (including offline/nonseated users), then active sessions and seated humans, deduplicated to 512; it is a safety backstop, not Save confirmation. Authoritative SLOW persistence and cache/socket updates complete before barrier release and positive ACK. Failed confirmation remains fail-closed; lawful settlement/rejoin/leave/cash-out are unchanged.

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

## R5 — Refill ledger and hourly database authority

The previous worker/dispatcher contract in this research section is historical and is superseded by Issue #1018 §29. The current design uses `public.poker_bot_pool_refill_hourly()` and, only after separate activation, one Supabase Cron job named `poker-bot-pool-refill-hourly` on `0 * * * *`.

The function validates `pg_control_system().system_identifier` against the singleton control row, exits while `enabled=false`, takes one transaction advisory lock, and uses a DB-derived UTC-hour bucket. It processes only enabled policies from the canonical 11-tier list and maps the exact 22 NORMAL/SLOW keys, including NORMAL 500 → `POKER_BOT_BANKROLL`. For each pool it locks/re-reads the policy and GENESIS/target accounts before deciding. Balance at/above threshold is no-op; below threshold issues exactly the configured amount.

The write follows the existing `postTransaction` ledger pattern: one deterministic 64-hex payload hash, append-only `chips_transactions` MINT, existing transaction trigger for `chips_transaction_idempotency`, atomic locked account deltas, exactly two balanced entries, and existing entry-sequence trigger. Identity is `poker-pool-refill:<poolKey>:<policyRevision>:<UTC-hour>`. The existing unique pool/bucket index prevents a second same-hour refill across policy revisions. Each pool has a narrow exception subtransaction, so failure is isolated and recorded while other pools proceed.

**Rationale**: A database-owned transaction removes the GitHub/PAT/VPS actor path while retaining the existing source-of-truth ledger and idempotency. Hourly buckets allow another configured refill only in a later hour after renewed depletion. No receipt registry, balance trigger, Edge Function, queue, or alternate scheduler is added.

**Alternatives considered**: Keeping both authorities creates duplicate MINT risk. Balance triggers, queues and generic mint frameworks add write-path complexity. Catch-up/refill-until-target would exceed the configured per-pool hourly amount.

## R6 — Admin reuse and retired dispatcher

The Admin interfaces continue to use `requireAdminUser`, existing read/write validation and `klog` patterns. The old poker-specific workflow, Node refill worker, canary mode, VPS dispatcher/service/timer and `trustedScheduledRefill` application capability are removed after the database path is implemented. The separate chips cleanup dispatcher and its `/home/copilot/.config/gh` authentication remain unchanged.

**Operational boundary**: the shared Stage migration may apply automatically from the PR, but the singleton remains `enabled=false`; no pg_cron extension or job is created and no MINT/balance/table/profile change occurs. The Production equivalent is prepared only. Existing poker service/timer on the VPS remain disabled/inactive and require separate post-merge owner GO for cleanup. Stage Cron activation and Production migration/activation are separate authorization gates. Do not run bootstrap on the live host.

**Rationale**: There must be exactly one future refill authority, with schema alone economically dark. Retiring only the poker path must not replace, relog or remove the existing chips cleanup identity.

## R7 — Live lobby and DB Quick Seat

**Decision**: Keep `tableManager → activeLobbyTablesById → buildLobbySnapshotPayload → lobby_snapshot`; extend `buildLobbyTableEntry`, `syncLobbyTable`, bootstrap repository/db/adapter and `poker/poker.js::canViewLobbyTable` with slowOnly. Self effective access is a separate authenticated cached snapshot, not personalized inventory. Keep `netlify/functions/poker-quick-seat.mjs::selectExistingActiveSeat/selectCandidate/recommendSeatAtTable/createAndRecommend` DB-backed with class predicate, resume preference and shared Create limits.

**Rationale**: Current architecture is already live WS inventory plus DB recommendations. Final JOIN remains security authority; stale offers may fail. No second lobby, personalized WS offers/proofs or viewer×table DB work.

**Alternatives considered**: #869 personalized WS matchmaking and SQL replacement of live inventory would unnecessarily broaden scope.

## R8 — Validation and breaking impacts

**Decision**: Extend only existing fundamental backend/ledger/migration and operational guard tests, plus the existing disposable PostgreSQL transaction suite. No UI/CSS/JSP/glue suite or scheduler framework is needed. The §29 tests prove control-off, tier/pool policy, exact ledger writes, same-hour replay/concurrency, next-hour eligibility, pool-local rollback, identity/ACL and no scheduler side effects.

**Rationale**: Mocks cannot prove ledger trigger/registry behavior or transaction isolation. Disposable local PostgreSQL tests provide that evidence; they never target shared Stage or Production. The automatic Stage schema apply is documented and remains dark. No WS runtime changes require a Preview deploy.

**Alternatives considered**: Live Stage depletion or real pg_cron activation is unnecessary to prove refill mechanics. Existing ledger and Cron catalogs provide future operational evidence after separate activation.

## R9 — Manual RESTRICTED amendment

**Decision**: Add `FORCE_RESTRICTED` only to the existing override enum and derive effective `RESTRICTED`; leave `ACCESS_CLASSES` and automatic threshold normalization as NORMAL/SLOW. Extend the already applied access CHECK with one forward-only migration. Existing Admin revision/audit/cache paths remain authority.

Fresh RESTRICTED admission is a human-only compatibility rule: ordinary `STANDARD`, `is_slow_only=false`, `botCount=0`, and no authoritative bot funding claim. A user's own empty Create table is valid because Create remains unclassified and bot-free; final `executePokerJoinAuthoritative` rechecks all facts. SLOW-only, bot-populated and CONTINUOUS_BOT targets reject before buy-in or bot funding. Existing financed rejoin/resume, settlement, leave and cash-out are grandfathered.

Settled rollover reads effective RESTRICTED from the existing cached seated-human snapshots. It permits the existing legal settlement transaction but passes `allowBotFunding=false`, yielding zero replacement and managed top-up plans. No per-hand policy read, new eviction lifecycle, escrow unwind or runtime MINT is added. If cache state is unknown, existing fail-closed no-new-funding recovery remains authoritative.

`lobby_snapshot` carries only the minimal authoritative occupancy fact `botCount` plus existing lifecycle metadata; browser filtering is UX and does not replace JOIN authority. DB Quick Seat keeps its existing rejoin-first and Create fallback flow, adding only an indexed candidate predicate for ordinary bot-free RESTRICTED targets. CONTINUOUS_BOT remains NORMAL and is never a RESTRICTED fresh target.

The new migration is classified `needs-production-equivalent` and intentionally causes one automatic Stage Apply effect (expected source inventory 98→99 applied after the existing 98 baseline). Production compatibility continues to probe capability per transaction: missing #1018 schema keeps legacy JOIN/rejoin, progression, Quick Seat, bootstrap and 100 CH provenance, while unrelated SQL errors propagate. The required exact-SHA Preview gate is new after T029; Stage refill/MINT, VPS activation, Production and merge remain separate gates.


## R10 — §29 corrective database-owned refill amendment

Stage migration `20260930211623_poker_bot_pool_refill_hourly.sql` creates a singleton disabled control with Stage system identifier `7656985631720456337` and the SECURITY INVOKER function. The Production equivalent `20260930211624_poker_bot_pool_refill_hourly.sql` uses `7575202818581710058`, is represented in the Production manifest, and remains unapplied. Both migrations avoid installing pg_cron, creating jobs or writing ledger rows.

The sole documented future job is exactly `poker-bot-pool-refill-hourly`, schedule `0 * * * *`, command `select public.poker_bot_pool_refill_hourly();`. It is not activated by this PR. Stage automatic application can add only the dark schema/function; Production has no effect. Existing poker VPS units remain disabled/inactive pending separately authorized cleanup. No profile/table activation or `bootstrap.sh` execution is part of the implementation.

Breaking impact: once separately activated, refill evaluation changes from three-hour to hourly buckets; a depleted pool can receive another configured amount sooner. Until the job and control are separately enabled, no recurring refill runs. Policy values, amounts, tier enablement and balances are unchanged.

## R11 — Bounded per-pool lock contention

PostgreSQL `lock_timeout=0` lets a pool's `FOR UPDATE` wait reach the global statement timeout. A `QUERY_CANCELED` at that boundary is not caught by `EXCEPTION WHEN OTHERS`, so the outer call can roll back earlier pool commits. The immutable applied Stage migration remains unchanged. Forward-only Stage correction `20260930223409_poker_bot_pool_refill_lock_timeout.sql` replaces the function with the same body plus function-level `SET lock_timeout = '5s'`; the existing per-pool exception block then records the timed-out pool as failed and continues. The not-yet-applied Production P2 receives the same final setting instead of a new migration.

Only one new disposable PostgreSQL test is needed: one connection confirms it holds `FOR UPDATE` on an exact pool account, then the second calls the function and verifies the first pool returns `failed` with `55P03` while an independent pool commits one balanced MINT. Promises coordinate lock acquisition/release; there is no sleep. The Stage correction's automatic apply replaces only the function, with the control still disabled and no pg_cron/job/MINT. Production/VPS remain untouched.
