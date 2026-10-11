# Self-review / evidence — #1090

## Scope and breaking impact
Three client files plus one existing test-fixture correction; existing ChipsClient, generic endpoint, topbar event wiring, profile/home claims, Daily keyframes and server payout/idempotency remain intact. Intentional behavior change: lobby Welcome CTA no longer navigates to `/account.html` (#1083/#1069 contract superseded only here). Daily and Welcome POST actions are serialized while pending. No DB/WS/config/dependency/inline-script changes; no shared Stage or Production mutations.

## Before proof (MOCK)
Existing Netlify Preview `https://deploy-preview-1088--playkcswh.netlify.app/poker/`, runtime lobby matching base main e7fd0ce2: mock eligible campaign `welcome-mock-1090`, amount 731. CTA visibly advertised the old static 500 CH, then navigated to `/account.html` instead of claiming. No actual CH award.

## Claim flow reviewed
1. Existing combined GET populates eligible Welcome and Daily cache (60 seconds / UTC boundary).
2. Click disables Welcome with PLEASE WAIT and blocks duplicate/Daily POST. Warm click reuses payload; stale click joins/refreshes the combined GET and selects actual campaign code.
3. `ChipsClient.claimBonusCampaign(code)` performs existing authenticated POST. Its synchronous transaction event refreshes topbar/balance/progression; lobby suppresses competing cache invalidation until the Promise settles.
4. Unchanged identity plus strict `claimed === true` and positive safe integer POST amount hides banner, announces static receipt and shows independent manual-popover top-layer reward for 1800ms using Daily art/keyframes. Reduced motion/hidden documents receive static confirmation only. Never opens Daily.
5. Reconcile campaigns with GET only. Denial/already-claimed/uncertain results produce no celebration; transport failures never auto-POST. Failed/uncertain outcomes also refresh authoritative balance/progression. The generic client's existing explicit-401 auth-refresh retry remains unchanged (no transport retry).
6. Auth identity change clears pending/status/timer/popover; old response/finally cannot reset or celebrate on the new account. Daily retains its own status, receipt, dialog and fly-in.

## Existing controls
- `tests/chips-client-cache.behavior.test.mjs`: pass.
- `tests/bonus-campaigns.behavior.test.mjs`: 17/17 pass (mock server dependencies; no remote ledger).
- `node --check poker/poker.js`: pass (poker files are outside the general syntax script's JS path filter).
- Existing syntax: 226 files pass; CSP: 55 served documents pass; ci:guards pass; diff whitespace check pass.

## Browser/Preview — all results MOCK
Netlify served runtime SHA `87626af65cbb9c778d2e505ab735b63f0ed69357`, independently confirmed through `/js/build-info.js` (`context: deploy-preview`, `isProduction: false`), at https://deploy-preview-1091--playkcswh.netlify.app/poker/. Product HTML/JS/CSS were loaded from Netlify without local substitution. Only auth/API replies were mocked; consent and the injected Netlify review toolbar were suppressed in the temporary harness to prevent unrelated click interception.

18 browser scenes passed with no JS exceptions. Mock values deliberately differ: banner **731 CH**, confirmed POST **902 CH**, authoritative mock balance **1902 CH**. These are NOT real CH postings.

| Scenario | Campaign request sequence after click/start | Observed outcome |
| --- | --- | --- |
| Success at 390×844, 320×568, 844×390, 568×320 | POST, GET, GET | Full viewport popover, all hero text/art fits, +902 CH, hidden after ~1800ms; banner hidden, lobby URL unchanged, Daily dialog stays closed; topbar 1.9k and progression 1902 from reads |
| Double click + focus + transaction event during pending | One POST | PLEASE WAIT, disabled button; one reward; lobby shared cache not refreshed while posting |
| Server denial | POST, GET | No reward, usable Claim, nonconfirmation status |
| Already claimed | POST, GET | No new reward/celebration |
| Network timeout, mock paid/disappearing GET | POST, GET | No fake success despite campaign disappearance; balance read; zero automatic re-POST |
| Account switch / logout during POST | One POST | Old result/status/fly-in discarded; current account refresh isolated |
| Reduced motion / hidden document | POST, GET, GET | Static accessible +902 CH confirmation; no animation/replay |
| Stale cache / in-flight shared refresh | GET, POST, GET, GET | Exactly one pre-POST combined GET, actual current code, joined existing request |
| Daily shortcut while Welcome pending | One Welcome POST | No competing Daily POST; independent statuses; Welcome top-layer visible above opened dialog |
| Keyboard Enter / touch taps | One POST | No navigation, proper reward and persistent status |
| 401 | POST, POST, GET | Existing client auth retry only; final denial produces no reward |
| Malformed `claimed: "true"` | POST, GET, GET | No reward; strict success guard holds |

Two GETs after normal successful POST are the existing topbar badge refresh and the lobby shared Welcome/Daily reconciliation, not pre-claim reads. Daily shortcut after Welcome success still claims its mock 25 CH and shows the original Daily +25 CH / STREAK DAY 1 fly-in; closing clears it. Home/profile/client/topbar source diff is empty.

Temporary harness/results/screenshots remain outside the repository (`/tmp/welcome-1090-smoke.cjs`, `/tmp/welcome-1090-smoke-results.json`, `/tmp/welcome-1090-success-<viewport>.png`), not a new test suite. Draft PR: https://github.com/krzysztofcal/arcadePlatform/pull/1091. Later changes are docs and the existing fixture only; runtime artifacts are unchanged. Final PR SHA/Netlify build and CI are reported in the PR and handoff.

## Review findings and checks caveat
Independent read-only reviewer found no critical/important issues. CI initially exposed an incomplete existing account-isolation mock (missing banner `strong`): corrected only the fixture, preserving all existing assertions/cases; `node tests/poker-ui.behavior.test.mjs` now passes.

Optional local `npm run check:all` reports five pre-existing design HTML files without XP badge anchors: `poker/designs/luxury-lobby/{index,landscape,portrait}.html`, `specs/1086-poker-felt/design/index.html`, `specs/792-premium-table-themes/design/index.html`. Their diff against base main e7fd0ce2 is empty. Required structural `ci:guards` passes. No unrelated design/config cleanup performed.

No real Stage/Production Claim, WS deployment, merge or Production operation was executed. Owner final review remains pending.
