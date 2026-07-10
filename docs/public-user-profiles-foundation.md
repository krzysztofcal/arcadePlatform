# Public User Profiles Foundation

## Executive Summary

This plan creates a safe public gaming identity for every authenticated Arcade Hub user and prepares the contract used by a future XP leaderboard. It does not implement leaderboard ranking, XP aggregation, or public XP values.

Every authenticated account receives a public profile automatically. A profile has a generated gaming name, a permanent public handle, a default avatar identity, and an empty bio. It must never expose email, Supabase user UUID, chip balances, ledger entries, poker data, session data, IP address, or copied auth metadata.

**Privacy decision required before implementation:** every authenticated profile will be public and reachable at `/u/<handle>`. This must be explicitly approved as product policy and checked against Terms and Privacy wording before PR 1 is merged.

## Current Repository Fit

The implementation should extend existing patterns rather than create parallel client infrastructure:

- `account.html` and `js/account-page.js` already own authenticated account UI and localized field/status rendering.
- `js/auth/supabaseClient.js` centralizes the Supabase client, session reads, and auth-change listeners. Its current avatar is an initials monogram derived from auth metadata and must be replaced for authenticated users by profile data, never by email.
- `js/topbar.js` owns topbar placement; profile refresh should subscribe through the existing auth bridge, not add a second independent auth subscription.
- Netlify functions already use trusted server-side access and `klog`; public responses must be explicit allowlists rather than raw rows.
- Supabase migrations use timestamped files in `supabase/migrations/`. Existing database access is intentionally server-mediated for sensitive data.
- `netlify.toml` contains Netlify redirect conventions and CSP policy. New JavaScript remains root-absolute external IIFE scripts; any changed inline script requires a CSP hash update.
- `js/i18n.js` and `langchange` are the existing PL/EN localization mechanism.
- `docs/operations.md` and `docs/ai-agent-db-migration-checklist.md` define the structural migration check, stage apply workflow, and preview verification procedure.

`skills.md` remains useful as a high-level map but has stale XP path examples. This work should use actual current files above when implemented.

## Product Contract

### Public identity

1. Every authenticated user has exactly one profile.
2. There is no private-profile mode and no profile-setup gate in this MVP.
3. Missing profiles are created lazily during `GET profile-me` and at the existing safe authenticated topbar/profile refresh path.
4. Initial values are generated server-side from curated local words and secure randomness:
   - `display_name`: adjective + noun + short number, such as `BlueFox27`.
   - `handle`: lowercase normalized equivalent, such as `bluefox27`.
   - `avatar_variant`: a curated built-in default such as `fox-blue`.
   - `bio`: empty string.
5. No generated or displayed value may derive from email, email prefix, Supabase UUID, IP address, or real name in auth metadata.
6. Profiles are public to anyone knowing the handle at `/u/<handle>`.

### Stable handles

- Handles are public, externally persistent identifiers.
- A generated handle may be customized exactly once by its owner.
- After the first successful custom value, it becomes immutable; further attempts return `handle_locked`.
- Display name and bio remain editable.
- Do not add recurring handle changes or handle history in this MVP.

## Data Model and Migration

PR 1 adds a timestamped migration creating `public.user_profiles`:

```text
user_id uuid primary key references auth.users(id) on delete cascade
handle text not null
display_name text not null
bio text not null default ''
avatar_key text null
avatar_variant text not null
handle_customized_at timestamptz null
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
```

Required constraints and indexes:

- Case-insensitive unique handle index, for example on `lower(handle)`.
- Server normalization to lowercase before write.
- Handle validation: 3-24 characters, `a-z`, digits, `_`, and `-` only.
- Reserved-handle validation at least for `admin`, `api`, `account`, `profile`, `poker`, `xp`, `login`, `logout`, `settings`, `support`, `about`, and `leaderboard`.
- Display name: 2-40 characters after trim.
- Bio: maximum 160 characters.
- A trigger or server-owned update statement maintains `updated_at`.

Do not add email, XP, chips, ledger, poker statistics, visibility, `is_public`, or copies of auth metadata.

Enable RLS and deny direct `anon` and `authenticated` table access. Netlify functions are the only public/owner view boundary and use the existing trusted server-side Supabase/Postgres path. The migration must follow the repository's established auth-user deletion convention.

## Shared Server Helper

Add `netlify/functions/_shared/user-profile.mjs` in PR 1. It should be small and own:

- curated adjective, noun, and default-avatar-variant lists;
- secure random selection using the Netlify Node runtime primitive;
- handle normalization and all validation errors;
- reserved-handle lookup;
- public-row projection;
- generated identity creation with bounded uniqueness retries;
- lazy `ensureUserProfile(authenticatedUserId)` creation.

The generator must retry a finite number of handle collisions and return a controlled server error if exhausted. Do not use hashes of user IDs, external nickname services, or client-generated identity values.

## API Contracts

Use separate Netlify functions and current CORS/auth/JSON conventions.

### `GET /.netlify/functions/profile-public?handle=<handle>`

No authentication required. Normalize and validate the handle, return `404` for an unknown profile, and return only:

```json
{
  "handle": "bluefox27",
  "displayName": "BlueFox27",
  "bio": "",
  "avatar": { "type": "default", "variant": "fox-blue" }
}
```

For a processed uploaded avatar, `avatar` becomes `{ "type": "uploaded", "url": "<stable-public-webp-url>", "variant": "fox-blue" }`. Do not return `user_id`, timestamps, auth metadata, email, chips, ledger, poker, XP, or internal storage paths.

### `GET /.netlify/functions/profile-me`

Require a valid Supabase JWT via the existing server helper. Lazily create a missing profile and return the editable owner contract, including `handleCanBeCustomized` and the safe avatar model. It must not return raw auth data.

### `PATCH /.netlify/functions/profile-me`

Require the same authentication. Permit display-name and bio updates; permit a handle update only when `handle_customized_at` is null. Validate, normalize, and produce controlled errors:

- `unauthorized`
- `invalid_handle`
- `handle_taken`
- `reserved_handle`
- `handle_locked`
- `invalid_display_name`
- `bio_too_long`

Updates need an atomic conditional write for the handle lock so two concurrent owner requests cannot consume the one permitted customization twice.

All public and owner responses are constructed field-by-field. No function may serialize a database row directly.

## Avatar Design

### Default avatars (PR 2)

Uploaded avatars are not required for a valid profile. The frontend renders every default avatar from `avatar_variant` using curated static assets or a CSS-rendered variant. The same rendering helper is used by account UI, topbar, public profile, and later leaderboard rows.

Default avatar variants must not encode a UUID, email, or other personal identifier. An empty `avatar_key` always resolves to a usable default visual.

### Upload pipeline (PR 3)

Use a two-stage pipeline.

1. Create private `profile-avatar-uploads` Storage bucket for temporary originals.
2. `profile-avatar-upload-url` requires a valid JWT, ensures the profile exists, validates declared MIME and size, and issues a short-lived user-scoped signed upload URL.
   - Allow only JPEG, PNG, and WebP.
   - Reject SVG, GIF, unknown MIME, and files over 1 MB.
   - The browser never receives service-role credentials.
3. `profile-avatar-finalize` requires the same JWT and only operates on that user's pending object.
   - Inspect actual file type instead of trusting the upload header.
   - Enforce dimensions up to 1024x1024.
   - Strip metadata, normalize to a 256x256 WebP, and write a processed result.
   - Use an opaque random processed key, never a raw user UUID.
   - Update `user_profiles.avatar_key`, safely remove/replace the preceding processed avatar, and delete the temporary source.
4. Create public read-only `profile-avatars` bucket for normalized processed WebP only. Its stable public URL is safe to cache and suitable for leaderboard lists.

The public bucket is safe because it contains only server-normalized WebP, no SVG, no EXIF, no originals, and no internal identifier in its path. Clients cannot overwrite processed objects.

Before choosing an image processor, inspect installed dependencies and Netlify bundle/runtime limits. Reuse an existing suitable package. If none is available or image processing is unsuitable for the runtime, stop and document the smallest supported alternative; do not publish an unvalidated source image or silently skip metadata removal.

## Frontend Work

### Account editor (PR 2)

Extend the current `account.html` and `js/account-page.js` authenticated account panel with a localized **Public profile** section:

- current default/uploaded avatar;
- display name;
- generated or customized handle;
- `/u/<handle>` preview;
- bio;
- save action, per-field errors, loading and saving state;
- disclosure that profiles are public while email and account details are never public;
- explicit confirmation before the first custom handle change;
- locked handle field after customization.

Do not make setup mandatory. Use DOM APIs and `textContent` for user data, retain the plain-script/IIFE style, use `klog` for diagnostics, and keep CSS to one physical line per selector.

