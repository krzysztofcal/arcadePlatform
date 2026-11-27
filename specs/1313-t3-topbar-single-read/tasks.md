# Tasks: one top-bar profile read per page (#1313 T3)

- [ ] T001 `js/chips/client.js`: `fetchTopbarSnapshot()`, the shared balance publish/emit helper, and the deduplicated raw poker fallback (FR-001).
- [ ] T002 `js/topbar.js::refreshChipBadge`: single snapshot path with every existing guard (FR-002).
- [ ] T003 `js/auth/supabaseClient.js::refreshProfile`: includePoker when `ChipsClient` exists, fallback to `getMe()`, strip `balance`/`poker` before publish/render, shared raw read (FR-003).
- [ ] T004 Extend `tests/chips-client-cache.behavior.test.mjs` and one existing `supabaseClient.js` test file (plan → Files).
- [ ] T005 Run the listed test files one at a time; report results and any pre-existing failures without editing their assertions.
- [ ] T006 Coordinator: Deploy Preview request counts and badge values (SC-001–SC-003), Codex review, Draft PR.
