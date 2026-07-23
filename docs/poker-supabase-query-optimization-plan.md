# Poker Supabase/Postgres query optimization plan

## Metadata

- Issue: `#742` — “Poker: reduce unnecessary Supabase query traffic”
- Analyzed remote ref: `origin/main`
- Analyzed SHA: `55152180556acc41078e38dbdcf65070f05706fd`
- Analysis date: `2026-07-23`
- Scope: static revalidation of poker-originated Supabase/Postgres traffic and a staged implementation plan; no runtime change is included in this document PR.
- Source of truth: a new branch created directly from the fetched `origin/main`, followed by inspection of the current files, migrations, call sites, and existing tests. The SHA happens to equal the historical audit SHA embedded in #742, but the findings below were independently revalidated against the fetched remote branch.
- Architecture assumptions:
  - loaded WS runtime state remains authoritative for live poker;
  - Postgres remains required for durability, cross-process idempotency, recovery, settlement projections, ledger accounting, cleanup of unloaded tables, and terminal chip conservation;
  - guest tables and the local file persistence backend do not contribute Supabase traffic;
  - optimization must reduce avoidable statements or transferred rows without weakening correctness guarantees.
- Repository instructions read: `agents.md`, `skills.md`, `AGENTS.md`, and `RTK.md`. No `arcadePlatform-repomix*.txt` snapshot is present on the analyzed branch, so analysis used the current source files directly.
- Confirmation required outside the repository:
  - effective production and preview environment values for all timer/freshness variables;
  - number of active WS instances;
  - actual production indexes, constraints, and pre-existing duplicate audit rows;
  - external consumers of legacy lobby endpoints;
  - measured statement counts and egress before and after each optimization.

## Revalidated findings

### F1 — persisted `poker_seats.last_seen_at`

**Classification: nadal aktualny. Effective production frequency requires configuration confirmation.**

- Files and methods:
  - `ws-server/poker/runtime/conn-state.mjs` — `HEARTBEAT_MS = 15000`;
  - `ws-server/server.mjs` — `persistedSeatTouchThrottleMs`, `maybeTouchPersistedSeatLastSeen()`, `touchPersistedSeatLastSeen()`;
  - `ws-server/poker/runtime/disconnect-cleanup.mjs` — `createDisconnectCleanupRuntime()`;
  - `shared/poker-domain/inactive-cleanup.mjs` — `resolveSeatPresenceFreshness()`, `isTurnProtected()`, `executeInactiveCleanup()`;
  - `ws-server/poker/runtime/table-janitor.mjs` — `findStaleHumanSeat()`.
- Call flow:
  - successful `ping`, join, resync, table subscription/snapshot, and action handling call `maybeTouchPersistedSeatLastSeen()`;
  - it resolves the joined/subscribed table and authenticated user;
  - `touchPersistedSeatLastSeen()` deduplicates in `persistedSeatTouchByTableUser`;
  - when the throttle expires it opens a DB transaction and updates the active persisted seat.
- DB operation:
  - `UPDATE public.poker_seats SET last_seen_at = now() WHERE table_id = $1 AND user_id = $2 AND status = 'ACTIVE'`.
- Frequency from current defaults:
  - throttle default: `max(1000, HEARTBEAT_MS / 2) = 7500 ms`;
  - normal 15-second client ping can therefore write once per ping: 4/minute, 240/hour, 5,760/day per continuously connected seated user;
  - command-triggered calls within 7.5 seconds of the previous touch are suppressed;
  - an env override can set `WS_PERSISTED_SEAT_TOUCH_THROTTLE_MS` between 1 and 60 seconds, so the production figure is not confirmed by the repository.
- Query-count impact: linear with connected seated users and WS replicas that independently own connections. The UPDATE returns no row payload, so statement count and WAL/write amplification are more material than response egress.
- Safety boundary:
  - stale-seat classification uses `max(WS_ACTIVE_SEAT_FRESH_MS, WS_SEATED_RECONNECT_GRACE_MS)`, defaulting to 120 seconds;
  - disconnect cleanup itself waits the reconnect grace, default 90 seconds;
  - private live-hand cleanup also consults persisted presence and `POKER_LIVE_HAND_STALE_MS`;
  - after a WS restart the in-memory touch map and socket context are rebuilt, so the persisted timestamp must leave adequate reconnect margin.
- Recommendation:
  - do not adopt the historical “60 seconds is safe” statement without production env and restart-grace validation;
  - start with a conservative 30-second default only after verification of the full cleanup/reconnect matrix;
  - retain immediate in-memory socket presence and the same persisted UPDATE; change cadence only.
- Expected default reduction if 30 seconds is selected: from about 5,760 to 2,880 UPDATEs/day/user, approximately 50%. An existing production override can make the reduction smaller or zero.

### F2 — open-table reconciler pagination

**Classification: nadal aktualny.**

- File and methods:
  - `ws-server/server.mjs` — `openTableJanitorCursor`, `listOpenTableIdsForJanitor()`, `sweepOpenTableJanitorAndBroadcast()`;
  - `ws-server/poker/runtime/table-janitor.mjs` — `selectOpenTableJanitorBatch()`.
- Call flow:
  - the open-table timer invokes `sweepOpenTableJanitorAndBroadcast()`;
  - `listOpenTableIdsForJanitor()` selects every open table ordered by `(updated_at, id)`;
  - all rows are transferred to Node;
  - `selectOpenTableJanitorBatch()` applies the cursor and selects only the configured batch;
  - each selected table is passed to `runEvaluatedTableJanitor()`.
- DB operation:
  - one unbounded-result SELECT over `poker_tables WHERE status = 'OPEN' ORDER BY updated_at, id`;
  - no SQL `LIMIT`; default JavaScript batch is 10.
- Frequency:
  - default `WS_OPEN_TABLE_JANITOR_SWEEP_MS = 60000`, bounded in code to 5–300 seconds;
  - default one full open-table result/minute/WS instance, 1,440/day/instance;
  - effective production interval and batch require env confirmation.
- Query-count and egress:
  - SQL statement count is one per sweep regardless of table count;
  - returned rows and DB-to-WS egress grow with every open table even though only the batch is evaluated;
  - the historical 44,640 statements/day assumes a full batch of 10 and includes the three health reads for each selected table; it is a valid default upper-order calculation, not a measured production fact.
