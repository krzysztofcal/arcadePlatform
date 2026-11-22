# Implementation Plan: Progressive Account hydration and profile latency (#1309)

**Branch**: `1309-account-progressive-hydration` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md)
**Validation**: `node --test tests/account-auth.contract.test.mjs tests/account-page.test.mjs tests/public-profiles.behavior.test.mjs tests/profile-google-photo.behavior.test.mjs tests/ugc-client.behavior.test.mjs`, run with the `scripts/test-all.mjs` environment. CI on the Draft PR, then the Deploy Preview.

## Diagnosis (evidence, 2026-11-22)

**Netlify observability, 24 h, `playkcswh` Production functions:**

| Function | Requests | p50 | p90 | p99 |
|---|---|---|---|---|
| `profile-me` | 406 | 1.51 s | 3.82 s | 14.3 s |
| `chips-balance` | – | 0.58 s | – | – |
| `calculate-xp` (no Postgres) | – | 0.14 s | – | – |

Request log 09:36–09:39 UTC:
- base and `includePoker` reads start in the same millisecond, for example at 09:37:08.938 / .941, taking 16.0 s / 21.1 s;
- the base read alone also takes 6–16 s, so the slow part is not WS-only;
- sequential `includePoker` reads take ≈2.3 s each;
- there were 499s (client gave up).

**Client causes (confirmed in code):**

1. **The base profile waits for Poker.** `account-page.js::loadPublicProfile` read `getMe(true,{includePoker:true})` and rendered the profile only after the balance and the WS projection had returned.
2. **Forced reads bypass coalescing.** In `profile-client.js::getMe` a forced read skipped the in-flight read, and there was a single in-flight slot, so a poker read replaced the base read. Callers on one Account open:
   - topbar `refreshProfile` (`getMe()`);
   - topbar `refreshPokerBadge` (`getMe(true,{includePoker})`, also on every `ui:visible`);
   - Account `renderUser` (forced `includePoker`);
   - `ugc-client` (`getMe(false)`).

   Each of these runs again on `getCurrentUser`, on `INITIAL_SESSION` and on `SIGNED_IN`. The replay measured 10 requests per open.
3. **The gallery flips.** While the owner is unresolved, `profile-google-photo.js::getPresentation` returns `pending`. The gallery adds a Google tile, then removes it once the status read returns 404 or "no copy". This happens again on every auth event. A shape change rebuilds every `<img>`, so the visible tile count (6↔7, 16↔17) and the images keep changing.

**Server causes (confirmed in code):**

1. **The account check runs twice.** `verifySupabaseJwt` runs a lifecycle transaction (BEGIN, advisory lock, exists, COMMIT). Then `ensureUserProfile` runs the same check again in its own transaction (BEGIN, lock, exists, `ensure_user_profile`, COMMIT). That is 9 round trips and 2 locks per GET.
2. **The cost of each round trip** comes from functions in the default Netlify region talking to the pooler in `eu-west-3`. This matches the ≥0.5 s floor of every Postgres function.
3. **Concurrent same-user requests serialise** on the `account-lifecycle:<id>` advisory lock. This is a hypothesis for the 6–21 s outliers, consistent with the paired timings. It is not proven by a lock trace.

The WS projection is bounded by `POKER_WS_INTERNAL_TIMEOUT_MS` (default 4 s) and cannot explain the base outliers.

## Constitution Check (v1.6.0)

| Gate | Result |
|---|---|
| I Simplicity / reuse | PASS. Existing functions and endpoints only; no new endpoint, table, dependency or framework |
| II Runtime boundaries | PASS. The WS stays authoritative and the Poker projection contract is unchanged |
| III Fail-closed | PASS. The lifecycle check still runs in the same request, inside the profile transaction, and its 401 is unchanged. A failed Poker or photo read never grants anything |
| IV JSP / logging / CSP | PASS. Global IIFEs, `klog` only, no inline script, no CSS. The SRI pins of `profile-client.js` (37 non-legal pages) and `profile-google-photo.js` (`account.html`) are updated. The 10 immutable `legal/*.html` documents keep their old pin by design (spec FR-006) |
| V Tests | PASS. Fundamental contract tests in existing files only (late Poker, contained Poker failure, coalescing across writes, gallery stability, GET/PATCH lifecycle check). No DOM/CSS suite. No Git commands |
| VI Workspace | Volume worktree created via the preflight |

## Changes
- `netlify/functions/profile-me.mjs::createProfileMeHandler`: the GET uses `verifyJwt(token,{allowDeleting:true})`, and `account_not_active` from `ensureProfile` becomes 401. Adds `PROFILE_ME_SLOW_MS` and `profile_me_timing`.
- `js/profile-client.js::getMe/updateMe/clear/invalidate/parse`: per-kind shared in-flight reads with `writeSeq`. No finished-answer cache (review R7: closes every stale-cache case at once). Strict 2xx body validation. Announcement only when the write cannot have been overtaken.
- `js/account-page.js::renderUser/loadPublicProfile/loadPokerProjection/renderAvatarGallery`: independent sections, the Google tile rule, and a contained Poker failure.
- `js/profile-google-photo.js::request/getPresentation`: invalidates after photo actions; `copyKnown`.
- `*.html` (non-legal only): updated SRI pins. `legal/*.html` is unchanged (FR-006).
- Tests: `tests/account-auth.contract.test.mjs`, `tests/account-page.test.mjs`, `tests/public-profiles.behavior.test.mjs`.

## Breaking impact
- **WWW and APK packaging:** both share these scripts. Profile and Poker now render independently, with no change to the visual design. The APK needs a new build to receive the change.
- **Topbar and Poker:** the Poker badge and the Poker page reads now share an identical in-flight `includePoker` read instead of each sending its own. Their freshness is unchanged, because they only share a read that started after the last write.
- **Server:** `profile-me` GET answers 401 for an inactive account from the profile transaction instead of from the JWT check; the status and body are the same. If the database is unavailable during that check, GET now answers 500 `server_error`; before, it answered a misleading 401. PATCH is unchanged. Other functions are unchanged.
- **Logs:** `profile_me_timing` adds at most one line per slow request.

## Follow-ups (separate OWNER decision; not in this PR)
- **F1:** set the Netlify functions region near `eu-west-3`. This is a Production site configuration change, and it may depend on the plan.
- **F2:** if Preview timings still show outliers, take a lock or pooler trace before any change to the lifecycle lock.
- **F3:** `chips-balance` deduplication between the topbar and Account.
