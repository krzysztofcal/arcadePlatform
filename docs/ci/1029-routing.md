# Issue #1029: CI ownership and verification

Baseline: live `main` after #1035, `2e98a71d43d906432bb0061956449817a2a16a8d`.
Spec/plan/tasks source: GitHub issue #1029 (T001–T009), verified 2026-10-04.

## Workflow changes

| Workflow | Change |
| --- | --- |
| CI | Universal PR `actionlint` context unchanged. Structural guards only for web/games. Chromium and games catalog unit alias removed. Existing main feature/secrets chips integration additionally requires chips impact. |
| Tests | Separate core (`npm test` once, no PG), chips/DB (disposable PG), WS persistence (disposable PG), Chromium (`npm run test:e2e` once). No browser invocation through the core runner. Reset CLI PG contracts retain their own disposable database coverage in chips. |
| Validate games catalog | Node semantic validator + Python schema validator each once, scoped to games impact, also on main push. |
| WS PR Checks | WS impact only; 54 commands. No infra or duplicate Production deploy guards. Explicit browser/WS contracts retained. |
| WS Deploy | Removed. No backup. All 74 baseline contracts retained by WS Server Deploy/Infra ownership. |
| **WS Server Deploy — Production path** | **Main/manual validate runs 67 unique commands + existing Docker build before `deploy` through `needs: [impact, validate]`. PR runs 14 deploy guards only; runtime harness belongs to WS PR. Deploy eligibility preserves the previous runtime/helper/workflow surface. Test-only/unknown diffs never authorize mutation. Main push and explicit manual dispatch retain existing deployment semantics. Merge requires a separate owner decision.** |
| Infra VPS | Owns 8 infra/maintenance commands once. Impact-gated validation on PR/main; existing Caddyfile-only push mutation and manual apply retained, now behind validation. Guard-only/unknown changes do not reload Production. |

Classifier: six coarse domains. PR uses base→head, push uses before→SHA.
Empty/missing/unknown/shared/package/CI changes select broad coverage. Explicit
manual workflows select full validation; no operational workflow was converted
into automatic execution. No dependency graph/reusable-workflow framework.

## Executions (commands/test files, not individual `node:test` subtests)

| Surface/event | Before | After |
| --- | ---: | ---: |
| WS runtime PR: WS harness + deploy guard commands | 76 + 16 = 92 | 54 + 14 = 68 |
| WS runtime main: pre-deploy WS commands | 74 + 16 = 90 | 67, each once |
| Infra-only PR: WS + infra commands | 76 + 2 = 78 | 8 infra; 0 full WS |
| Generic web change: Chromium suites | 2 | 1 |
| Generic core runner invocation when web affected | 1, coupled to Playwright | 1, independent of browser job |
| Unconditional core runner commands | 144 + games validator | 142; games and two maintenance commands have their owners |
| Docs-only PG services | 2 | 0 |
| Web-only PG services | 2 | 0 |
| Catalog-only Chromium / PG / full WS | 2 / 2 / 0 | 0 / 0 / 0 |

Removed duplicates: all 16 old main WS Server Deploy commands overlapped WS
Deploy; 14 PR deploy commands overlapped WS PR, plus 2 misplaced maintenance
commands. Seven main/eight PR infra checks no longer run for WS-only changes.
Catalog validation formerly ran Node three times (CI alias, Tests step, core
runner) plus Python; now Node once + Python once for relevant input. Chromium
formerly ran in both CI and Tests. Maintenance is no longer repeated by core.
All old main WS commands remain covered (set difference is empty); Infra adds
its existing PR-only Caddy contract to main validation.

Generic CI does not redesign the coarse core runner: some core contracts also
exercise WS components. This change removes duplicated WS workflow owners and
browser-driven core reruns, not every cross-domain assertion in the repository.

Workflow *starts* are distinct from expensive suite executions. CI, Tests,
Validate games, WS PR, WS Server Deploy and Infra now each start a small impact
job on PRs (6 vs 3 for a docs-only PR); irrelevant heavy jobs are skipped. On
main the analogous starts are 5, with WS PR absent and WS Deploy retired. DB
workflows retain independent path-scoped validation before Stage mutation.
No runner-minute savings are claimed without post-merge observations.

## T009 representative routing

| Change | Core | Chromium | Chips PG | WS PG | Full WS PR / main | Games | Infra |
| --- | --- | --- | --- | --- | --- | --- | --- |
| docs/README | off | off | off | off | off | off | off |
| migration / chips test | off | off | on | on (conservative DB gate) | off | off | off |
| web JS | on | once | off | off | off | off | off |
| catalog JSON/schema | off | off | off | off | off | Node + Python | off |
| WS runtime | on | off | off | on | 54 / 67 | off | off |
| infra | off | off | off | off | off | off | 8 |
| package/shared/unknown/CI | on | once | on | on | on | on | on |

Deterministic routing and CLI tests cover these cases, unions, empty diff,
missing ranges, manual validation and Production mutation eligibility.
`actionlint` remains universal. Playwright Matrix/nightly, ledger operational
workflows, WS Preview, resource health, DB check and Stage apply are unchanged.

## Task status / rollout limits

- [x] T001 shared classifier and deterministic guards.
- [x] T002 lightweight universal CI and actionlint context.
- [x] T003 core/chips/WS PG/Chromium split.
- [x] T004 games-owned distinct validators.
- [x] T005 scoped WS PR ownership, infra/deploy duplication removed.
- [x] T006 single main pre-deploy validation; WS Deploy retired atomically.
- [x] T007 operational/DB safety workflows preserved.
- [x] T008 fundamental routing/deploy guards.
- [ ] T009 exact-SHA PR CI evidence and owner-authorized post-merge routing evidence.

PR CI results are recorded in the draft PR body. An actual merge-run cannot be
produced before the owner's separate merge decision. No Production deployment,
Stage mutation or merge is authorized/performed for this implementation. There
are no migrations, so this PR does not trigger DB Stage Apply PR. No WS runtime,
artifact inputs, protocol or Preview config changed; no WS Preview redeploy or
runtime smoke is required for these workflow/test/docs changes.

Breaking impacts: external references to retired `WS Deploy` cease to work;
non-required Tests job contexts change to the four scoped jobs. Required
`actionlint` and Netlify contexts remain unchanged. WS Server Deploy keeps its
existing Production mutation path, but its validation ownership changes.
