# Tasks

- [x] T001 Verify finding against live main (`processMessage` maintenance sweeps and unbounded `messageQueue`).
- [x] T002 Decouple global maintenance from `processMessage()` in `ws-server/server.mjs`.
- [x] T003 Move `sweepExpiredSessionsOnly()` to periodic `sweepTransportWatchdog()` in `ws-server/server.mjs`.
- [x] T004 Implement bounded inbound message backlog per connection with `MAX_SOCKET_MESSAGE_BACKLOG = 16` and early termination check in `processMessage()`.
- [x] T005 Add fundamental deterministic tests for backlog overflow termination, non-processing of excess frames, and maintenance decoupling.
- [x] T006 Run all targeted tests and repo checks (`npm run check:all`, `npm run test:quick`, WS behavior suites).
- [x] T007 Deploy exact runtime SHA via `WS Preview Deploy` and execute narrow runtime smoke.
- [x] T008 Review whole diff, simplify, and update review evidence.
- [x] T009 Create draft PR linked to #1050 with root cause, fix scope, test evidence, breaking impact, and Preview smoke results.
