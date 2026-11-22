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
Opening Account sends one `profile-me` base read and one `includePoker` read. Auth events (`INITIAL_SESSION`, `SIGNED_IN`) that arrive while a read of the same kind is still in flight join that read. An event that arrives after one kind has finished refreshes only that kind. A later auth event for the same account, such as `TOKEN_REFRESHED`, still refreshes both reads, deduplicated in the same way, and keeps the Poker section visible while it refreshes. Reads made after a profile write never reuse an older in-flight read.
**Test**: identical forced reads share one request; a read after `updateMe` or `invalidate` starts a new one; after a lost, overlapping or later-applied write the next read returns the server state.

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
- **FR-002** `js/profile-client.js::getMe` keeps **no finished answer**. A lost, overlapping or later-applied write therefore can never leave a stale profile behind.
  - Identical reads share one in-flight request per kind (base, poker), also when forced.
  - A read joins an in-flight request only if it has the same user, the same identity generation and the same `writeSeq`.
  - `updateMe`, `clear` and `invalidate` advance `writeSeq`.
  - `parse` rejects a 2xx response whose body is lost, unreadable or not an object, with the code `invalid_response`.
  - `updateMe` announces `profile:updated` only when no other write is in flight and no write or invalidation happened since it started.
- **FR-003** `js/profile-google-photo.js::request` opens a profile write with `ProfileClient.beginWrite()` for every non-GET photo action. It closes the write with the returned `done()` in `finally`.
  - While the action runs, no in-flight read is shared across it and no overlapping PATCH answer is announced.
  - `getPresentation` adds `copyKnown`.
  - **Known limitation:** a PATCH whose response is lost can still be applied by the server after a later write has been announced. The announced view is then outdated until the next read. This is accepted as a rare, self-correcting case. It is no regression: before #1309 every answer was announced.
- **FR-004** `js/account-page.js::renderAvatarGallery` adds the Google tile only for a known copy or for an uploaded avatar already in use. It never fakes catalog variants.
- **FR-005** `netlify/functions/profile-me.mjs` GET verifies the JWT with `allowDeleting: true` and relies on the account-lifecycle check that `ensureUserProfile` already runs inside its own transaction. This is one transaction instead of two. `account_not_active` maps to the unchanged 401.
  - PATCH keeps the JWT lifecycle check.
  - A bounded `profile_me_timing` klog (aggregate ms, no identifiers) is written for **successful** GET/PATCH requests ≥ 1000 ms. Failed requests keep the existing `profile_me_failed` log.
- **FR-006** No new endpoint, table, migration, flag, CSS or inline script. The SRI pins of the changed scripts are updated on every non-legal page: 37 for `profile-client.js` and 1 for `profile-google-photo.js`.
  The 10 `legal/*.html` documents are immutable, hash-pinned documents and stay byte-identical, keeping their old `profile-client.js` pin. On those pages the browser skips the new script, and the topbar uses its existing fallback without `ProfileClient` (initials plus a direct `profile-me` fetch). Never update these pins in place; a future legal version decides.

## Success Criteria *(mandatory)*
- **SC-001** In the deterministic replay of the Account-open sequence, `profile-me` requests per open drop from 10 to 2. In the replay, every auth event arrives while both reads are in flight. An event between the base completion and the Poker completion adds one fresh base read.
- **SC-002** Time to basic profile drops from the `includePoker` latency to the base latency. On the observed medians that is 2.31 s → 1.51 s; in the worst case it is 21.1 s → 6.6 s.
- **SC-003** `profile-me` GET database round trips drop from 9 to 5 when account deletion is enabled. Each GET takes one fewer `account-lifecycle` advisory lock, so concurrent same-user requests queue less.
- **SC-004** The gallery count is stable across auth events and photo-status reads.
- **SC-005** OWNER real-device acceptance on the Deploy Preview, plus Netlify timings of the Preview, before any publication decision.

## Assumptions / not changed
- Netlify functions run in the default region, and the database pooler is in `eu-west-3`. Moving the function region is a Production configuration change and is outside this PR (plan §Follow-ups).
- The chips balance is still read twice (`chips-balance` and `includePoker`). This is unchanged, to keep old APK and Poker contracts.