- Safety boundary:
  - cursor wrap must preserve eventual coverage and avoid starvation;
  - ordering must remain deterministic for equal timestamps;
  - empty sets, deleted cursor rows, newly inserted rows, and wraparound must remain safe.
- Recommendation:
  - move the cursor and `LIMIT` into the SQL query while preserving cyclic `(updated_at, id)` order;
  - keep the existing `selectOpenTableJanitorBatch()` semantics as the reference and avoid introducing a new pagination abstraction;
  - do not combine this with janitor execution or cleanup-policy changes.
- Expected reduction:
  - query count unchanged at one listing SELECT/sweep;
  - returned listing rows fall from all open tables to at most `WS_OPEN_TABLE_JANITOR_SWEEP_BATCH`, giving approximately `1 - batch/openTableCount` row reduction when open tables exceed the batch;
  - the three health reads per selected table are unchanged.

### F3 — sweep intervals

**Classification: wymaga danych runtime lub sprawdzenia konfiguracji produkcyjnej. Repository defaults remain as reported.**

- File and properties in `ws-server/server.mjs`:
  - `staleActiveSeatSweepMs`: `WS_STALE_ACTIVE_SEAT_SWEEP_MS`, default 5 seconds, allowed 0.5–60 seconds;
  - `zombieTableSweepMs`: `WS_ZOMBIE_TABLE_SWEEP_MS`, default 30 seconds;
  - `openTableJanitorSweepMs`: `WS_OPEN_TABLE_JANITOR_SWEEP_MS`, default 60 seconds, allowed 5–300 seconds.
- Call flows and DB operations:
  - stale sweep → `listStaleActiveHumanSeatCandidates()` → one bounded joined SELECT with default limit 25;
  - zombie sweep → `listZombieOpenTableIds()` → one bounded `NOT EXISTS` SELECT with default limit 25;
  - open-table sweep → `listOpenTableIdsForJanitor()` → one listing SELECT, then evaluation of the selected batch.
- Default frequencies, recalculated:
  - stale candidate listing: 12/minute, 720/hour, 17,280/day/instance;
  - zombie candidate listing: 2/minute, 120/hour, 2,880/day/instance;
  - open-table listing: 1/minute, 60/hour, 1,440/day/instance;
  - candidate health reads occur only for returned table IDs and add three SELECTs/table/evaluation.
- Query-count and egress:
  - listing statement count is fixed per timer and WS instance even with no candidates;
  - candidate query response egress is small when empty;
  - health snapshot egress can be material because it includes persisted poker state JSON and all seats.
- Safety boundary:
  - slower stale detection delays cleanup;
  - zombie/open reconciliation covers tables absent from current WS memory;
  - cleanup must preserve live-hand and reconnect grace checks.
- Recommendation:
  - confirm deployed timer values and WS replica count before changing defaults;
  - if defaults are effective, treat only the stale scan as an initial cadence candidate and move it from 5 to 30 seconds in a dedicated PR;
  - retain zombie/open intervals until before/after data shows they are material.
- Expected default stale-listing reduction at 30 seconds: from 17,280 to 2,880 SELECTs/day/instance, approximately 83.3%, with up to 25 seconds additional detection delay relative to the current cadence.

### F4 — concurrent evaluation of one `tableId`

**Classification: nadal aktualny.**

- File and methods: `ws-server/server.mjs` — the three sweep functions, `runEvaluatedTableJanitor()`, `loadPersistedTableHealthSnapshot()`.
- Call flow:
  - each timer starts its async sweep without awaiting the previous timer invocation;
  - stale, zombie, and open-table sweeps independently call `runEvaluatedTableJanitor()` using `Promise.allSettled`;
  - no map, set, queue, or promise registry guards evaluation by `tableId`;
  - each invocation independently loads persisted health and may route to a cleanup primitive.
- Current caller/parameter semantics:
  - the only current callers are `sweepStaleActiveHumanSeatsAndBroadcast()`, `sweepZombieTablesAndBroadcast()`, and `sweepOpenTableJanitorAndBroadcast()`;
  - all pass the same semantic `tableId`, but distinct `trigger` and `requestId` values;
  - `trigger` and `requestId` are not inputs to `loadPersistedTableHealthSnapshot()`, `buildTableJanitorRuntimeContext()`, or `evaluateTableHealth()`, so current snapshot and classification are independent of them;
  - `runTableJanitor()` includes both values in `klog` and forwards them to the selected primitive;
  - the current stale/zombie/inactive primitives ignore `trigger` in their destructured inputs, while `requestId` is forwarded into the existing cleanup path;
  - the three sweep callers consume only settlement of the returned promise through `Promise.allSettled`; they do not branch, broadcast, or schedule retry from the returned value.
- DB operations per evaluation:
  - SELECT table metadata;
  - SELECT all persisted seats;
  - SELECT persisted state JSON;
  - an unhealthy classification may then execute cleanup/terminal accounting SQL.
- Frequency:
  - duplicates depend on candidate overlap and query latency, so repository-only analysis cannot quantify them;
  - overlap is possible both between different sweep families and between successive invocations of a slow sweep.
- Query-count and egress:
  - every overlapping evaluation repeats three SELECTs and state/seat transfer;
  - cleanup primitives use idempotency and locks, but those protections do not eliminate the duplicate health reads.
- Safety boundary:
  - before implementation, repeat a complete caller and parameter audit because this behavior may have changed since this plan SHA;
  - coalescing by `tableId` is permitted only if snapshot, classification, primitive routing, broadcast, retry, and caller result semantics remain independent of `trigger`;
  - caller-specific `trigger` and `requestId` diagnostics must not silently disappear;
  - if any caller-specific effect becomes required, share only the DB snapshot/classification and execute the distinct required post-classification effect without loading the snapshot again;
  - coalescing must be in-flight only, not a TTL cache;
  - the promise entry must be removed on success and failure;
  - no later evaluation may be suppressed after the first finishes;
  - no cleanup result, ledger movement, or runtime state may be manufactured by the coalescer.
- Recommendation:
  - first document every current caller and the use of `tableId`, `trigger`, `requestId`, classification, primitive result, broadcast, and retry;
  - if the audit still proves semantic independence, add one server-local in-flight promise map keyed only by `tableId`, return the existing operation to overlapping callers, and delete it in `finally`;
  - preserve a bounded caller-specific `klog` record for a coalesced request using its original `trigger` and `requestId`;
  - otherwise coalesce only snapshot/classification by `tableId` and preserve each distinct required effect without a second DB snapshot;
  - do not introduce a cache framework.
