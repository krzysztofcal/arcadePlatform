# #1150 / Draft #1151 — private audit metadata after WS Leave

**2026-10-25 runtime verdict: NOT READY.** Exact-SHA deploy and Online audit/cashout/privacy passed; retry timed out at the existing client deadline, Single Player stopped, and isolated reload timing could not be captured. See the controlled smoke results below.

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

## Initial exact-SHA Preview plan (partly executed below under owner GO)

Implementation is ready for review, **awaiting exact-SHA WS Preview runtime verification**, not merge-ready. PR/Netlify checks do not deploy WS.

1. Check shared Preview occupancy, other work, prior human places/stacks/cashouts/escrow. After explicit deploy GO, use workflow definition main and exact latest runtime-affecting SHA; prove metadata/restart/module hashes/health.
2. Ordinary Online in-hand Leave: original starting-stack metadata retained, bots continue, audit OK, canonical cashout. Repeat/reconnect with existing requestId where appropriate; no second cashout, no leftover human stack and no map in public output. This branch does not include #1149's JOIN fairness patch.
3. **Actual Account Deletion requires a separate explicit destructive-test authorization**, pinned disposable Stage identity and approved CH/escrow expectations. Do not reuse the ordinary shared smoke account automatically. In-hand deletion Leave should finish/reconcile bots, retain audit OK until authorized privacy cleanup, BURN once, finish privacy before Auth-last, and reach completed state. Check retry/recovery through local failure tests unless fault injection is separately authorized; no live fault injection implied.
4. Stop on unclear balances, missing metadata, prolonged fenced recovery or privacy leak. No manual ledger/history correction. No Production test or deployment.

No #1149/#1147 edits or Offline T003–T008. Draft only; stop for owner review.


## Controlled WS Preview smoke — 2026-10-25 UTC

**Recommendation: NOT READY for the complete requested verification gate.** The original in-hand Leave audit defect did not reproduce, but do not equate that PASS with a passed retry/Single Player gate. No new runtime fix, configuration change, fault injection, real Account Deletion, Production deployment, merge or Offline/#1149 work was performed. After retry uncertainty, no further gameplay mutations were sent. Only read-only accounting checks and this report followed.

### Preflight / exact deployment — PASS

