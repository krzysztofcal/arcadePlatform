# Tasks (dependency order)

- [x] T001 Live main/rules and isolated branch; spec/plan/tasks Constitution Check.
- [x] T002 Existing adapter + SETTLED runtime regressions; red before fix.
- [x] T003 Preserve authoritative access in normalizeSuccess only; green.
- [x] T004 Focused/required checks, full self-review and Draft PR.
- [x] T005 Exact latest runtime SHA WS Preview deploy, SHA equality and health.
- [x] T006 One authenticated Stage fresh SETTLED JOIN smoke and handoff evidence.

## Verification before Draft PR

Both extended assertions failed before the one-line fix (missing adapter access / missing join_refresh frame), then adapter + real-socket JOIN passed 25/25. Existing handler + access propagation passed 44/44. Syntax, check:all, ci:guards, CSP and diff whitespace passed. Real-socket tests use WS_POKER_LOG_LEVEL=DEBUG because their existing listening harness consumes the startup log; no logging/config changes are committed. File-store harness does not activate the DB-only settled access gate; it proves the existing handler cache branch via join_refresh and legal automatic PREFLOP, not the Stage-only gate. Authenticated Stage smoke remains required.

Self-review: only production change is optional preservation of trusted access after existing validation; absent access remains absent. No scheduler/retry/refresh/manager/funding/WS protocol changes. Public breaking impact: none.

## Exact-SHA Preview and authenticated Stage evidence (2026-10-06 UTC)

- Draft PR #1057 to main; issue #1056. WS Preview Deploy run 37391775054 succeeded: https://github.com/krzysztofcal/arcadePlatform/actions/runs/37391775054.
- Runtime SHA d150962f3d9ec4096d5dd8b990b6f32bed4c2f62. Remote release metadata releaseSha == deployRef == this SHA; environment preview. Public https://ws-preview.kcswh.pl/healthz and local 127.0.0.1:3001/healthz returned ok.
- Real Deploy Preview https://deploy-preview-1057--playkcswh.netlify.app -> ws-preview.kcswh.pl -> Stage krydukthwdvccggbyjfw. Confirmed isolated fixture human e8292fa5-5cfb-4e8b-83b3-cc04c1a6de01 received normal welcome bonus through the existing endpoint. No SQL mutation.
- Bot-only table 8bdfac3f-8a4a-44cb-a131-237bf267b85c: subscription observed SETTLED v137 / hand ws_hand_8bdfac3f-8a4a-44cb-a131-237bf267b85c_126_3 at 00:03:33.563Z; exactly one fresh table_join sent at 00:03:33.564Z, request ef203d2e-e5bb-4bd5-9f90-b6f1855e230b.
- Fresh poker_access reason join_refresh at 00:03:35.263Z: NORMAL/AUTO/NORMAL, revision 1, policyRevision 5, threshold 2000, hysteresis 500, recovery 1900. Existing handler caches access before emitting this frame.
- Accepted JOIN at 00:03:35.329Z; seat 4 WAITING_NEXT_HAND published in SETTLED v138 at 00:03:35.333Z. Automatic new PREFLOP v139 / hand ws_hand_8bdfac3f-8a4a-44cb-a131-237bf267b85c_139_6 at 00:03:35.621Z: fixture seat 4 ACTIVE. 2058ms from JOIN send, 358ms from fresh access frame; no additional command, refresh, reconnect or resync between JOIN and PREFLOP.
- Access-cache known is directly asserted with the real manager in the existing adapter regression; Stage cache is not exposed as a debug endpoint. Stage evidence is fresh join_refresh plus successful existing DB-gated automatic rollover, not a claimed cache log. Default DEBUG rollover logs were suppressed; no additional logging was introduced.
- Normal leave accepted at 00:03:39.542Z. Read-only Stage inspection confirmed leftTableByUserId=true while finishing the hand, then no fixture poker_seats row after the next boundary.
- PR CI core, ws-harness, ws-persistence-integration, CodeQL and infrastructure validation passed. No Production operation or merge. Draft remains for owner review.
- Final review: only runtime delta is the optional access property; regression also proves missing access remains absent and supplied schema-backed access makes the existing cache known. Tests/docs-only evidence commits after runtime SHA do not alter deployable code and reuse this verified deployment.