- Expected reduction: three SELECTs for each overlapping evaluation avoided; exact savings require runtime overlap counters.

### F5 — repeated `maybeWriteHoleCards()`

**Classification: nadal aktualny.**

- Files and methods:
  - `ws-server/server.mjs` — `persistMutatedState()`;
  - `ws-server/poker/persistence/persisted-state-writer.mjs` — `writeMutation()`, `writeViaDb()`, `maybeWriteHoleCards()`;
  - callers: human action, timeout action, bot autoplay, start-hand/bootstrap, and settled rollover paths.
- Call flow:
  - every persisted mutation obtains current private state from `tableManager.privatePokerStateForAudit()` or an override;
  - `writeMutation()` passes it into `writeViaDb()`;
  - after a successful optimistic state UPDATE, `maybeWriteHoleCards()` bulk-upserts every valid two-card hand;
  - the same helper is also invoked on the equal-state conflict/replay path;
  - no hand/card fingerprint or successful-write acknowledgement suppresses a later identical call.
- DB operation:
  - one bulk `INSERT ... ON CONFLICT (table_id, hand_id, user_id) DO UPDATE SET cards = excluded.cards`.
- Frequency:
  - once per successful persisted mutation while private cards are present, plus equal-state replay handling;
  - one human action followed by several bot actions produces one hole-card statement for every persisted step;
  - exact statements/hand depend on action count and autoplay.
- Query-count and egress:
  - one avoidable SQL statement per unchanged mutation after the first successful write for a hand;
  - request egress includes all persisted private card rows; response egress is small.
- Safety boundary:
  - the first durable card write is required for restart recovery;
  - a failed write must not mark the cards as durable;
  - process restart must safely cause another idempotent write;
  - new hand, changed private-card fingerprint, and restore/recovery must not reuse a stale acknowledgement;
  - terminal close, normal runtime unload, explicit eviction, and long-lived processes that observe many table IDs must not leave acknowledgement entries indefinitely;
  - no private cards or full private state may be logged.
- Recommendation:
  - in `createPersistedStateWriter()`, keep a minimal process-local acknowledgement keyed by table and containing `{handId, fingerprint}` only after `maybeWriteHoleCards()` succeeds;
  - skip the SQL call only when the current normalized rows match that acknowledgement;
  - replace the entry on a new hand or changed fingerprint;
  - expose one narrow writer lifecycle method that forgets the acknowledgement for a `tableId`;
  - call it from the existing server lifecycle hook `evictClosedRuntimeTable()` for terminal close and from `restoreTableFromPersisted()` before applying restored runtime, so the next mutation performs a recovery-safe upsert;
  - add one narrowly named `onTableEvicted(tableId)` callback option to the existing table manager, invoke it from `evictTable()`, and route normal table removal through that existing method instead of leaving direct `tables.delete()` paths invisible;
  - have the server callback call only the writer's table-specific forget method; do not expose writer state to the table manager;
  - verify every current deletion path in `leave()`, connection cleanup, expired-presence cleanup, explicit eviction, and terminal close;
  - do not add a timer, general cache, or generic eviction framework;
  - an empty acknowledgement structure after process restart intentionally causes one recovery-safe upsert;
  - do not cache live poker state and do not query DB merely to populate the acknowledgement.
- Expected reduction: from one hole-card statement per persisted mutation to normally one per hand per WS process, plus retries after failure/restart. Exact percentage depends on actions/hand.

### F6 — `SELECT + INSERT` for accepted-action and settlement audit

**Classification: nadal aktualny.**

- File and methods: `ws-server/poker/persistence/persisted-state-writer.mjs` — `maybeWriteAcceptedActionAudit()`, `maybeWriteSettlementAudit()`.
- Current accepted-action operation:
  - SELECT by `(table_id, request_id)`;
  - if absent, INSERT one accepted action audit row.
- Current settlement operation:
  - SELECT by `(table_id, hand_id, action_type = 'HAND_SETTLED')`;
  - if absent, INSERT one settlement audit row.
- Frequency:
  - accepted action: normally two statements per accepted human, bot, or timeout action;
  - settlement: normally two statements on the first persisted SETTLED state; later equal-state handling can repeat the existence SELECT.
- Query-count and egress:
  - successful first writes can become one statement only after enforceable uniqueness exists;
  - SELECT response is a single ID at most, so statement count is the primary impact.
- Safety boundary:
  - action history cannot be silently lost;
  - replay cannot duplicate accepted actions;
  - settlement must occur exactly once in the audit timeline;
  - audit optimization cannot affect state persistence, stack projection, payout calculation, or ledger.
- Recommendation:
  - do not change writer SQL before the constraint work in F7 is complete and verified;
  - afterward replace each read-then-insert pair with an INSERT using the exact matching partial conflict target and `RETURNING id`;
  - preserve existing `klog` events and best-effort audit behavior.
- Expected reduction after constraints: accepted-action audit from two statements to one/action; settlement audit from two statements to one/first settlement attempt.

### F7 — repository indexes and constraints for conflict-safe audit inserts

**Classification: częściowo aktualny. The optimization premise is valid, but the required uniqueness does not exist in repository migrations and production state is unconfirmed.**

- Repository schema:
  - `supabase/migrations/20260116120000_poker_tables.sql` creates `poker_actions` without audit uniqueness;
  - `supabase/migrations/20260117120001_poker_actions_hand_history.sql` adds non-unique indexes on `(table_id, hand_id, created_at)` and `(table_id, version)`;
  - no migration defines uniqueness for accepted action request IDs or one settlement per hand.
- Constraint design limitation:
  - a global unique `(table_id, request_id)` is invalid because `poker-start-hand-core.mjs` writes `START_HAND`, `POST_SB`, and `POST_BB` with the same request ID;
  - other writers include snapshot timeouts, admin actions, leave actions, and post-leave bot autoplay.
- Required production preflight:
  - inspect `pg_indexes`/`pg_constraint`;
  - find duplicate accepted action rows by `(table_id, request_id)` restricted to accepted action types;
  - find duplicate settlement rows by `(table_id, hand_id)` restricted to `HAND_SETTLED`;
  - decide explicitly how any existing duplicates are retained or repaired before adding uniqueness.
