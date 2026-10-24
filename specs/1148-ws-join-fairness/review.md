# #1148 — WS bot-step queue fairness review

Independent bugfix from main `6ecbc8a36a19952b7e86255436e8be903ea5d646`. No commits or artifacts from Offline PR #1147. Issue: https://github.com/krzysztofcal/arcadePlatform/issues/1148

## Change

`ws-server/poker/runtime/accepted-bot-autoplay-adapter.mjs::createAcceptedBotStepExecutor` now passes both `maxActions: 1` and `botsOnlyHandCompletionHardCap: 1`. The shared loop can no longer expand a single queued WS step into a whole bots-only hand. Remove unused full-hand budget ENV parsing from that WS adapter; reaction configuration remains unchanged.

Existing `createBotAutoplayCascadeScheduler` still defers and queues the next step. The real table FIFO runs pending admission/Leave commands between steps. No server/scheduler rewrite, new dependency, strategy/rules/ledger/protocol change, UI timeout change or migration.

## Fundamental regression / RED → GREEN

Two parameterized cases in the existing accepted-adapter test file use the real FIFO, cascade scheduler, accepted adapter, engine actions and settlement. Initial bootstrap stamps real turn timing; first reaction is paused deterministically, then an admission callback is queued. Cases: initial two-bot Online hand and three-seat hand after a real accepted human FOLD (Single Player condition).

Before the fix both fail with **12 bot actions before admission, expected 1**. After the fix both admit after one action, before settlement. Subsequent actions continue to real settlement. Assertions pin accepted/version-ordered actions, unique requestIds, one reaction and one persistence write per action, no restore/resync, pot zero, payout/contribution equality and 200/300 CH conservation throughout.

The queued callback is deliberately the admission boundary, not a simulated authoritative database JOIN. Full funding/WAITING_NEXT_HAND/projection integration is covered separately by existing tests and remains part of required runtime smoke; do not claim these two tests prove live JOIN end-to-end.

Five existing whole-hand adapter tests now drive the existing cascade, aggregating whole-hand action/broadcast assertions while retaining their delayed-turn-loss and broadcast-failure coverage. No new test framework, UI suite or broad test infrastructure.

## Other shared-loop callers

Repository-wide reference search found:

- Accepted WS adapter: the only changed caller.
- `ws-server/shared/poker-domain/poker-autoplay.mjs`: unchanged neutral re-export.
- `netlify/functions/_shared/poker-autoplay.mjs`: unchanged wrapper with injected legacy reducer/strategy/legality.
- `shared/poker-domain/leave.mjs`: unchanged post-Leave completion call, budgets **8 / 30**; no WS reaction sleeps. Its completion semantics are preserved.
- `shared/poker-domain/poker-autoplay.mjs`: unchanged algorithm, including bots-only completion behavior for the other callers.

Legacy Netlify bot config still retains its own full-hand ENV setting. Only the accepted WS invocation ignores that setting, because its contract is one FIFO step. The regression explicitly supplies an ENV hard cap of 80 and still proves one action per WS step.

## Validation

- Modified accepted adapter suite: **40/40 PASS**.
- Scheduler/queue/handlers/engine/shared legality/table manager/deferred Leave/settlement/side-pots/legacy bot selection targeted run: **310/310 PASS**.
- Additional authoritative JOIN/Leave, live WS server, leave race and reconnect/resync run: **287/287 PASS** (existing CI environment `WS_POKER_LOG_LEVEL=INFO`).
- Root `npm test`: **exit 0, 147 test groups passed**. Five optional PostgreSQL checks skipped because `CHIPS_MIGRATIONS_TEST_DB_URL` or `POKER_RLS_TEST_DB_URL` is unset: Stage cleanup contracts, metadata fence, legacy overload, legacy replay savepoint and RLS reads. No Stage/Production DB was used.
- Syntax and whitespace checks: PASS. Independent reviewer found no blocking issue and independently ran adapter 40/40.
- The first extra live-WS test invocation omitted CI's `WS_POKER_LOG_LEVEL=INFO`. Readiness fixtures wait for the INFO startup message, so reconnect tests timed out. That run and its child processes were stopped; rerun uses the existing workflow environment, with no CI or runtime config edit. Do not mistake that initial setup failure for a passed test run.

## Timing and cost

Normal reaction delays and gameplay policy are unchanged. Without pending commands, the same actions/reactions run, with extra `setImmediate`/FIFO scheduling and adapter re-entry between actions. Hand duration should remain close to the previous aggregate reaction time plus small local scheduling/snapshot overhead; no live performance measurement is claimed.

Under contention, JOIN waits for the current bot reaction/action/persistence rather than every remaining street. The current reaction may still take the normal 2–4 seconds; other queued work and DB latency still apply, so this is not an unconditional wall-clock SLA. Interleaved human commands may extend total hand time while improving admission responsiveness.

Queue entries become one per bot action instead of one per entire bots-only hand. The adapter rebuilds/re-reads in-memory state and snapshots on each entry. The patch adds no SQL operation and the fundamental test verifies one persistence write per action, unchanged in count. Actual DB round-trip timing/load and interleaving conflicts still need bounded Preview verification. No batching of writes is removed: previous loop already persisted each action.

## Risk and later smoke — separate GO required

Risk is runtime interleaving: authoritative JOIN/Leave can now execute during a hand instead of after settlement. Existing handSeats/waiting-state rules must continue excluding a fresh player from the current pot; versioning, replay and resync must remain correct. Folded-human Single Player must continue its bot cascade through settlement. Local tests cover the core contracts; they do not establish deployed integration.

After separate owner GO:

1. Check shared Preview occupancy and that previous Stage seats/stacks are safely settled.
2. Dispatch manual WS Preview Deploy using workflow definition `main` and this bugfix's exact runtime SHA. Verify workflow, installed metadata/process and changed-module hash. A green Netlify/WS PR check is not a deployed WS revision.
3. From this PR's Netlify Preview, one normal Online JOIN during bots-only play: capture requestId, commandResult timing, assigned seat/WAITING_NEXT_HAND before settlement, and unchanged current-hand eligibility. Preserve the 30-second failure boundary; stop on failure.
4. Observe legal bot continuation/settlement and a short player action/reconnect scenario, then normal Leave and ledger-confirmed cashout with no leftover human stack.
5. Single Player: human FOLD, bots continue in order to correct settlement; verify normal Leave/cashout. No manual CH adjustments.

**Implementation ready, awaiting manual runtime verification. Draft only; not merge-ready. No WS Preview or Production deployment, no merge, no Poker Offline T003–T008. STOP for owner review.**
