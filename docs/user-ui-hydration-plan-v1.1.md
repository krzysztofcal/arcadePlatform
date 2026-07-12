# User UI Hydration Plan v1.1

## Executive summary

Arcade Hub performs full-page navigation. Each page recreates the topbar and its JavaScript state, so authenticated users briefly see avatar initials, loading XP, and loading chips before the same server data arrives again.

The target is a small shared `user-ui-state` module that hydrates the last server-confirmed topbar state after the local Supabase session identifies the current user, then revalidates profile, XP, and chips in parallel. This is stale-while-revalidate presentation only: servers remain authoritative, cached values never authorize actions or mutate balances, and no SPA conversion is required.

## Current problem

- Full-page navigation destroys in-memory state and builds a new topbar.
- The uploaded avatar temporarily falls back to initials.
- XP and chips badges return to loading state on every page.
- `profile-client.js` has only page-memory cache; many pages use the profile fallback in `supabaseClient.js`.
- `XPClient` and the chips client fetch authoritative values again, but do not share a safe cross-page presentation cache.
- Browser HTTP caching may retain an avatar image, but the new page does not know which URL to render until profile data is resolved.

## Goals

1. Hydrate an authenticated topbar immediately after the local Supabase session identifies its user.
2. Use stale-while-revalidate for avatar, display name, XP, level, and chips.
3. Never show user A's cached state to user B, even briefly.
4. Keep profile, XP, and chips servers as their respective sources of truth.
5. Preserve full-page navigation and the existing plain-script/IIFE architecture.
6. Avoid award animations, chip transaction effects, and other mutation UI during hydration.
7. Keep loading/error states when no safe cache exists.

## Non-goals

- SPA routing or persistent in-memory application state.
- Backend, database, Redis-key, Storage, or API contract changes.
- Realtime infrastructure or guaranteed instant cross-device updates.
- Using cached XP or chips to authorize gameplay, purchases, claims, or ledger operations.
- Caching JWTs, email addresses, auth metadata, ledger rows, or private profile fields.

## Fixed design decisions

- Do not render identity-bound cache before `SupabaseAuth.getCurrentUser()` returns a user ID.
- Cache only successful, server-confirmed responses.
- Every record includes its `userId`; key and record identity must both match the current session.
- Revalidation always runs after hydration. Cache freshness changes presentation priority, not server authority.
- A failed refresh keeps a valid cached value visible and marks it stale internally; it must not replace it with zero or initials.
- Logout clears rendered identity state immediately. Account switch invalidates pending requests through a generation token before hydrating the new user.
- Existing clients remain API owners: `ProfileClient`/profile fallback, `XPClient`, and the chips client continue making requests.

## Architecture

Add one plain-script module, for example `js/user-ui-state.js`, loaded after the auth bridge and before topbar consumers. It owns only:

- versioned, user-scoped cache reads and writes;
- defensive schema validation;
- hydration and update events;
- auth-generation race protection;
- `BroadcastChannel` and storage-event synchronization.

It must not duplicate Supabase auth, profile projection, XP calculation, or chips API code. Existing modules publish confirmed data into it and subscribe to relevant hydrated slices.

Suggested public surface:

```text
UserUiState.hydrate(userId)
UserUiState.publish(userId, slice, value, confirmedAt)
UserUiState.clearUser(userId)
UserUiState.clearRenderedState()
UserUiState.onChange(listener)
```

Supported slices are `profile`, `xp`, and `chips`. Unknown fields and slices are ignored.

## Cache design

Use separate records so one corrupt or expired slice cannot invalidate the others:

```text
kcswh:user-ui:profile:v1:<userId>
kcswh:user-ui:xp:v1:<userId>
kcswh:user-ui:chips:v1:<userId>
```

Each JSON record contains:

```json
{
  "version": 1,
  "userId": "supabase-user-id",
  "confirmedAt": 0,
  "value": {}
}
```

Allowlisted values:

- `profile`: `displayName` and the public avatar model (`type`, `variant`, public `url` when uploaded).
- `xp`: server-confirmed `totalLifetime` and derived/confirmed `level`.
- `chips`: server-confirmed display balance only.

Never store email, JWT, refresh token, Supabase session, profile `user_id`, avatar storage key, ledger data, or transaction details.