- Recommendation:
  - only if preflight is clean or an approved data repair is completed, add two narrowly scoped partial unique indexes:
    - accepted poker action identity over `(table_id, request_id)` only for non-null request IDs and the accepted action-type set used by `maybeWriteAcceptedActionAudit()`;
    - settlement identity over `(table_id, hand_id)` only for non-null hand IDs and `action_type = 'HAND_SETTLED'`;
  - deploy/verify constraints separately from writer changes;
  - never infer production schema solely from migrations.
- Expected reduction: none from indexes alone; they enable the one-statement F6 change.

### F8 — legacy lobby endpoints

**Classification: wymaga danych runtime lub sprawdzenia konfiguracji produkcyjnej.**

- Files and methods:
  - `netlify/functions/poker-list-tables.mjs` — `handler()`, `buildSeatCountsByTableId()`;
  - `netlify/functions/poker-list-my-tables.mjs` — `handler()`, `buildSeatCountsByTableId()`;
  - current first-party client: `poker/poker-ws-client.js` subscribes through `lobby_subscribe` and consumes `lobby_snapshot`.
- DB operations:
  - list tables: one bounded table SELECT, then one active-seat query joining `poker_state` for returned IDs;
  - list my tables: one user-seat/table/state SELECT, then the same active-seat/state query;
  - the state JSON can be repeated for every seat although JavaScript only derives visibility and counts.
- Frequency:
  - no current in-repo browser reference to either HTTP endpoint was found;
  - frequency is zero for the inspected first-party path but cannot be asserted for old builds, bookmarks, external consumers, or direct API users.
- Query-count and egress:
  - one or two statements/request;
  - repeated state JSON may dominate egress for called endpoints.
- Safety boundary:
  - removal must not break fallback discovery, external clients, admin/operational tooling, or recovery entry points;
  - WS lobby remains authoritative for the current browser path.
- Recommendation:
  - verify access logs and external consumers first;
  - if unused for an agreed observation window, remove the endpoints in a dedicated PR;
  - if retained, optimize their read model separately rather than caching live state.
- Expected reduction: zero if they are already unused; otherwise equal to observed endpoint traffic. It cannot be estimated statically.

### F9 — dependencies on recovery, cleanup, settlement, and accounting

**Classification: nadal aktualny. These operations are correctness boundaries, not removal candidates.**

- `ensureTableLoaded()` returns loaded WS state without DB reads and coalesces cold bootstrap by `tableId`.
- Cold bootstrap and `restoreTableFromPersisted()` read table, seats, and state; conflict recovery depends on those reads.
- `executePokerJoinAuthoritative()`, `executePokerLeave()`, and `executePokerRebuyAuthoritative()` use DB locks, request idempotency, stack projections, and ledger movements.
- `executeInactiveCleanup()` and `executeTerminalPokerCloseInTx()` use persisted truth, idempotent cashouts, escrow checks, and terminal chip-conservation invariants.
- Human and bot actions are persisted one accepted transition at a time; batching them is explicitly out of scope.
- Recommendation: do not reduce these statements merely because they are numerous. Optimize only their independently redundant surrounding operations.

## Target work breakdown

The order below starts with bounded read-result reduction, then removes duplicate work, then changes time semantics, and ends with private recovery and schema-sensitive changes. A PR proceeds only after its listed dependencies and production checks pass.

### PR A — bound the open-table reconciler result in SQL

- Goal: stop transferring all open-table IDs when only one batch is evaluated.
- Dependencies: none; confirm actual batch/interval for measurement only.
- Files:
  - `ws-server/server.mjs`;
  - use existing behavior coverage in `ws-server/poker/runtime/table-janitor.behavior.test.mjs` and relevant `ws-server/server.behavior.test.mjs`.
- Symbols and env:
  - `openTableJanitorCursor`;
  - `listOpenTableIdsForJanitor()`;
  - `selectOpenTableJanitorBatch()`;
  - `WS_OPEN_TABLE_JANITOR_SWEEP_BATCH`;
  - `WS_OPEN_TABLE_JANITOR_SWEEP_MS`.
- Current behavior: one SQL statement returns every open table; Node selects a rotating batch.
- Minimal change:
  - pass cursor timestamp, cursor table ID, and bounded batch to the existing SELECT;
  - apply cyclic deterministic ordering and SQL `LIMIT`;
  - keep the current evaluation and cleanup flow unchanged.
- After change: one listing statement returns at most the batch and still wraps without starving tables.
- Predicted reduction: listing response rows bounded to the batch; no reduction in listing statement count or health reads.
- Risk: low/medium; cursor errors can starve tables.
- Breaking impact: none intended; changed `totalOpenTables` logging semantics must be explicitly documented or preserved.
- Rollback: revert only the SQL/cursor selection to current full-list plus `selectOpenTableJanitorBatch()`.
- Verification:
  - use existing rotation/wrap tests and server behavior tests;
  - manually verify multiple batches, cursor deletion, new rows, and wrap;
  - compare returned-row/query payload before/after;
  - because `ws-server/**` changes, manually run `WS Preview Deploy` for the exact PR head ref/SHA before full preview E2E.

### PR B — coalesce only concurrent janitor evaluation by table

- Goal: avoid simultaneous duplicate three-query snapshots and cleanup routing for one `tableId`.
- Dependencies: PR A is not technically required, but landing after it isolates measurements.
- File: `ws-server/server.mjs`.
- Symbols:
  - new server-local `pendingTableJanitorByTableId` map;
  - `runEvaluatedTableJanitor()`;
  - existing `loadPersistedTableHealthSnapshot()` and `runTableJanitor()`.
- Current behavior: every caller immediately loads a fresh persisted snapshot.
- Mandatory pre-implementation gate:
  - enumerate every current caller of `runEvaluatedTableJanitor()` and record its `tableId`, `trigger`, and `requestId`;
  - trace those parameters through `runTableJanitor()` and every reachable primitive;
  - confirm whether they affect only diagnostics or also classification, cleanup routing, table-command dedupe, broadcast, retry, idempotency, or caller-visible results;
  - approve a `tableId`-only key only when all evaluation and execution semantics are independent of trigger.
- Minimal change:
  - if the gate passes, store the in-flight evaluation/cleanup promise by `tableId` and return it to overlapping callers;
  - preserve caller-specific coalesced diagnostics with the original `trigger` and `requestId`;
  - if the gate fails, share only the snapshot/classification promise and preserve distinct required effects without repeating the DB snapshot;
  - delete the entry in `finally`;
  - record only bounded `klog` coalescing metadata without state/cards.
