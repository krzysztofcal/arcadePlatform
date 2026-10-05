# WS Frame Flood & Backlog Hardening (Issue #1050 Finding 2)

## User story US1 (P1)
As the Arcade Poker platform operator,
I want unauthenticated WebSocket message handling to be decoupled from global maintenance sweeps and bounded by a per-connection message backlog limit,
So that an unauthenticated remote client cannot amplify a frame flood (e.g. valid `ping` frames) into global O(N) maintenance iterations or build an unbounded Promise backlog in memory to exhaust server resources.

## Requirements
- Decouple global maintenance from `processMessage()`: remove `sweepDisconnectCleanupAndBroadcast()` and `sweepTurnTimeoutsAndBroadcast()` from the per-message path; let existing periodic timers remain the sole owners.
- Move session expiry scan outside per-message path: remove `sweepExpiredSessionsOnly()` from `processMessage()`, invoke it periodically via the existing transport watchdog sweep (`sweepTransportWatchdog()`, 15s).
- Decouple maintenance sweeps from `cleanupConnectionOnce()`: remove `sweepExpiredSessionsOnly()` and `sweepDisconnectCleanupAndBroadcast()` so anonymous rapid connect/disconnect bursts cannot force global O(N) sweeps; disconnect cleanup remains owned by its dedicated 500ms timer (`disconnectCleanupTimer`), and session expiry by the 15s watchdog.
- Enforce O(1) lazy session expiry on rebind: in `session-store.mjs::rebindSession()`, check TTL specifically for the requested inactive `sessionId` without triggering an O(N) global sweep; active sessions (`socketBySessionId.has(sessionId)`) remain strictly protected against premature expiry.
- Enforce explicit bounded backlog per connection:
  - Count pending in-flight messages per socket (`pendingMessages`).
  - Cap at `MAX_SOCKET_MESSAGE_BACKLOG = 16`.
  - When incoming message exceeds the bound, immediately terminate connection (`beginTransportTermination(connState)`, `ws.close(1002)`), log `ws_message_backlog_overflow`, and do not enqueue additional work.
  - In `processMessage()`, check `connState.transportTerminationStarted` to skip execution of queued items once terminated.
  - Preserve strict sequential message processing and ordering for conforming clients.
- Add deterministic fundamental tests covering:
  - Frame flood of valid unauthenticated pings no longer triggers per-frame maintenance sweeps.
  - Slower message processing overflowing backlog terminates connection and skips excess frames, using the minimal `WS_TEST_PROCESS_MESSAGE_DELAY_MS` delay seam for 100% deterministic test execution.
  - Inactive sessions past TTL return `unknown_session` on rebind, while active sessions remain valid.
  - Architectural guards verify `cleanupConnectionOnce` has no global maintenance sweeps.
  - Ordinary `hello` / `ping` and ordered stateful messages maintain correct execution and sequencing.
  - Dedicated periodic timers continue to execute periodic sweeps.

## Acceptance Criteria
- No per-frame maintenance runs inside `processMessage()`.
- No maintenance sweeps run on connection cleanup in `cleanupConnectionOnce()`.
- Unauthenticated ping flood does not amplify into global session or table sweeps.
- Rapidly pipelining >16 messages on a single connection closes the socket with code 1002 and aborts further processing.
- Rebind of expired inactive session returns `unknown_session` without O(N) global scan; active sessions are preserved.
- Conforming clients sending ordered commands experience no regressions.
- Existing suites and repo checks pass.
- Exact-SHA WS Preview Deploy and narrow runtime smoke executed.

## Breaking Impact
- Brak wpływu na normalnych conforming Arcade clients (klienci wysyłają sekwencyjne komendy lub małe serie zapytań poniżej limitu 16 oczekujących ramek).
- Intentional breaking behavior dla klienta, który przekracza 16 jednocześnie pending frames / flooduje połączenie — taki socket zostaje natychmiast zamknięty kodem 1002 (Protocol Error), a nadmiarowe ramki są odrzucane.
