# Poker profile avatars and future social-avatar support

Status: implementation plan only. This document does not change the poker protocol, database, Auth providers, runtime, CSP, or UI.

## Objective

Show each authenticated human player's Arcade Hub public-profile avatar and display name at the poker table. Preserve safe fallbacks for guests, bots, missing profiles, and failed images. Keep the design ready for a future owner-controlled import of Google or Facebook profile photos without making poker depend directly on either provider.

The intended ownership chain is:

```text
Google/Facebook identity (optional future input)
  -> validated server-side import
  -> Arcade Hub user_profiles + profile-avatars Storage
  -> bounded WS public-profile projection
  -> poker seat snapshot
  -> poker table renderer
```

Poker consumes only the Arcade Hub public-profile projection. It never consumes Auth metadata, provider tokens, provider image URLs, email addresses, or database avatar keys directly.

## Scope

This plan covers occupied seats in `poker/table-v2.html`, their WS read model, and the shared profile pipeline required to support them. Adding avatars to lobby table lists, chat, tournament views, bot customization, or enabling social-login buttons is out of scope until the table implementation and provider-import foundation are verified independently.

## Confirmed current state

### Profile avatar source

- `public.user_profiles` is the platform-owned profile source. It stores `display_name`, `handle`, `avatar_key`, and `avatar_variant`.
- `netlify/functions/_shared/user-profile.mjs` converts those internal fields into the public allowlist:
  - `{ type: "uploaded", url }` for an immutable processed image in the public `profile-avatars` bucket;
  - `{ type: "default", variant }` otherwise.
- The upload path in `netlify/functions/_shared/profile-avatar.mjs` accepts JPEG, PNG, or WebP up to 1 MB and 1024 by 1024 source pixels, validates the decoded image with Sharp, crops it to 256 by 256, converts it to WebP, and writes a UUID-named immutable object.
- `js/profile-client.js` already renders this public avatar contract in portal UI. Poker should reuse its semantics, not invent a second avatar model.

### Poker table gap

- `poker/poker-v2.js` currently creates `.poker-seat-avatar` and inserts initials from `displayName`; it has no image path.
- The browser already accepts optional seat naming fields, but the authoritative WS snapshots normally contain only seat identity and game metadata.
- `ws-server/poker/read-model/room-core-snapshot.mjs` projects `userId`, `seatNo`, `status`, and bot metadata. It does not join or project `user_profiles`.
- `ws-server/poker/bootstrap/persisted-bootstrap-repository.mjs` reads `poker_seats` without a profile join. The adapter and table manager therefore have no safe profile data to place in a snapshot.
- Snapshot projection is synchronous. A database read must not be added inside `projectRoomCoreSnapshot()` or repeated for every action broadcast.
- The deployed poker CSP permits images from the project's `*.supabase.co` Storage origin. It does not permit arbitrary Google or Facebook image hosts.

The missing poker avatar is therefore a read-model problem, not an image-upload problem.

## Product decisions

1. The Arcade Hub public profile is the single source of truth for a human poker identity.
2. Poker shows the current public `displayName`, `handle`, and avatar. Leaderboard visibility does not hide an avatar at a poker table because the public profile itself remains public.
3. A user-uploaded Arcade Hub avatar has precedence over any social-provider suggestion.
4. Google or Facebook photos are optional profile sources controlled by the owner. Linking or signing in with a provider must not silently replace a later user upload.
5. Provider images are copied into Arcade Hub Storage after validation. They are never hotlinked in profile or poker UI.
6. Guests and accounts missing a valid profile use initials plus the existing neutral poker-seat treatment. Bots keep an explicit bot treatment and never cause a `user_profiles` lookup requirement.
7. A broken image must fall back locally without moving the seat, hiding the player name, or affecting gameplay.
8. Profile enrichment is derived presentation data. It must not be written into `poker_state`, used by the engine, included in idempotency decisions, or affect funds and seat authority.

## Public poker seat contract

Add one nested, additive field to human seat rows:

```json
{
  "userId": "internal-existing-seat-id",
  "seatNo": 3,
  "status": "ACTIVE",
  "profile": {
    "handle": "cosmic-panda-951265",
    "displayName": "Cosmic Panda 951265",
    "profileUrl": "/u/cosmic-panda-951265",
    "avatar": {
      "type": "uploaded",
      "url": "https://<project-ref>.supabase.co/storage/v1/object/public/profile-avatars/<opaque>.webp"
    }
  }
}
```

Default-avatar example:

```json
{
  "profile": {
    "handle": "pixel-fox-123456",
    "displayName": "Pixel Fox 123456",
    "profileUrl": "/u/pixel-fox-123456",
    "avatar": { "type": "default", "variant": "fox-blue" }
  }
}
```

Rules:

