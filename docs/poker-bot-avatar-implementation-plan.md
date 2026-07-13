# Poker bot avatars

Status: planning only. Avatar assets are owner-provided and are not part of this documentation PR. Do not begin implementation until the asset handoff in Phase 0 is complete.

## Objective

Show a local illustrated avatar and a matching human-style display name for every occupied poker bot seat in `poker/table-v2.html`, while preserving a safe initials fallback and all human-profile avatar behavior.

The implementation should be a presentation-only enhancement. Bot avatars and names do not need accounts, public profiles, database rows, remote image URLs, or new poker state. The browser can select one trusted local presentation identity deterministically from identity data already present in the seat snapshot.

## Scope

In scope:

- owner-provided male and female avatar images for live poker bot seats;
- an explicit owner-approved male or female display name paired with every avatar;
- deterministic assignment so the same bot `userId` has the same name/avatar pair across snapshots, reconnect, and resync for a fixed presentation catalog;
- reuse of the existing poker seat `<img>` loading and initials fallback behavior;
- same-origin static asset loading;
- desktop and mobile table presentation.

Out of scope:

- generating avatar art or using AI image generation;
- human, guest, public-profile, lobby, leaderboard, or topbar avatar changes;
- bot personality labels or localization of proper names;
- storing bot avatars in `public.user_profiles`;
- database migrations, Storage uploads, new environment variables, or runtime configuration;
- poker engine, ledger, settlement, autoplay, or bot policy changes;
- WebSocket payload, snapshot, patch, replay, or persisted poker-state changes;
- new automated tests.

## Repository analysis

### Poker bot identity

- `shared/poker-domain/bots.mjs` creates bot UUIDs and persists bot seats with `is_bot` and `bot_profile`.
- Initial bot IDs are deterministically derived from table ID and seat number. Broke-bot replacement in `ws-server/poker/engine/poker-engine.mjs` deliberately creates a new UUID, which is an appropriate identity boundary for a potentially different name/avatar pair.
- `bot_profile` represents play style (`TIGHT`, `NORMAL`, or `LOOSE`, with legacy values normalized by the bot policy). It is behavior configuration, not presentation identity, gender, or display name.
- Bot metadata is restored by `ws-server/poker/bootstrap/persisted-bootstrap-adapter.mjs` into `seatDetailsByUserId`.

### Snapshot contract

- `ws-server/poker/read-model/room-core-snapshot.mjs` and `ws-server/poker/read-model/state-snapshot.mjs` already expose `userId`, `seatNo`, `status`, optional `isBot`, and optional `botProfile` for bot seats.
- Human seats may additionally carry the optional minimal `profile` projection. Both snapshot projectors intentionally refuse to attach a human public profile to a bot.
- The existing `userId` plus `isBot` fields are sufficient for local deterministic presentation selection. Adding an avatar URL, avatar key, display name, or gender to the WS contract would duplicate derivable presentation state.

### Browser normalization and rendering

- `poker/poker-v2.js::normalizeSeatRows()` preserves `userId`, computes the displayed seat name, and recognizes bots from authoritative `isBot` metadata, with its existing legacy ID-pattern fallback.
- `poker/poker-v2.js::renderSeatAvatar()` first renders initials, then handles human generated variants or an uploaded image. Initials remain visible until an image loads; an image error removes the failed image and restores initials.
- `getDisplayName()` currently labels every bot as `Bot`, so all bot fallbacks are `BO`. The implementation must replace that generic label with the display name from the selected bot presentation entry; image failure must show initials derived from the same name.
- `renderSeats()` creates a new avatar element for each seat render, so no previous occupant's image or data attribute is reused.
- `.poker-seat-avatar__image` in `poker/poker-v2.css` already provides circular clipping through the parent and uses `object-fit: cover`. The turn clock, active, winner, folded, and hero layers are separate and can remain unchanged.

### Asset loading and CSP

- Poker already serves static table assets from `poker/assets/`, including the chip image catalog.
- Absolute same-origin paths are safe from route-relative path mistakes on `/poker/table-v2.html`.
- The effective CSP already permits `img-src 'self'`. Local bot assets require no CSP domain, hash, or provider allowlist change.
- No build-time asset manifest or bundler is present. A small explicit presentation catalog in the existing external `poker-v2.js` is simpler than a new JSON request, endpoint, or configuration subsystem.

## Architecture decision

Add a fixed, ordered allowlist of bot presentation entries to `poker/poker-v2.js`. Each entry binds exactly one owner-approved display name, one explicit presentation gender (`male` or `female`), and one owner-provided avatar filename of the same gender. The implementation must never infer gender from spelling, filename, image pixels, locale, or `botProfile`.

