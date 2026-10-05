# Plan

## Technical context
JavaScript ESM, node:test, ws server runtime (`ws-server/server.mjs`, `ws-server/poker/runtime/session-store.mjs`). Base live main `a69bcd0ffbc3d2f25720d4f3271e08adac6adac5`.

## Constitution Check
PASS:
- Fundamental deterministic tests only.
- No UI/CSS/JSP/glue suites.
- Minimal change:
  - Remove redundant maintenance calls from `processMessage()` and `cleanupConnectionOnce()`.
  - Move periodic global session scan `sweepExpiredSessionsOnly()` to `sweepTransportWatchdog()` (15s timer).
  - Add O(1) lazy TTL check in `rebindSession()` for inactive sessions, preserving active sessions.
  - Keep disconnect cleanup owned by its dedicated 500ms timer (`disconnectCleanupTimer`).
  - Add per-socket backlog limit counter in `ws.on("message")` capped at `MAX_SOCKET_MESSAGE_BACKLOG = 16`.
  - Add minimal test delay seam `process.env.WS_TEST_PROCESS_MESSAGE_DELAY_MS` for deterministic test verification.
- No new framework, no proxy dependencies, no schema or config changes.
- Exact-SHA WS Preview Deploy and runtime smoke required before merge-ready.

## Changes
1. `ws-server/server.mjs`:
   - Define `const MAX_SOCKET_MESSAGE_BACKLOG = 16;`.
   - In `processMessage()`:
     - Check `if (connState.transportTerminationStarted === true) return;`.
     - Remove `sweepExpiredSessionsOnly()`, `void sweepDisconnectCleanupAndBroadcast()`, and `await sweepTurnTimeoutsAndBroadcast()`.
     - Support optional test processing delay `WS_TEST_PROCESS_MESSAGE_DELAY_MS` for deterministic testing.
   - In `sweepTransportWatchdog()`:
     - Call `sweepExpiredSessionsOnly();` at the start of periodic watchdog tick (every 15s).
   - In `cleanupConnectionOnce()`:
     - Remove `sweepExpiredSessionsOnly()` and `void sweepDisconnectCleanupAndBroadcast()`. Disconnect cleanup is handled by `disconnectCleanupTimer` (500ms) or explicit queueing without global scan.
   - In `wss.on("connection")` / `ws.on("message")`:
     - Maintain `let pendingMessages = 0;`.
     - If `pendingMessages >= MAX_SOCKET_MESSAGE_BACKLOG`:
       - `klogSafe("ws_message_backlog_overflow", ...)`.
       - `beginTransportTermination(connState)`.
       - `try { ws.close(1002); } catch { ws.terminate(); }`.
       - return.
     - Increment `pendingMessages += 1` before chaining onto `messageQueue`.
     - Decrement `pendingMessages = Math.max(0, pendingMessages - 1)` in `.finally()` handler.

2. `ws-server/poker/runtime/session-store.mjs`:
   - In `rebindSession({ sessionId, userId, ws, nowMs = Date.now() })`:
     - Check if entry exists and is inactive (`!this.socketBySessionId.has(sessionId)`).
     - If `nowMs - entry.lastSeenAt >= this.sessionTtlMs`, delete entry and return `{ ok: false, reason: "unknown_session" }`.
     - Active sessions remain strictly protected from lazy expiry.

3. Tests:
   - In `ws-server/poker/runtime/session-store.behavior.test.mjs`:
     - Unit test O(1) lazy expiry of inactive sessions past TTL and protection of active sessions.
   - In `ws-server/poker.protocol.behavior.test.mjs`:
     - Test backlog overflow with `WS_TEST_PROCESS_MESSAGE_DELAY_MS: "50"`, proving deterministic closure with code 1002 and dropping of excess frames.
     - Test sequential FIFO ordering for conforming frames.
     - Add architectural guard verifying `cleanupConnectionOnce` and `processMessage` do not run maintenance sweeps.
   - In `ws-server/poker/reconnect/resync.behavior.test.mjs`:
     - Ensure existing `resume after session expiry returns explicit unknown_session resync` passes.

4. Verification:
   - Run targeted test suites and repo checks (`npm run check:all`, `npm run test:quick`, etc.).
   - Deploy exact runtime SHA via `WS Preview Deploy` and execute narrow runtime smoke.
   - Whole diff review and draft PR creation linked to #1050.

## Breaking Impact
- Brak wpływu na normalnych conforming Arcade clients (klienci wysyłają sekwencyjne komendy lub małe serie zapytań poniżej limitu 16 oczekujących ramek).
- Intentional breaking behavior dla klienta, który przekracza 16 jednocześnie pending frames / flooduje połączenie — taki socket zostaje natychmiast zamknięty kodem 1002 (Protocol Error), a nadmiarowe ramki są odrzucane.
