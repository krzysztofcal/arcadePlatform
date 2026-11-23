# Tasks: T2 XP status dedup (#1313), plan only
- [x] T201 Measurement without a HAR (OWNER 2026-11-23): Playwright aggregates (anonymous) plus Netlify logs (signed in). See research.md M1.
- [x] T202 Classification: the burst is status reads. Key safety verified; the naive cached-token key is unsafe, so the rule was corrected (research.md M2).
- [ ] T202b Optional: a signed-in Playwright run, which needs an OWNER-provided Stage test account (no OWNER credentials).
- [ ] T203 OWNER GO for FR-001 (or a re-plan).
- [ ] T204 Implementation (agy) with the tests from plan §Tests; Draft PR; Codex review (max 3 rounds).
- [ ] T205 Stage measurement against SC-001/SC-002; OWNER merge decision.