For a seat that is positively identified as a bot, a small deterministic string hash of its existing `userId` selects one complete entry from that catalog. The same selected entry supplies both the visible name and the absolute same-origin image path below `/poker/assets/avatars/bots/`. Names and avatars are therefore impossible to select independently.

`renderSeatAvatar()` then uses its existing safe image lifecycle:

1. resolve the bot presentation only when `seat.isBot === true` and `seat.userId` is non-empty;
2. render the selected display name beside the seat and its initials inside the avatar immediately;
3. create the paired local image with DOM APIs, an empty decorative `alt`, and asynchronous decoding;
4. hide initials only after `load`;
5. remove the image and keep the selected name's initials after `error`.

Human seats continue through the existing `seat.profile.avatar` branch. Guest and empty seats never enter bot resolution.

### Why this is the preferred design

- It reuses the existing renderer, display-name path, and initials helper instead of introducing a second avatar system.
- It adds no database lookup, profile hydration, runtime cache, network API, or backend failure mode.
- Every viewer derives the same result from the same snapshot and static catalog.
- The WS server remains authoritative only for whether a seat is a bot; presentation stays in the browser.
- Names, gender metadata, and asset paths cannot be injected by snapshot data because only complete entries compiled into the local allowlist are usable.

Rejected alternatives:

- **Create public profiles for bots:** mixes system actors with authenticated user identity, adds database lifecycle and profile-query complexity, and conflicts with the current rule that bots never receive `seat.profile`.
- **Add `botAvatar`, `botDisplayName`, or `botGender` to WS snapshots:** creates an unnecessary contract and normalization surface for data derivable from existing fields.
- **Persist an avatar key on `poker_seats`:** needs a migration and authoritative lifecycle rules without providing user-facing value for the first release.
- **Map presentation directly to `botProfile`:** couples name, gender, and visual identity to betting policy and leaves every bot in the same policy class looking identical.
- **Maintain separate name and avatar arrays:** permits index/order mistakes that can pair a male name with a female avatar or the reverse. One validated catalog entry is the atomic unit.
- **Fetch a JSON manifest at runtime:** adds another request and failure mode for a small release-owned catalog.

## Asset contract

### Owner deliverable

Before implementation, the owner supplies the final runtime files, marks every asset as male or female for presentation purposes, and confirms that Arcade Hub may distribute them in production. No temporary generated images should be committed as placeholders.

Recommended runtime specification:

- square `256 × 256` WebP images;
- sRGB color space;
- visually complete inside a circular crop, with the important face/details inside the central safe area;
- consistent background, crop, lighting, and visual weight across the set;
- preferably no transparency unless all supplied avatars are intentionally designed for the poker seat background;
- target size at or below 50 KB per file where visual quality permits;
- at least 6 distinct avatars for useful variation at the currently supported tables, with at least 3 male and 3 female assets;
- 8–12 balanced assets are preferable if the owner has a larger set.

Recommended repository location:

`poker/assets/avatars/bots/`

Recommended naming convention:

`bot-male-01-v1.webp`, `bot-male-02-v1.webp`, `bot-female-01-v1.webp`, `bot-female-02-v1.webp`, and so on, using an explicit gender marker, zero-padded sequence number, and content version.

The ordered presentation allowlist in `poker-v2.js` is the only runtime catalog. Each entry contains a stable internal key, exact display name, presentation gender, and filename. Names should be fictional or generic, culturally appropriate, unique within the first-release catalog, stable across languages, and approved by the owner. They are proper names and are not translated by `i18n.js`.

The resolver constructs `/poker/assets/avatars/bots/<allowlisted filename>` from the selected entry; it must never concatenate a snapshot-provided filename, name, gender, or URL. A lightweight catalog validation helper should fail closed for an invalid entry so the affected seat falls back to the generic `Bot`/`BO` presentation rather than risking a mismatched identity.

Replacing artwork should use a new filename version and a corresponding catalog update so browser/CDN caches cannot retain obsolete content. A replacement must retain the entry's declared gender or update its paired name in the same release. Changing the catalog length or order can reassign complete name/avatar pairs because selection is modulo the fixed catalog. Treat catalog changes as a deliberate visual rollout; preserve the initial order for ordinary artwork revisions.

## Phase 0 — owner asset handoff

### Owner tasks

- provide the complete male/female WebP set under the agreed naming convention and explicitly identify the gender of each asset;
- confirm distribution rights and that no supplied image contains private or provider-derived user data;
- confirm whether the first release should use all assets or a reviewed subset;
- approve the exact display name paired with every asset and confirm the name matches the asset's intended gender presentation;
- approve representative circular crops at normal and hero-seat sizes.

### Exit criteria

- every catalog entry has a final file, explicit `male`/`female` classification, and one approved matching display name;
- filenames are unique, lowercase, versioned, and stable for the release;
- display names are unique in the catalog, safe for public display, and do not impersonate real users;
- the set is visually coherent when cropped to the existing avatar circle;
- no implementation placeholder or AI-generated asset is needed.

