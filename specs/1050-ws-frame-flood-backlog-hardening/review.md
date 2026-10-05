# Code Review & Verification Evidence: Finding P1 #2 (Issue #1050)

## Problem Summary
Finding P1 #2 from GitHub issue #1050:
*"Unauthenticated WS frame flood amplifies into global O(N) sweeps and an unbounded per-socket Promise queue."*

### Root Cause
1. In `ws-server/server.mjs`, `processMessage()` previously executed global maintenance sweeps before authentication and envelope validation:
   - `sweepExpiredSessionsOnly()` (scans all registered sessions)
   - `sweepDisconnectCleanupAndBroadcast()`
   - `await sweepTurnTimeoutsAndBroadcast()`
2. Dedicated periodic timers already exist for turn timeouts (250ms) and disconnect cleanups (500ms). Executing them on every incoming frame allowed an unauthenticated client flooding pings to force the server into continuous O(N) global table and session scanning.
3. In `ws.on("message")`, incoming frames were chained to `messageQueue = messageQueue.then(...)` without any bound on in-flight or queued messages. A fast sender could queue unbounded Promises in memory faster than the server could process them.
4. In `cleanupConnectionOnce()`, `sweepExpiredSessionsOnly()` and `sweepDisconnectCleanupAndBroadcast()` were also run on every socket close, allowing an unauthenticated client rapidly connecting/disconnecting to trigger O(N) sweeps.
5. Moving session expiry strictly to the periodic 15s watchdog caused an edge case where an expired session could be resumed before the next tick if TTL was short.

## Solution Architecture
1. **Decoupled Global Maintenance from Message & Disconnect Hot Paths**:
   - Removed `sweepDisconnectCleanupAndBroadcast()` and `sweepTurnTimeoutsAndBroadcast()` from `processMessage()`.
   - Removed `sweepExpiredSessionsOnly()` and `sweepDisconnectCleanupAndBroadcast()` from `cleanupConnectionOnce()`.
   - Dedicated timers (`timeoutSweepTimer` and `disconnectCleanupTimer`) remain the sole periodic owners.
2. **Periodic Session Expiry & O(1) Lazy Expiry Check**:
   - Removed `sweepExpiredSessionsOnly()` from per-message and per-disconnect hot paths.
   - Placed periodic execution of `sweepExpiredSessionsOnly()` into `sweepTransportWatchdog()`, which runs every 15s via `transportWatchdogTimer`.
   - In `session-store.mjs::rebindSession()`, added an O(1) lazy expiry check for inactive sessions: if the session has no active socket and its age exceeds `sessionTtlMs`, it is deleted from `sessionById` and rejected with `unknown_session`. Active sessions remain strictly protected.
3. **Bounded Per-Socket Message Backlog**:
   - Defined `const MAX_SOCKET_MESSAGE_BACKLOG = 16;`.
   - Tracked `pendingMessages` per connection around `messageQueue`.
   - If `pendingMessages >= MAX_SOCKET_MESSAGE_BACKLOG`, incoming frames immediately trigger `beginTransportTermination(connState)`, log `ws_message_backlog_overflow`, close the socket with protocol error code `1002`, and refuse to enqueue further work.
   - At the entry of `processMessage()`, verified `if (connState.transportTerminationStarted === true) return;` so that already queued items are dropped without processing once termination has commenced.
   - Decremented `pendingMessages` via `.finally(() => { pendingMessages = Math.max(0, pendingMessages - 1); })`.
   - Added minimal test delay seam `process.env.WS_TEST_PROCESS_MESSAGE_DELAY_MS` to enable 100% deterministic testing of backlog overflow without timing race conditions.
4. **Preserved Semantics**:
   - Conforming clients continue to enjoy strictly sequential, ordered frame execution without changes.
   - Reconnect/resync preserves exact session TTL expiry behavior.
   - No external proxy dependencies or Caddy modifications.
   - No changes to authentication flow or finding #3.

## Automated Verification
- Target test suites:
  - `node --test ws-server/poker/runtime/session-store.behavior.test.mjs` (6/6 pass, verifying O(1) lazy expiry of inactive sessions and protection of active sessions).
  - `node --test ws-server/poker.protocol.behavior.test.mjs` (8/8 pass, verifying deterministic backlog overflow with code 1002, drop of excess frames, sequential FIFO ordering, and architectural decoupling guards).
  - `WS_POKER_LOG_LEVEL=INFO node --test ws-server/poker/reconnect/resync.behavior.test.mjs` (20/20 pass, verifying `resume after session expiry returns explicit unknown_session resync`).
  - `node --test ws-server/poker.hello-ping.behavior.test.mjs ws-server/poker.unknown-type.behavior.test.mjs` (2/2 pass).
  - `node --test ws-tests/ws-ws-dependency.guard.test.mjs ws-tests/ws-poker-protocol-compliance.test.mjs` (46/46 pass).
- Repo checks:
  - `npm run test:quick`: Syntax OK (221 files).
  - `npm run check:all`: Lifecycle OK (169 files), Badge OK (53 pages), XP guard OK, transport guard OK.
  - `npm run test:unit`: Games validation OK.

## Breaking Impact
Zero breaking impact for conforming clients. Conforming clients send sequential commands or small pipelined requests (well below the limit of 16 concurrent un-acknowledged frames). Malicious or abusive clients attempting to flood frames without waiting for responses are rejected with close code 1002.
