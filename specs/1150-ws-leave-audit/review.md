# #1150 / Draft #1151 — private audit metadata after WS Leave

Medium/P2, before public 1.0. Issue: https://github.com/krzysztofcal/arcadePlatform/issues/1150

**Account Deletion V2 is active on Production since 2026-10-23 (owner-confirmed); #1117 is CLOSED/completed. The prior assumption that this path was disabled was wrong.** This change treats deletion Leave as an active production path; no live deletion or Production inspection/mutation was performed.

## Final behavior and files

- `ws-server/poker/handlers/leave.mjs::handleLeaveCommand`: after successful ordinary/already-left Leave, use existing `restoreTableFromPersisted(tableId)` rather than the public Leave result. `server.mjs` supplies that callback. Public responses remain sanitized.
- `ws-server/poker/runtime/account-deletion.mjs::createDeletionPokerLeave`: the existing deletion callback is extracted for fundamental testing and uses the existing `createDeletionPokerCoordinator.coordinate` queue/fence/full-reload mechanism. It calls the same authoritative Leave executor and retains its fresh-attempt suffix for deferred seats/all-in winnings. No public state is installed into runtime.
- `server.mjs::runAccountDeletionTick`: uses this callback, then existing broadcast/rollover/bot scheduling after successful restore. No new service, queue, persistence structure or SQL is introduced.
- `createAccountDeletionRuntime.steps.poker`: first calls existing `resyncPokerPrivacy(context)`, **before** scanning SQL seats. A committed cashout can remove the owner from that scan; resync must not depend on finding the seat again.
- Full reload reads current persisted table/seats/state, validates/rehydrates through `adaptPersistedBootstrap` and applies the existing manager version fence. It never copies private metadata across handIds. Existing Auth-last, lifecycle/lease guards, deletion phase order, ledger/BURN and canonical cashout code are unchanged.

## Consumer audit / removal

Repository-wide search of executable code, scripts, tests and workflows confirmed deletion Leave was the last production caller of `buildAuthoritativeLeaveRestore`. `syncAuthoritativeLeave` had only direct unit-test consumers and delegated to the same obsolete public-projection restore. After migrating deletion, neither API had a production consumer.

Removed both internal methods/exports and their exclusive private-state/seat-shape helpers from `table-manager.mjs`. Removed tests of the discarded mechanism, retained the meaningful deferred-Leave projection test using full canonical restore, and changed the existing `table-manager.leave-restore.behavior.test.mjs` to verify full persisted bootstrap reload (normal/deferred all-in, original starting stacks, private cards, public snapshot privacy). Its existing CI registration stays unchanged. Remaining `restoreTableFromPersisted`, `deriveDeterministicRuntimeHandState` and the separate authoritative adapter shape validators still have needed callers and remain.

The large deletion in the diff removes the orphaned mechanism and its tests; it is not an engine rewrite. No WS/HTTP/schema breaking change. Internal Node-only APIs with no remaining runtime consumers are removed; repository search must stay empty for their names.

## Recovery after commit and latency

The existing coordinator serializes under the existing table FIFO, fences table mutations and invalidates old views before Leave, then reloads full persistence. A failed reload keeps the table fenced and its existing pending-resync entry. `advanceDeletion` treats this as a dependency failure: RETRY, lease released, next attempt after 30 s; the existing 25 s tick scans due work. Nonfinancial long delays raise the existing operator incident after the deadline; they do not silently advance to BURN/Auth or become permanently completed/error. Recovery requires the underlying dependency to return.

On the next poker attempt, resync runs even if SQL no longer has the owner's seat/stack. Success unblocks runtime before the poker phase can finish; another failure stays RETRY and cannot BURN. No second financial Leave is needed when the owner no longer has an obligation. A process restart drops the stale in-memory runtime/pending map; canonical bootstrap reloads SQL, not an old public reply. Existing restart/Auth-last tests remain in the verification set.