## Phase 1 — local presentation catalog and deterministic resolver

### Affected file and functions

- `poker/poker-v2.js`
  - add one ordered bot-presentation allowlist near the existing avatar and asset constants;
  - keep each internal key, display name, `male`/`female` marker, and filename in the same immutable entry;
  - add a small closed validator for catalog entries and reject duplicate keys, duplicate first-release names, unsupported gender values, or filenames whose gender marker disagrees with the entry;
  - add a deterministic, side-effect-free hash helper for arbitrary non-empty bot IDs, including UUID and legacy fixture formats;
  - add `resolveBotPresentation(userId)` that selects and returns one complete validated catalog entry;
  - extend `normalizeSeatRows()` to compute `isBot` once, resolve the bot presentation, and use its display name instead of the generic `Bot` label;
  - retain a derived browser-only presentation reference on the normalized seat so name and image rendering consume the same selected entry;
  - keep `getDisplayName()` compatible with existing human/guest handling and use generic `Bot` only when bot presentation resolution fails.

### Invariants

- selection has no randomness, time, storage, request, table action, or connection dependency;
- the same `userId` and catalog always select the same complete name/gender/avatar entry in every browser;
- a replacement bot with a new `userId` is allowed to select a different complete presentation;
- name and avatar are never hashed or selected separately;
- unknown, missing, guest, human, and empty-seat identities return no bot presentation;
- `botProfile` does not choose or modify the name, gender, or image;
- the resolver cannot emit an external URL or a path outside the bot asset directory;
- presentation gender is private local catalog metadata used for pairing/validation, not a user-facing label, analytics field, or WS value.

### Acceptance

- all live bot seats with valid normalized IDs resolve to exactly one complete catalog entry;
- every male entry has a male name and male asset, and every female entry has a female name and female asset according to the owner-approved catalog;
- the selected display name is visible beside the same entry's avatar;
- human and guest seats cannot resolve a bot presentation;
- no snapshot or backend contract is changed;
- no new request occurs beyond loading the selected static images.

## Phase 2 — renderer integration and assets

### Affected files and functions

- `poker/assets/avatars/bots/*.webp`
  - add only the final owner-provided runtime files from Phase 0.
- `poker/poker-v2.js::renderSeatAvatar()`
  - render initials from the selected bot display name as the first render and fallback;
  - load the local image from that exact same bot presentation entry;
  - otherwise retain the current human default/uploaded-avatar branches unchanged;
  - reuse one image creation, load, and error path rather than duplicating event handling.
- `poker/poker-v2.css`
  - no change is expected because `.poker-seat-avatar__image` already supplies clipping and `object-fit: cover`;
  - change it only if manual review of the final owner assets proves a shared, non-destructive `object-position` adjustment is necessary. Do not add per-bot CSS selectors.
- `docs/poker-bots.md`
  - after implementation, document that bot names and imagery are one deterministic local browser projection and not persisted bot metadata.

### Renderer rules

- create image elements with DOM APIs; do not build avatar HTML strings;
- use `alt=""` because the adjacent visible selected bot name identifies the seat and the art is decorative;
- keep initials visible until the image has loaded successfully;
- on image failure, remove only the failed image and leave the seat, controls, cards, and turn state usable;
- preserve the existing human uploaded/default avatar normalization and trusted Supabase-origin rules;
- preserve active-turn ring, winner treatment, folded opacity, hero size, card layers, and chip animation anchors;
- do not preload the entire catalog; load only assets selected for occupied bot seats.

### Acceptance

- every occupied bot seat renders one owner-approved name/avatar pair after successful load;
- male names are displayed only with their paired male avatars and female names only with their paired female avatars;
- a missing image visibly falls back to initials derived from the still-visible selected name, without an empty blue circle;
- an invalid catalog entry fails closed to generic `Bot`/`BO` rather than mixing a name and image;
- authenticated human avatars, generated profile variants, guests, and empty seats behave exactly as before;
- no external image host, inline script, or new CSP permission is introduced;
- multiple snapshots and reconnects do not visibly reshuffle an unchanged bot's avatar.

## Manual verification plan

No new automated tests are part of this Speckit. Validate the implementation on the Netlify deploy preview with real WS gameplay:

