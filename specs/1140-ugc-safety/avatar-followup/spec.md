# Feature Specification: UGC and avatar follow-up after release B (#1140)

**Branch**: `1140-ugc-avatar-followup` · **Created**: 2026-11-26 · **Base**: `main` @ `79d2c4f0` (Production deploy `6b081a96`)
**Origin**: OWNER Production smoke of release B on 2026-11-26. All four items were accepted by OWNER in the same conversation.
**Scope**: browser only (WWW and the Android WebView, which loads the same files). No WS, Netlify function, DB, migration, flag or legal-document change.

## Evidence (2026-11-26, Production, read-only)

- **Report vs block.** Netlify request log for account B: `POST ugc-report` 201 at 19:49:12 UTC, then `POST user-blocks` 201 at 19:49:22, `DELETE user-blocks` at 19:53:43 and `POST user-blocks` at 19:53:55. `private.ugc_reports` and `private.user_blocks` match these times. In `js/ugc-client.js`, `report()` only calls `ugc-report`, and the only block path is the Block button followed by the confirm dialog. A headless replay of Report → Send report sent only `GET user-blocks` and `POST ugc-report` within 12 s. Conclusion: the block came from a second confirmed dialog. The block confirm dialog looks almost the same as the report dialog (same layout, same confirm style, confirm button focused).
- **Leaderboard.** `leaderboard.html` does not load `js/ugc-client.js`, and `js/leaderboard-page.js::avatarNode` never checks blocks, so a blocked player's photo is still shown. The block dialog promises "You will no longer see their avatar".
- **Top bar flicker.** `js/auth/supabaseClient.js::applyResolvedUser` renders the hydrated profile with the display name only ("cached avatars need a fresh server confirmation"). `js/profile-client.js::applyAvatar` shows `AH` for a profile without an avatar. The real avatar appears only after `profile-me` answers. Each `profile-me` answer carries a new 60 s signed URL, so the browser cannot reuse its HTTP cache and downloads the same photo again on every page.
- **Photo turns into `AH` after 60 s.** `js/profile-client.js::applyPhoto` caps the display time at `min(link expiry, 60 s)` and its timer calls `applyAvatar(node, null)` even after a successful load. Nothing re-requests the photo; the earlier fix #1313 T1 (PR #1318) removed repeated `profile-me` reads and must not be undone.
- **Facts used by the plan.** Stored photos are 256×256 WebP (`profile-avatar.mjs::normalizeAvatarImage`); Production has 3 objects, max 18,564 bytes. Supabase Storage answers with `access-control-allow-origin: *`. The site CSP `img-src` already allows `data:` and `https://*.supabase.co`. The signed URL path (`/storage/v1/object/sign/profile-avatar-uploads/pending/<uuid>`, signed by `profile-avatar.mjs::photoPath` from the stored key `<uuid>.webp`) is stable per stored photo; only the `token` changes.

## User stories

### US1: Blocked players have no photo in the leaderboard (P1)
As a signed-in player who blocked someone, I do not see that player's uploaded photo or catalog avatar in the leaderboard; I see the default Arcade avatar, the same as on their public profile.

**Acceptance**
1. With A blocked by B, B opens the leaderboard: A's row shows the default avatar from the first paint (no flash of the photo) whenever the block list arrives within 3 s of the leaderboard data. A slower block list leaves A's real avatar visible until it arrives, then masks it. This is an accepted trade-off, so a hanging list never blocks the leaderboard.
2. B unblocks A in another page or tab and reopens the leaderboard: A's real avatar is shown.
3. Guests and players with no blocks see the leaderboard as today.
4. When the blocks endpoint is off (404) or fails, the leaderboard still renders; no avatar is masked and no error is shown.

### US2: The block confirmation cannot be mistaken for the report dialog (P1)
As a player who has just reported someone, I cannot block them by accident.

**Acceptance**
1. The block confirm dialog has its own title ("Zablokować gracza?" / "Block player?"), the existing explanation text and a red confirm button labelled "Zablokuj gracza" / "Block player".
2. Cancel has the initial focus in the block dialog, so Enter or a stray tap does not confirm it. The report dialog keeps its current behaviour.
3. Report never sends a block request (regression test).

### US3: My own avatar in the top bar does not flicker between pages (P1)
As a signed-in player, my avatar (photo or catalog avatar) is shown immediately on every page, and my photo is not downloaded again while it is unchanged.