- Must not change:
  - classification logic;
  - cleanup primitive selection;
  - request idempotency;
  - ledger calls;
  - any result after the in-flight promise completes.
- After change: concurrent calls share one evaluation; the next later call always reevaluates.
- Predicted reduction: three SELECTs per overlapping call, plus avoidance of duplicate cleanup entry; runtime evidence is required for percentage.
- Risk: medium.
- Breaking impact: trigger-specific logs, request identity, retry, broadcast, and result semantics could be lost if a `tableId`-only key is approved without the mandatory caller audit; no cleanup may be skipped after completion.
- Rollback: remove the map wrapper; no persisted rollback or migration.
- Verification:
  - use existing janitor and server behavior tests;
  - manually trigger overlapping stale/zombie/open candidates and confirm one snapshot/cleanup;
  - confirm failure clears the map and a later sweep retries;
  - manual `WS Preview Deploy` for the exact PR ref/SHA is mandatory.

### PR C — reduce stale-seat candidate polling cadence

- Goal: reduce fixed idle SELECTs while preserving bounded eventual cleanup.
- Dependencies:
  - confirm production `WS_STALE_ACTIVE_SEAT_SWEEP_MS`, `WS_ACTIVE_SEAT_FRESH_MS`, and `WS_SEATED_RECONNECT_GRACE_MS`;
  - land PR B first so overlap is independently controlled.
- Files:
  - `ws-server/server.mjs`;
  - `netlify/functions/_shared/admin-ops.mjs` only if its displayed fallback must match the runtime default.
- Symbols and env:
  - `staleActiveSeatSweepMs`;
  - `sweepStaleActiveHumanSeatsAndBroadcast()`;
  - `WS_STALE_ACTIVE_SEAT_SWEEP_MS`;
  - admin runtime configuration projection.
- Current behavior: default one candidate SELECT every 5 seconds.
- Minimal change: change only the default to 30 seconds; retain the same env override bounds, candidate query, batch, classification, and cleanup.
- After change: default cleanup detection can be delayed by up to about 25 additional seconds; explicit env overrides continue to win.
- Predicted reduction under defaults: 17,280 to 2,880 listing SELECTs/day/instance, approximately 83.3%.
- Risk: medium.
- Breaking impact: slower stale-seat cleanup and possibly longer-lived lobby seats.
- Rollback: restore the 5-second default or set the previous value through env.
- Verification:
  - existing stale-seat, reconnect, inactive-cleanup, and server behavior tests;
  - manual reconnect inside and outside grace;
  - disconnect during a live hand and eventual cleanup;
  - restart WS and confirm persisted stale seats are still found;
  - compare empty-system listing count before/after;
  - manual `WS Preview Deploy` for the exact PR ref/SHA is mandatory.

### PR D — coarsen persisted seat touch cadence conservatively

- Goal: reduce per-user heartbeat UPDATEs without weakening restart/reconnect safety.
- Dependencies:
  - confirm production values for touch throttle, active freshness, reconnect grace, and live-hand stale window;
  - verify PR C behavior first;
  - document a safety inequality leaving restart/reconnect margin below stale classification.
- Files:
  - `ws-server/server.mjs`;
  - `netlify/functions/_shared/admin-ops.mjs` only if exposing the effective value is added through the existing runtime-config response.
- Symbols and env:
  - `persistedSeatTouchThrottleMs`;
  - `persistedSeatTouchByTableUser`;
  - `touchPersistedSeatLastSeen()`;
  - `maybeTouchPersistedSeatLastSeen()`;
  - `WS_PERSISTED_SEAT_TOUCH_THROTTLE_MS`;
  - `WS_ACTIVE_SEAT_FRESH_MS`;
  - `WS_SEATED_RECONNECT_GRACE_MS`;
  - `POKER_LIVE_HAND_STALE_MS`.
- Current behavior: default 7.5-second throttle; normal ping writes every 15 seconds.
- Minimal change: use a conservative 30-second default, retaining the existing map, UPDATE, bounds, failure retry behavior, and immediate socket presence.
- Must not change:
  - stale classification;
  - reconnect grace;
  - cleanup accounting;
  - runtime authority;
  - session heartbeat.
- After change: normal default ping stream persists every second ping; command bursts remain coalesced.
- Predicted default reduction: approximately 50% UPDATEs/user, from 5,760 to 2,880/day for a continuously seated user.
- Risk: high because a stale persisted timestamp after process failure shortens recovery margin.
- Breaking impact: possible false stale classification after restart if production windows are incompatible.
- Rollback: restore previous default or set the env override to the prior value.
- Verification:
  - existing server, table-janitor, reconnect/resync, disconnect-cleanup, and inactive-cleanup tests;
  - manual active play, reconnect before/after grace, and WS restart at worst-case touch age;
  - confirm a connected user is never stale-cleaned;
  - compare UPDATE count before/after;
  - manual `WS Preview Deploy` for the exact PR ref/SHA is mandatory.

### PR E — suppress only acknowledged identical hole-card writes

- Goal: persist private cards once per hand/process in the normal case while keeping recovery retries.
- Dependencies: PRs A–D are independent; establish a query-count baseline for actions/hand.
- Files:
  - `ws-server/poker/persistence/persisted-state-writer.mjs`;
  - `ws-server/server.mjs`;
  - `ws-server/poker/table/table-manager.mjs` only for routing existing runtime deletion paths through the existing `evictTable()` lifecycle.
- Symbols:
  - `createPersistedStateWriter()`;
  - `buildHoleCardRows()`;
  - `maybeWriteHoleCards()`;
  - `writeViaDb()`;
  - new minimal acknowledgement map and narrow forget method local to the writer instance;
  - `restoreTableFromPersisted()`;
  - `evictClosedRuntimeTable()`;
  - `tableManager.evictTable()`, a narrow `onTableEvicted(tableId)` callback, and current direct `tables.delete()` paths.
- Current behavior: identical bulk UPSERT after every successful mutation and equal-state replay path.
- Minimal change:
  - derive a stable fingerprint from normalized `{tableId, handId, userId, cards}` rows;
  - skip only when the same writer instance has already observed a successful write for that table/hand/fingerprint;
  - record acknowledgement only after SQL success;
  - replace on hand/fingerprint change;
  - clear immediately on restore and terminal close;
  - make all normal runtime table removals reach the existing `evictTable()` lifecycle and invoke the narrow server callback that clears the corresponding writer entry.
