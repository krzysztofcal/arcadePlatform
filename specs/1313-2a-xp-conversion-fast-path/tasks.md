# Tasks: #1313 2a, skip no-op anonymous XP conversion
- [x] T001 Read-only analysis on main `5364a459` (research.md R1–R6).
- [ ] T002 Independent Codex review of this plan (architecture, safety, simpler alternatives). Verify the findings.
- [ ] T003 OWNER GO for implementation.
- [ ] T004 [agy] Implement plan §Change in `netlify/functions/_shared/xp-identity.mjs` only.
- [ ] T005 [agy] Fundamental tests (a)–(h) in `tests/xp-redis-v3.behavior.test.mjs`; the existing XP and deletion suites pass unchanged.
- [ ] T006 Coordinator review; Draft PR from main; Codex review (max 3 rounds).
- [ ] T007 Stage measurement per plan §Measurement (baseline and after); OWNER real-device test; report.
- [ ] T008 OWNER merge decision. Production is a separate path.
