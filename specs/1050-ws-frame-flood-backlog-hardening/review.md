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

## Solution Architecture
1. **Decoupled Global Maintenance from Message Hot Path**:
   - Removed `sweepDisconnectCleanupAndBroadcast()` and `sweepTurnTimeoutsAndBroadcast()` from `processMessage()`.
   - Dedicated timers (`timeoutSweepTimer` and `disconnectCleanupTimer`) remain the sole periodic owners.
2. **Periodic Session Expiry Ownership**:
   - Removed `sweepExpiredSessionsOnly()` from `processMessage()`.
   - Placed periodic execution of `sweepExpiredSessionsOnly()` into `sweepTransportWatchdog()`, which runs every 15s via `transportWatchdogTimer`.
3. **Bounded Per-Socket Message Backlog**:
   - Defined `const MAX_SOCKET_MESSAGE_BACKLOG = 16;`.
   - Tracked `pendingMessages` per connection.
   - If `pendingMessages >= MAX_SOCKET_MESSAGE_BACKLOG`, incoming frames immediately trigger `beginTransportTermination(connState)`, log `ws_message_backlog_overflow`, close the socket with protocol error code `1002`, and refuse to enqueue further work.
   - At the entry of `processMessage()`, verified `if (connState.transportTerminationStarted === true) return;` so that already queued items are dropped without processing once termination has commenced.
   - Decremented `pendingMessages` via `.finally(() => { pendingMessages = Math.max(0, pendingMessages - 1); })`.
4. **Preserved Semantics**:
   - Conforming clients continue to enjoy strictly sequential, ordered frame execution without changes.
   - No external proxy dependencies or Caddy modifications.
   - No changes to authentication flow or finding #3.

## Automated Verification
- Target test suite: `node --test ws-server/poker.protocol.behavior.test.mjs`
  - 8/8 tests passing.
  - Verifies close code 1002 on backlog overflow (>16 in-flight frames).
  - Verifies drop of excess frames.
  - Verifies `ws_message_backlog_overflow` log emission.
  - Verifies normal sequential message order and pong resolution.
  - Verifies architectural decoupling invariant (no maintenance calls in `processMessage`, watchdog owns session expiry).
  - Verifies `sessionStore.sweepExpiredSessions()` purge behavior.
- Repo checks:
  - `npm run test:quick`: Syntax OK (221 files).
  - `npm run check:all`: Lifecycle OK (169 files), Badge OK (53 pages), XP guard OK, transport guard OK.
  - `npm run test:unit`: Games validation OK.

## Preview Verification
- **WS Preview Deploy**: [Run 37328287767](https://github.com/krzysztofcal/arcadePlatform/actions/runs/37328287767) succeeded for exact runtime SHA `205f549736fb37e688bd8fa958cc879add0f6005`.
- **Health check**: `https://ws-preview.kcswh.pl/healthz` returned `ok`.
- **Live WS Smoke**: Executed against `wss://ws-preview.kcswh.pl/ws`:
  - Conforming `ping` returned expected `pong`.
  - Burst frame flood (>16 in-flight frames) was terminated with protocol error close code `1002`, and excess frames were dropped.

## Breaking Impact
Zero breaking impact for conforming clients. Conforming clients send sequential commands or small pipelined requests (well below the limit of 16 concurrent un-acknowledged frames). Malicious or abusive clients attempting to flood frames without waiting for responses are rejected with close code 1002.

