# Plan

## Technical context
JavaScript ESM, node:test, ws server runtime (`ws-server/server.mjs`). Base live main `a69bcd0ffbc3d2f25720d4f3271e08adac6adac5`.

## Constitution Check
PASS:
- Fundamental deterministic tests only.
- No UI/CSS/JSP/glue suites.
- Minimal change: remove 3 redundant maintenance calls from `processMessage()`, add `sweepExpiredSessionsOnly()` to `sweepTransportWatchdog()`, add per-socket backlog limit counter in `ws.on("message")`.
- No new framework, no proxy dependencies, no schema or config changes.
- Exact-SHA WS Preview Deploy and runtime smoke required before merge-ready.

## Changes
1. `ws-server/server.mjs`:
   - Define `const MAX_SOCKET_MESSAGE_BACKLOG = 16;`.
   - In `processMessage()`:
     - Check `if (connState.transportTerminationStarted === true) return;`.
     - Remove `sweepExpiredSessionsOnly()`, `void sweepDisconnectCleanupAndBroadcast()`, and `await sweepTurnTimeoutsAndBroadcast()`.
   - In `sweepTransportWatchdog()`:
     - Call `sweepExpiredSessionsOnly();` at the start of periodic watchdog tick.
   - In `wss.on("connection")` / `ws.on("message")`:
     - Maintain `let pendingMessages = 0;`.
     - If `pendingMessages >= MAX_SOCKET_MESSAGE_BACKLOG`:
       - `klogSafe("ws_message_backlog_overflow", ...)`.
       - `beginTransportTermination(connState)`.
       - `try { ws.close(1002); } catch { ws.terminate(); }`.
       - return.
     - Increment `pendingMessages += 1` before chaining onto `messageQueue`.
     - Decrement `pendingMessages = Math.max(0, pendingMessages - 1)` in `.finally()` handler.
2. Tests:
   - Add targeted deterministic tests in `ws-server/server.behavior.test.mjs` or `ws-server/poker.protocol.behavior.test.mjs` proving:
     - Repeated valid unauthenticated `ping` does not invoke maintenance per frame.
     - Enqueueing excess messages beyond backlog bound terminates socket with code 1002 and prevents processing excess frames.
     - Normal `hello` / `ping` and ordered command sequencing work unchanged.
     - Periodic timers continue to drive maintenance sweeps.
3. Verification:
   - Run targeted test suites and repo checks (`npm run check:all`, `npm run test:quick`, etc.).
   - Deploy exact runtime SHA via `WS Preview Deploy` and execute narrow runtime smoke.
   - Whole diff review and draft PR creation linked to #1050.
