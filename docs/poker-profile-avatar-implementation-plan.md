# Poker profile avatars

Status: implementation completed in PR #700. The owner approved combining the three reviewed delivery phases in the same PR. The change adds an optional poker profile projection and UI rendering, without a database migration, new Auth provider, new environment variable, or CSP expansion.

## Objective

Show each authenticated human player's Arcade Hub public-profile avatar and display name at `poker/table-v2.html`. Preserve initials for guests, bots, missing profiles, invalid payloads, profile-read failures, and image-load failures.

Poker consumes only the Arcade Hub public identity projection. It never consumes Auth metadata, provider tokens, provider image URLs, email addresses, bio, XP, leaderboard fields, or database avatar keys.

## Scope

In scope:

- optional public identity data on occupied human seats in poker WS snapshots;
- independently hydrated, fail-open profile data in the WS runtime;
- avatar rendering in the existing poker table UI;
- verification that the contract can accept a future Google/Facebook-derived Arcade Hub avatar.

Out of scope:

- lobby, chat, tournament, or bot avatars;
- Google/Facebook login buttons;
- remote provider-image ingestion, consent, unlink/delete policy, or provider configuration;
- changes to poker engine state, persisted poker JSON, chips, settlement, or authorization.

Social-avatar import is a separate future feature and requires its own plan. It is not part of the poker-avatar definition of done.

## Confirmed current state

- `public.user_profiles` stores `display_name`, `handle`, `avatar_key`, and `avatar_variant`.
- `netlify/functions/_shared/user-profile.mjs` exposes uploaded avatars as immutable Supabase Storage URLs and generated avatars as allowlisted variants.
- `netlify/functions/_shared/profile-avatar.mjs` already validates and converts uploads to 256 by 256 WebP.
- `poker/poker-v2.js` renders initials inside `.poker-seat-avatar` and has no image path.
- `ws-server/poker/bootstrap/persisted-bootstrap-repository.mjs` loads the table, seats, and poker state in one required transaction.
- `ws-server/poker/read-model/room-core-snapshot.mjs` projects seats synchronously and has no profile data.
- `ws-server/poker/table/table-manager.mjs` has asynchronous `ensureTableLoaded()` but synchronous `tableSnapshot()` and `resync()` methods.
- Persisted `poker_seats.user_id` values are UUIDs. Guest tables and local fixtures may use non-UUID identifiers and must never reach the profile query.
- The effective poker image policy already permits the project's `https://*.supabase.co` Storage origin.

The missing avatar is a public read-model enrichment gap, not an upload or engine-state problem.

## Product and architecture decisions

1. `public.user_profiles` remains the source of presentation identity.
2. A poker seat receives only `handle`, `displayName`, and `avatar`.
3. The profile URL is derived from `handle`; it is not an independent WS field.
4. The full `publicProfile()` object is not reused by poker because it also contains `bio` and may contain XP and level.
5. Only avatar normalization is shared. Poker owns a separate closed identity allowlist.
6. Profile hydration runs after the required table bootstrap in an independent database operation. It is never joined to the required `poker_seats` query.
7. Profile availability never determines whether join, reconnect, action, leave, settlement, or cash-out succeeds.
8. The cache is derived runtime presentation state. It is not written to `coreState`, `poker_state`, replay data, or the ledger.
9. `tableSnapshot()` and `resync()` remain synchronous. Existing callers do not receive a changed return type.
10. Ordinary actions and broadcasts never trigger a profile query.

## Additive WS contract

Add an optional `profile` property to non-bot public seat rows:

```json
{
  "userId": "71ae168f-6ec8-4b0e-8a38-ae11b40414cc",
  "seatNo": 3,
  "status": "ACTIVE",
  "profile": {
    "handle": "cosmic-panda-951265",
    "displayName": "Cosmic Panda 951265",
    "avatar": {
      "type": "uploaded",
      "url": "https://<project-ref>.supabase.co/storage/v1/object/public/profile-avatars/<opaque>.webp"
    }
  }
}
```

Generated-avatar example:

```json
{
  "profile": {
    "handle": "pixel-fox-123456",
    "displayName": "Pixel Fox 123456",
    "avatar": { "type": "default", "variant": "fox-blue" }
  }
}
```

Contract rules:

- `profile` is optional and additive; old clients ignore it and new clients fall back when absent.
- The poker allowlist contains exactly `handle`, `displayName`, and `avatar`.
- `profileUrl`, `bio`, XP, level, leaderboard preference, email, provider metadata, provider URL, and `avatar_key` are forbidden.
- Uploaded avatars use only the trusted Arcade Hub Storage origin and the existing immutable WebP key shape.
- Default variants use the same allowlist as the profile UI.
- Bots never receive `profile`.
- Guests and invalid non-UUID human identifiers are skipped by profile hydration and use initials.
- The public profile projection is identical for every table viewer; existing recipient-specific cards and legal actions stay unchanged.

The browser derives a profile link only when needed:

```text
/u/${encodeURIComponent(handle)}
```

## Phase 1 — minimal avatar and poker identity projections

### Files and methods

- Add `shared/profile-avatar-projection.mjs`:
  - `projectPublicAvatar({ avatarKey, avatarVariant, storageBaseUrl })` performs pure uploaded/default avatar projection;
  - the function has no environment reads, database access, or mutations.
- Update `netlify/functions/_shared/user-profile.mjs`:
  - keep `publicProfile()` and `ownerProfile()` contracts unchanged;
  - replace only the private `profileAvatar()` implementation with `projectPublicAvatar()`.
- Add `ws-server/poker/read-model/public-poker-identity.mjs`:
  - `projectPublicPokerIdentity(row, { storageBaseUrl })` returns exactly `handle`, `displayName`, and `avatar`;
  - it must not call or spread `publicProfile()`.
- Update `ws-server/Dockerfile` to copy `shared/profile-avatar-projection.mjs` into the release image.
- Document the optional `seat.profile` contract in `docs/poker-realtime.md`.

### Acceptance

- Profile APIs keep their existing public shape, including bio where already documented.
- Poker identity projection cannot serialize bio, XP, level, provider data, or storage keys.
- Uploaded/default avatar rules are identical in profile and poker projections.
- No poker browser or WS payload changes are enabled in this PR.

### Critical tests

- Extend `tests/public-profiles.behavior.test.mjs` and `tests/profile-avatar.behavior.test.mjs` for projection parity and private-field rejection.
- Do not add UI, CSS, JSP, DOM, or Playwright tests.

## Phase 2 — isolated WS profile hydration

### Repository boundary

- Add `ws-server/poker/profile/public-profile-repository.mjs` with:
  - `createPublicProfileRepository({ env })`;
  - `loadPublicProfiles(userIds)`.
- `loadPublicProfiles()` performs one bounded `public.user_profiles` query in its own `beginSqlWs()` call after the required bootstrap transaction has completed.
- Do not JOIN `user_profiles` into the table or seat bootstrap query.
- Do not execute the optional query inside the callback used by `persisted-bootstrap-repository.loadFromDb()`.
- A profile-query error or timeout is caught by the profile refresh method and produces an initials fallback. It cannot change a successful required-bootstrap result into a failure.

### Candidate filtering

Add a local UUID validator and build candidates from the current authoritative members:

1. exclude entries whose `seatDetailsByUserId[userId].isBot` is true;
2. trim the identifier and require a valid UUID;
3. remove duplicates and sort for a deterministic fingerprint;
4. cap candidates at the current normalized `table.coreState.maxSeats`/`table.tableMeta.maxPlayers`;
5. retain the existing domain hard cap of ten as a final guard;
6. skip invalid IDs, bot-only tables, and guest tables without running SQL.

The query uses `WHERE user_id = ANY($1::uuid[])`. An empty candidate set returns `{}` without opening a transaction.

### Table-manager cache

Update `ws-server/poker/table/table-manager.mjs` with derived fields on each table:

```text
table.publicProfilesByUserId
table.publicProfilesLoadedAtMs
table.publicProfilesSeatFingerprint
table.publicProfilesRefreshPromise
table.publicProfilesRefreshGeneration
```

Add methods/helpers:

- `buildPublicProfileCandidates(table)` returns the validated sorted IDs and fingerprint;
- `invalidatePublicProfilesForSeatChange(table)` clears the projection, timestamp, and advances the generation when the authoritative human-ID fingerprint changes;
- `refreshPublicProfiles(tableId, { force, nowMs })` owns the optional read, timeout, deduplication, stale-result protection, and fallback;
- `publicProfilesForSnapshot(table)` returns only entries matching the current candidate IDs.

Cache invariants:

1. A snapshot attaches a profile only by exact equality with the current `seat.userId`.
2. A changed human-ID fingerprint invalidates freshness immediately.
3. Each refresh captures its candidate IDs, fingerprint, and generation before querying.
4. Concurrent refreshes for the same fingerprint reuse `publicProfilesRefreshPromise`.
5. A result is applied only if the table still exists and its fingerprint and generation still match.
6. Applied results are filtered again to the captured candidate set.
7. Authoritative rehydration removes profiles for users no longer seated.
8. Failure or timeout never rejects the caller. A changed seat set falls back to `{}`; a stale refresh for an unchanged set may retain the last safe projection.
9. Freshness is initially 60 seconds. This is presentation freshness, not game authority.

### Exact refresh call sites

- `createTableManager().ensureTableLoaded()`:
  - first await the required `tableBootstrapLoader` and install/restore the table;
  - then call and await the bounded `refreshPublicProfiles()` before returning the cold-load result;
  - profile failure returns the successful table result with initials.
- `ws-server/poker/handlers/join.mjs` in `handleJoinCommand()`:
  - after successful authoritative `restoreTableFromPersisted()` and before the first `tableSnapshot()`, await `refreshPublicProfiles(tableId, { force: true })`;
  - the refresh timeout/failure does not reject the accepted join.
- `ws-server/server.mjs` resync/resume paths:
  - after `ensureTableLoaded()` and before the synchronous `tableSnapshot()`, await `refreshPublicProfiles()` only when stale;
  - replay-only resume that sends no snapshot does not require a refresh.
- `restoreTableFromPersisted()`, authoritative leave restore, join, and leave membership mutations call `invalidatePublicProfilesForSeatChange()` synchronously.
- `applyAction()`, turn timeout, bot autoplay, persistence, settlement, cash-out, and ordinary snapshot broadcasts do not call the loader.

The optional refresh gets a short bounded timeout configured as a local constant in the new profile module. It introduces no ENV requirement. Timing is verified on stage before adjustment.

### Snapshot projection

- Update `ws-server/poker/read-model/room-core-snapshot.mjs` so `projectRoomCoreSnapshot()` accepts an explicit `publicProfilesByUserId` argument.
- Attach `profile` only after current-seat and left-player filtering and only for non-bot seats.
- Update `ws-server/poker/table/table-manager.mjs::tableSnapshot()` to pass the filtered map.
- Keep `tableSnapshot()` synchronous.
- Preserve the additive field through `stateSnapshot`, `table_state`, and `statePatch` payloads without changing engine or persistence formats.

### Acceptance

- A profile-table outage or timeout cannot reject table load, join, action, reconnect, leave, settlement, or cash-out.
- A profile query never runs inside the required bootstrap transaction.
- One refresh performs at most one bounded profile query and no per-seat query.
- Ordinary poker actions perform zero profile queries.
- A late result for an old seat fingerprint is ignored.
- Removed users do not remain in the active snapshot cache.
- `tableSnapshot()` and `resync()` remain synchronous and all existing callers retain their contracts.

### Critical tests

Extend existing tests rather than introducing a new framework:

- `ws-server/poker/bootstrap/persisted-bootstrap-repository.behavior.test.mjs`: required bootstrap succeeds independently of profile loading.
- `ws-server/poker/table/table-manager.behavior.test.mjs`: candidate filtering, deduplication, max-player bound, freshness, concurrent refresh deduplication, invalidation, timeout, and stale-result rejection.
- `ws-server/poker/read-model/room-core-snapshot.behavior.test.mjs`: minimal allowlist, bot/guest omission, and exact current-user mapping.
- `ws-server/poker/read-model/state-snapshot.behavior.test.mjs` and `state-patch.behavior.test.mjs`: additive profile survives full snapshots and compatible patches.
- `ws-server/poker/reconnect/resync.behavior.test.mjs`: cold load, authoritative join rehydration, stale resync, profile failure, and no gameplay rejection.

These are required WS/reconnect/backend tests under the project policy. Do not add UI-rendering or Playwright tests.

## Phase 3 — poker table renderer

### Files and methods

- Update the existing external `poker/poker-v2.js`:
  - add `normalizePokerAvatar()` and `normalizePokerProfile()`;
  - extend `normalizeSeatRows()` with the closed optional profile shape;
  - add `renderSeatAvatar()` for uploaded images, generated variants, and initials fallback;
  - derive `/u/<encoded handle>` locally only if the link does not interfere with controls or focus order.
- Update `poker/poker-v2.css` using the existing selector formatting and seat layers.
- Do not add an inline script or a second poker renderer.

Renderer rules:

- create `<img>` with DOM APIs, never profile-derived HTML strings;
- accept only HTTPS URLs on the configured Supabase Storage host and expected public bucket path;
- use `alt=""`, `decoding="async"`, and `object-fit: cover` because the adjacent visible name identifies the player;
- on `error`, remove the image and restore initials without rebuilding the whole table;
- keep default variants allowlisted and render initials inside the existing circle;
- preserve turn clock, winner/folded states, cards, chip animations, mobile geometry, and current-user treatment.