Initial maximum hydration ages:

- profile: 7 days;
- XP: 15 minutes;
- chips: 5 minutes.

These limits are UX controls, not correctness guarantees. Revalidation runs regardless of age. Expired or malformed entries are removed and produce the existing loading state. Storage failures must degrade to network-only behavior without throwing.

## Bootstrap sequence

1. Render a neutral, non-identity placeholder. Do not render a previous user's initials.
2. Resolve the local Supabase session through the existing auth bridge.
3. Increment an auth-generation token and capture the resolved `userId`.
4. Read only cache keys ending in that exact `userId` and verify the record's embedded identity.
5. Hydrate valid profile, XP, and chips slices without animations.
6. Start profile, `calculate-xp operation=status`, and chips requests in parallel through existing clients.
7. Before applying each result, confirm that the auth generation and current `userId` still match.
8. Update UI and cache only for successful, allowlisted responses. Skip DOM work when the normalized value did not change.
9. Keep hydrated data on individual request failure; expose loading/error only for a slice that had no safe cached value.

Non-game pages must not start an XP award session. Game pages preserve their current gameplay lifecycle and use hydration only for initial presentation.

## Avatar strategy

- Before identity is known, show a neutral avatar skeleton rather than initials tied to unknown state.
- After identity resolution, render the cached avatar model immediately.
- Uploaded avatars use the stable public processed URL; normal browser HTTP caching should avoid downloading an unchanged image again.
- Revalidate through the existing owner-profile endpoint in the background.
- A new upload publishes the new avatar model immediately after successful finalization.
- Restoring the default avatar removes the cached uploaded URL after server confirmation.
- Logout clears avatar DOM state before any asynchronous work. Account switch must never reuse the previous profile cache.

## XP strategy

- Hydrate only a server-confirmed authenticated total previously written after `calculate-xp` status or award success.
- Never hydrate authenticated XP from legacy optimistic or anonymous browser values.
- Revalidate with `calculate-xp` using `operation: "status"` and the current Bearer token.
- Hydration and status reconciliation update badge text without overlay, bump, or `+N XP` animation.
- A positive confirmed award updates the normal XP state first, then publishes the returned authoritative total to cache.
- Invalid token, network failure, or malformed response must not overwrite a cached total with zero.
- Logout switches to the established guest XP flow and does not project account cache into the guest identity.

## Chips strategy

- Cache only the last server-confirmed balance used for display.
- Hydrate it after authenticated identity resolution, then refresh through the existing chips client.
- Never use the cached balance to approve a claim, poker buy-in, transfer, or adjustment.
- Publish a new balance after every successful chips read and transaction response.
- On transaction failure, retain the last confirmed value and let the existing error UI describe the failed operation.
- Do not optimistically decrement or increment the shared cache unless the server response contains the resulting authoritative balance.

## Auth transitions and invalidation

### Logout

1. Increment auth generation and cancel application of old in-flight results.
2. Clear rendered profile, XP, and chips account state synchronously.
3. Remove the departing user's cached slices as the conservative MVP policy.
4. Continue with existing signed-out and guest rendering.

### Account switch

1. Apply logout invalidation for user A.
2. Resolve user B from Supabase; never use a standalone "last user" pointer for hydration.
3. Read only user B's keys and start new revalidation requests.

### Profile, XP, and chips updates

- Publish only after successful server confirmation.
- Include `userId`, slice, normalized value, `confirmedAt`, and an event ID.
- Ignore events for a different user or an older confirmation timestamp.

## Multi-tab synchronization

Use `BroadcastChannel("kcswh:user-ui:v1")` when available. Messages contain no tokens and carry only the same allowlisted cache record fields.

Use the browser `storage` event as fallback because writes use `localStorage`. A receiving tab validates version, slice, `userId`, timestamp, and value schema before applying an update. It must ignore its own event ID and must not trigger an API mutation or award animation.

Cross-device convergence remains request-based; this plan adds no realtime backend.

## Race handling

