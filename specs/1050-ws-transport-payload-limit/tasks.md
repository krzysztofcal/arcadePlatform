# Tasks

- [x] T001 Verify finding against live main (`ws` version and `WebSocketServer` configuration).
- [x] T002 Update `ws` dependency in `ws-server/package.json` to safe `>= 8.21.0` and update `ws-server/package-lock.json`.
- [x] T003 Pass `maxPayload: MAX_FRAME_BYTES` to `WebSocketServer` instantiation in `ws-server/server.mjs`.
- [x] T004 Extend/verify fundamental deterministic tests in `ws-server/poker.protocol.behavior.test.mjs` for transport rejection (1009) on frames > 32 KiB and conforming frames functioning normally.
- [x] T005 Run all required repo checks (`npm run check:all`, `npm run test:quick`, WS behavior tests).
- [x] T006 Perform exact-SHA WS Preview Deploy and narrow runtime smoke test.
- [x] T007 Review whole diff, simplify, and record evidence.
- [x] T008 Create draft PR linked to #1050 with root cause, fix scope, test evidence, breaking impact, and Preview smoke results ([PR #1051](https://github.com/krzysztofcal/arcadePlatform/pull/1051)).