Normal deletion Leave adds one existing full repository read: ordinarily four SELECTs (table, seats, state and schema-capability check) in one read transaction. It holds that table's command ownership/fence for the read latency; unrelated tables keep their queues. Pending-resync retries add the same read; with no pending entries the pre-scan resync does no SQL. Existing restore may schedule settled rollover and invalidate the private-card acknowledgment cache. No extra ledger or bot-action write is introduced; a later writer may make its existing idempotent hole-card check. No live latency/SLA measurement is claimed, and no timeout/configuration was changed.

## Fundamental tests

- Ordinary Leave RED→GREEN remains: original map survives real manager/bot actions and settlement audit writer; public response/player/observer snapshots omit it. Already-left retry loads a current hand/version instead of an old public result.
- New regression in existing `tests/account-deletion.e2e.test.mjs`, using existing local PGlite fixture: extracted original callback gives RED (map undefined); corrected callback/coordinator yields GREEN. Real authoritative Leave, legal engine bot actions, real persisted writer and HAND_SETTLED audit: OK, no flags, original total 300 CH.
- Real subsequent cashout of 100 CH commits, reload fails twice, runtime stays fenced/RETRY and BURN count remains zero. Resync succeeds with no active owner place/stack to scan; Leave call count stays unchanged, so no second cashout. Wallet 75+100=175 CH; real BURN of 175 CH commits once, a lost post-commit response retries its durable receipt without another BURN. Observer keeps bot table open: remaining bot escrow 200 CH, all ledger entry sums zero. Auth still exists; the regression does not invoke Auth deletion.
- Existing all-in/main-pot/side-pot/real cashout+BURN/restart/lost-Auth-response test validates Auth-last and full completion separately. Existing lifecycle, lease, privacy, Redis/avatar and wallet-retirement tests remain unchanged.
- The local regression adds only missing fixture table/index shapes needed by the real writer, isolates its table and cleans it before legacy fixtures. It is registered before the file's later asynchronous imports so targeted runs do not execute the file cleanup hook before it. Initial incomplete-fixture failures were not treated as runtime passes.

## Verification

- Full Account Deletion E2E file: **12/12 PASS**.
- WS server + reconnect/resync + live Leave race: **162/162 PASS**.
- Handler + full reload + bootstrap: **37/37 PASS**; manager + reload suite: **94/94 PASS** (obsolete-method cases removed).
- Root `npm test`: exit 0, **148 groups passed**, with existing optional PostgreSQL groups/subtests skipped without disposable DB configuration.
- Combined deletion/lifecycle/Redis/avatar/bonus/retirement run: **74/74 PASS**, exit 0. CI is reported in the PR. Standalone deletion runs use the existing CI `XP_TEST_MODE=1` and concurrency=1; an initial invocation without that environment failed V3 setup, not a verified runtime result.
- Syntax/whitespace checks PASS; no Stage/Production database or provider calls, migration, deploy or real deletion.

## Exact-SHA Preview plan — separate GO, no execution here

Implementation is ready for review, **awaiting exact-SHA WS Preview runtime verification**, not merge-ready. PR/Netlify checks do not deploy WS.

1. Check shared Preview occupancy, other work, prior human places/stacks/cashouts/escrow. After explicit deploy GO, use workflow definition main and exact latest runtime-affecting SHA; prove metadata/restart/module hashes/health.
2. Ordinary Online in-hand Leave: original starting-stack metadata retained, bots continue, audit OK, canonical cashout. Repeat/reconnect with existing requestId where appropriate; no second cashout, no leftover human stack and no map in public output. This branch does not include #1149's JOIN fairness patch.
3. **Actual Account Deletion requires a separate explicit destructive-test authorization**, pinned disposable Stage identity and approved CH/escrow expectations. Do not reuse the ordinary shared smoke account automatically. In-hand deletion Leave should finish/reconcile bots, retain audit OK until authorized privacy cleanup, BURN once, finish privacy before Auth-last, and reach completed state. Check retry/recovery through local failure tests unless fault injection is separately authorized; no live fault injection implied.
4. Stop on unclear balances, missing metadata, prolonged fenced recovery or privacy leak. No manual ledger/history correction. No Production test or deployment.

No #1149/#1147 edits or Offline T003–T008. Draft only; stop for owner review.
