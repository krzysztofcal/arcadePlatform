# Tasks: #1071 mobile store readiness audit

Scope: documentation deliverables only. Release gates are future owner decisions in the report; they are not executable implementation tasks authorized by this issue.

## Phase 1 — Setup

- [x] T001 Pin the live repository baseline and issue scope in `docs/issue-1071-mobile-store-readiness-audit.md`.
- [x] T002 Create and validate scope in `specs/1071-mobile-store-readiness/spec.md` against the project constitution.

## Phase 2 — Foundational evidence

- [x] T003 Inspect browser/auth/CSP/WS/lifecycle/layout/assets/privacy paths and record static evidence in `docs/issue-1071-mobile-store-readiness-audit.md`.
- [x] T004 Verify dated primary store/legal/packaging sources and record decision provenance in `specs/1071-mobile-store-readiness/research.md` and the report.

## Phase 3 — US1 route decision

Independent acceptance: four routes compared; recommendation distinguishes free-first Android from near-term cross-platform monetization.

- [x] T005 [US1] Write route comparison, web prerequisites and breaking-impact findings in `docs/issue-1071-mobile-store-readiness-audit.md`.
- [x] T006 [US1] Record concrete paths/functions, constraints and Constitution Check in `specs/1071-mobile-store-readiness/plan.md`.

## Phase 4 — US2 release decision

Independent acceptance: every compliance topic is sourced; free and monetized targets retain separate approvers and evidence.

- [x] T007 [US2] Write compliance matrix, present NO-GO and independently owner-gated F/M checklists in `docs/issue-1071-mobile-store-readiness-audit.md`.
- [x] T008 [US2] Record ownership/deletion/entitlement invariants in `specs/1071-mobile-store-readiness/data-model.md` and `specs/1071-mobile-store-readiness/contracts/release-boundaries.md`.

## Phase 5 — US3 handoff

Independent acceptance: device proposal is bounded; purchase verification/recovery is concrete without implementing billing.

- [x] T009 [US3] Define the BrowserStack/device matrix and purchase reconciliation proposal in `docs/issue-1071-mobile-store-readiness-audit.md`.
- [x] T010 [US3] Write artifact validation and future smoke instructions in `specs/1071-mobile-store-readiness/quickstart.md`.

## Phase 6 — Cross-cutting review and publication

- [x] T011 Validate FR coverage, local links, source/claim consistency and documentation-only scope; record results in `specs/1071-mobile-store-readiness/checklists/requirements.md`.
- [ ] T012 Publish one documentation Draft PR referencing #1071 and `docs/issue-1071-mobile-store-readiness-audit.md`; verify draft/head/diff and disclose pending release gates.

## Dependencies and delivery strategy

T001–T004 precede stories. US1/US2 consume the same fixed evidence; US3 consumes both. T011 follows all stories; T012 follows T011. Within US1, route evaluation and file-path verification can be reviewed independently. Within US2, ratings/deletion and economic/legal sources can be researched independently. Within US3, device proposal and purchase-recovery contract can be reviewed independently. No concurrent edits or further agent delegation are needed for publication.

MVP audit value is US1; final delivery includes US1–US3. This plan ends with a reviewable Draft PR. Future packaging, legal, free-launch and monetization work must receive its own scope and authorization; do not reinterpret unchecked release gates as permission to implement them.
