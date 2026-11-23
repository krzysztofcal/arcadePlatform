# Feature Specification: T1, no profile refetch on repeated same-user auth events (#1313)

**Branch**: `1313-t1-profile-reads` · **Created**: 2026-11-23 · **Base**: `main` @ `e663883e`
**Origin**: split out of PR #1317 by OWNER decision (2026-11-23). Diagnosis and evidence are in `specs/1313-profile-me-latency/` on branch `1313-profile-me-latency`. T2 (XP status) is a separate task: `specs/1313-t2-xp-status-dedup/`.

## Problem
Each Account open sends 3 base `profile-me` reads instead of 1. Each auth event for the same user (`INITIAL_SESSION`, `SIGNED_IN`, `TOKEN_REFRESHED`) refetches the profile after the previous read has finished. Every extra read also takes the `account-lifecycle` lock on the server.

## Requirements
- **FR-001** `js/account-page.js::renderUser`, same user key: the profile and Poker sections each reload only if they have no successful or in-flight read in the current `publicProfileGeneration`.
  - A user-key change keeps the existing reset and reload of both.
  - Sign-out resets both states.
  - An earlier failure or a cancelled read reloads on the next event.
  - The explicit profile-write paths (avatar save and conflict, Google photo, `profile:updated`) are unchanged.
- **FR-002** `js/auth/supabaseClient.js`, **ProfileClient path only**:
  - after a published profile (`profileConfirmedUserId`), a same-user auth event renders from `state.profile` and skips `refreshProfile`;
  - a late answer or failure from an earlier session (`profileSessionGeneration`, advanced on sign-out and on a user change) or from a non-current user/UI generation changes nothing;
  - a current failure clears the mark.
- **FR-003** The legal-page fallback without `ProfileClient` behaves **identically to main**: every event reads, and late answers and failures are handled as before. Proven by running the fallback tests against main's file.
- **FR-004** No XPClient, `xp/core`, token, XP generation or `calculate-xp` change. No server, DB, HTML, CSS, SRI or legal change. ES5 IIFE, `klog`/`logDiag` only.

## Success Criteria
- **SC-001** Base `profile-me` reads per Account open: 3 → 1 (Deploy Preview, Netlify request logs, OWNER real device).
- **SC-002** The fundamental tests below pass. The new dedup tests fail against main's code; the fallback tests pass identically on main and T1.
