# Automatic public profiles and leaderboard privacy

## Confirmed current state

Before this change, `public.user_profiles` existed with safe public identity fields, RLS deny-all access, case-insensitive handles, avatar support, and `ON DELETE CASCADE` ownership through `auth.users`. Profile creation was lazy: `profile-me`, avatar operations, or the admin `profile_coverage` maintenance operation called the Node `ensureUserProfile()` helper. Supabase signup itself created only the `auth.users` row. A new account could therefore exist without a profile until an authenticated profile surface or maintenance task ran.

The XP award path writes authenticated users directly to Redis leaderboard projections. Public leaderboard reads join those members to `user_profiles` and omit members without a profile. This made profile coverage an operational prerequisite rather than a database invariant. There was no owner opt-out from leaderboard inclusion.

## Implemented architecture

### Database-owned provisioning

Migration `20260713090000_user_profile_provisioning_visibility.sql` makes profile existence an account-lifecycle invariant:

- `public.ensure_user_profile(uuid)` is the single idempotent profile constructor.
- An `AFTER INSERT` trigger on `auth.users` invokes it in the account-creation transaction.
- Concurrent calls for the same user return the same row through `ON CONFLICT DO NOTHING` plus a read of the winning row.
- Handle collisions generate another identity, with a bounded 16-attempt limit.
- Generated handles, names, and avatar variants use curated local values and randomness only. They never derive from email, auth metadata, UUID, IP address, or real name.
- The existing Netlify helper calls the same database function as a repair path; it no longer owns a parallel identity generator.
- The migration backfills pre-existing auth accounts that lack profiles. Routine `profile_coverage` maintenance is no longer required for normal signup, but remains available as a diagnostic and repair tool.

The trigger is deliberately allowed to fail account creation if all bounded identity attempts fail. This preserves the stronger invariant that a successfully created account already has a valid profile; silently creating an account without one would recreate the original operational gap.

### Leaderboard privacy

`user_profiles.leaderboard_visible` is `NOT NULL DEFAULT true`. The owner API exposes it as `leaderboardVisible`; public profile responses do not expose the preference. The account Settings UI presents the inverse control, "Hide my profile from the leaderboard", which is unchecked for new accounts.

Hiding affects only leaderboard membership. `/u/<handle>` remains public and continues to show the public profile and lifetime XP under the existing product policy.

Leaderboard privacy is enforced in two layers:

1. SQL profile joins and maintenance queries include only `leaderboard_visible = true`, so a hidden account is never projected in a public row even if Redis is temporarily stale.
2. A Redis hidden marker prevents gameplay awards and anonymous-XP conversion from re-adding the member. The profile update path atomically synchronizes that marker with all-time, current-day, and current-week projections. Re-enabling visibility rebuilds those projections from canonical XP counters rather than from client data.

Synchronization order depends on the direction of the privacy change:

- Opt-out writes the Redis hidden marker and removes all projections before setting `leaderboard_visible = false`. If Redis is unavailable, the database remains visible and the PATCH fails without leaving a hidden database row that can still influence raw ranks. If the later database write fails, the account is temporarily omitted from the leaderboard, which is the privacy-safe partial state; retrying the same PATCH converges both stores.
- Opt-in sets `leaderboard_visible = true` before removing the marker and rebuilding projections. If Redis is unavailable, the account remains omitted until the owner retries. Repeating the same visibility PATCH is supported, so either partial state can be repaired idempotently.

## API and UI contract

`GET /.netlify/functions/profile-me` includes:

```json
{
  "leaderboardVisible": true
}
```

`PATCH /.netlify/functions/profile-me` accepts a boolean `leaderboardVisible`. Non-boolean values return `invalid_leaderboard_visibility`. Public profile and leaderboard payloads still use explicit allowlists and never return the database flag, user UUID, email, Redis keys, chips, or auth metadata.

The Settings control is saved with the existing public-profile form, loading state, success feedback, auth-safe cache, and `profile:updated` event. It does not optimistically alter rank or XP.

## Rollout and verification

1. Apply the migration through the existing DB Stage Apply PR workflow.
2. On stage, create a new Supabase account and verify a matching `user_profiles` row exists before calling `profile-me`.
3. Confirm generated public values contain no email or UUID fragments and `leaderboard_visible = true`.
4. Hide the account in Settings. Verify all three leaderboard periods omit it and `xp-leaderboard-me` returns `me: null`.
5. Earn XP while hidden and verify the account remains absent.
6. Re-enable visibility and verify all-time, today, and week values are restored from canonical XP.
7. Retry both visibility values to confirm idempotency.
8. Apply the same migration to production, then repeat signup and visibility smoke tests.

No new environment variables are required. Existing Supabase DB and Upstash credentials are reused.

## Breaking impacts

- Every successful Supabase account creation now writes a public profile in the same database transaction.
- A failure in profile generation now fails signup instead of allowing an account without a profile.
- The generated identity implementation moves from Node to PostgreSQL; existing profile identities are unchanged.
- Existing accounts missing profiles are backfilled during migration and become publicly reachable under the already approved public-profile policy.
- Hidden users are removed from rank calculations as well as rendered rows, so ranks and page boundaries can change immediately after an opt-out.
- `profile-me` gains an owner-only field and PATCH validation code; public API contracts remain unchanged.
- The maintenance `profile_coverage` operation remains compatible but should be treated as repair tooling, not a required deployment step.
