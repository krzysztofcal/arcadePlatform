# #1150 — review: normal WS Leave must retain private audit state

Priority Medium/P2; before public 1.0. Issue: https://github.com/krzysztofcal/arcadePlatform/issues/1150

## Final change

`ws-server/poker/handlers/leave.mjs::handleLeaveCommand` now calls the existing server `restoreTableFromPersisted(tableId)` after a successful authoritative Leave, including already-left/idempotent results. `ws-server/server.mjs` supplies that existing callback. It reads current table/seats/state through `createPersistedBootstrapRepository`, validates/rehydrates via `adaptPersistedBootstrap`, then applies the existing stale-version fence in the manager. Public response state is no longer installed into private runtime. No manual metadata copying, cross-hand merging or fallback to the public response.

The current callback is already used by inactivity Leave. A replay of an old successful Leave reloads **current persistence**, not the old public response. A failed/thrown reload rejects without publishing success or scheduling a new bot step. Because the financial transaction may already have committed, clients must retry the existing same requestId; the unchanged durable Leave idempotency prevents repeated cashout. Existing restore diagnostics remain classified.

## Fundamental evidence

One new regression in the existing handler test uses the real engine bootstrap, Leave reducer, manager/handler, legal bot action reducer, snapshot builder and settlement audit writer. The SQL/commit boundary is an in-memory fixture, not a real DB or a claimed live cashout. It models the actual split: full committed state versus sanitized public Leave result.

- RED on main: full starting-stack map expected, actual undefined after normal Leave restore.
- GREEN: original u1/b1/b2 starting stacks survive; real bot actions reach SETTLED, pot zero, total 300 CH, audit OK/no flags. Public Leave projection and player/bot/observer snapshots omit handStartStacksByUserId.
- A second small critical guard exercises a failed reload followed by already-left retry with an older public result: current hand/version and its distinct 125 CH map win; no old-hand metadata is copied.
- Existing socket-test overrides now supply their corresponding persisted fixtures for successful external Leave, because success requires a full reload. No test runtime bypass or CI configuration change.

## Cost and privacy

One additional full repository load per successful Leave/replay: one DB transaction with table, seat and state reads, plus the existing schema-capability read (cached within the transaction), i.e. ordinarily four SELECTs. It adds no ledger write or bot decision/action write. Queries are bounded to one table; there is no new SQL or dependency. Normal Leave acknowledgment holds the existing table command ownership for the extra read latency. No measured Preview/Production latency claim; verify on the separately authorized exact-SHA smoke.

The bootstrap reload also resets the existing private-hole-card acknowledgment cache, as any current restore does; the next existing writer may perform its usual idempotent hole-card check. No new public field, private-map logging, client exposure or fabricated audit OK. Existing partial historical records stay untouched. Current bootstrap's consistency/identity validation and version fences remain the recovery boundary; read failure after financial commit remains an operational retry case.

## Validation

- Fundamental handler suite: 9/9 PASS, including RED→GREEN and current-hand retry guard.
- Existing adapter/writer/manager/bootstrap targeted run: 172/172 PASS.
- Existing reconnect/adapter run: 70/70 PASS.
- Existing shared Leave/deferred cashout/manager Leave restore/live Leave race run: 15/15 PASS.
- Existing socket Leave subset: 10/10 PASS. Table socket suite: 11/11 PASS.
- Root `npm test`: exit 0, 148 groups passed. Five optional PostgreSQL groups skipped without CHIPS_MIGRATIONS_TEST_DB_URL / POKER_RLS_TEST_DB_URL; also the existing daily-campaign PostgreSQL subtest and three PostgreSQL 16 CLI subtests skipped. No external DB configured/used.
- Syntax and whitespace checks PASS.
- First full WS server run: 140/141, one failure from removing classified `ws_leave_restore_rejected` diagnostic while replacing restore code. Restored the existing diagnostic on full-reload rejection; focused log-policy test PASS. Final full rerun: **141/141 PASS**, exit 0.
- Initial regression invocation needed existing dependencies linked into the isolated worktree; after resolving that setup error, RED was the expected undefined-map assertion (not an import failure).
- The first socket fixture adaptation also made invalid Leave fixtures into bootstrap fixtures and broke their preliminary JOINs. Restricted adaptation to successful coherent results with stacks; all 10 Leave cases then PASS. No runtime bypass.

The first PR WS harness also found the implicit-tableId Leave socket fixture lacked persisted state. Added its committed-state fixture and updated the initial observer expectation to an available empty table; all 11 table socket cases PASS locally. This follow-up changes tests/docs only; runtime remains commit `8ca505906f586878ce2e7ea9b1519510a3db8901`.

No Stage/Production database access, financial mutation, migration, deploy or merge was performed for this implementation.

## Exact-SHA Preview gate — separate GO required

Implementation is ready for review, **awaiting runtime verification**, not merge-ready. Green PR CI and Netlify only validate/build; they do not deploy WS.

1. Check shared Preview connections, human seats, prior cashouts/escrows and other work.
2. Manual WS Preview Deploy: workflow definition main; application exact latest runtime-affecting SHA. Confirm workflow success, runtime metadata, service restart, changed-module hashes and /healthz.
3. From this PR's Netlify Preview, admit a test human normally, then ordinary Leave during a live Online hand; verify original private starting-stack map in server-only read evidence, continued legal bots, HAND_SETTLED integrity OK and normal deferred cashout. Public Leave responses/snapshots must omit the map. Do not treat the separate #1149 JOIN fairness patch as part of this branch.
4. Reconnect/retry the same Leave requestId as appropriate; verify current state/hand is loaded, no second cashout and no leftover human stack. Single Player: manual FOLD, bot settlement, ordinary Leave/cashout.
5. Stop on mismatch, missing metadata or ambiguous accounting. No manual ledger/history repair.

No #1149/#1147 edits; no Offline T003–T008. Draft only; stop for owner review.
