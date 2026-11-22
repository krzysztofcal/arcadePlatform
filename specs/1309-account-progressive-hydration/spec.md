# Feature Specification: Progressive Account hydration and profile latency (#1309)

**Feature Branch**: `1309-account-progressive-hydration` · **Created**: 2026-11-22 · **Base**: `main` @ `98fb6fac`
**Status**: implemented in a Draft PR, awaiting Codex review and OWNER runtime acceptance. WWW publication remains HOLD.

## User Scenarios & Testing *(mandatory)*

### User Story 1: Basic profile first (Priority: P1)
When a signed-in player opens Account, the following appear as soon as the base profile read resolves:
- display name and handle
- saved catalog avatar
- public-profile and visibility controls

They never wait for the Poker projection, which needs a chips balance and the WS runtime.
**Test**: Poker held or failing → the profile is rendered and its status is `success`. Poker then shows its own "unavailable" state.

### User Story 2: No request storms (Priority: P1)
Opening Account and the auth events that follow (`INITIAL_SESSION`, `SIGNED_IN`) send at most one `profile-me` base read and one `includePoker` read per profile generation. Reads made after a profile write never reuse an older in-flight read.
**Test**: identical forced reads share one request; a read after `updateMe` / `invalidate` starts a new one; a late old answer never replaces the written profile.

### User Story 3: Stable avatar gallery (Priority: P1)
The gallery shows exactly the server-allowed catalog choices (6 when `variants_enabled=false`, 16 when true). An unresolved Google-photo status adds no tile.
A Google tile exists only in two cases:
- a consented stored copy is known
- the profile already uses the Google photo

In both cases the tile is a stable placeholder that only changes state.
**Test**: unresolved status keeps 6 tiles and the same image nodes; a Google photo in use keeps one placeholder tile.

### Edge Cases
- Sign-out or account switch: the generation changes, so older Poker or profile answers render nothing, and the cache is cleared.
- A cancelled read (`stale_identity`) gets one fresh retry for the same identity, for the profile and for Poker. It is not reported as an error.
- A throwing Poker renderer is contained: no unhandled rejection, and the profile state is unchanged.
- An account that is being deleted or no longer exists still gets 401 `unauthorized` from `profile-me` GET.

## Requirements *(mandatory)*
- **FR-001** `js/account-page.js::renderUser` starts `loadPublicProfile(true)` (base) and `loadPokerProjection(true)` (`includePoker`) independently. Each has its own in-flight guard, generation guard and error state.
- **FR-002** `js/profile-client.js::getMe` keeps one in-flight read per kind (base, poker). A read joins one only if it has the same user, the same identity generation, and the same `writeSeq`. This also applies to forced reads.
  - `updateMe`, `clear` and the new `invalidate` advance `writeSeq`.
  - A read started before a write never writes the cache.
- **FR-003** `js/profile-google-photo.js::request` calls `ProfileClient.invalidate()` before and after every non-GET photo action. `getPresentation` adds `copyKnown`.
- **FR-004** `js/account-page.js::renderAvatarGallery` adds the Google tile only for a known copy or for an uploaded avatar already in use. It never fakes catalog variants.
- **FR-005** `netlify/functions/profile-me.mjs` GET verifies the JWT with `allowDeleting: true` and relies on the account-lifecycle check that `ensureUserProfile` already runs inside its own transaction. This is one transaction instead of two. `account_not_active` maps to the unchanged 401.
  - PATCH keeps the JWT lifecycle check.
  - A bounded `profile_me_timing` klog (aggregate ms, no identifiers) is written for requests ≥ 1000 ms.
- **FR-006** No new endpoint, table, migration, flag, CSS or inline script. The SRI pins of the changed scripts are updated.

## Success Criteria *(mandatory)*
- **SC-001** In the deterministic replay of the Account-open sequence, `profile-me` requests per open drop from 10 to 2.
- **SC-002** Time to basic profile drops from the `includePoker` latency to the base latency. On the observed medians that is 2.31 s → 1.51 s; in the worst case it is 21.1 s → 6.6 s.
- **SC-003** `profile-me` GET database round trips drop from 9 to 5 when account deletion is enabled. Each GET takes one fewer `account-lifecycle` advisory lock, so concurrent same-user requests queue less.
- **SC-004** The gallery count is stable across auth events and photo-status reads.
- **SC-005** OWNER real-device acceptance on the Deploy Preview, plus Netlify timings of the Preview, before any publication decision.

## Assumptions / not changed
- Netlify functions run in the default region, and the database pooler is in `eu-west-3`. Moving the function region is a Production configuration change and is outside this PR (plan §Follow-ups).
- The chips balance is still read twice (`chips-balance` and `includePoker`). This is unchanged, to keep old APK and Poker contracts.
