# Plan

## Constitution Check

PASS: only two existing fundamental adapter/runtime harness regressions; no UI/CSS/JSP tests. Existing architecture/helpers only. No generic ignore/config/dependency cleanup, new runtime logging or DB migrations. No Production work. Exact-SHA Preview gate mandatory. No owner approval needed for authorized Stage smoke; keep PR draft for review.

1. Extend existing forwarding test in ws-server/poker/persistence/authoritative-join-adapter.behavior.test.mjs to preserve a fresh schema-backed access object.
2. Extend existing SETTLED JOIN case in ws-tests/ws-join-runtime.behavior.test.mjs through its current real socket/file persistence harness: assert join_refresh access frame and known access outcome/new PREFLOP before periodic refresh can release it.
3. ws-server/poker/persistence/authoritative-join-adapter.mjs::normalizeSuccess preserves optional trusted result.access. handleJoinCommand already caches/sends it; no other runtime edits.
4. Focused existing tests, syntax/check:all/ci:guards/CSP, diff self-review, Draft PR.
5. Exact-SHA WS Preview deploy then one real authenticated Stage smoke. Reuse existing per-table logging only if needed to observe known outcome. Record limitations separately from proof.

If existing path needs a broader runtime change, stop scope growth and document the finding.
