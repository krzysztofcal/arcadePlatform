# Tasks: T1 profile reads (#1313)
- [x] T001 Extract the T1 code from `1313-profile-me-latency` onto current main (`js/account-page.js`, `js/auth/supabaseClient.js`).
- [x] T002 Fallback identical to main (OWNER R6/F4): the `.catch` checks apply only to the ProfileClient path; the new fallback-failure test passes on main and T1.
- [x] T003 Fundamental tests: the T1 tests from #1317 plus the fallback-failure test. The dedup tests fail on main's code.
- [x] T004 Draft PR #1318 plus independent Codex review: R1 (1 P1 rejected with evidence, 2 P2 fixed), R2: 0 findings. Prior T1 history: #1317 R1–R6.
- [ ] T005 OWNER: Deploy Preview real-device acceptance, then measurement of SC-001; merge decision.