**Acceptance**
1. Second and later page loads show my avatar on the first paint, without `AH`.
2. While my stored photo is unchanged, page changes do not download the image again (Network panel: no request to `profile-avatar-uploads`). `profile-me` is still read once per page, as today.
3. When I pick another photo, choose a catalog avatar, withdraw the Google photo consent, or a moderator hides my photo, the next `profile-me` answer replaces or removes the cached image on that page.
4. Sign-out, account switch and account deletion remove the cached image for that user. Account deletion reaches this through its local sign-out (`js/account-page.js`, `auth.signOut({ scope: 'local' })`), then `supabaseClient.js::applyResolvedUser(null)`, then `UserUiState.clearUser` and `setAnonymous`. A photo fetch still running at that moment saves nothing.
5. A device with no or blocked `localStorage` behaves as today.

### US4: Photos stay visible after their link expires, with no extra downloads (P2)
As a player looking at the leaderboard, a public profile or the Account page, a photo that has loaded stays visible until I leave or re-render the page, instead of turning into `AH` after a minute.

**Acceptance**
1. A loaded photo is still shown after 2 minutes on the same page.
2. No timer or poller requests a new link or image.
3. A photo whose link expired before it loaded falls back to the catalog avatar or `AH`, as today.
4. A moderator hide or block applies on the next page load or data refresh. A block made on the current page still masks the avatar immediately (existing `ArcadeUgc.onChange` listeners).

## Functional requirements

- **FR-001** `leaderboard.html` loads `js/ugc-client.js` (no new CSS; no controls are rendered there). `js/leaderboard-page.js` masks a row whose handle `ArcadeUgc.isBlockedHandle` reports as blocked with `{ displayName, avatar: { type: 'default', variant: 'default' } }`, waits for `ArcadeUgc.loadBlocks(false)` (started in parallel with the leaderboard read) before the first render, but at most 3 s after the leaderboard data arrives; after that it renders unmasked and `ArcadeUgc.onChange` applies the masks when the list arrives. Row avatars are re-applied on `ArcadeUgc.onChange`. A late block list for a previous page, period or account changes nothing.
- **FR-002** `js/ugc-client.js::openDialog` accepts a `danger` option. For block it sets the class `ugc-dialog--danger`, uses `ugcBlockTitle` and `ugcBlockConfirmButton`, and focuses Cancel. `css/ugc.css` adds one rule for the red confirm button. `js/i18n.js` adds the two keys in PL and EN.
- **FR-003** `js/user-ui-state.js` gets an own-photo record `photo`: `{ version, userId, savedAt, path, dataUrl }` per user, in its own key under the existing prefix. It is written and read only through dedicated `readPhoto`/`writePhoto`/`clearPhoto` functions. It is **not** part of `MAX_AGE`, `publish`, `acceptExternal` or the cross-tab broadcast, so a `storage` event can never rewrite or re-announce it.
  - The record is accepted on read only within 7 days of `savedAt`. `localStorage` has no TTL, so an older record is removed when it is read.
  - `clearUser` and `setAnonymous` remove the record.
  - `path` must match `^pending/[0-9a-f-]{36}$`, the key the server signs (`profile-avatar.mjs::photoPath`).
  - `dataUrl` must be `data:image/webp;base64,` followed by Base64 of at most 65,536 characters in the Base64 alphabet. The **whole** payload must decode without error. The decoded data must start with a `RIFF....WEBP` header and be at most 48 KiB.
  - Anything else is not written, and an invalid stored record is removed on read. No URL, `token` or query string can pass this validation.
