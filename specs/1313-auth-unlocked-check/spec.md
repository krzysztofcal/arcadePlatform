# Feature Specification: lockless account-active check for request authentication (#1313)

**Branch**: `1313-auth-unlocked-check` (PR #1325, git branch `1313-auth-shared-lock`) · **Base**: `main` @ `04e281a7` · **Status**: OWNER "napraw to" 2026-11-25.

## Problem (measured on Production, 2026-11-25)
- One signed-in page load fires about 9 function calls at once. They took 7.5–18.9 s each, and XP, CH and the avatar appear only after that.
- In the 24 h before the 2026-11-25 release: `profile-me` p50 6.7 s / p90 19.6 s, `chips-balance` p50 5.8 s / p90 14 s, `calculate-xp` p90 27.7 s.
- Cause: with `ACCOUNT_DELETION_ENABLED=1`, `verifySupabaseJwt` ran `assertAccountActive` in a standalone transaction under the **exclusive** `account-lifecycle` advisory lock. Parallel requests of one account therefore queued one by one. `calc_xp_timing.jwtMs` was 0.5–1.9 s.
- Side effect: the owned-write trigger `account_guard_owned_write_v2` uses an exclusive `pg_try_advisory_xact_lock`, so writes to `favorites`, `user_profiles` and `bonus_claims` that overlapped any such check failed with 40001.

## Requirements
- **FR-001** `shared/account-deletion.mjs::assertAccountActiveUnlocked(tx, userId)` runs the same present/not-deleting check as `assertAccountActive`, with no advisory lock.
- **FR-002** Only `netlify/functions/_shared/supabase-admin.mjs::verifySupabaseJwt` uses it, in a transaction that does nothing else.
- **FR-003** `assertAccountActive` (exclusive lock) stays unchanged for every writer, the WS server included.
- **FR-004** The Account Deletion guarantee is unchanged:
  - a committed deletion request is visible to the check (READ COMMITTED);
  - every write re-checks under the exclusive lock in its own transaction.

## Success Criteria
- **SC-001** A fundamental test (`tests/account-deletion.behavior.test.mjs`): the same results as `assertAccountActive` for active, deleting and missing accounts; one query; no advisory lock.
- **SC-002** After release: the `calc_xp_timing.jwtMs` p50 and the page-load function durations drop on Production (Netlify logs and observability, aggregates only).
