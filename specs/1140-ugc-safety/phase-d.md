# #1140 UGC phase D — voluntary Google profile photo (WWW)

Owner GO 2026-11-07: voluntary import of the Google profile photo with explicit consent, withdrawal and a safe
fallback to the Arcade avatar; existing architecture, minimal changes, fundamental tests, Draft PR, no deployment
or activation, no e-mail, job, scheduler or notification. Follows the Google photo model of
`specs/1114-arcade-profiles-avatars/plan.md` (there called "Faza C").

## Requirements
- **R-D-CONSENT.** Separate, unticked, voluntary choice on the Account page, sent with the import request
  (`consent: true`, current `noticeVersion`). Sign-in, a callback or a page load never imports or grants anything.
  One record per account in `private.profile_photo_consents`: decision `granted|withdrawn`, notice version,
  `granted_at`/`withdrawn_at`, `consent_revision`, the imported key. No record = no consent.
- **R-D-PROOF.** The current Google `provider_token` of the same browser session must return, from the fixed
  userinfo endpoint `openidconnect.googleapis.com/v1/userinfo`, the same `sub` as the account's server-side Google
  identity (`auth.identities`). `user_metadata`, e-mail and client URLs are not trusted. Without a token the page
  offers "Confirm with Google" (a fresh Google sign-in) and the user ticks the box again.
- **R-D-FETCH.** Photo only from `https://lh3–lh6.googleusercontent.com` (no port, no redirects, 5 s timeout,
  ≤ 1 MiB streamed), no credentials sent to the image host; re-encoded by the existing avatar normalizer (JPEG/PNG/
  WebP, one frame, ≤ 1024², 256² WebP without metadata) and stored in the existing `profile-avatars` bucket
  (cache ≤ 1 h). Never hot-linked. Provider token, Google URL and image are never logged or stored.
- **R-D-SAFE.** Before any network call and again at attach under the lifecycle and profile row locks: active
  account, current Terms, no moderator avatar hold (phase C `private.ugc_avatar_holds`; without that table the
  import fails closed), the same Google identity, unchanged `avatar_revision` (a newer avatar choice or a moderator
  action wins; the new copy is deleted). The write uses the existing V3 avatar manifest protocol
  (`profile_avatar_uploads`: intent while active, output started before the write, finished when confirmed; a lost
  response stays uncertain), so an account deletion waits for or reconciles it; with tracking off the key is listed
  in `private.account_avatar_objects`. 5 imports per account and hour.
- **R-D-ONE-COPY.** At most one Google copy exists and it is always findable: the key is listed in
  `private.profile_photo_pending_deletions` before the write and unlisted only by a successful attach or a
  confirmed deletion; a failed import deletes its own object after the write (and lists it again if that fails).
  A new import is refused (409 `photo_copy_exists`) while a copy exists; changing the photo = withdraw, then import.
- **R-D-WITHDRAW.** Withdrawal (also with pending Terms) shows the Arcade avatar at once, sets
  `google_photo_suppressed`, bumps `avatar_revision` (a running import loses its attach), records the time and
  deletes our copy and any listed copy. The key stays on the record until the deletion is confirmed; a failure is
  reported (`copyDeleted: false`) and the next withdrawal retries. Later sign-ins never re-import. Choosing an Arcade
  avatar (phase A) also detaches the photo; the copy stays until withdrawal. Refused (409 `account_deleting`) once
  deletion has started (the deletion purge removes it).
- **R-D-SHOW.** WWW only (Account, topbar, public profile, leaderboard): a photo is shown only while consent is
  granted, the imported key is still the profile's avatar and the user did not choose a catalog avatar since; a read
  failure shows the Arcade avatar. Poker tables keep the Arcade avatar: the shared projection used by the WS server
  is unchanged (a WS change needs a separate decision).
- **Dark:** `GOOGLE_PHOTO_IMPORT_ENABLED=1` per Netlify context; otherwise the endpoint answers 404, readers add no
  query and the panel stays hidden.

## Dependencies and gates
- Base #1160 (on #1155: `avatar_revision`, `google_photo_suppressed`, Terms). Runtime also needs phase C (#1216) for
  the moderator hold; without it the import is refused.
- Owner: Stage apply of `20261107140000_google_photo_consent.sql` (DB Stage Apply PR dispatch); Production separate
  GO. Privacy text for the photo, its source and withdrawal before activation (legal). Google OAuth scopes are
  unchanged (`openid email profile`).
- Physical check (owner): WWW Google sign-in → import → profile/leaderboard → withdraw; Android: whether the
  in-app Google sign-in returns a `provider_token`. If it does not, the import stays unavailable in the APK
  ("Confirm with Google" does not help) and Auth linking is not changed in its place.

## Tasks
- [x] D-T1 Migration (consent record), RLS, grants, cascade, manifest entry; migration check PASS.
- [x] D-T2 `_shared/profile-google-photo.mjs` + `profile-google-photo` endpoint; `_shared/profile-photo-publication.mjs`
  read side for `profile-me`, `profile-public` and the leaderboard; normalizer extracted from `finalizeAvatar`.
- [x] D-T3 Account panel `js/profile-google-photo.js`, photo rendering in `js/profile-client.js`, PL/EN strings.
- [x] D-T4 Fundamental tests (PGlite with the real migration; UI with a minimal DOM); mutation-checked.
- [x] D-T6 Review: Codex 3 rounds (R1 4, R2 1, R3 1 findings, all fixed); the R3 fix was checked by agy (1 valid
  race fixed, 2 rejected with reasons) and by mutation tests, not re-reviewed by Codex (round limit).
- [ ] D-T5 Owner: Stage apply, `GOOGLE_PHOTO_IMPORT_ENABLED=1` on a Preview, physical WWW and Android check.