- Must not change:
  - public persisted state;
  - card validation;
  - hole-card schema/RLS;
  - bootstrap/recovery reads;
  - state versioning;
  - any log payload to include private cards.
- After change: first write, failed-write retry, process restart, new hand, and changed fingerprint still execute the idempotent upsert.
- Lifecycle after change:
  - new hand/fingerprint replaces the single entry for that table;
  - restore clears it before restored state can be persisted;
  - terminal close clears it through `evictClosedRuntimeTable()`;
  - normal unload/connection cleanup/expired-presence deletion clears it through `tableManager.evictTable()`;
  - a long-running process therefore retains at most acknowledgements for runtime tables that have not been evicted, without a separate cache framework.
- Predicted reduction: normally `persisted mutations per hand - 1` statements; quantify using representative human/bot hands.
- Risk: high.
- Breaking impact: an incorrect acknowledgement can make private-card recovery incomplete.
- Rollback: remove the acknowledgement check; existing idempotent upsert resumes every mutation.
- Verification:
  - use existing `persisted-state-writer.behavior.test.mjs`, bootstrap, table-snapshot, hole-card contract/RLS, autoplay, and server behavior tests;
  - manually verify start and recovery of a hand, human actions, multiple bot autoplay steps, settlement, and WS restart;
  - force a hole-card write failure and confirm the next mutation retries;
  - verify terminal close, explicit eviction, normal unload, restore, new hand, and churn through many table IDs do not retain stale acknowledgements;
  - never log private cards or full private state;
  - manual `WS Preview Deploy` for the exact PR ref/SHA is mandatory.

### PR F1 — add narrowly scoped audit uniqueness, only after production preflight

- Goal: create the database invariant required for conflict-safe one-statement audit inserts.
- Dependencies:
  - production schema inspection;
  - duplicate reports for both proposed identities;
  - an explicit approved repair decision if duplicates exist.
- File: one new timestamped migration under `supabase/migrations/`.
- Affected identities:
  - accepted action types recognized by `ACCEPTED_ACTION_TYPES`;
  - `HAND_SETTLED`.
- Current behavior: only non-unique history indexes exist.
- Minimal change: add the two partial unique indexes described in F7; do not add global request-ID uniqueness.
- After change: duplicates in only the targeted audit domains are rejected; `START_HAND`/blind and other action writers remain valid.
- Predicted reduction: none until F2; possible index storage/write overhead.
- Risk: high.
- Breaking impact: migration failure on existing duplicates; incorrect predicate can reject legitimate action history.
- Rollback: drop only the new indexes after stopping any writer that relies on them.
- Verification:
  - inspect actual production index definitions after migration;
  - verify representative start-hand/blind, leave, timeout, admin, human, and bot action inserts;
  - verify exactly one settlement audit;
  - no WS Preview Deploy is required for a migration-only PR unless it also changes WS/shared runtime.

### PR F2 — replace audit pre-reads with conflict-safe inserts

- Goal: remove one SELECT from every accepted-action audit and first settlement audit attempt.
- Dependencies: PR F1 deployed and verified in every target environment.
- File: `ws-server/poker/persistence/persisted-state-writer.mjs`.
- Symbols: `maybeWriteAcceptedActionAudit()`, `maybeWriteSettlementAudit()`, `ACCEPTED_ACTION_TYPES`, `HAND_SETTLED_ACTION_TYPE`.
- Current behavior: SELECT existence followed by INSERT.
- Minimal change:
  - use INSERT with the exact F1 partial conflict target and `DO NOTHING RETURNING id`;
  - distinguish inserted versus already present without a follow-up SELECT;
  - preserve current `klog` only for actual insert and current caller result semantics.
- Must not change:
  - audit metadata;
  - accepted action types;
  - settlement computation;
  - state transaction ordering;
  - best-effort error handling.
- After change: duplicate replay is a successful no-op enforced by Postgres.
- Predicted reduction: one statement per accepted action and one per settlement first/replay attempt.
- Risk: high.
- Breaking impact: a predicate mismatch can lose audit rows or surface conflicts.
- Rollback: restore pre-read writer before dropping F1 indexes; indexes may safely remain during rollback.
- Verification:
  - existing persisted-writer action/settlement replay tests;
  - manual human actions, bot autoplay, timeout action, settlement, recovery replay, leave/rebuy, and terminal close;
  - confirm no lost/duplicated action or settlement audit;
  - manual `WS Preview Deploy` for the exact PR ref/SHA is mandatory.

### PR G — decide legacy lobby endpoint disposition from observed consumers

- Goal: remove unused persisted lobby traffic or reduce response duplication if consumers exist.
- Dependencies: access-log/API-consumer verification over an agreed window.
- Files:
  - `netlify/functions/poker-list-tables.mjs`;
  - `netlify/functions/poker-list-my-tables.mjs`;
  - consumer references, documentation, or redirects only if confirmed.
- Current behavior: no first-party browser caller found; each external request performs one or two SQL reads and can repeat state JSON per seat.
- Minimal change:
  - if unused, remove the two endpoints and references in a dedicated PR;
  - if used, retain the contract and replace repeated state/seat transfer with one bounded visibility/count projection;
  - do not add caching.
- Predicted reduction: must be based on observed endpoint calls; zero if already unused.
- Risk: medium.
- Breaking impact: endpoint removal is explicitly breaking for unknown external clients.
- Rollback: restore functions or revert the read-model query.
- Verification:
  - current WS lobby subscribe/snapshot path;
  - direct endpoint contract if retained;
  - first-party quick-seat/create/join flows;
  - CSP/JSP reminder: if any future implementation adds browser script, preserve plain JSP-compatible JavaScript and update the CSP SHA; no JavaScript or CSS is expected for this candidate.

## Detailed implementation tasks

### Task set A — SQL-bounded open-table selection

1. In `ws-server/server.mjs`, update `listOpenTableIdsForJanitor()` to bind the normalized current cursor and `boundedLimit` into its existing query.
2. Preserve `(updated_at, id)` ordering and cyclic wrap; do not replace it with offset pagination.
3. Continue using the existing `selectOpenTableJanitorBatch()` behavior as the reference; do not create a generic pagination utility.
4. Preserve `WS_OPEN_TABLE_JANITOR_SWEEP_BATCH`, timer cadence, `runEvaluatedTableJanitor()`, and cleanup primitives.
5. Validate empty result, first page, middle page, wrap, cursor-row deletion, and equal timestamps using existing tests/manual fixtures.
6. Confirm query response never exceeds the bounded batch.

