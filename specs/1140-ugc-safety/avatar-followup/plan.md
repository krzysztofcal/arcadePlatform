# Implementation Plan: UGC and avatar follow-up after release B (#1140)

**Spec**: `specs/1140-ugc-safety/avatar-followup/spec.md` · **Branch**: `1140-ugc-avatar-followup` · **Base**: `main` @ `79d2c4f0`
**Gate**: implementation starts only after OWNER approves D1–D5 in the spec.

## Technical context

Plain ES5 IIFEs loaded with `defer` on static pages, the same files packaged into the Android WebView. State that must survive a page change lives in `js/user-ui-state.js` (`localStorage`, prefix `kcswh:user-ui:`, per-user keys, `clearUser`/`setAnonymous`, cross-tab `storage` event). Avatars are drawn only by `js/profile-client.js::applyAvatar`. Blocks live in `js/ugc-client.js` (`ArcadeUgc.loadBlocks/isBlockedHandle/onChange`).

## Constitution check

| Principle | Result |
|---|---|
| I Simplicity / existing mechanisms | PASS. Reuses `UserUiState` storage and clearing, `ProfileClient.applyAvatar`, `ArcadeUgc` and the public-profile masking pattern. No new module, endpoint, dependency or framework |
| II Authoritative runtime boundaries | PASS. No WS, poker, chips or DB change. Blocks stay a viewer-side filter |
| III Fail-closed / environment separation | PASS. Storage, fetch or validation failures fall back to today's behaviour; a block-list failure never shows an error. No flag or environment change |
| IV JSP compatibility / logging / CSP | PASS. Global IIFEs, `klog` only, no inline script. CSP `img-src` already allows `data:` and `*.supabase.co`, and `connect-src` already allows `*.supabase.co`. SRI pins of `profile-client.js` updated |
| V Fundamental tests only | PASS. Tests cover the privacy-relevant cache rules and the report/block separation. No UI, CSS or layout tests; presentation is checked on the Deploy Preview |
| VI VPS checkout | Not affected |

## Design

### 1. Leaderboard masking (US1, FR-001)
- `leaderboard.html`: add `<script src="/js/ugc-client.js" defer></script>` after `profile-client.js` and before `leaderboard-page.js`. Keep the order the same as `profile.html`.
- `js/leaderboard-page.js`:
  - `load`: start `ArcadeUgc.loadBlocks(false)` together with the leaderboard request. After the leaderboard data arrives, wait for the block list for at most 3 s (`Promise.race` with a timer; a rejected load counts as "no blocks"), then render. `loadBlocks` has no timeout of its own, so a hanging list never blocks the leaderboard. When the list arrives later, `ArcadeUgc.onChange` applies the masks.
  - The existing `load` generation check also guards the block wait, so a late result for an older page, period or account is ignored.
  - `avatarNode(row)`: pass the masked profile when `ArcadeUgc.isBlockedHandle(row.handle)` is true.
  - `boot`: `ArcadeUgc.onChange(reapplyAvatars)`, which reapplies avatars for the rows on screen. It does not refetch the leaderboard.
- The block list is already loaded once per page and user (`state.loaded`), so a page has at most one `GET user-blocks`.

### 2. Distinct block dialog (US2, FR-002)
- `js/ugc-client.js::openDialog(options)`: when `options.danger` is set, add `ugc-dialog--danger` to the dialog and focus `cancel` instead of `confirm`.
- The block call in `renderActions` keeps its current `text: t('ugcBlockConfirm', <existing fallback>, target.displayName)` and changes only `title: t('ugcBlockTitle', 'Block player?')`, `confirm: t('ugcBlockConfirmButton', 'Block player')` and `danger: true`.
- `css/ugc.css`: one line, `.ugc-dialog--danger .ugc-dialog__confirm{ ... }`, red background with readable contrast, using existing danger colour tokens if `css/ugc.css` or `css/portal.css` defines them.
- `js/i18n.js`: `ugcBlockTitle` (PL "Zablokować gracza?", EN "Block player?") and `ugcBlockConfirmButton` (PL "Zablokuj gracza", EN "Block player").

### 3. Own-photo cache (US3, FR-003, FR-004, FR-006, FR-007)
**Simplification (series 2):** all guards are per tab. There is no cross-tab epoch, lock or broadcast. The only cross-tab effect left is accepted under D2: a fetch that was already running in tab A when tab B changed the avatar, or signed out, can still write the old photo of the same owner. On a later page, that owner can see their own old photo only until `profile-me` confirms (D2). After a sign-out, the next signed-out page load removes every photo key. No other account can ever read it, because keys are per user ID and the hydration reads only the current user's key.

