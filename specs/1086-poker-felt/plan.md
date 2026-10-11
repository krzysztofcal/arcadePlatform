# Plan — #1086 T005–T007

1. T005: simplify `poker/poker-v2.css` to shared material/print rules and one existing portrait transform. Retain approved Classic/Neon lighting, add four small color-specific lighting declarations over original theme SVGs. Reuse both original assets; preserve `TABLE_THEME_CATALOG`, `resolveTableThemeId` and `applyTableTheme` byte-for-byte.
2. T005: clean only `specs/1086-poker-felt/design/`; retain final six-theme captures and two original-main landscape examples, no historical experiments/large measurement JSON. Rewrite four feature documents for current scope.
3. T006: real deployed renderer/state fixtures for24scenes at390×844,320×568,844×390,568×320; inspect cards/chips/names/HUD, matrices/centering/content bounds, pointer/touch controls, missing assets/theme fallback, reduced motion and mobile-emulation performance. Temporary capture scripts outside repo, no new test suite.
4. T007: verify runtime exactSHA/Netlify bytes, existing syntax/CSP/guards/tests and GitHubCI; self-review simplifying CSS and functional breaking impacts. Publish concise static final gallery and verification report, update existing Draft PR for owner final review. No merge.

Constitution check: presentation-only, no UI tests, generic setup/dependencies/config/ignore changes. No protocol/runtime/schema/economy/migrations or shared Stage effects. Theme-specific original ornament assets remain unchanged. Mobile-emulation results are not physical-device guarantees.