### Task set B — in-flight janitor coalescing

1. In `ws-server/server.mjs`, enumerate all callers of `runEvaluatedTableJanitor()` and trace `tableId`, `trigger`, `requestId`, classification, primitive arguments/results, broadcasts, and retries.
2. Record the conclusion in the implementation PR; do not approve a `tableId`-only key if trigger changes evaluation or required effects.
3. If semantics remain independent, add one `Map` beside other server-local runtime maps and wrap the in-flight operation with get/set/finally behavior.
4. Preserve a caller-specific `klog` entry for every coalesced invocation using its original trigger/request ID.
5. If semantics are not independent, coalesce `loadPersistedTableHealthSnapshot()` plus classification only, then preserve distinct required post-classification effects without re-reading DB.
6. Do not cache completed results and do not suppress any invocation after the shared promise settles.
7. Reuse `loadPersistedTableHealthSnapshot()`, `evaluateTableHealth()`, `runTableJanitor()`, and existing primitives; never use `console.log`.
8. Verify one DB snapshot during overlap, required caller effects remain observable, cleanup runs with correct routing, and later retry works after rejection.

### Task set C — stale sweep cadence

1. In `ws-server/server.mjs`, change only the fallback passed to `resolvePositiveInt()` for `WS_STALE_ACTIVE_SEAT_SWEEP_MS` after production confirmation.
2. If admin runtime config reports the fallback in `netlify/functions/_shared/admin-ops.mjs`, keep the displayed default aligned.
3. Do not change candidate SQL, batch size, active freshness, reconnect grace, or cleanup behavior.
4. Verify the effective configured value is visible in existing operational output and logs.
5. Compare listing calls over the same observation window before/after.

### Task set D — persisted presence cadence

1. In `ws-server/server.mjs`, change only the default for `persistedSeatTouchThrottleMs`.
2. Retain `persistedSeatTouchByTableUser`, failure deletion, active-seat predicate, and fire-and-forget call sites.
3. Do not change `HEARTBEAT_MS`, ping protocol, session TTL, reconnect grace, or stale classification in this PR.
4. Confirm the selected value leaves a documented worst-case margin under production stale thresholds after restart.
5. Verify active play, command bursts, disconnect/reconnect, and process restart without false cleanup.

### Task set E — hole-card write acknowledgement

1. In `createPersistedStateWriter()`, add one local map containing only hand/fingerprint acknowledgement, not card state used by gameplay.
2. Reuse `buildHoleCardRows()`, normalized card codes, and deterministic ordering; do not add a second card parser.
3. Make `maybeWriteHoleCards()` return enough non-secret metadata to record success without logging card values.
4. Set acknowledgement only after the SQL call resolves successfully; keep failure retry behavior.
5. Skip only an identical normalized table/hand/fingerprint; a changed hand, user set, or card code must write.
6. Add one narrow writer method to forget an acknowledgement by `tableId`; do not expose the map or create a generic cache API.
7. In `ws-server/server.mjs`, invoke that method from `restoreTableFromPersisted()` and the existing `evictClosedRuntimeTable()` hook.
8. In `ws-server/poker/table/table-manager.mjs`, add only a narrow `onTableEvicted(tableId)` option, invoke it from `evictTable()`, audit every direct `tables.delete()` path, and route runtime removal through `evictTable()`.
9. In `ws-server/server.mjs`, supply that callback and have it call only the writer's table-specific forget method, covering normal unload as well as terminal close without exposing the acknowledgement map.
10. Confirm a new hand replaces the prior entry and process restart starts with no acknowledgements.
11. Verify long-running table churn cannot grow the map beyond currently retained runtime table IDs.
12. Do not alter `poker_hole_cards`, private-state recovery, RLS, state sanitizer, or transaction accounting.
13. Verify query count across start, multiple actions, bot autoplay, settlement, equal-state replay, restart, restore, terminal close, unload, and many table IDs.

### Task set F — audit uniqueness and insert

1. Before code, inspect production constraints and duplicates with read-only SQL; record results without private state.
2. In a dedicated migration, add only the accepted-action and settlement partial unique indexes; do not add global `(table_id, request_id)` uniqueness.
3. Verify all `poker_actions` writers against predicates, including start hand/blinds, snapshot timeout, leave, post-leave autoplay, and admin actions.
4. Only after index deployment, update `maybeWriteAcceptedActionAudit()` and `maybeWriteSettlementAudit()` to one conflict-safe INSERT each.
5. Reuse existing audit metadata builders and `klog`; do not alter settlement or ledger logic.
6. Verify actual insert, duplicate no-op, SQL error, state rollback behavior, and audit timeline.

### Task set G — legacy endpoint decision

1. Confirm external consumers and observed calls before modifying either endpoint.
2. If unused, remove only the two functions and directly related documentation/configuration.
3. If used, preserve response contracts and reuse `shouldHideSeatRowFromReadModel()` while moving counts/visibility into bounded SQL.
4. Do not introduce polling, cache, live-state fallback, JavaScript, or CSS.
5. Verify WS lobby remains the first-party authority and quick-seat/create flows remain unchanged.

## Verification strategy

### This documentation PR

- Add no tests and run no new runtime test suite.
- Validate only document scope, Markdown, diff, and that the commit contains exactly this file.

### Future implementation PRs

Use existing deterministic tests and manual verification; do not add a new framework. Prefer the current behavior files, including:

- `ws-server/poker/runtime/table-janitor.behavior.test.mjs`;
- `ws-server/server.behavior.test.mjs`;
- `ws-server/poker/runtime/disconnect-cleanup.behavior.test.mjs`;
- `ws-server/poker/reconnect/resync.behavior.test.mjs`;
- `shared/poker-domain/inactive-cleanup.behavior.test.mjs`;
- `ws-server/poker/persistence/persisted-state-writer.behavior.test.mjs`;
- `ws-server/poker/bootstrap/persisted-bootstrap-*.behavior.test.mjs`;
- `ws-server/poker/handlers/act.behavior.test.mjs`;
- `ws-server/poker/handlers/bot-autoplay.behavior.test.mjs`;
- `ws-server/poker/handlers/turn-timeout.behavior.test.mjs`;
- `shared/poker-domain/leave.behavior.test.mjs`;
- `shared/poker-domain/rebuy.behavior.test.mjs`;
- `tests/poker-ledger-settlement.idempotency.test.mjs`;
- existing terminal-close, rollover, and ledger tests located in `shared/`, `ws-server/`, and `tests/`.

