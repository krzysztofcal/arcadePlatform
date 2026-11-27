# Feature Specification: One top-bar profile read per page (#1313 T3)

**Branch**: `perf/1313-topbar-single-read` · **Created**: 2026-11-27 · **Base**: `main` @ `f5d1fb6e`
**Scope**: browser only (WWW and the Android WebView, which loads the same files). No Netlify function, WS, DB, flag or legal-document change.

## Evidence (Deploy Preview, Stage, 2026-11-27, `main` code)

A signed-in page load sends three top-bar requests:

| Request | Caller | Purpose |
|---|---|---|
| `GET profile-me` | `js/auth/supabaseClient.js::refreshProfile` → `ProfileClient.getMe()` | top-bar avatar and name |
| `GET profile-me?includePoker=1` | `js/topbar.js::refreshPokerBadge` → `ChipsClient.fetchPokerProjection` → `ProfileClient.getMe(true, { includePoker: true })` | "· Poker: N CH" badge |
| `GET chips-balance` | `js/topbar.js::refreshChipBadge` → `ChipsClient.fetchBalance` | CH badge |

- `netlify/functions/profile-me.mjs` with `includePoker=1` already returns the owner profile, `balance` and `poker`.
  - The balance is read with the same `getUserBalance` that `chips-balance.mjs` uses.
  - A failed poker projection gives `poker: null`.
  - A failed balance read makes the whole response a 5xx.
- `ProfileClient.getMe` shares an in-flight request only within the same kind (`base` or `poker`).
- On pages without `ProfileClient` (the 12 immutable `legal/*.html` with their old SRI pin), the fallbacks send raw requests that nothing shares. Measured on `/legal/privacy.en.html`: 2× `profile-me` (from `supabaseClient.js`) and 2× `profile-me?includePoker=1` (from `ChipsClient.fetchPokerProjection`). `topbar.js` calls `refreshChipBadge` for both `resolveInitialAuth` and `INITIAL_SESSION`, and `refreshPokerBadge` runs before the `chipInFlight` check.

## User stories

### US1: One profile request per page for the top bar (P1)
**Acceptance**
1. On a signed-in page with `ProfileClient`, the first load sends exactly one `GET profile-me?includePoker=1` and no `GET chips-balance` and no plain `GET profile-me` for the top bar. Other page features may still read (for example the Account page's own reads, if they cannot share).
2. The avatar, name, CH badge and Poker badge show the same values as today.
3. Later top-bar refreshes (`ui:visible`, `chips:tx-complete`) send one `profile-me?includePoker=1` instead of `chips-balance` plus `profile-me?includePoker=1`.

### US2: A balance failure does not break the avatar (P1)
**Acceptance**
1. If the combined read fails, `supabaseClient.js` falls back to one plain `ProfileClient.getMe()` for the avatar, and the CH badge keeps today's failure behaviour: it keeps the cached value or hides.
2. The 5 s CH badge timeout and the 404 and `not_authenticated` handling stay as they are.

### US3: Legal pages stop duplicating requests (P2)
**Acceptance**
1. On a page without `ProfileClient`, `supabaseClient.js` sends one raw `profile-me` per session (repeated session events share one in-flight raw read for the same user and session generation).
2. `ChipsClient.fetchPokerProjection`'s raw fallback shares one in-flight request.
3. The values shown are unchanged.

### US4: Nothing else changes (P1)
**Acceptance**
1. `ChipsClient.fetchBalance` keeps its behaviour for its other callers: the Account page, `poker/poker-v2.js` rebuy and the table, and `poker/poker.js`.
2. The `chips` slice in `UserUiState` is still published from a successful balance (same `{ balance }` shape), and `chips:balance` is still emitted.
3. The `profile` slice published to `UserUiState` keeps today's shape: `balance` and `poker` are stripped before publishing.
4. Guests send none of these requests (unchanged). The #1313 T1 once-per-open rule and the #1355 deferral stay intact.

## Functional requirements

- **FR-001** `js/chips/client.js` gets `fetchTopbarSnapshot()`.
  - With `ProfileClient`: it calls `ProfileClient.getMe(false, { includePoker: true })` and returns `{ balance, poker }`, with `balance` checked as a non-negative safe integer.
  - A valid balance goes through the same publish/emit step as `fetchBalance`, factored into one private helper used by both.
  - Without `ProfileClient`: it returns `{ balance: <fetchBalance()>, poker: <fetchPokerProjection()> }` (today's behaviour), with the raw poker fallback deduplicated by one shared in-flight promise per user.
- **FR-002** `js/topbar.js::refreshChipBadge`: when `ChipsClient.fetchTopbarSnapshot` exists, it uses that one call (under the existing `chipInFlight`, generation, UI-context and 5 s timeout rules) to render the CH badge and the Poker badge. In that path it no longer calls `refreshPokerBadge` separately. Otherwise it keeps today's path.
- **FR-003** `js/auth/supabaseClient.js::refreshProfile` with `ProfileClient`:
  - when `window.ChipsClient` is present it calls `getMe(false, { includePoker: true })`, so it shares the top bar's in-flight request; on failure it falls back to one `getMe()`;
  - before `ui.publish(..., 'profile', ...)` and `renderUser`, it removes `balance` and `poker` from a copy of the profile.

  Without `ProfileClient`: one shared in-flight raw read per user and `profileSessionGeneration`.
- **FR-004** No change to Netlify functions or SRI-pinned files, except `js/chips/client.js` and `js/topbar.js` if they carry pins (re-pin on the non-legal pages that pin them; the immutable `legal/*.html` keep their pins). `js/auth/supabaseClient.js` has no pin.
- **FR-005** ES5 IIFE, `klog` only, no new endpoint, request type, dependency or inline script.

## Out of scope

- Server-side changes (for example letting `profile-me` tolerate a failed balance).
- XP badge requests, the welcome bonus status, and Account and poker page reads.

## Success criteria

- **SC-001** Deploy Preview, Stage account: top-bar requests per page load on `/`, `/xp.html`, `/leaderboard.html` and `/account.html`, before and after (Network evidence in the PR).
- **SC-002** Legal page: one raw `profile-me` and one raw `profile-me?includePoker=1`, at most.
- **SC-003** Avatar, CH and Poker badges are visually unchanged; the CH badge updates after `chips:tx-complete`.
- **SC-004** Fundamental tests pass; CI green.