- `js/user-ui-state.js`:
  - add a separate key `kcswh:user-ui:photo:v1:<userId>` with `readPhoto(userId)`, `writePhoto(userId, { path, dataUrl })` and `clearPhoto(userId)`. `readPhoto` returns `{ available: false }` when storage is missing or throws, and `{ available: true, record: <record|null> }` otherwise. `writePhoto` returns `true` or `false`;
  - **not** added to `MAX_AGE`, `normalize`, `publish`, `acceptExternal` or the `BroadcastChannel`/`storage` handling, so no other tab rewrites or re-announces it;
  - `validPhoto(record, userId, now)` checks the following. Anything invalid is not written, and an invalid stored record is removed when it is read:
    - `version` and `userId` match;
    - `savedAt` is at most 7 days ago;
    - `path` matches `^pending/[0-9a-f-]{36}$`;
    - `dataUrl` is `data:image/webp;base64,` followed by `^[A-Za-z0-9+/]+={0,2}$`, at most 65,536 Base64 characters, with a length that is a multiple of 4;
    - the **whole** payload decodes with `atob` inside `try`. The decoded string is at most 49,152 bytes, and bytes 0–3 read `RIFF` and bytes 8–11 read `WEBP`;
  - `clearUser(userId)` also removes `photo:v1:<userId>`;
  - `setAnonymous()` removes **every** `kcswh:user-ui:photo:v1:*` key, which also covers a late write from another tab.
- `js/profile-client.js` (all state is in memory, per tab):
  - `photoPath(url)` returns `pending/<uuid>` from a URL that already passes `PHOTO_URL_RE` and the storage-origin check, and `null` otherwise;
  - `ownConfirmed[userId] = { type, path, rev }`: the last avatar confirmed in this tab. `rev` is an in-memory counter that grows on every confirmed type or path change, including A→B→A;
  - `ownPhotoLoads`: map from `userId|publicGeneration|rev|path` to the shared fetch-and-convert promise. A render after A→B→A therefore never joins the load started for the first A. When the promise settles, its entry is deleted if it is still the same entry, so a later render with a fresh link can retry. `clear()` (account switch, sign-out) increments `publicGeneration`, empties the map and empties `ownConfirmed`;
  - **Confirmation** (`ownProfileConfirmed(userId, profile)`) runs **only inside ProfileClient**:
    - from `getMe` on success, only when `seq === writeSeq` and `writesInFlight === 0` (no write or invalidation since the read started). The answer is still returned unchanged, so `profile-me` counts and #1313 behaviour stay the same. How the top bar publishes and renders an overtaken GET is today's behaviour and is not changed here;
    - from `updateMe`, in its existing `notify` branch.

    It sets `ownConfirmed[userId]`. If no record exists, or the record's path equals the confirmed photo path, the record stays. A non-uploaded avatar or a different path calls `clearPhoto(userId)`.
  - `applyAvatar(node, profile, options)`:
    - the keep-rules below (own transitional render, URL-less own marker, shortcut) are evaluated **before** `node.avatarRequest` is incremented, so keeping a node never cancels its running load. Every other call increments it. Every reset removes `data-avatar-shown-path` and `data-avatar-owner`;
    - **own URL-less marker** (`options.ownUserId` set, avatar `{ type: 'uploaded' }` without URL, as `UserUiState` publishes it and `wireAvatar` renders it on `user-ui:change`): for the same owner and generation, keep the node, including a running load. Otherwise show the stored record only if its path equals `ownConfirmed[ownUserId].path`, or nothing is confirmed yet. Otherwise use today's path;
    - **own transitional render** (`options.ownUserId` set, no avatar data): keep the node as it is when `node.dataset.avatarOwner === ownUserId` and its recorded generation is current. Otherwise use today's path. A null `ownUserId` (sign-out) or another owner resets the node;
    - **shortcut** (a photo whose path equals `node.dataset.avatarShownPath`): keep the node only if it is not an own node, or if it is the same owner and generation and the path still equals `ownConfirmed[ownUserId].path` (or nothing is confirmed yet, the D2 window). Otherwise reset and continue;
    - `options.ownUserId` set, avatar uploaded and `readPhoto(...).available` true: call `applyOwnPhoto`;
    - otherwise: today's `applyPhoto` or catalog path, plus US4. Without usable storage the plain `applyPhoto` path is used. For an own node it also records the owner and generation markers after a successful display, so the transitional-render and shortcut rules work without storage too. Every reset removes these markers.
  - `applyOwnPhoto(node, profile, userId)`:
    - **cached:** a record whose path equals the profile's path, or a hydrated `{ type: 'uploaded' }` with no URL while a record exists and nothing is confirmed yet. Show the data URL and set the shown-path and owner markers. No request;
    - **fetch:** start or join a shared load only when the profile's path equals `ownConfirmed[userId].path`. A stale profile object can therefore never fetch an older path or delete a record. The load is one `fetch` (`mode: 'cors'`, `credentials: 'omit'`, `cache: 'no-store'`, `referrerPolicy: 'no-referrer'`, `redirect: 'error'`, 15 s abort), requires `content-type` `image/webp` and at most 48 KiB, converts with `FileReader.readAsDataURL` and checks the header;
    - **completion:** this covers success **and** failure. `await currentUserId()`, then check synchronously that the user equals `userId`, `publicGeneration` and `node.avatarRequest` are unchanged, and `ownConfirmed[userId]` still has the loaded path **and** the `rev` captured at start. If any check fails, change nothing. Otherwise:
      - on success, show the image and call `writePhoto`. If it returns `false`, keep the image for this page, log `klog('profile:own_photo_not_saved')` and do not retry;
      - on failure, show today's fallback and log `klog('profile:own_photo_failed', { code })` with no URL.