- Maintain a monotonically increasing auth generation in memory.
- Capture `{ generation, userId }` for every hydration and request.
- Check both values before DOM or cache writes.
- Deduplicate concurrent reads per slice where existing clients already expose an in-flight promise.
- Compare `confirmedAt` before applying cross-tab events so an older response cannot overwrite newer state.
- Treat malformed cache, quota errors, disabled storage, and unavailable `BroadcastChannel` as recoverable network-only states.

## Testing plan

### Contract and unit coverage

- Cache schema accepts only allowlisted fields and rejects wrong version/user ID.
- Malformed, oversized, negative, or non-finite XP/chips values are ignored.
- Logout and account switch invalidate pending results.
- Hydration emits no XP award animation or chips transaction effect.
- Storage failures fall back to loading plus network refresh.

### Browser coverage

- Uploaded avatar remains visible across full-page navigation without an initials flash after identity resolution.
- Default avatar remains correct and removal clears the uploaded image.
- XP and chips render cached confirmed values, then reconcile to changed server values.
- Failed requests retain cached values and do not force zero.
- Two accounts in one browser never see each other's topbar state.
- Two tabs converge through `BroadcastChannel`; storage-event fallback is also exercised.
- BFCache restore does not duplicate listeners, requests, or award animation.
- Representative root, nested game, account, public-profile, poker, and legal pages use the same bootstrap order.

### Manual smoke

1. Sign in with an uploaded avatar and known XP/chips.
2. Navigate repeatedly between root, a game, poker, account, and legal pages.
3. Confirm no initials or zero-value flash after the session resolves locally.
4. Change avatar and perform XP/chips-producing actions; confirm another tab updates.
5. Sign out and sign in as a second account; confirm no first-account data appears.
6. Simulate offline/network failure after one successful load; confirm cached display remains visibly stale rather than resetting.

## Proposed implementation split

### PR 1: Infrastructure and avatar

- Add `user-ui-state.js`, cache schema, auth generation, and cross-tab transport.
- Integrate profile publication and topbar avatar hydration.
- Add the shared script to every topbar page using existing page-validation tooling.
- Verify uploaded/default avatar, navigation, logout, account switch, and stale requests.

### PR 2: XP hydration

- Publish server-confirmed status and award totals from `XPClient`.
- Hydrate badge without award animation.
- Preserve guest/account separation, migration-notice rules, BFCache, and daily/session caps.

### PR 3: Chips hydration

- Publish server-confirmed balance reads and transaction results.
- Hydrate display only; all operations continue to query the authoritative server.
- Verify claims, profile history, poker transitions, account switch, and multi-tab updates.

Each PR must be independently deployable and pass existing lifecycle, XP, chips, auth, profile, static-page, and Playwright checks.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Previous user's data flashes after account switch | Resolve Supabase user first; require key and embedded `userId` match; use auth generation. |
| Cached value is stale | Always revalidate; bound hydration age; cache never authorizes operations. |
| Old request overwrites new identity | Check generation and user ID before every apply/write. |
| Cross-tab update loops | Event IDs, timestamp ordering, and no republish of received events. |
| Cache corruption or storage denial | Strict parsing and network-only fallback. |
| Hydration triggers XP animation | Separate hydration/status application from confirmed positive award effects. |
| Chips display implies transactional authority | Cache display balance only; all mutations remain server-confirmed. |
| Added script ordering differs between pages | Extend static page inventory guard and representative nested-page browser tests. |

## Breaking impact

No backend or data migration is planned. Frontend behavior changes from loading placeholders to last server-confirmed values after identity resolution. During a short revalidation window, XP or chips may be stale by design; product copy and accessibility state must not claim that cached values are freshly synchronized.

The main compatibility risk is script ordering across many static pages. Implementation must preserve plain-script/IIFE and JSP compatibility, use root-absolute assets where rewritten routes require them, use `klog` for diagnostics, and update CSP hashes if any inline bootstrap changes.

## Exit criteria

- No authenticated identity slice is rendered before Supabase user resolution.
- Full-page navigation hydrates valid cached avatar, XP, and chips without provisional initials or zeroes.
- Profile, XP, and chips revalidate in parallel and remain server-authoritative.
- Logout, account switch, stale requests, multi-tab updates, and BFCache are deterministic.
- No cached field can authorize or mutate account state.
- Existing account, XP, chips, bonuses, poker, public-profile, and game flows remain unaffected.
