# Tasks: T1 profile reads (#1313)
- [x] T001 Extract the T1 code from `1313-profile-me-latency` onto current main (`js/account-page.js`, `js/auth/supabaseClient.js`).
- [x] T002 Fallback identical to main (OWNER R6/F4): the `.catch` checks apply only to the ProfileClient path; the new fallback-failure test passes on main and T1.
- [x] T003 Fundamental tests: the T1 tests from #1317 plus the fallback-failure test. The dedup tests fail on main's code.
- [ ] T004 Draft PR plus independent Codex review per AGENTS.md (prior T1 review history: #1317 R1–R6).
- [ ] T005 OWNER: Deploy Preview real-device acceptance, then measurement of SC-001; merge decision.
