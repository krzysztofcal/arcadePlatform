# Poker bot avatars

Status: planning only. Avatar assets are owner-provided and are not part of this documentation PR. Do not begin implementation until the asset handoff in Phase 0 is complete.

## Objective

Show a local illustrated avatar for every occupied poker bot seat in `poker/table-v2.html`, while preserving the current initials fallback and all human-profile avatar behavior.

The implementation should be a presentation-only enhancement. Bot avatars do not need accounts, public profiles, database rows, remote image URLs, or new poker state. The browser can select a trusted local asset deterministically from identity data already present in the seat snapshot.

## Scope

In scope:

- owner-provided avatar images for live poker bot seats;
- deterministic assignment so the same bot `userId` has the same avatar across snapshots, reconnect, and resync for a fixed asset catalog;
- reuse of the existing poker seat `<img>` loading and initials fallback behavior;
- same-origin static asset loading;
- desktop and mobile table presentation.

Out of scope:

- generating avatar art or using AI image generation;
- human, guest, public-profile, lobby, leaderboard, or topbar avatar changes;
- bot display names or personality labels;
- storing bot avatars in `public.user_profiles`;
- database migrations, Storage uploads, new environment variables, or runtime configuration;
- poker engine, ledger, settlement, autoplay, or bot policy changes;
- WebSocket payload, snapshot, patch, replay, or persisted poker-state changes;
- new automated tests.

## Repository analysis

### Poker bot identity

- `shared/poker-domain/bots.mjs` creates bot UUIDs and persists bot seats with `is_bot` and `bot_profile`.
- Initial bot IDs are deterministically derived from table ID and seat number. Broke-bot replacement in `ws-server/poker/engine/poker-engine.mjs` deliberately creates a new UUID, which is an appropriate identity boundary for a potentially different avatar.
- `bot_profile` represents play style (`TIGHT`, `NORMAL`, or `LOOSE`, with legacy values normalized by the bot policy). It is behavior configuration, not presentation identity.
- Bot metadata is restored by `ws-server/poker/bootstrap/persisted-bootstrap-adapter.mjs` into `seatDetailsByUserId`.

### Snapshot contract

- `ws-server/poker/read-model/room-core-snapshot.mjs` and `ws-server/poker/read-model/state-snapshot.mjs` already expose `userId`, `seatNo`, `status`, optional `isBot`, and optional `botProfile` for bot seats.
- Human seats may additionally carry the optional minimal `profile` projection. Both snapshot projectors intentionally refuse to attach a human public profile to a bot.
- The existing `userId` plus `isBot` fields are sufficient for local deterministic avatar selection. Adding an avatar URL or avatar key to the WS contract would duplicate derivable presentation state.

### Browser normalization and rendering

- `poker/poker-v2.js::normalizeSeatRows()` preserves `userId` and recognizes bots from authoritative `isBot` metadata, with its existing legacy ID-pattern fallback.
- `poker/poker-v2.js::renderSeatAvatar()` first renders initials, then handles human generated variants or an uploaded image. Initials remain visible until an image loads; an image error removes the failed image and restores initials.
- `getDisplayName()` currently labels bots as `Bot`, so the fallback is `BO`. This behavior should remain unchanged.
- `renderSeats()` creates a new avatar element for each seat render, so no previous occupant's image or data attribute is reused.
- `.poker-seat-avatar__image` in `poker/poker-v2.css` already provides circular clipping through the parent and uses `object-fit: cover`. The turn clock, active, winner, folded, and hero layers are separate and can remain unchanged.

### Asset loading and CSP

- Poker already serves static table assets from `poker/assets/`, including the chip image catalog.
- Absolute same-origin paths are safe from route-relative path mistakes on `/poker/table-v2.html`.
- The effective CSP already permits `img-src 'self'`. Local bot assets require no CSP domain, hash, or provider allowlist change.
- No build-time asset manifest or bundler is present. A small explicit filename allowlist in the existing external `poker-v2.js` is simpler than a new JSON request, endpoint, or configuration subsystem.

## Architecture decision

Add a fixed, ordered allowlist of owner-provided bot avatar filenames to `poker/poker-v2.js`. For a seat that is positively identified as a bot, a small deterministic string hash of its existing `userId` selects one entry from that catalog. The resolver returns an absolute same-origin path below `/poker/assets/avatars/bots/`.

`renderSeatAvatar()` then uses its existing safe image lifecycle:

1. render `BO` initials immediately;
2. resolve a local image only when `seat.isBot === true` and `seat.userId` is non-empty;
3. create the image with DOM APIs, an empty decorative `alt`, and asynchronous decoding;
4. hide initials only after `load`;
5. remove the image and keep initials after `error`.

Human seats continue through the existing `seat.profile.avatar` branch. Guest and empty seats never enter bot resolution.

### Why this is the preferred design

- It reuses the existing renderer and fallback instead of introducing a second avatar system.
- It adds no database lookup, profile hydration, runtime cache, network API, or backend failure mode.
- Every viewer derives the same result from the same snapshot and static catalog.
- The WS server remains authoritative only for whether a seat is a bot; presentation stays in the browser.
- Asset paths cannot be injected by snapshot data because only filenames compiled into the local allowlist are usable.

