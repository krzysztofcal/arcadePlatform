# Plan: one top-bar profile read per page (#1313 T3)

Spec: `specs/1313-t3-topbar-single-read/spec.md`.

## Files

| File | Change |
|---|---|
| `js/chips/client.js` | Add `fetchTopbarSnapshot()`. Factor the balance publish/emit step of `fetchBalance` into one private helper and call it from both. Deduplicate the raw `fetchPokerProjection` fallback with one in-flight promise per user, cleared on settle and on `clearAuthCache`. Export `fetchTopbarSnapshot`. |
| `js/topbar.js` | `refreshChipBadge`: when `ChipsClient.fetchTopbarSnapshot` exists, race it against the existing 5 s timeout and render `renderChipBadgeBalance(snapshot.balance)` and `renderPokerBadge(snapshot.poker)`, without the separate `refreshPokerBadge()` call. Keep every existing guard: `chipInFlight`, `chipRequestGeneration`, the UI context, `pokerRequestGeneration` and the timeout/404/`not_authenticated` handling. Without `fetchTopbarSnapshot`, keep today's code path. |
| `js/auth/supabaseClient.js` | `refreshProfile`, ProfileClient path: `includePoker` is true when `window.ChipsClient` exists; on rejection, retry once with plain `getMe()`. Strip `balance` and `poker` from a shallow copy before `ui.publish` and `renderUser`. Raw path: one shared in-flight promise keyed by user ID and `profileSessionGeneration`. |
| `tests/chips-client-cache.behavior.test.mjs` | Extend: `fetchTopbarSnapshot` uses one `getMe(false, { includePoker: true })`, publishes the `chips` slice and emits `chips:balance` for a valid balance and not for an invalid one; the raw path shares the in-flight poker request. |
| `tests/account-auth.contract.test.mjs` or `tests/topbar-contract.test.mjs` | Extend, whichever already loads `supabaseClient.js` with a fake `ProfileClient`: includePoker read when `ChipsClient` exists; fallback to `getMe()` on rejection; the published profile has no `balance` or `poker`; raw reads shared. |

No new test files, no UI/CSS/layout tests (AGENTS.md Testing Policy).

## Order of calls on a signed-in page (after)

1. `supabaseClient.js` resolves the session. `refreshProfile` waits for `DOMContentLoaded` if needed (#1355), then calls `getMe(false, { includePoker: true })`. This starts the `poker`-kind in-flight read.
2. `topbar.js::refreshChipBadge`, from `resolveInitialAuth` and `INITIAL_SESSION`, calls `fetchTopbarSnapshot()` → `getMe(false, { includePoker: true })`, which shares the same in-flight request (same user, `writeSeq` and generation).
3. Whichever runs first starts the single request; the other joins it. `chips-balance` is not called.

## Verification

- Run each existing test file on its own: `chips-client-cache.behavior`, `account-auth.contract`, `topbar-contract`, `account-page`, `public-profile-ui.contract`, `user-ui-state.behavior`, `poker-offline`, `mobile-poker-security`.
- Coordinator, on the Deploy Preview with Stage accounts:
  - the request count per page (spec SC-001/SC-002);
  - the avatar timeline;
  - the CH and Poker badge values against `chips-balance` and `profile-me?includePoker=1` read directly;
  - the CH badge after `chips:tx-complete`.
- Independent review: Codex, per `REVIEW.md`. Antigravity implements and the coordinator only fixes, so if the coordinator changes code, the author set is mixed and the OWNER chooses the reviewer, per `AGENTS.md`.
