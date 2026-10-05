# Review

Base: live main `4f798bdd56dba0e11b34e8982895650920ec6944`.
Confirmed:
1. `ws-server/package-lock.json` pinned `ws@8.19.0`, vulnerable to GHSA-96hv-2xvq-fx4p (memory-exhaustion DoS from tiny fragments/chunks).
2. `ws-server/server.mjs` initialized `WebSocketServer` with no `maxPayload`, exposing the server to the 100 MiB default transport limit before application-level 32 KiB checks.

## Audit & Changes
- `ws-server/package.json` upgraded `ws` dependency to `^8.21.0`; lockfile updated cleanly to `ws@8.22.0`.
- `ws-server/server.mjs`: `new WebSocketServer({ server, maxPayload: MAX_FRAME_BYTES })` passed `MAX_FRAME_BYTES` (32 * 1024) to the transport layer.
- Existing application-level `MAX_FRAME_BYTES` check preserved inside `processMessage()` as defense-in-depth and controlled error signaling.
- Fundamental deterministic test in `ws-server/poker.protocol.behavior.test.mjs` verifies transport boundary rejection: oversized frames (>32 KiB) are closed with code 1009 without command processing, while conforming frames (<32 KiB) succeed normally.
- Whole-diff audit: no extra abstractions, no framework additions, no UI/CSS changes, no unrelated P1 #2 / P1 #3 modifications.

## Breaking impact
Intentional transport-level hardening: frames larger than 32 KiB are now rejected by the transport layer during receive (socket closed with code 1009) rather than after buffering and emitting to the application layer. The Arcade protocol already declared 32 KiB as the maximum allowable frame size, so all conforming clients are unaffected.

## Tests & Checks
- `npm run test:quick` passed (221 files).
- `npm run check:all` passed.
- `npm run test:unit` passed.
- `node --test ws-server/poker.protocol.behavior.test.mjs` passed (6/6 tests).
- `node --test ws-server/poker.hello-ping.behavior.test.mjs ws-server/poker.unknown-type.behavior.test.mjs` passed (2/2 tests).

### Test Quality & Deterministic Proof
The protocol test in `ws-server/poker.protocol.behavior.test.mjs` explicitly proves that oversized frames are terminated by transport before `processMessage()`:
1. Oversized text frame (> 32 KiB) is closed with `1009` with bounded wait, receiving no application error frame (`maybeTextFrame === null`).
2. An oversized binary frame (> 32 KiB) is proven not to receive an application envelope response (`maybeBinaryFrame === null`), and closes with bounded `1009`. If `processMessage()` were reached, `isBinary` at line 4750 would have returned `INVALID_ENVELOPE` without closing with `1009`.
3. Bounded timeouts on `close` promises guarantee fast failure instead of hanging test execution in case of regression.
4. Normal conforming frames (< 32 KiB) continue to function and respond with `pong`.

## Runtime Verification
- [WS Preview Deploy run 37317500889](https://github.com/krzysztofcal/arcadePlatform/actions/runs/37317500889) succeeded for exact runtime SHA `8633d75a22fc6f562af39cd0aee39838d11a18f1`.
- Release metadata verified: `releaseSha=8633d75a22fc6f562af39cd0aee39838d11a18f1`, `deployRef=8633d75a22fc6f562af39cd0aee39838d11a18f1`, `environment=preview`.
- Local healthz (`http://127.0.0.1:3001/healthz`) and public healthz (`https://ws-preview.kcswh.pl/healthz`) returned `ok`.
- Live WebSocket smoke against `wss://ws-preview.kcswh.pl/ws`:
  - Conforming frame (`ping` / `clientTime="smoke-test"`) succeeded with expected `pong` (`preview-smoke-ping`).
  - Oversized frame (> 32 KiB) was rejected at the transport boundary with WebSocket close code `1009`.
- Diff since `8633d75a` contains only test/spec/docs changes; runtime/deployable artifacts and server configuration are unchanged, so previous exact-SHA Preview verification remains valid per `agents.md`.

