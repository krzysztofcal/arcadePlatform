# Tasks — #1066

## Setup and design
- [x] T001 Record issue-linked scope and Constitution Check in specs/1066-terminal-sitout/spec.md and plan.md

## US1 — safe terminal cash-out
- [x] T002 [US1] Extend existing shared/poker-domain/inactive-cleanup.behavior.test.mjs harness and add one fundamental incident regression; verify RED
- [x] T003 [US1] Narrow absent-human mapping exception in shared/poker-domain/terminal-close.mjs; verify GREEN

## Validation and handoff
- [x] T004 Run existing fundamental suites/checks and record accounting safety review in specs/1066-terminal-sitout/review.md
- [x] T005 Open Draft PR, verify CI and exact WS Preview Deploy; record handoff in specs/1066-terminal-sitout/review.md; no Production writes/merge

Dependencies: sequential T001→T002→T003→T004→T005. One story, no parallel implementation needed. No external contract changes.
