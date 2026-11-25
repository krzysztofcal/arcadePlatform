# Tasks: conversion once per sign-in (#1313 2a)
- [x] T000 OWNER GO 2026-11-25 ("implement per plan"): covers the additive server response field and accepts the cross-tab storage-failure limit (spec FR-005).
- [x] T001 [agy] `calculate-xp.mjs`: additive `anonConversionChecked` (plan §Change, server).
- [x] T002 [agy] `js/xpClient.js`: `tokenSub`, `anonIdFor`, `noteConversion`, the shared activity token (`bumpActivity` writes a new random value on anonymous start and settle); wire into `fetchStatus` and `postWindowServerCalc` (plan §Change, client).
- [x] T003 [agy] Fundamental tests (spec SC-001): client cases in `tests/xp-client-contract.test.mjs`. Server field verified on the PR Preview (OWNER-agreed; the in-process harness cannot reach the signed-in conversion path).
- [ ] T004 Coordinator review (done); Claude code review (done; fixes in progress); rerun the client and server XP tests; Draft PR; Codex code review (max 3 rounds); CI and CodeQL green.
- [ ] T005 Preview check SC-002 by the OWNER; agent XP-mutating steps only on pinned Stage after a separate OWNER GO.
