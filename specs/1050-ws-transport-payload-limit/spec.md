# WS transport payload limit & dependency upgrade (Issue #1050 Finding 1)

## User story US1 (P1)
As the Arcade Poker platform operator,
I want the WebSocket runtime to enforce the 32 KiB payload limit at the transport layer and use a patched `ws` library release,
So that unauthenticated remote clients cannot trigger memory-exhaustion DoS (GHSA-96hv-2xvq-fx4p) or force buffering of frames up to the 100 MiB default before application-layer validation.

## Requirements
- `ws-server/package.json` and `ws-server/package-lock.json` upgrade `ws` from vulnerable `8.19.0` to safe `ws >= 8.21.0` within the 8.x major version line.
- `ws-server/server.mjs` initializes `WebSocketServer` with `maxPayload: MAX_FRAME_BYTES` where `MAX_FRAME_BYTES = 32 * 1024` from `ws-server/poker/protocol/constants.mjs`.
- The existing application-level `MAX_FRAME_BYTES` check in `processMessage()` is preserved as defense-in-depth and controlled protocol error handling.
- No new framework, proxy workaround, or additional abstractions introduced.
- Deterministic fundamental test proves an oversized payload (>32 KiB) is rejected at the transport boundary (WebSocket connection closed with code 1009 without command processing) while conforming frames (<32 KiB) continue to function.
- Do not address Finding #2 or Finding #3 from #1050 in this scope.

## Acceptance Criteria
- `ws` version in `ws-server/package-lock.json` is `>= 8.21.0`.
- Connecting client sending a frame > 32 KiB is immediately closed with code 1009 at the transport level.
- Normal protocol operations (`hello`, `ping`, authenticated commands) succeed unaffected.
- Existing suites and repo checks pass.
- Exact-SHA WS Preview Deploy and narrow runtime smoke executed if permissions/mechanisms permit.
