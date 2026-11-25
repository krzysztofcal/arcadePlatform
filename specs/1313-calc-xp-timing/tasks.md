# Tasks: `calc_xp_timing` (#1313)
- [ ] T001 [agy] `createXpTiming` plus the wrapper and phase measurement in `netlify/functions/calculate-xp.mjs` (plan §Change).
- [ ] T002 [agy] Fundamental tests (plan §Tests).
- [ ] T003 Coordinator review; Draft PR; Codex review (max 3 rounds R1–R3; OWNER 2026-11-25 approved extra rounds R4–R6, then R7–R9); CI and CodeQL green.
- [ ] T004 Stage Playwright measurement with the dedicated test account: ≥ 10 signed-in status reads, ≥ 10 signed-in awards counted only as responses with `granted > 0` (the reported aggregate count of such responses proves the minimum), plus anonymous reads. Aggregates only.
- [ ] T005 Report: per group the request count and phase-sample count, the median and p90 per phase over logged requests, the dominant phase, and a recommendation (2a/V1, region, or stop).
