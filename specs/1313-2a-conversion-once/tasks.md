# Tasks: conversion once per sign-in (#1313 2a)
- [ ] T001 [agy] `calculate-xp.mjs`: additive `anonConversionChecked` (plan §Change, server).
- [ ] T002 [agy] `js/xpClient.js`: `tokenSub`, `anonIdFor`, `noteConversion`, anonymous generation; wire into `fetchStatus` and `postWindowServerCalc` (plan §Change, client).
- [ ] T003 [agy] Fundamental tests (spec SC-001) in the existing files.
- [ ] T004 Coordinator review; rerun the client and server XP tests; Draft PR; Codex code review (max 3 rounds); CI and CodeQL green.
- [ ] T005 Preview check SC-002 (OWNER or agent with the dedicated Stage test account).
