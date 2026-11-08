# #1140 UGC safety — plan

Small Draft PRs. Server parts build on `main` (they need only `auth.users` and `public.user_profiles`); UI parts
build on the profile UI of #1160 because #1155/#1160 rewrote `js/account-page.js` and `js/profile-client.js`.

## Phase B — Report / Block

**PR B1 (server, base `main`)**
- `supabase/migrations/20261107120000_ugc_reports_blocks.sql`: `private.user_blocks` (pk blocker+blocked, no self,
  both `on delete cascade`) and `private.ugc_reports` (fixed reason/context codes, `table_id` only for table
  context, server `evidence` jsonb, status `pending|resolved|dismissed` with `resolved_at` consistency, one open
  report per pair via partial unique index; reporter `on delete set null`, target `on delete cascade`). RLS on,
  no grants to `anon`/`authenticated`; `service_role` select/insert/update (reports), select/insert/delete (blocks).
  Entry in `supabase/production-migrations/manifest.json` `forward_only`.
- `netlify/functions/_shared/ugc-safety.mjs`: `parseTarget`, `createReport`, `listBlocks`, `blockUser`
  (advisory lock per blocker for the cap), `unblockUser`, `ugcSafetyEnabled`; `assertAccountActive` when the
  deletion lifecycle is enabled.
- `netlify/functions/ugc-report.mjs` (POST) and `netlify/functions/user-blocks.mjs` (GET/POST/DELETE): existing
  CORS, `verifySupabaseJwt`, `atomicRateLimitIncr` with a hashed user key and one-hour TTL, `klog`.
- `tests/ugc-safety.behavior.test.mjs` (PGlite with the real migration), registered in `scripts/test-all.mjs`.

**PR B2 (UI, base #1160)**
- `js/ugc-client.js` (IIFE, `window.ArcadeUgc`): token from the existing Supabase client, `report`, `block`,
  `unblock`, `blockedIds` (cached once per page).
- Public profile in `js/account-page.js`: Report (reason dialog, confirmation) and Block/Unblock; Account section
  "Blocked players" with Unblock. `account.html`: script tag and the section container.
- Table `poker/poker-v2.js`: Report/Block on a seat through the existing seat/target UI; blocked users' avatar
  masked and their reactions/gifts not rendered on this client only. `poker/table-v2.html`: script tag.
- `js/i18n.js` PL/EN, `css` one line per selector; `mobile/poker/package-web.mjs` packages the new script for the
  APK. External script only, so no CSP hash change.

## Phase C — Moderation (PR C1 server + PR C2 admin UI)

- Migration: `private.ugc_moderation_actions` (report id, admin user id, action `resolve|dismiss|hide_avatar|
  restrict_profile|restore`, time); hide uses the existing `google_photo_suppressed`/avatar fallback and restrict
  uses `public_profile_blocked` through a security-definer function guarded for the admin role only.
- `netlify/functions/admin-ugc-reports.mjs` (list/act) behind the existing `admin-me` authorization.
- `admin.html` / `js/admin-page.js`: queue tab, filters by status, action buttons, audit list.
- Weekly digest: reuse an existing scheduler/mail path if one exists (to verify: Netlify scheduled functions,
  existing mail provider); otherwise propose the smallest option for owner decision before building anything.

## Phase D — Google avatar consent (PR D1 server + PR D2 UI)

- Consent record next to Terms receipts (version, granted/withdrawn time); import once on grant through the existing
  avatar finalize path; withdrawal sets the Arcade fallback and stops imports; moderator hide wins.
- Onboarding (`js/profile-onboarding.js`) after Google sign-in: separate unticked checkbox; Account toggle to
  withdraw.

## Dependencies and gates

- Stage apply of each migration: separate owner DB Stage Apply PR dispatch. Production: separate GO.
- Activation (`UGC_SAFETY_ENABLED=1` outside previews) after Privacy/Terms describe reports, blocks, moderation
  and consent (legal), and after phase C exists: reports without a moderation queue are not "ongoing moderation".
- WS unchanged. If owners want blocks enforced on the server (e.g. reactions never delivered), that is a separate
  WS decision.