- PR HEAD was the authorized `1226167c8fd77d77307f5cb097a4cc9d57e477f9`, Draft.
- At 08:01:07.212604: zero established port-3001 clients, active human seats, pending Poker requests or pending deletion requests. No other active agents or competing Preview workflow. Five system-owned CONTINUOUS_BOT tables only; each escrow/state total 300 CH, no human seat history or pending detach; ordinary managed pool activity, no human game displaced. Test wallet 460 CH.
- Workflow definition main `6ecbc8a36a19952b7e86255436e8be903ea5d646`, application ref exact authorized SHA. [Manual run 40175101317](https://github.com/krzysztofcal/arcadePlatform/actions/runs/40175101317) SUCCESS, workflow_dispatch/main.
- Installed releaseSha/deployRef both exact authorized SHA, environment preview. Journal shows Preview stop/start **08:03:54 UTC**, new PID **285476**. Final metadata/PID unchanged, service active, public `/healthz` `ok`.
- Installed SHA256 matches `git show` bytes for every changed runtime module:

| Module within ws-server | SHA256 |
|---|---|
| server.mjs | 71565bd98fd72e24d8deb52c9e33c4129b214392e7c3557cd0fae17b20163464 |
| poker/handlers/leave.mjs | bbe2fcc605dc25415b00f2c7a53e55ac0bca8a2fa12a2702946ee7df1fdbb3cc |
| poker/runtime/account-deletion.mjs | aff06b5d14637ec74303d7ac2c05f30f99641c35b9f8d54cdaf61bfeb427c2d2 |
| poker/table/table-manager.mjs | 0a28067a903bdc782b62bc37ebe04a96656f0b8870efb4ac9ca6483f6042c648 |

- Netlify https://deploy-preview-1151--playkcswh.netlify.app build-info matched that SHA and Preview WS URL. Normal UI login pinned the dedicated account to Stage `krydukthwdvccggbyjfw`. Three observed sockets all used `wss://ws-preview.kcswh.pl/ws`.

### Online JOIN / action / in-hand Leave / audit — PASS

Table **`2d200475-11f7-4069-8377-0ab8b9e9590f`**, system-owned managed test pool. JOIN `join_mvnjqemb_7mxqbd8k`, sent 08:08:49.294, accepted 08:09:03.996: **14,702 ms**, seat 4 / WAITING_NEXT_HAND. It waited behind the old bots-only hand; this branch deliberately lacks #1149's queue-budget change. No admission-performance improvement is claimed.

The harness used the actual deployed PokerWsClient and UI, with a read-only tap exposing the created client instance. Leave used its normal `sendLeave` command so the socket could stay open to record ACK; no protocol mock, forged auth, engine copy, changed timeout or local WS server. The immediate-navigation UI branch was not separately exercised in this run.

Two human hands occurred. Prelude `_112_6`: legal CALL(4), then an observation pause let the ordinary 20-second timer FOLD the player. It settled with audit OK, player 100→96 CH. The harness should have advanced sooner; this cost is included below, not hidden or corrected. Target hand **`ws_hand_2d200475-11f7-4069-8377-0ab8b9e9590f_141_6`**: legal CALL(2) `ws_1a1721d1a1b_8004184a`, accepted **243 ms**, player 96→94 CH, then normal Leave during PREFLOP.

Leave **`leave_1151_mvnjth7c`** sent **08:11:12.618**, commandResult accepted **08:11:16.224**: **3,606 ms**, server ts 08:11:16.220. Durable LEAVE_TABLE v146 at 08:11:15.720292, deferred cashout=0 at that point. It executed before the hand settled, not after waiting for the whole hand.

At 08:11:43.520320, v154/RIVER of the same target hand still had the complete private six-entry map. Its values equal the preceding audited ending stacks: seats 1–6 **61, 139, 76, 96, 90, 138 CH** (total 600). All target HAND_SETTLED participant starting stacks equal these exact values. Target's original starts were verified against the previous durable settlement, not claimed to be a separately archived pre-Leave private snapshot. No escrow funding occurred between those two hand boundaries.

After Leave, accepted bot actions v147–v156: CALL, CHECK, CHECK, CHECK, CHECK, CHECK, CHECK, BET, CALL, CALL; phases PREFLOP→FLOP→TURN→RIVER→SETTLED. Target HAND_SETTLED v156 at **08:11:50.235893**: **integrity OK**, flags `[]`, payout/contributions **14 CH**, starting/ending total **600 CH**, stack/pot/payout deltas all **0**. The target human contributed 2 CH, received 0, ended at 94 CH. No STARTING_STACK_DERIVED.

### Cashout / ledger / no orphan — PASS

| Event | UTC | User delta | Transaction ID |
|---|---|---:|---|
| Online buy-in | 08:09:02.423332 | -100 | eac1ee7b-a10e-470a-a31e-8c7476f3757e |
| Ordinary deferred cashout | 08:11:55.385020 | +94 | 8545239c-1d43-46d4-aac2-08ca8b742027 |

Wallet **460 − 100 + 94 = 454 CH**; actual losses were prelude 4 + target 2 = 6 CH. Exactly one user cashout remained after retry. Every transaction entry sum is zero. The managed JOIN also funded two new bots, 100 CH each: `c8ee4a7d-60b2-4a47-97a1-02246ddc19d1` and `1c762eab-8b3e-4fad-84c6-e30d3eaccdc5` (BOT_SEED_BUY_IN references, not user wallet debits).

After user cashout: escrow **300 initial bots + 200 new bots + 100 user − 94 refund = 506 CH**, matching all escrow entries and bot state. At **08:19:54.865407**, ordinary lifecycle closed the table and returned bot balances **87+73+107+115+124=506 CH** in five balanced cashouts (IDs in evidence JSON). Final read 08:21:56.522112: CLOSED, escrow=ledger total=state total **0**, human stack absent, active human seats **0**, wallet **454**, user cashout count **1**. No manual Leave/repair/CH adjustment was used for cleanup.

### Reconnect — PASS; same-request Leave retry — FAIL at client deadline

Normal page reload established socket 3, observer snapshot at **08:13:55.881**, current bot-only hand `_182_5`, seat null, no additional JOIN/buy-in. Reconnect passed.

Same Leave requestId sent **08:13:55.909** on the new connection. The unmodified client timed out at **08:14:07.915** (12.006 s; existing COMMAND_TIMEOUT_MS=12000). No accepted/rejected commandResult was observed for that retry, so it is **not PASS**. The bot-only hand remained active through the deadline and settled at **08:14:29.139390**. This is consistent with the known bots-only FIFO occupation in main, not proof that #1151's reload introduced the delay. Exact retry server queue/reload timing is unavailable from existing logs; no separate #1149 diagnosis/fix or late-PASS workaround was attempted.

Read-only accounting subsequently confirmed no second cashout or orphan. That financial check does not substitute for the missing client ACK. The smoke stopped; no second retry or Single Player JOIN followed.

### Privacy — PASS for observed output; timing / Single Player — BLOCKED

All observed payloads were checked for the private map key without saving auth frames or full private snapshots. **51 reduced public/table snapshot events**, zero private-map violations. The durable public Leave result also omits the map. The unobserved retry response cannot be certified separately.

Leave round-trip **3,606 ms** is directly measured. DB transaction-start timestamp to commandResult server timestamp is approximately **500 ms**, but spans SQL work, reload and response handling and uses different clocks; it is **not an isolated reload measurement or a strict bound**. Existing DEBUG recovery spans were not emitted. A read-only probe of installed loader/hydration modules stopped before any query because the unit's EnvironmentFile path was absent and process environment was not readable. No secret/config/logging change or permission bypass was attempted. Isolated reload duration is **BLOCKED/unmeasured**; no performance improvement claim.

Single Player is **BLOCKED / not attempted**, because the retry outcome had become operationally unconfirmed and the authorized stop condition was applied. No SP buy-in or session was created. Real Account Deletion is **NOT RUN, explicitly excluded**; prior 74/74 local fundamental deletion tests remain its authorized evidence at this stage.

[Reduced evidence](preview-smoke-2026-10-25.json) includes original/retained stack maps, audit/actions, transaction IDs, lifecycle close and sanitized browser timing. No passwords, JWTs, hole cards, deck or full private snapshots are included.

**Stop for owner review.** Original audit/cashout behavior passed on exact SHA; the complete requested smoke remains NOT READY due to retry ACK failure, blocked Single Player and missing isolated reload timing. No automatic approval/merge or broader regression-free claim.