1. Review every first-release catalog entry and confirm its exact display name, explicit gender marker, filename marker, and supplied artwork agree.
2. Join a table that seeds multiple bots and confirm each occupied bot shows both a human-style display name and its paired local WebP.
3. Confirm every displayed male name uses its approved male avatar and every displayed female name uses its approved female avatar; no runtime inference is involved.
4. Compare two browsers viewing the same table; each bot must have the same name/avatar pair in both clients.
5. Trigger ordinary actions, snapshot updates, reconnect, and resync; unchanged bot IDs must keep their assigned name/avatar pairs without flashing another identity.
6. If a broke bot is replaced with a new bot ID, confirm the new occupant receives one valid deterministic pair and never inherits a stale name or DOM image.
7. Block one selected avatar request in browser developer tools and confirm the seat remains visible and usable with initials matching its still-visible selected name.
8. Verify an authenticated human with an uploaded avatar and one with a generated avatar still use the existing human paths.
9. Verify a guest seat and an empty seat never receive a bot name or artwork.
10. Exercise active-turn, winner, folded, dealer-chip, cards, and chip-animation states to confirm the image stays below the existing overlays.
11. Check a six-seat desktop layout and a narrow mobile viewport, including long approved names and the larger hero-seat geometry.
12. Switch Arcade Hub language and confirm proper names remain stable while surrounding UI localization continues normally.
13. Inspect network and CSP reports: bot images must load only from `/poker/assets/avatars/bots/`, with no new external request or CSP violation.
14. Refresh after a production-style deploy and confirm versioned filenames avoid stale artwork.

## Rollout and rollback

1. Land the owner assets, paired names/gender metadata, catalog, resolver, and renderer integration in one implementation PR so released entries can never reference files absent from that release.
2. Use the ordinary Netlify deploy preview for visual and failure-fallback verification. A WS Preview Deploy is not required because the plan changes neither WS server code nor protocol.
3. Roll out to production after the owner approves desktop/mobile crops and browser network inspection.
4. Monitor normal static-asset 404/error reporting and client error telemetry if already available; do not add bot IDs or table IDs to telemetry for this feature.
5. Roll back by removing the bot resolver branch from the renderer. The existing initials fallback immediately restores the previous behavior. Leaving unused versioned assets deployed is harmless and can be cleaned up later.

## Breaking and operational impact

| Area | Impact |
| --- | --- |
| Browser UI | Visible bot labels change from generic `Bot` to deterministic owner-approved names; avatars and matching-name initials are additive. |
| WS contract | None. Existing `userId` and `isBot` fields are consumed unchanged. |
| Poker engine and bot policy | None. `botProfile`, decisions, autoplay, replacement, and funds flows are untouched. |
| Database and persistence | None. No migration, new column, profile row, or persisted avatar key. |
| ENV and secrets | None. The paired presentation catalog is release-owned source code, not runtime configuration. |
| Network and runtime | One same-origin static image request per distinct selected asset in view, then normal browser/CDN caching; no API request or runtime cache. |
| CSP | None. Existing `img-src 'self'` covers the assets, and the implementation remains in external `poker-v2.js`. |
| Deployment | Netlify preview/production only; no WS Preview Deploy. |
| Accessibility | Decorative images use empty alt text; the selected visible bot name and matching initials fallback identify the seat. |

This is not a breaking change. Old cached JavaScript continues to show initials, and new JavaScript safely falls back if an asset is unavailable during a staggered deployment.

## Future improvements

Consider these only after the first release demonstrates a product need:

- a larger curated catalog with an explicitly reviewed reassignment rollout;
- optional themed/localized bot-name catalogs only if product requirements later justify names changing by locale;
- stable rendezvous-style selection if the catalog must grow frequently without reassigning most existing IDs;
- a server-projected bot presentation identity only if multiple independent clients need shared names and avatars that cannot be derived locally;
- an owner-facing asset build step only if manual WebP preparation becomes error-prone.

None of these requires or justifies complexity in the initial implementation.

## Definition of Done

- Phase 0 owner assets, gender classifications, name pairings, approvals, and rights confirmation are complete.
- The implementation uses the existing `isBot` and `userId` snapshot fields without changing WS payloads.
- Bot selection returns one atomic, deterministic, same-origin, allowlisted name/gender/avatar entry and is independent of `botProfile`.
- Every male name is paired with its approved male avatar and every female name with its approved female avatar.
- The current safe image loader and initials helper are reused; image failure retains initials matching the visible bot name.
- Human, guest, and empty-seat rendering is unchanged.
- Desktop, mobile, reconnect, replacement, failure, layering, network, and CSP cases pass the manual verification plan.
- No migration, ENV, backend, WS, persistence, CSP, inline script, generated asset, or automated test is added.

## Plan verdict

The simplest maintainable implementation is a frontend-only deterministic projection from the bot identity already present in poker snapshots to a fixed catalog of atomic owner-approved name/gender/avatar entries. Explicit pairing guarantees that a male bot name uses its male asset and a female bot name uses its female asset without runtime guessing. The repository already contains every server-side fact and browser rendering primitive required. Backend or protocol work would add complexity without improving correctness for this feature.
