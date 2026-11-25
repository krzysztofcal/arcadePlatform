# Tasks: conversion once per sign-in (#1313 2a)
- [ ] T000 OWNER GO, explicitly covering the additive server response field.
- [ ] T001 [agy] `calculate-xp.mjs`: additive `anonConversionChecked` (plan §Change, server).
- [ ] T002 [agy] `js/xpClient.js`: `tokenSub`, `anonIdFor`, `noteConversion`, the shared activity counter (`bumpActivity` on anonymous start and settle); wire into `fetchStatus` and `postWindowServerCalc` (plan §Change, client).
- [ ] T003 [agy] Fundamental tests (spec SC-001) in the existing files.
- [ ] T004 Coordinator review; rerun the client and server XP tests; Draft PR; Codex code review (max 3 rounds); CI and CodeQL green.
- [ ] T005 Preview check SC-002 by the OWNER; agent XP-mutating steps only on pinned Stage after a separate OWNER GO.