Rejected alternatives:

- **Create public profiles for bots:** mixes system actors with authenticated user identity, adds database lifecycle and profile-query complexity, and conflicts with the current rule that bots never receive `seat.profile`.
- **Add `botAvatar` to WS snapshots:** creates an unnecessary contract and normalization surface for data derivable from existing fields.
- **Persist an avatar key on `poker_seats`:** needs a migration and authoritative lifecycle rules without providing user-facing value for the first release.
- **Map avatars directly to `botProfile`:** couples visual identity to betting policy and leaves every bot in the same policy class looking identical.
- **Fetch a JSON manifest at runtime:** adds another request and failure mode for a small release-owned catalog.

## Asset contract

### Owner deliverable

Before implementation, the owner supplies the final runtime files and confirms that Arcade Hub may distribute them in production. No temporary generated images should be committed as placeholders.

Recommended runtime specification:

- square `256 × 256` WebP images;
- sRGB color space;
- visually complete inside a circular crop, with the important face/details inside the central safe area;
- consistent background, crop, lighting, and visual weight across the set;
- preferably no transparency unless all supplied avatars are intentionally designed for the poker seat background;
- target size at or below 50 KB per file where visual quality permits;
- at least 6 distinct avatars for useful variation at the currently supported tables; 8–12 is preferable if the owner has a larger set.

Recommended repository location:

`poker/assets/avatars/bots/`

Recommended naming convention:

`bot-01-v1.webp`, `bot-02-v1.webp`, and so on, using zero-padded sequence numbers and an explicit content version.

The ordered filename allowlist in `poker-v2.js` is the only runtime catalog. The resolver constructs `/poker/assets/avatars/bots/<allowlisted filename>`; it must never concatenate a snapshot-provided filename or URL.

Replacing artwork should use a new filename version and a corresponding catalog update so browser/CDN caches cannot retain obsolete content. Changing the catalog length or order can reassign avatars because selection is modulo the fixed catalog. Treat catalog changes as a deliberate visual rollout; preserve the initial order for ordinary artwork revisions.

## Phase 0 — owner asset handoff

### Owner tasks

- provide the complete WebP set under the agreed naming convention;
- confirm distribution rights and that no supplied image contains private or provider-derived user data;
- confirm whether the first release should use all assets or a reviewed subset;
- approve representative circular crops at normal and hero-seat sizes.

### Exit criteria

- every catalog entry has a final file;
- filenames are unique, lowercase, versioned, and stable for the release;
- the set is visually coherent when cropped to the existing avatar circle;
- no implementation placeholder or AI-generated asset is needed.

## Phase 1 — local catalog and deterministic resolver

### Affected file and functions

- `poker/poker-v2.js`
  - add one ordered bot-avatar filename allowlist near the existing avatar and asset constants;
  - add a deterministic, side-effect-free hash helper for arbitrary non-empty bot IDs, including UUID and legacy fixture formats;
  - add `resolveBotAvatarPath(seat)` that returns `null` unless the normalized seat is a bot with a usable `userId`;
  - return only an absolute path assembled from the fixed local directory and an allowlisted filename.

### Invariants

- selection has no randomness, time, storage, request, table action, or connection dependency;
- the same `userId` and catalog always select the same file in every browser;
- a replacement bot with a new `userId` is allowed to select a different avatar;
- unknown, missing, guest, human, and empty-seat identities return no bot image;
- `botProfile` does not choose or modify the image;
- the resolver cannot emit an external URL or a path outside the bot asset directory.

### Acceptance

- all live bot seats with valid normalized IDs resolve to exactly one catalog entry;
- human and guest seats cannot resolve a bot asset;
- no snapshot or backend contract is changed;
- no new request occurs beyond loading the selected static images.

## Phase 2 — renderer integration and assets

### Affected files and functions

- `poker/assets/avatars/bots/*.webp`
  - add only the final owner-provided runtime files from Phase 0.
- `poker/poker-v2.js::renderSeatAvatar()`
  - keep initials as the first render and fallback;
  - prefer the local bot image for a normalized bot seat;
  - otherwise retain the current human default/uploaded-avatar branches unchanged;
  - reuse one image creation, load, and error path rather than duplicating event handling.
- `poker/poker-v2.css`
  - no change is expected because `.poker-seat-avatar__image` already supplies clipping and `object-fit: cover`;
  - change it only if manual review of the final owner assets proves a shared, non-destructive `object-position` adjustment is necessary. Do not add per-bot CSS selectors.
- `docs/poker-bots.md`
  - after implementation, document that bot imagery is a deterministic local browser projection and not persisted bot metadata.

### Renderer rules

- create image elements with DOM APIs; do not build avatar HTML strings;
- use `alt=""` because the adjacent visible `Bot` label identifies the seat and the art is decorative;
- keep initials visible until the image has loaded successfully;
- on image failure, remove only the failed image and leave the seat, controls, cards, and turn state usable;
- preserve the existing human uploaded/default avatar normalization and trusted Supabase-origin rules;
- preserve active-turn ring, winner treatment, folded opacity, hero size, card layers, and chip animation anchors;
- do not preload the entire catalog; load only assets selected for occupied bot seats.