- `js/auth/supabaseClient.js`:
  - `applyResolvedUser`: when `hydrated.profile` exists, render `{ displayName, avatar: hydrated.profile.avatar }`. For `uploaded`, this shows the cached photo only if `readPhoto(userId)` returns a record; otherwise it keeps today's name-only render;
  - `applyProfileAvatar(node, profile, name)` passes `{ ownUserId: state.user ? String(state.user.id) : null }`;
  - no confirmation call and no extra `profile-me` read;
  - sign-out and account switch keep calling `ProfileClient.clear()`, `ui.clearUser` and `setAnonymous`. Account deletion ends with `auth.signOut({ scope: 'local' })` in `js/account-page.js`, which reaches `applyResolvedUser(null)`, so the photo keys are removed and pending loads are discarded.
- `js/account-page.js`:
  - the owner summary and `publicProfileAvatar` calls pass `{ ownUserId }`;
  - the `!profile` branch of `renderPublicProfile` resets **both** nodes through `applyAvatar(node, null)`, so pending loads for either node are discarded;
  - the gallery and the Google preview are unchanged.

### 4. No expiry after load (US4, FR-005)
- `js/profile-client.js::applyPhoto`:
  - in `image.onload`, when the node's current request is still the one that started, clear and delete `node.profileAvatarExpiry`, show the image and set `data-avatar-shown-path`;
  - the shared `fallback` (used by `image.onerror` and the expiry timer) also checks the captured request counter, not only the URL, so a late error from an earlier `Image` never resets a newer render of the same URL;
  - drop the `Date.now() >= deadline` fallback on load. The server already refuses an expired token, so a late successful load means the image is valid;
  - the fallback and every reset or mask remove `data-avatar-shown-path`, so re-applying the same path after a mask or an error loads it again.
- Poker table photos are untouched.

## Files

`leaderboard.html`, `js/leaderboard-page.js`, `js/ugc-client.js`, `css/ugc.css`, `js/i18n.js`, `js/user-ui-state.js`, `js/profile-client.js`, `js/auth/supabaseClient.js`, `js/account-page.js`, SRI pins of `js/profile-client.js` in the non-legal `*.html` pages that pin it (37 today), `tests/ugc-client.behavior.test.mjs`, `tests/user-ui-state.behavior.test.mjs`, one existing profile-client test file (see tasks), and `docs/antigravity-evaluation.md` for delegation logs.

## Fundamental tests (extend existing files)

- `tests/ugc-client.behavior.test.mjs`: Report → Send report issues exactly one `POST ugc-report` and no `user-blocks` write. The block dialog requires an explicit confirm, and cancelling it sends nothing.
- `tests/user-ui-state.behavior.test.mjs`:
  - `writePhoto`/`readPhoto` accept only `pending/<uuid>` and a valid WebP data URL. A valid header followed by an invalid tail (for example one extra Base64 character) is rejected;
  - the limit is tested at the boundary (65,536 Base64 characters accepted, more rejected);
  - a value with an appended URL, `token=` or `?` is rejected, and so are invalid Base64, a non-WebP header, another user, and a record older than 7 days, which is also removed;
  - `clearUser` and `setAnonymous` remove it;
  - a `storage` event carrying an old photo record after removal does not restore or announce it.
