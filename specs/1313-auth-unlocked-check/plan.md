# Plan: lockless account-active check (#1313)

## Change
- `shared/account-deletion.mjs`: extract `requireActiveRow`; add `assertAccountActiveUnlocked` with a contract comment that it is never used before a write.
- `netlify/functions/_shared/supabase-admin.mjs`: `verifySupabaseJwt` → `assertAccountActiveUnlocked`.
- Test: one case in the existing `tests/account-deletion.behavior.test.mjs`.

## Review (Claude, round 1)
- The first version used a shared lock. It was replaced by no lock: a lock in a standalone, immediately committing transaction protects nothing, and it still collides with the trigger's try-lock.
- Deferred follow-ups:
  - the WS per-frame active check still takes the exclusive lock (needs a WS behaviour change);
  - log the error code instead of mapping every verify DB error to `account_not_active`;
  - `profile-me` GET and `chips-balance` still take the exclusive lock on read (lock only on create).

## Release
- `shared/` and `supabase-admin.mjs` are packaged by WS Server Deploy, so the WS surface changes. WS does not call `verifySupabaseJwt`, so its behaviour is unchanged.
- Order:
  1. WS Preview Deploy before the end-to-end preview check;
  2. OWNER merge;
  3. WS Server Deploy of the merged SHA (OWNER approval in `ws-production`);
  4. WWW Candidate (after the OWNER GO) and Publish (OWNER).
- Preview cannot show the effect, because Preview has no `ACCOUNT_DELETION_ENABLED`. Measure on Production (SC-002).

## Constitution Check (v1.6.0)
| Gate | Result |
|---|---|
| I Simplicity | PASS: one helper and one call site |
| II Authoritative runtime | PASS: WS behaviour unchanged |
| III Fail-closed | PASS: the deletion check and the writer locks are unchanged |
| IV Logging | PASS: no `console.log` |
| V Fundamental tests | PASS: one case in an existing file |