- Treat `profile` as optional for backward compatibility and fail-open rendering.
- Reuse the same strict public allowlist as profile and leaderboard APIs.
- Do not serialize `avatar_key`, Supabase UUID fields beyond the already-existing poker `userId`, email, auth metadata, provider name, provider subject, provider URL, bio, or leaderboard preference.
- Reject unknown avatar types and variants while normalizing a snapshot. Use initials on rejection.
- Keep bot presentation separate from this contract. A bot may later receive an allowlisted local bot-avatar variant, but it must not masquerade as a public user profile.
- The field is public to all table viewers; it must be identical for every recipient. Only existing hole-card and legal-action fields remain recipient-specific.

## Server design

### 1. Extract a pure shared public-profile projector

Move the non-I/O normalization and avatar projection into a small shared module usable by Netlify functions and the WS service. It should accept normalized profile fields plus an explicitly supplied trusted Storage base URL and return only the public contract.

Do not make the WS server import the current full `user-profile.mjs`, because that module also owns database writes and leaderboard-visibility behavior. The shared projector must have no database client, environment reads, or mutation side effects.

Contract tests must prove that the profile endpoint, leaderboard, and poker use the same avatar-type and variant rules.

### 2. Batch-load profiles with seats

Extend the persisted bootstrap repository with a bounded join from active human `poker_seats` to `public.user_profiles`, or perform one separate `WHERE user_id = ANY($1::uuid[])` query after loading seats.

Requirements:

- one bounded profile read per table refresh, never one query per seat;
- no more profile candidates than the table's maximum of ten seats;
- no Auth-schema or browser-side profile read;
- missing rows are allowed and reported only as aggregate diagnostics;
- bot IDs are excluded before the UUID/profile query;
- SQL failures fail open to initials unless the table bootstrap itself requires the same database connection and has already failed.

Store the result as derived table-level `publicProfilesByUserId`, outside `coreState` and outside persisted poker JSON. The persisted bootstrap adapter should normalize it, while gameplay reducers should remain unaware of it.

### 3. Define freshness without querying on every action

Add an async table-manager profile refresh operation and keep snapshot projection synchronous:

- force refresh after authoritative join rehydration, because the seat set changed;
- refresh before the first snapshot on a cold table load;
- refresh on reconnect/resync when the cache is stale;
- reuse the cache for ordinary action/state broadcasts;
- use a short bounded freshness window, initially 60 seconds;
- deduplicate concurrent refreshes per table;
- on refresh failure, retain the last safe projection and log only aggregate counts/latency.

The initial implementation does not need instant cross-tab propagation. Acceptance is that a changed profile appears after rejoin/resync or the next stale-cache refresh without restarting a hand. A later authenticated `refresh_profile` WS command is permissible only if the server ignores client profile fields, reloads the caller by the JWT-bound user ID, rate-limits the command, and broadcasts the server projection.

### 4. Enrich only the public read model

Pass `publicProfilesByUserId` explicitly into `projectRoomCoreSnapshot()`. Merge an optional `profile` into each non-bot public seat after left-player filtering. Keep the authoritative `members`, engine seats, stacks, action state, persistence, and replay formats unchanged.

Update both `stateSnapshot` and `table_state` payload builders, plus state-patch tests, so the additive field survives join, action broadcasts, reconnect, and resync.

## Browser design

Update `normalizeSeatRows()` in `poker/poker-v2.js` to accept only the documented nested profile shape. Do not copy arbitrary snapshot properties into DOM state.

For each occupied human seat:

- always render a stable avatar container and player name;
- for `uploaded`, insert an `<img>` with an empty `alt` because the adjacent visible name identifies the player;
- set `decoding="async"`; eager loading is acceptable because there are at most ten visible seats;
- for `default`, set an allowlisted `data-avatar-variant` and render initials;
- on `error`, remove the failed image and restore initials without re-rendering the whole table;
- preserve the active-turn clock, winner treatment, folded opacity, cards, and chip animation layers above or around the image;
- avoid assigning untrusted URLs through HTML strings; use DOM properties after strict URL validation;
- make the profile name/avatar link to the allowlisted relative `/u/<handle>` only if the link does not interfere with poker controls and focus order.

CSS should use `object-fit: cover`, preserve the existing circular crop, and include high-contrast focus styling if a profile link is introduced. Test narrow mobile layouts and six-seat layouts so the 76 px avatar does not overlap cards or action badges.

## Google and Facebook compatibility assessment

### Feasibility

This architecture is compatible with both providers.

- Supabase supports Google and Facebook social login through `signInWithOAuth()`.
- OAuth identities expose provider metadata through `identity_data`.
- A Supabase user can have multiple linked identities; automatic and optional manual linking are supported.
- Supabase documents that `user_metadata` defaults from the first provider's identity data, but its order is not a stable selection mechanism and the field is user-editable. It must not become the poker or profile authority.