- profile-client behaviour (in the existing test that loads `js/profile-client.js`, otherwise `tests/public-profile-ui.contract.test.mjs`):
  - a loaded photo is not replaced after its expiry timer;
  - the same path on a re-render issues no new image request;
  - for the owner, an unchanged cached path issues no `fetch`;
  - a changed path removes the old record first and fetches once, shared by four nodes rendered together;
  - Account confirms a catalog avatar or a new path while a top-bar fetch is still running: the late result writes nothing and changes no node;
  - a failed shared fetch is removed from `ownPhotoLoads`, and a later render with a fresh link fetches again;
  - A → B → A within one tab: a render of A after B was confirmed starts no fetch until A is confirmed again; neither the load started for B nor the still-pending load started for the first A applies after A is re-confirmed, and a new render of A starts a fresh load;
  - with storage unavailable: a name-only render keeps the own photo already shown, and a re-render of the same path does not reload it;
  - after confirmation, a `user-ui:change` render with a URL-less `uploaded` marker keeps the shown photo and does not cancel a running load;
  - two renders of the same URL on one node, then the first `Image` fails or its timer fires: the second render is kept;
  - a failed or late load after a newer render on the same node changes nothing;
  - `setAnonymous` removes every photo key, including one written late for the same user;
  - an accepted PATCH to a catalog avatar (`profile:updated`) clears the record and discards a running fetch;
  - a stale profile object with an older path neither deletes the record nor fetches;
  - a fresh ProfileClient (new page) with a valid stored record, then `profile-me` with the same path, then a new node: no `fetch`, record kept;
  - GET started → accepted PATCH (catalog) → old GET finishes: the old answer confirms nothing, and the record stays cleared;
  - a render with no avatar data for the same owner keeps the shown photo on the node and in storage. Sign-out (no `ownUserId`) resets the node;
  - account deletion: the local sign-out drives `applyResolvedUser(null)` (in the existing `tests/account-auth.contract.test.mjs` or `tests/topbar-contract.test.mjs` harness), which removes the record and leaves a running fetch writing nothing;
  - `readPhoto` throwing → plain `applyPhoto`; no record → fetch; `writePhoto` throwing → image shown, nothing stored;
  - a failed fetch after a path change leaves no old record, so the next hydration shows no stale photo;
  - a fetch that finishes after `clear()` or an account switch writes nothing and changes no node;
  - only `ownProfileConfirmed` with a catalog avatar clears the cache, and a render with no avatar does not;
  - re-applying the same path after a mask or an error loads it again;
  - with `localStorage` throwing, the plain `applyPhoto` path is used;
  - the existing `profile-me` read-count tests in `tests/account-page.test.mjs` and `tests/topbar-contract.test.mjs` still pass unchanged.
- Run: the changed test files plus `tests/account-page.test.mjs`, `tests/account-auth.contract.test.mjs`, `tests/topbar-contract.test.mjs`, `tests/leaderboard-ui.contract.test.mjs` and `tests/public-profiles.behavior.test.mjs`, one file at a time (no full suite on the VPS).

## Delegation

- Following `agents.md` (switch enabled), Antigravity implements T002–T011 in its own `agy/*` worktree from this plan.
- The coordinator reviews every diff and checks for removed or rewritten assertions. It runs the tests, takes Deploy Preview screenshots of the leaderboard, the profile, the top bar on two pages and the block dialog, and opens the Draft PR.
- Every attempt is logged in `docs/antigravity-evaluation.md`.

## Rollout

1. Draft PR, CI green, then Deploy Preview.
2. OWNER smoke on the Deploy Preview: US1–US4, plus SC-002 in the Network panel.
3. A separate OWNER GO for the Production release, following the WWW release SOP on `origin/main`.
4. No WS Preview Deploy is needed, because no `ws-server/**`, `shared/**` or protocol change is made.

**Rollback**: revert the PR. `localStorage` has no TTL, and older code neither reads nor deletes the `photo:v1` key, so the cached own photo stays on devices that used this version until the browser data is cleared. The 7 days apply only when this code reads the key. If a rollback lasts, a small cleanup release that only removes `kcswh:user-ui:photo:v1:*` keys is the fix. It needs a separate GO.
