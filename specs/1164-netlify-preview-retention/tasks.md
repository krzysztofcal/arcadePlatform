# Netlify Preview retention — tasks

## Current preparation (no destructive authorization)

- [x] T001 Search existing GitHub issues; create OWNER-approved issue #1164, linked to #1159.
- [x] T002 Reuse full existing Netlify snapshot; retrieve only required368 PR states/closure dates.
- [x] T003 Write small spec/plan with7-day rules, pins, alias-fallback and irreversible DELETE semantics.
- [x] T004 Prepare offline-only planner and temporary protection manifest for rotations/APK/Stage/#1159 evidence.
- [x] T005 Produce full candidate ID/reason/exception dry-run and estimates; explicitly no live-lock acceptance.
- [x] T006 Fifteen fundamental tests and syntax/diff/self-review; no broad UI/CI or environment work.

## Later — separate GO required

- [ ] T007 OWNER accepts Production and Stage rotation results and reviews/narrows execution pins; this gates canary only, not implementation. Issue/publication preparation is already authorized.
- [x] T008 Implement thin trusted-main API adapter and manual-only/default-dry-run workflow using existing planner;15 fundamental policy/adapter tests, no new framework or schedule.
- [ ] T009 Review credential permissions, obtain separate GO for GitHub secret placement (if needed), preserve all Netlify/Production settings.
- [ ] T010 Fresh read-only plan against provider locks/aliases/dependencies, exact-ID manual canary GO and verification. No execution from the current snapshot.
- [ ] T011 After canary PASS and separate OWNER approval, enable once-daily bounded cleanup and audit artifacts. First activation is not authorized by this task list.

Production/WS/DB/Terms/merge/APK/secrets remain untouched. A manual-only gated canary implementation exists; it has not been dispatched. No scheduled workflow, live DELETE, secret setup or activation.

- [ ] T012 Standard hosted CI/Netlify Preview for the Draft implementation PR; no live retention dispatch.