Official references:

- [Supabase Google login](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase Facebook login](https://supabase.com/docs/guides/auth/social-login/auth-facebook)
- [Supabase identities and `identity_data`](https://supabase.com/docs/guides/auth/identities)
- [Supabase users and metadata caveats](https://supabase.com/docs/guides/auth/users)
- [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)
- [Supabase social-login provider-token lifecycle](https://supabase.com/docs/guides/auth/social-login)

Provider metadata keys are not the Arcade Hub contract. Stage fixtures must capture the actual Google and Facebook `identity_data` shapes produced by the configured Supabase project, with tokens, emails, provider subjects, and real URLs redacted. The importer may support explicitly tested candidates such as `picture` or `avatar_url`, but unknown shapes must result in “no provider avatar”, not a guessed URL.

### Safe provider-avatar import

Add a server-only profile operation, conceptually `POST profile-avatar-import-provider`, that accepts only a supported provider selector such as `google` or `facebook`. It must derive the user from a verified Supabase JWT and then:

1. Read that user's matching `auth.identities` row through trusted server/database access.
2. Select the image candidate from an explicitly versioned provider adapter.
3. Require HTTPS and validate the initial host against a provider-specific allowlist.
4. Fetch with a short timeout, a small redirect limit, DNS/private-address protections, and revalidation after every redirect to prevent SSRF.
5. Stream with a strict byte ceiling; do not trust `Content-Length` or `Content-Type` alone.
6. Decode and validate with the existing Sharp limits.
7. Resize to 256 by 256 WebP and store in the existing `profile-avatars` bucket under a new UUID key.
8. Atomically update the profile avatar selection, then best-effort delete the replaced owned object.
9. Return the standard owner-profile projection and emit the existing `profile:updated` lifecycle event in the browser.

Do not store Google/Facebook provider tokens. Supabase does not refresh provider tokens for the application, and the avatar import does not require ongoing provider API access. Do not expose the provider URL to browsers or persist it as the rendered avatar URL.

### Source precedence and schema

The existing `avatar_key` can hold every processed image regardless of origin. Add minimal private provenance so automatic or explicit imports cannot overwrite an owner's choice:

```text
avatar_source: default | user_upload | google | facebook
avatar_source_identity_id: nullable private identity reference/fingerprint
avatar_source_updated_at: timestamp
```

Exact naming should be finalized with the migration. None of these fields is public.

Precedence:

1. `user_upload` remains selected until the owner explicitly chooses another source or removes it.
2. Selecting Google/Facebook imports a snapshot into Arcade Hub Storage and records that source.
3. A later OAuth login does not overwrite the stored image.
4. “Refresh provider photo” is an explicit owner action using the same secured import endpoint.
5. Removing an avatar returns to the generated default unless the owner explicitly selects a linked provider again.
6. Unlinking an identity must prevent future refresh. Product/legal review should decide whether an already imported copy is retained as an owner-selected profile asset or deleted immediately; implementation must encode and test one policy before rollout.

For a brand-new OAuth signup, the safest initial release keeps the generated Arcade Hub avatar and offers “Use Google/Facebook photo” after the first confirmed session. Automatic first-sign-in import can be evaluated later only with clear consent copy and the same validation pipeline.

## Security, privacy, and reliability requirements

- Never trust a client-supplied profile, avatar URL, provider, user ID, or Storage key.
- Never read OAuth metadata from the poker browser or include it in WS frames.
- Never hotlink provider photos. This avoids provider tracking, URL expiry, referrer leakage, CSP expansion, inconsistent caching, and table layout changes from arbitrary images.
- Keep `img-src` limited to the existing Arcade Hub/Supabase Storage origin. Add a contract test for the effective `/poker/*` CSP rather than adding Google/Facebook CDN wildcards.
- Use immutable UUID object names and existing long-lived cache headers; an avatar update gets a new URL and naturally invalidates clients.
- Do not make profile availability a gameplay, reconnect, or cash-out dependency. Initials are always a valid fail-open state.
- Do not log handles, provider URLs, identity data, emails, raw image contents, or high-cardinality user IDs. Log table-level counts, source type, status code, bytes rejected, and latency only where needed.
- Preserve the existing profile upload limits and decompression-bomb protection for provider imports.
- Apply rate limits and idempotency to provider import/refresh requests.
- Review Google/Facebook platform terms, consent copy, privacy policy, and deletion behavior before enabling either provider in production.

## Delivery sequence

### PR 1: Shared projection and protocol contract

- extract the pure public-avatar/profile projector;
- define and document the optional poker seat `profile` field;
- add allowlist, privacy, and compatibility tests;
- no browser behavior change yet.

### PR 2: WS profile hydration

- add the bounded seat/profile batch read;
- add derived table-level profile cache and refresh lifecycle;
- enrich public snapshots and patches;
- cover cold load, join, reconnect, resync, missing profile, bot, and database-failure fallbacks.

### PR 3: Poker table rendering

- normalize the additive profile field;
- render uploaded and default avatars with resilient fallback;
- add CSS and accessibility behavior;
- add DOM/Playwright coverage for multiple players, image failure, turn clock, mobile layout, reconnect, and avatar update after refresh.

### PR 4: Optional social-avatar import foundation

- add private avatar-source provenance migration;
- implement provider adapters and the secured remote-image ingestion path;
- add account UI source selection and explicit refresh;
- do not enable Google/Facebook buttons until provider configuration, redirect allowlists, consent, deletion policy, and stage verification are complete.

Google and Facebook may be separate rollout PRs after the shared import foundation because their metadata shapes, host allowlists, console setup, and platform review requirements differ.

## Test matrix

### Unit and contract tests

- uploaded/default public avatar projection parity across profile API, leaderboard, and poker;
- strict rejection of unknown avatar types, variants, schemes, hosts, and malformed profile URLs;
- no private profile/auth fields in serialized poker seats;
- one profile batch for up to ten human seats and zero lookups for bot-only tables;
- deterministic missing-profile and SQL-failure fallback;
- unchanged gameplay core state and persisted poker JSON;
- uploaded image error restores initials while preserving the turn clock;
- ties between `table_state`, full `stateSnapshot`, and `statePatch` profile data.

### WS integration tests

- existing seated players receive profiles on cold bootstrap;
- a newly joined player appears with a profile after authoritative rehydration;
- every observer receives the same public profile projection;
- reconnect/resync refreshes stale profile data;
- normal actions do not cause profile queries;
- profile lookup failure does not reject join, act, leave, reconnect, or cash-out;
- bot and guest seats never expose another user's cached profile.

### Provider import tests

- Google and Facebook stage fixtures map only allowlisted fields;
- unsupported/missing identity returns a controlled error;
- JWT user cannot select another user's identity;
- user upload precedence is preserved;
- HTTPS, DNS, redirect, timeout, byte, MIME, decoded-format, dimension, and pixel limits are enforced;
- SVG, HTML, polyglot, oversized, redirect-to-private-network, and decompression-bomb inputs are rejected;
- imported object is WebP in Arcade Hub Storage and provider URL is absent from public payloads;
- retries do not leak orphaned objects and replacement cleanup is safe;
- linked-identity removal follows the chosen retention policy.

### Stage acceptance

1. Set a generated avatar and join a table from two browsers; both see the same default variant and display name.
2. Upload a custom avatar, resync/rejoin, and verify all table viewers receive the new immutable URL.
3. Force the image request to fail and verify initials, name, controls, turn ring, and gameplay remain usable.
4. Exercise six seats with humans and bots on desktop and mobile.
5. Verify snapshots contain no email, bio, Auth metadata, provider URL, Storage key, or provider token.
6. Confirm ordinary action traffic does not increase profile SQL reads.
7. When social import is implemented, repeat with one Google and one Facebook test identity, linked and unlinked identity flows, user-upload precedence, and provider-photo refresh.
8. Verify the deployed `/poker/*` CSP loads only the copied Supabase Storage image and requires no Google/Facebook image-domain additions.

## Rollout and rollback

- Roll out the optional WS field before enabling the browser renderer; old clients ignore it.
- Monitor aggregate profile-cache hit/miss, load latency, missing-profile counts, image failures, and snapshot size.
- Set a snapshot-size budget before implementation; ten small profile projections should remain well below protocol limits.
- If WS enrichment causes problems, disable profile hydration and continue sending seats without `profile`; clients fall back to initials and gameplay remains unchanged.
- If the renderer causes problems, disable image rendering while retaining names and initials.
- Social-avatar import must have its own feature flag. Disabling it stops new imports without breaking already stored Arcade Hub avatars.
- Rollback must never delete canonical profiles, user uploads, poker seats, poker state, or ledger data.

## Definition of done

- Every authenticated human with a valid Arcade Hub profile is shown at the poker table using the same display name and avatar seen on `/u/<handle>`.
- Guests, bots, missing profiles, invalid payloads, and failed image requests have intentional non-blocking fallbacks.
- Join, actions, reconnect, resync, leave, settlement, and cash-out remain independent of profile availability.
- Snapshot and DOM tests prove that no private identity fields are added.
- Profile queries are bounded and absent from ordinary per-action broadcasts.
- The design can import Google/Facebook photos into the same platform-owned avatar pipeline without hotlinking or poker-specific provider logic.
- No provider is enabled until stage fixtures, consent, CSP, redirect, deletion, and platform-policy checks pass.
