# Audit validation and future smoke — #1071

## Review this documentation

1. Open [spec.md](spec.md), [plan.md](plan.md) and [audit report](../../docs/issue-1071-mobile-store-readiness-audit.md).
2. Match FR-001–FR-009 to the [requirements checklist](checklists/requirements.md). Inspect listed code paths at the pinned revision; distinguish static findings from runtime evidence.
3. Follow policy links; verify date and claim, especially social vs real-money gambling, regional ratings, CH title restriction and deletion.
4. Review [purchase boundaries](contracts/release-boundaries.md) and [conceptual model](data-model.md) together. Confirm no implementation/persistence contract is implied.
5. Validate all local Markdown links and required SpecKit files. Run `.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks` with `SPECIFY_FEATURE_DIRECTORY` set to this feature. No application tests are needed for a documentation-only diff.
6. Verify the PR changes only this feature's Markdown and the audit report. Keep it Draft. Check remote PR state/head and report actual CI state separately.

## Future targeted device acceptance

After separate implementation authorization, follow the [three-session matrix](../../docs/issue-1071-mobile-store-readiness-audit.md) and [BrowserStack guide](../../docs/browserstack-real-device-testing.md). Prerequisites: approved Stage test accounts, known frontend/WS revisions, available real devices/quota, and a signed package for package acceptance. If WS/protocol changes, complete its exact-revision Preview deployment before end-to-end smoke.

Record device/OS/browser/package/revision/environment, expected vs observed recovery, layout, auth reset return, CH/seat outcomes, accessibility and cold-load metrics. Browser emulation, Safari and Chrome runs cannot certify WKWebView/TWA billing. Close sessions and keep sensitive artifacts outside the repo. Paid sandbox cases belong to a separately approved billing task.

## Evidence for this handoff

- Static audit completed against `33d0ceceb6f77503e9dd6d4630a09a02f92a23c1`; primary policies checked 2026-10-09.
- SpecKit scope, source/claim review and local-link checks are the documentation acceptance evidence.
- Device sessions, store registration/questionnaires/submission, live purchases and environment mutations: not performed.
- F1–F7 and M1–M5 remain pending in the report. These pending release decisions do not leave the requested audit implementation unfinished.