### Acceptance

- every occupied bot seat renders a selected owner asset after successful load;
- a missing or invalid asset visibly falls back to `BO` without an empty blue circle;
- authenticated human avatars, generated profile variants, guests, and empty seats behave exactly as before;
- no external image host, inline script, or new CSP permission is introduced;
- multiple snapshots and reconnects do not visibly reshuffle an unchanged bot's avatar.

## Manual verification plan

No new automated tests are part of this Speckit. Validate the implementation on the Netlify deploy preview with real WS gameplay:

1. Join a table that seeds multiple bots and confirm each occupied bot shows a local WebP rather than only `BO`.
2. Compare two browsers viewing the same table; each bot must have the same avatar in both clients.
3. Trigger ordinary actions, snapshot updates, reconnect, and resync; unchanged bot IDs must keep their assigned images without flashing another bot's image.
4. If a broke bot is replaced with a new bot ID, confirm the new occupant receives a valid deterministic avatar and never inherits a stale DOM image.
5. Block one selected avatar request in browser developer tools and confirm the seat remains visible and usable with `BO` initials.
6. Verify an authenticated human with an uploaded avatar and one with a generated avatar still use the existing human paths.
7. Verify a guest seat and an empty seat never receive bot artwork.
8. Exercise active-turn, winner, folded, dealer-chip, cards, and chip-animation states to confirm the image stays below the existing overlays.
9. Check a six-seat desktop layout and a narrow mobile viewport, including the larger hero-seat geometry.
10. Inspect network and CSP reports: bot images must load only from `/poker/assets/avatars/bots/`, with no new external request or CSP violation.
11. Refresh after a production-style deploy and confirm versioned filenames avoid stale artwork.

## Rollout and rollback

1. Land the owner assets, catalog, resolver, and renderer integration in one implementation PR so released catalog entries can never reference files absent from that release.
2. Use the ordinary Netlify deploy preview for visual and failure-fallback verification. A WS Preview Deploy is not required because the plan changes neither WS server code nor protocol.
3. Roll out to production after the owner approves desktop/mobile crops and browser network inspection.
4. Monitor normal static-asset 404/error reporting and client error telemetry if already available; do not add bot IDs or table IDs to telemetry for this feature.
5. Roll back by removing the bot resolver branch from the renderer. The existing initials fallback immediately restores the previous behavior. Leaving unused versioned assets deployed is harmless and can be cleaned up later.

## Breaking and operational impact

| Area | Impact |
| --- | --- |
| Browser UI | Additive presentation change for bot seats; initials remain the failure fallback. |
| WS contract | None. Existing `userId` and `isBot` fields are consumed unchanged. |
| Poker engine and bot policy | None. `botProfile`, decisions, autoplay, replacement, and funds flows are untouched. |
| Database and persistence | None. No migration, new column, profile row, or persisted avatar key. |
| ENV and secrets | None. The asset catalog is release-owned source code, not runtime configuration. |
| Network and runtime | One same-origin static image request per distinct selected asset in view, then normal browser/CDN caching; no API request or runtime cache. |
| CSP | None. Existing `img-src 'self'` covers the assets, and the implementation remains in external `poker-v2.js`. |
| Deployment | Netlify preview/production only; no WS Preview Deploy. |
| Accessibility | Decorative images use empty alt text; the existing visible seat name and initials fallback remain. |

This is not a breaking change. Old cached JavaScript continues to show initials, and new JavaScript safely falls back if an asset is unavailable during a staggered deployment.

## Future improvements

Consider these only after the first release demonstrates a product need:

- a larger curated catalog with an explicitly reviewed reassignment rollout;
- local bot display names paired with the same deterministic identity resolver;
- stable rendezvous-style selection if the catalog must grow frequently without reassigning most existing IDs;
- a server-projected bot presentation identity only if multiple independent clients need shared names and avatars that cannot be derived locally;
- an owner-facing asset build step only if manual WebP preparation becomes error-prone.

None of these requires or justifies complexity in the initial implementation.

## Definition of Done

- Phase 0 owner assets and rights confirmation are complete.
- The implementation uses the existing `isBot` and `userId` snapshot fields without changing WS payloads.
- Bot selection is deterministic, same-origin, allowlisted, and independent of `botProfile`.
- The current safe image loader and `BO` fallback are reused.
- Human, guest, and empty-seat rendering is unchanged.
- Desktop, mobile, reconnect, replacement, failure, layering, network, and CSP cases pass the manual verification plan.
- No migration, ENV, backend, WS, persistence, CSP, inline script, generated asset, or automated test is added.

## Plan verdict

The simplest maintainable implementation is a frontend-only deterministic projection from the bot identity already present in poker snapshots to a fixed catalog of local owner-provided WebP assets. The repository already contains every server-side fact and browser rendering primitive required. Backend or protocol work would add complexity without improving correctness for this feature.