### Public route and page (PR 2)

Add `profile.html`, an external profile-page controller, and narrowly scoped CSS only where `portal.css` is insufficient. Add a `netlify.toml` rewrite from `/u/:handle` to `/profile.html`, then resolve route state using the existing routing conventions.

The view displays avatar, display name, `@handle`, and optional bio only. It has generic loading, not-found, and network-error states. It does not display XP, rank, chips, poker data, account metadata, or timestamps.

Use semantic heading structure, meaningful avatar alternative text, keyboard-safe controls, `aria-live` status messaging, and no color-only state. Add all PL/EN keys through the current i18n mechanism.

### Topbar integration (PR 2)

Replace email-derived labels for authenticated users with loaded public-profile display name and avatar. A missing profile triggers the safe authenticated `profile-me` read/create path. Reuse the centralized auth-change listener in `js/auth/supabaseClient.js`; do not add independent listeners. Profile saves invalidate the profile cache and refresh topbar rendering. Guests keep the current generic Arcade Hub state.

## Future Leaderboard Contract

This task does not implement a leaderboard. Document this contract in the profile documentation and use it later:

```text
rank
handle
displayName
avatarUrl or avatar model
xp
optional level
```

The leaderboard backend will aggregate XP server-side and join identities to `user_profiles` server-side. It must never expose email or Supabase UUID, never require browser access to Redis or `auth.users`, and link each row to `/u/<handle>`.

## Delivery Plan

### PR 1: Profile data and API foundation

- Migration for `user_profiles`, constraints, RLS, and timestamps.
- Shared profile helper and generated identity.
- `profile-public` and `profile-me` endpoints.
- Documentation of public/private data and leaderboard contract.
- Stage migration plus API smoke verification.

### PR 2: Profile UI and public route

- Account editor and profile cache.
- Default avatar rendering.
- `/u/<handle>` rewrite, `profile.html`, and public page controller.
- Topbar integration and PL/EN localization.
- No uploaded-avatar support yet.

### PR 3: Avatar upload pipeline

- Private temporary bucket and signed-upload endpoint.
- Finalization endpoint, type/dimension validation, metadata stripping, and WebP normalization.
- Public processed-avatar bucket and safe replacement/removal.
- Upload/remove account UI.

### PR 4: XP leaderboard

Out of scope. Begin only after public profiles and avatars are stable in production.

## Verification and Rollout

Do not add automated tests during this planning-only change. Each implementation PR must include deterministic manual verification plus existing checks:

1. Run `npm test` and `npm run check:all`.
2. Use the syntax check recorded in `skills.md`/the repository test runner.
3. For a migration, run `node scripts/check-db-migrations.mjs`, wait for `DB Migration Check` and `DB Stage Apply PR`, then use the matching Netlify Deploy Preview against stage.
4. Complete stage smoke verification before applying production migration according to `docs/operations.md`.

Manual smoke checklist:

1. An existing authenticated account without a row receives a generated identity.
2. Generated handle/display name contain no email or UUID fragment.
3. `/u/<handle>` loads and its API response has no `user_id`, email, chips, or metadata.
4. Unknown handles return `404`.
5. Display name and bio update correctly.
6. The first handle customization succeeds only after confirmation; a second returns `handle_locked`.
7. A default avatar always renders with no uploaded file.
8. Topbar refreshes after profile update and after auth transition.
9. PL and EN render correctly.
10. Existing account, XP, chips, and poker paths remain unaffected.
11. In PR 3, reject oversized/unsupported avatar files; verify processed output is stable public WebP and the original is not public.

Rollback: disable the new route/rewrite only if necessary, leave existing account auth flows intact, and do not delete `user_profiles` data merely to roll back UI. Avatar rollback must revoke/remove public processed objects only after confirming the account editor no longer references them.

## Breaking Impacts

- Authenticated topbar labels may change from email-derived values to generated gaming identities.
- Every authenticated account becomes publicly discoverable by its handle; this requires explicit privacy-policy approval and potentially Terms/Privacy updates before launch.
- Handles become externally persistent URLs and can only be customized once.
- The `/u/:handle` rewrite can conflict with future routes; reserved handles and deployment smoke checks are mandatory.
- Profile creation adds a write to the first authenticated profile/topbar access.
- Avatar processing introduces Storage configuration and potentially a runtime image-processing dependency.
- A future leaderboard will include every authenticated profile unless a later product rule introduces an opt-out.
