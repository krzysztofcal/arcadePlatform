# Tasks: Poker Lobby Welcome Bonus Visibility (#1083)

**Source**: GitHub Issue [#1083](https://github.com/krzysztofcal/arcadePlatform/issues/1083)  
**Baseline**: main (`1ba99776ff427783f858e075d3474e144c3947b3`)

---

## Task Checklist

- [x] **T001**: Review `agents.md`, `skills.md`, issue #1083, and PR #1084 diff for scope boundaries and conflict prevention.
- [x] **T002**: Inspect current lobby layout geometry in portrait and landscape with Playwright across standard device viewports (390×844, 375×667, 844×390, 568×320).
- [x] **T003**: Tune responsive styling in `poker/poker.css` for `body.poker-lobby .poker-bonus-banner` in mobile portrait and short landscape, following the one-line-per-selector rule.
- [x] **T004**: Run syntax validation (`npm run syntax`), CI guards (`npm run ci:guards`), and targeted UI behavior tests.
- [x] **T005**: Self-review implementation for regressions and breaking changes.
- [x] **T006**: Create Draft PR with summary and verification evidence.
- [x] **T007 (P2 Corrective)**: Correct CSS cascade order in `poker/poker.css` by moving responsive media query rules after base rule (`line ~500`) without `!important`.
- [x] **T008 (P2 Corrective)**: Preserve `min-height: 44px` on `.poker-btn` in landscape for touch target accessibility compliance.
- [x] **T009 (CI Corrective)**: Diagnose `WS PR Checks` failure on `Run ws join runtime behavior test` (flaky test runner timing), confirm unrelated to PR, rerun and verify 100% green checks.
- [x] **T010 (P3 Corrective)**: Remove simple glue code test from `tests/poker-ui.behavior.test.mjs` in accordance with `agents.md` testing policy.
- [x] **T011**: Verify final layout in portrait and short landscape with Playwright, ensuring Welcome Bonus readability, CTA functionality, and non-interference with Daily Bonus and navigation.
- [x] **T012 (Deploy Preview)**: Remove `[skip netlify]` from PR title and push clean trigger commit to start and verify Netlify Deploy Preview, validate deployed SHA, and perform live preview smoke on `/poker/`.
