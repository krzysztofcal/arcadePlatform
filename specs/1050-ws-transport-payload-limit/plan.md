# Plan

## Technical context
JavaScript ESM, node:test, ws server runtime (`ws-server/server.mjs`). Base live main `4f798bdd`.

## Constitution Check
PASS:
- Fundamental deterministic tests only (testing transport rejection at 32 KiB and conforming message handling).
- No UI/CSS/JSP/glue suites.
- Minimal change: upgrade `ws` dependency to safe `>= 8.21.0`, pass `maxPayload: MAX_FRAME_BYTES` to `WebSocketServer`.
- Retain existing application-layer `MAX_FRAME_BYTES` check as defense-in-depth.
- No schema/config/framework/architecture changes.
- Exact-SHA WS Preview Deploy and runtime smoke required before merge-ready.

## Changes
1. Update `ws-server/package.json` to `"ws": "^8.21.0"` (or latest 8.x safe version) and run `npm install --package-lock-only` (or `npm install`) in `ws-server` to update `package-lock.json`.
2. In `ws-server/server.mjs`, update `WebSocketServer` instantiation:
   ```javascript
   const wss = new WebSocketServer({ server, maxPayload: MAX_FRAME_BYTES });
   ```
3. Update/extend `ws-server/poker.protocol.behavior.test.mjs` to deterministically verify that frames exceeding 32 KiB are closed by transport with code 1009 and no command processing occurs, while normal frames (< 32 KiB) continue to function.
4. Run repo checks and test suites (`test:quick`, ws protocol tests, `check:all`).
5. WS Preview Deploy with exact runtime SHA and smoke test.
6. Create draft PR linked to #1050.
