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

### 3. Own-photo cache (US3, FR-003, FR-004, FR-006, FR-007), simplified
Owner-only staleness is accepted under D2. There are no cross-tab, revision or write-sequence guards.

- `js/user-ui-state.js`:
  - `readPhoto(userId)` returns `{ available: false }` or `{ available: true, record }`;
  - `writePhoto(userId, { path, dataUrl })` returns `true` or `false`;
  - `clearPhoto(userId)` removes the record;
  - one `validPhoto` helper (FR-003) is used on write and read; an invalid stored record is removed when read;
  - `clearUser` removes the user's key, and `setAnonymous` removes all `kcswh:user-ui:photo:v1:*` keys;
  - the photo key is not added to `MAX_AGE`, `publish` or the broadcast.
- `js/profile-client.js`:
  - `photoPath(url)` returns `pending/<uuid>` for a URL that already passes `PHOTO_URL_RE` and the storage-origin check;
  - `photoLoads`: map from `userId|path` to one in-flight download promise, deleted when it settles. The download is one `fetch` (`mode: 'cors'`, `credentials: 'omit'`, `cache: 'no-store'`, `referrerPolicy: 'no-referrer'`, `redirect: 'error'`, 15 s abort), requires `image/webp` and at most 48 KiB, and converts with `FileReader.readAsDataURL`;
  - `applyAvatar(node, profile, options)` with `options.ownUserId` and usable storage applies FR-004 rules 1–4:
    - rule 1: `record.path === path` shows `record.dataUrl`;
    - rule 2: set `node.dataset.avatarWant = path`, then take or start the download. On settle, `await currentUserId()` and continue only if the user is unchanged, `publicGeneration` is unchanged and `node.dataset.avatarWant === path`. Then show and `writePhoto`, or show the fallback on failure;
    - rule 3: a URL-less `uploaded` marker shows the record if one exists;
    - rule 4: an avatar of type `default` removes the record; a profile with no `avatar` field removes nothing;
  - every reset clears `data-avatar-want` and the shown-path marker;
  - without usable storage, or without `ownUserId`, today's `applyPhoto`/catalog path applies, plus FR-005;
  - errors log `klog('profile:own_photo_failed', { code })` with no URL.
- `js/auth/supabaseClient.js`:
  - `applyResolvedUser` renders `{ displayName, avatar: hydrated.profile.avatar }` when a hydrated profile exists;
  - `applyProfileAvatar` passes `{ ownUserId: state.user ? String(state.user.id) : null }`;
  - nothing else changes. Sign-out and account switch keep calling `ProfileClient.clear()`, `ui.clearUser` and `setAnonymous`, and account deletion reaches the same path through `auth.signOut({ scope: 'local' })`.
- `js/account-page.js`: the owner summary and `publicProfileAvatar` calls pass `{ ownUserId }`.

### 4. No expiry after load (US4, FR-005)
- `js/profile-client.js::applyPhoto`:
  - in `image.onload`, after the existing URL check, clear and delete `node.profileAvatarExpiry`, show the image and set `data-avatar-shown-path`;
  - drop the `Date.now() >= deadline` check on load;
  - at the top of `applyAvatar`, a photo whose path equals `data-avatar-shown-path` returns without a reset;
  - every reset, fallback or mask removes the marker.
- Poker table photos are untouched.

## Files

`leaderboard.html`, `js/leaderboard-page.js`, `js/ugc-client.js`, `css/ugc.css`, `js/i18n.js`, `js/user-ui-state.js`, `js/profile-client.js`, `js/auth/supabaseClient.js`, `js/account-page.js`, SRI pins of `js/profile-client.js` in the non-legal `*.html` pages that pin it (37 today), `tests/ugc-client.behavior.test.mjs`, `tests/user-ui-state.behavior.test.mjs`, one existing profile-client test file (see tasks), and `docs/antigravity-evaluation.md` for delegation logs.

## Fundamental tests (extend existing files)

- `tests/ugc-client.behavior.test.mjs`: Report → Send report issues exactly one `POST ugc-report` and no `user-blocks` write. The block dialog requires an explicit confirm, and cancelling it sends nothing.
- `tests/user-ui-state.behavior.test.mjs`:
  - `writePhoto`/`readPhoto` accept only `pending/<uuid>` and a valid WebP data URL. A valid header followed by an invalid tail (for example one extra Base64 character) is rejected;
  - the limit is tested at the boundary (65,536 Base64 characters accepted, more rejected);
  - a value with an appended URL, `token=` or `?` is rejected, and so are invalid Base64, a non-WebP header, another user, and a record older than 7 days, which is also removed;
  - `clearUser` removes the user's record and `setAnonymous` removes all photo records.
- profile-client behaviour (in the existing test that loads `js/profile-client.js`, otherwise `tests/public-profile-ui.contract.test.mjs`):
  - a loaded photo is still shown after its expiry timer;
  - the same path on a re-render issues no new image request;
  - own photo, record with the same path: no `fetch`;
  - own photo, new path, two nodes together: one `fetch`, both shown, record saved;
  - a download finishing after `clear()` or an account switch writes nothing and changes no node;
  - a catalog avatar removes the record; a name-only render does not;
  - a URL-less `uploaded` marker shows the stored record;
  - `localStorage` throwing → plain `applyPhoto`;
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