### CSP impact

- Continue loading code from the existing external `poker/poker-v2.js`; no script CSP hash is needed.
- Do not add Google/Facebook image domains. Images come only from existing Arcade Hub/Supabase Storage.
- If implementation unexpectedly introduces an inline script, update the effective CSP SHA allowlist in the same PR; the preferred implementation has no inline script.

### Acceptance and manual validation

The project policy excludes new tests for UI rendering and CSS. Validate manually on the deploy preview:

1. Two browsers see the same uploaded avatar, generated variant, and display name.
2. A failed image request returns to initials while the name and controls stay usable.
3. Human, bot, guest, and empty seats retain intentional presentation.
4. Turn ring, winner/folded states, cards, and chip animations remain correctly layered.
5. Six-seat desktop and narrow mobile layouts have no avatar overlap.
6. Reconnect/resync updates the avatar without restarting the hand.
7. Browser network and CSP reports show no provider-domain image requests or new inline-script violations.

Run the existing syntax and full test commands; update existing UI expectations only if the additive data changes a current assertion.

## Future Google/Facebook compatibility

The poker contract is compatible with future Google/Facebook avatars because poker reads only the platform-owned Arcade Hub avatar projection. Supabase supports both providers and exposes provider identity metadata, but that metadata must never become the poker contract.

Official references:

- [Supabase Google login](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase Facebook login](https://supabase.com/docs/guides/auth/social-login/auth-facebook)
- [Supabase identities](https://supabase.com/docs/guides/auth/identities)
- [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)

A separate social-avatar import plan must decide and specify:

- trusted access to `auth.identities` and provider-specific metadata adapters;
- explicit owner selection and precedence over/under user uploads;
- server-side download, redirect/DNS/private-address SSRF protection, byte and image limits;
- conversion through the existing WebP pipeline and copying to `profile-avatars` Storage;
- private provenance schema, unlink/delete retention, consent, feature flag, and rollout;
- provider host allowlists and stage fixtures.

Provider images must not be hotlinked. A copied provider image becomes an ordinary Arcade Hub `avatar_key`, so the poker implementation requires no provider logic, provider URL, new CSP image domain, or protocol change.

## Breaking and operational impact

| Area | Impact |
| --- | --- |
| WS seat contract | Additive optional `profile`; old clients remain compatible. |
| Table-manager API | `tableSnapshot()` and `resync()` stay synchronous; new `refreshPublicProfiles()` is explicitly awaited only from existing async call sites. |
| Poker engine/persistence | No changes to reducers, core state, `poker_state`, replay, or ledger. |
| Database | Phases 1–3 require no migration. Profile hydration reads existing `public.user_profiles`. |
| ENV/secrets | No new ENV or secret. Existing trusted Supabase configuration supplies DB and Storage origins. |
| CSP | No new image domain and no inline script in the intended implementation. |
| Runtime failure | Profile read or image failure degrades to initials without changing gameplay. |

Making existing synchronous table-manager paths asynchronous is explicitly out of scope. If implementation cannot preserve those signatures, stop and revise this plan and all callers before coding.

## Rollout and rollback

- Deploy the optional WS field before enabling browser rendering.
- Monitor aggregate profile-refresh count, cache hit/miss, timeout/error count, latency, missing-profile count, and snapshot size without logging handles or user IDs.
- Roll back WS enrichment by disabling the profile loader; clients continue with initials.
- Roll back image rendering while retaining names and initials.
- Never delete canonical profiles, user uploads, poker seats, poker state, or ledger data during rollback.

## Definition of done

- Authenticated human seats use the same display name and avatar semantics as their Arcade Hub public profile.
- The poker WS allowlist contains only `handle`, `displayName`, and `avatar`.
- Guests, bots, missing profiles, invalid IDs, failed SQL, timeouts, invalid payloads, and failed images have non-blocking fallbacks.
- Required bootstrap and gameplay remain independent of profile availability.
- Cache fingerprint and generation guards prevent stale seat-set results from being applied.
- Profile queries are bounded by the actual table capacity and absent from ordinary action broadcasts.
- Critical WS/backend behavior is covered by existing-suite tests; UI/CSS behavior is manually validated.
- Google/Facebook photos can later enter through the platform-owned avatar pipeline without poker-specific provider logic or hotlinking.