For the relevant PR, exercise:

1. stale-seat cleanup with no socket and with a connected socket;
2. zombie/open-table cleanup, rotation, wrap, and no-candidate sweeps;
3. reconnect inside and outside grace;
4. WS restart at worst-case persisted presence age;
5. persistence conflict recovery and authoritative restore;
6. start and recovery of a hand with hole cards;
7. human actions and repeated request replay;
8. multi-step bot autoplay and timeout action;
9. settlement exactly once;
10. leave and rebuy;
11. terminal close;
12. no double ledger movement;
13. no lost or duplicated chips;
14. before/after statement and returned-row comparison where practical.

Every PR affecting `ws-server/**`, WS runtime dependencies under `shared/**`, or browser/WS protocol behavior requires a manual `WS Preview Deploy` for the exact implementation branch or head SHA before full preview E2E. A green Netlify preview, `WS PR Checks`, or validation-only `WS Server Deploy` is not a runtime deployment. Record the deployed ref/SHA and workflow result.

Operational verification and any added diagnostics must use `klog` only, never `console.log`. Do not log private cards, full poker state, secrets, tokens, or connection credentials.

## Production and configuration checks

### Confirmable in the repository

- code defaults and allowed ranges for heartbeat, touch throttle, freshness, grace, and sweep timers;
- all static call sites of `maybeTouchPersistedSeatLastSeen()` and `persistMutatedState()`;
- current candidate/listing SQL and JavaScript cursor behavior;
- absence of in-flight janitor coalescing;
- repeated hole-card invocation paths;
- read-then-insert audit SQL;
- migration-defined indexes and all in-repo `poker_actions` writers;
- absence of first-party references to the two legacy list endpoints.

### Requires environment or production access

- effective preview/production env values for:
  - `WS_PERSISTED_SEAT_TOUCH_THROTTLE_MS`;
  - `WS_ACTIVE_SEAT_FRESH_MS`;
  - `WS_SEATED_RECONNECT_GRACE_MS`;
  - `POKER_LIVE_HAND_STALE_MS`;
  - `WS_STALE_ACTIVE_SEAT_SWEEP_MS`;
  - `WS_ZOMBIE_TABLE_SWEEP_MS`;
  - `WS_OPEN_TABLE_JANITOR_SWEEP_MS`;
  - `WS_OPEN_TABLE_JANITOR_SWEEP_BATCH`;
- number of WS instances and whether traffic is partitioned;
- actual `pg_indexes` and `pg_constraint` definitions in each deployed database;
- duplicate accepted-action and settlement audit rows;
- external/legacy endpoint consumers and request frequency;
- `pg_stat_statements` or equivalent before/after evidence, if available;
- Supabase DB/pooler egress before/after over comparable windows;
- table counts, batch occupancy, overlap rate, actions/hand, and bot-action distribution.

These environment checks are gates, not assumptions. If the required metric is unavailable, document that limitation and use bounded `klog` counters or comparable request logs without exposing private data.

## Risks and breaking impact

- **False stale classification:** coarser persisted presence can shorten restart recovery margin and remove an active player's seat.
- **Delayed cleanup:** slower sweep cadence intentionally delays stale-seat detection.
- **Zombie/open tables:** broken SQL wrap or excessive timer changes can leave tables open indefinitely.
- **Concurrent or missed janitors:** a coalescing map that is not cleared in `finally` can permanently suppress cleanup; an overly broad key can merge unrelated tables.
- **Janitor caller semantics:** coalescing the full operation by `tableId` can discard required trigger/request-specific logging, routing, broadcast, retry, or caller results unless the mandatory current-caller audit proves independence.
- **Private-card recovery:** premature or stale hole-card acknowledgement can make a hand unrecoverable after restart.
- **Writer lifecycle growth:** acknowledgement entries must be removed on terminal close, restore, and every normal runtime eviction; direct table deletion paths must not bypass lifecycle cleanup.
- **Lost action audit:** an incorrect partial predicate or conflict target can suppress a legitimate action.
- **Duplicate/missing settlement audit:** uniqueness must match exactly one settlement per table/hand without affecting settlement computation.
- **Reconnect:** freshness, grace, heartbeat, and restart behavior are coupled and must be verified together before changing presence cadence.
- **Idempotency:** durable request lookup/reserve/finalize remains unchanged; no optimization may replace it with memory-only state.
- **Balance and ledger:** no planned optimization changes account lookup, ledger posting, escrow checks, stack projection, cashout, or idempotency keys.
- **Terminal chip conservation:** terminal close reads and writes remain untouched; query reduction is never allowed to bypass claim/escrow equality or zero-escrow verification.
- **Legacy API breaking impact:** removing either legacy endpoint is breaking for unknown external consumers and requires evidence plus explicit release documentation.
- **Observability:** changes to log counts or meanings must be stated; all logging remains through `klog`.
- **CSP/JSP/CSS:** no browser code is planned. If a later implementation unexpectedly adds a script, it must remain plain JSP-compatible JavaScript and its CSP SHA must be updated. Any future CSS must retain one line per selector.

## Out of scope

- caching live poker state;
- caching chip balances, escrow balances, or ledger data;
- batching multiple accepted poker actions into one persistence write;
- removing or weakening durable request idempotency;
- weakening reconnect, recovery, settlement, cleanup, or terminal-close guarantees;
- broad architecture refactoring;
- a new cache framework;
- accounting optimization at the expense of correctness;
- changing poker reducer rules, autoplay decisions, settlement calculations, stack ownership, or chip-conservation invariants;
- JavaScript or CSS changes in this plan PR.

## Notes

- This is critical realtime poker infrastructure. Keep every implementation simple, local, and independently reversible.
- Reuse existing maps, helpers, adapters, env resolution, SQL transaction patterns, and `klog`.
- Do not create a duplicate autoplay, persistence, cleanup, recovery, or accounting path.
- WS remains authoritative for loaded tables; DB remains the durable secondary state and accounting boundary.
- Every possible breaking impact must be called out in its implementation PR.
- Before finishing each implementation PR, remove speculative abstractions and retain only the smallest verified change.
