# Plan: T1 profile reads (#1313)

## Files and methods
- `js/account-page.js`:
  - `renderUser`: guard `loadPublicProfile(true)` with `profileLoadState`/`publicProfileInFlight`, and `loadPokerProjection(true)` with `pokerLoadState`/`pokerProjectionInFlight`, for the same user key;
  - reset both states on sign-out and on a user change;
  - `loadPokerProjection`: tracks `pokerLoadState`.
- `js/auth/supabaseClient.js`:
  - `refreshProfile`: `hasProfileClient`, `sessionGen` checks and the mark set/clear, all inside the ProfileClient path;
  - `applyResolvedUser`: advances `profileSessionGeneration` and clears the mark on sign-out or a user change, and skips only on the ProfileClient path.

## Constitution Check (v1.6.0)
| Gate | Result |
|---|---|
| I Simplicity | PASS: two guards and one counter, no cache or new API |
| II Runtime | PASS: no WS or Poker state change |
| III Fail-closed | PASS: no server or lifecycle change; stale answers render nothing |
| IV JSP/CSP/logging | PASS: ES5 IIFE, no inline script, no SRI-pinned file touched, `logDiag`/`klog` only |
| V Tests | PASS: fundamental tests in existing files only |

## Validation
- `node --test tests/account-auth.contract.test.mjs tests/account-page.test.mjs tests/profile-google-photo.behavior.test.mjs tests/ugc-client.behavior.test.mjs tests/mobile-legal-packaging.test.mjs tests/public-profiles.behavior.test.mjs`, with the `scripts/test-all.mjs` environment.
- `tests/topbar-contract.test.mjs` separately: the new tests pass; its 5 `poker/table.html` assertions already fail identically on main and are untouched.

## Risks
- **R-A:** a same-user profile change made in another tab is shown at the next page load or `profile:updated`, not on a later auth event.
- **R-B:** the scripts are shared between WWW and the APK; the APK needs a new build.