- **FR-004** `js/profile-client.js::applyAvatar(node, profile, options)` takes an optional `options.ownUserId`. For an uploaded photo with that option and usable storage:
  - a cached `photo` record with the same `path` is shown at once and nothing is downloaded;
  - otherwise one fetch per user, session and path is shared by all nodes that ask for it (`fetch`, `mode: 'cors'`, `credentials: 'omit'`, `cache: 'no-store'`, `referrerPolicy: 'no-referrer'`, `redirect: 'error'`). The response must be `image/webp` of at most 48 KiB with a valid header. The image is then shown as a data URL and saved;
  - after the async work, the current user is read again (it is async), and then, synchronously just before the DOM change and the write, the code checks that the owner, the `ProfileClient` session generation, the per-owner photo epoch (kept in memory and in `localStorage`, so it covers every open tab) and the node's current request are all unchanged. The epoch is advanced by every authoritative change or clear, including a successful `profile-me` read and an accepted profile PATCH (`profile:updated`), so a late result after sign-out, an account switch, or a newer photo or catalog choice confirmed by any page changes nothing on any node;
  - a failed fetch shows the current fallback and saves nothing.
  The cached photo is removed only by authoritative events, all handled inside `ProfileClient` by `ownProfileConfirmed`: a successful `profile-me` read with no profile write or invalidation since it started, or an accepted profile PATCH for that user whose avatar is not uploaded or has a different `path` (the old record is removed before the new fetch starts, and only the last confirmed path is ever fetched), sign-out, account switch, or account deletion. A transitional render with no avatar data, such as a name-only render, keeps both the stored record and a photo already shown on that node for the same owner and session. On a fresh page, a first confirmation with the same path as the stored record keeps it. A fetch starts only for the last confirmed path while the stored epoch still matches that confirmation. `readPhoto` reports unavailable storage separately from "no record". Unavailable storage uses the plain `applyPhoto` path of FR-005. A failed write still shows the fetched image on the current page, logs `klog`, and does not retry.
- **FR-005** `js/profile-client.js::applyPhoto` (all callers) stops its expiry timer once the image has loaded. A separate marker `data-avatar-shown-path` is set only when a photo is actually displayed and is removed by every reset, fallback or mask. A repeated `applyAvatar` call for the path in that marker does not reset or reload the node. Before a successful load, the existing expiry fallback is unchanged.
- **FR-006** `js/auth/supabaseClient.js::applyResolvedUser` renders the hydrated profile with its avatar (catalog variant, or own photo when the `photo` slice has a record) instead of the display name only. `renderUser` passes `{ ownUserId }` to `applyProfileAvatar`. The `profile-me` read, its once-per-open rule from #1313 T1 and the legal-page fallback without `ProfileClient` are unchanged.
- **FR-007** `js/account-page.js` passes `{ ownUserId }` for the owner's summary and public-profile avatars. The Google-photo gallery previews (`js/profile-google-photo.js`) are not cached.
- **FR-008** The SRI pins of `js/profile-client.js` are updated on every non-legal page that pins it. The immutable `legal/*.html` documents keep their current pins, as in #1309. ES5 IIFE, `klog` only, no `console.log`, no new endpoint, request type, dependency or inline script.

## Decisions approved by OWNER (2026-11-26: D1–D5 accepted)

- **D1 (reverses a #1276 rule).** `js/user-ui-state.js` currently says "Persist only the photo marker, never a signed bearer URL or image." FR-003 stores the owner's own 256×256 photo (no URL or token) in that owner's `localStorage`, deleted on sign-out, account switch and deletion. The signed URL is never stored. After a rollback the record stays in `localStorage` until the browser data is cleared or a later version that knows the key removes it, because older code neither reads nor deletes it.
- **D2 (reverses a #1313-era rule).** FR-006 shows the cached avatar before the server confirms it. After a moderator hide, a withdrawal on another device or a catalog change, the owner may still see their own previous avatar until a `profile-me` read succeeds. If that read fails or never answers, the previous avatar stays on that page while it stays open (as in US4). Later pages re-read it from storage only within 7 days of when it was saved. Nobody else sees it.
- **D3 (changes phase D behaviour).** FR-005 keeps a loaded photo on screen after its 60 s link expires. A moderator hide then reaches pages that are already open on the next page load, not within 60 s. New links are still refused at once on the server, and the consent already says copies other people have seen cannot be recalled.
- **D4 (cost).** The leaderboard adds one `GET user-blocks` per view for signed-in players, which the public profile page already does. Image downloads go down (US3, US4), and no polling is added.
- **D5 (legal).** No Privacy or Terms change is proposed. Privacy a6 already says data saved on the device serves the session, settings and cache. These changes delete the cached photo on sign-out, which is stricter than the text ("sign-out does not delete local data"). OWNER confirms this reading.

## Success criteria

- **SC-001** Deploy Preview, OWNER device: US1–US4 acceptance passes. The top bar shows no `AH` on the second and later page loads.
- **SC-002** Deploy Preview Network panel: unchanged own photo, 5 page changes → 0 image requests to `profile-avatar-uploads` after the first page, and `profile-me` is read once per page, the same count as Production.
- **SC-003** Existing and new fundamental tests pass (see plan). CI is green.

## Out of scope

- Phase 4 (16-avatar catalog), server TTL of signed links, poker table photos (`poker/poker-v2.js` already fetches each seat photo once as a blob), WS, DB, legal documents and the Android release process.
