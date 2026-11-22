# Implementation Plan: profile-me latency, scope 1 (#1313)

**Branch**: `1313-profile-me-latency` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md) | **Research**: [research.md](research.md)
**Validation**: `node --test tests/account-auth.contract.test.mjs tests/account-page.test.mjs tests/xp-client.test.mjs tests/xp-client-contract.test.mjs tests/xp-core-authoritative-reset.test.mjs tests/xp-client-bfcache.test.mjs tests/xp-badge.test.mjs tests/mobile-legal-packaging.test.mjs`, run with the `scripts/test-all.mjs` environment. The new tests in `tests/topbar-contract.test.mjs` are run separately: that file has 5 failures that already exist on `main` and is not in CI. Then CI on the Draft PR and the Deploy Preview.

## Diagnosis (2026-11-22, read-only)
| Measure | Production (`308806cc`, 24 h) | Preview #1311 (Stage DB) |
|---|---|---|
| `profile-me` p50 / p90 / p99 | 2.33 s / 9.5 s / 21.1 s | 1.49 s / 2.4 s / 2.84 s |
| Base GET, function time (warm) | – | 466–476 ms (about 7 DB round trips × ~65 ms; each query < 0.5 ms in the DB) |
| Time before the function starts (cold or extra instances) | – | 50–970 ms |
| `calculate-xp` POSTs at the start of Account open | 8 in the same ms (09:36:55) | 8 in the same ms (18:03:43), finishing in a 2.2 s step queue |
| Base `profile-me` reads per Account open | – | 3 (t0, +0.75 s, +2.4 s) |

**Causes**
1. **Outliers:** the `account-lifecycle` lock queue fed by concurrent XP status reads (research R2, R3).
2. **Base latency:** functions in `iad` and the DB in `eu-west-3` (research R1).
3. **Redundant reads:** `ProfileClient` shares only in-flight reads. The base reads that follow are started by separate auth events after the first read has finished:
   - `supabaseClient.js::hydrateSession`, then `applyResolvedUser`, then `refreshProfile`;
   - `account-page.js::hydrateUser` and `onAuthChange`, then `renderUser`, then `loadPublicProfile(true)`.
4. **Uncoalesced XP status:** `XPClient.fetchStatus` has no shared in-flight request. Its callers include:
   - `refreshBadgeFromServer` (topbar, `handleAuthChange`);
   - `refreshInitialStatus`;
   - `xp/core.js::refreshStatus` / `maybeRefreshStatus` / `reconcileWithServer`;
   - `ensureStatusBootstrap`.

## Constitution Check (v1.6.0)
| Gate | Result |
|---|---|
| I Simplicity / reuse | PASS. Changes stay in existing functions, with no new module, endpoint or dependency |
| II Runtime boundaries | PASS. No WS or Poker state change. Poker projection freshness is unchanged |
| III Fail-closed | PASS. No server, lock or Account Deletion change. Stale answers are rejected, never applied |
| IV JSP / logging / CSP | PASS. IIFEs, `klog` only, no inline script or CSS. SRI pins on non-legal pages; `legal/*.html` stays unchanged (#1314) |
| V Tests | PASS. Fundamental contract tests in existing files only. No DOM/CSS suite |
| VI Workspace | The agy implementation worktree is allocated through the preflight on the verified Volume. The coordinator reuses its existing checkout |

## Changes (scope 1)
- **`js/account-page.js::renderUser`** (FR-001): for the same user key, start `loadPublicProfile(true)` only if `profileLoadState` is not `success`/`loading` for the current `publicProfileGeneration`. Start `loadPokerProjection(true)` only if Poker has no successful or in-flight read. Use a small `pokerLoadState` mirroring the profile state. A user-key change keeps the existing reset path.
- **`js/auth/supabaseClient.js::applyResolvedUser` / `refreshProfile`** (FR-002): track `profileConfirmedUserId`.
  - Set it after a successful publish in `refreshProfile`.
  - Clear it on a user change, on sign-out and in the `refreshProfile` failure branch.
  - Same user with the mark set: render from `state.profile` and skip `refreshProfile`.
- **`js/xpClient.js::fetchStatus`** (FR-003): `state.statusInFlight = {key, generation, promise}`, with `key = authSubject|anonId|awardSessionId` (auth subject decoded from the token already used in `buildAuthHeaders`).
  - `state.statusGeneration` advances in `handleAuthChange`, `clearServerSession` and `clearIdentityBoundXpCache`.
  - After the response, a key or generation change throws `{code:'stale_identity'}`.
  - Callers (`refreshBadgeFromServer`, `xp/core.js::refreshStatus`/`reconcileWithServer`, `refreshInitialStatus`) ignore that code: they apply nothing and show no error badge.
  - Finished answers are not kept.
- **SRI**: none of the changed scripts is pinned, so no HTML changes.

## Measurement (before = `e663883e`, after = PR Deploy Preview; Stage DB for both)
1. The OWNER opens Account on a real device five times: a cold load, then reloads 10 s apart, signed in.
2. Claude Code reads Netlify observability for that branch and window:
   - count base `profile-me`, `includePoker` and `calculate-xp` requests per open (grouped by start time, referrer `account.html`);
   - edge duration vs function duration (request detail);
   - p50/p99 per function.
3. Stage Postgres logs, same window: count and size of `account-lifecycle` waits over 1 s (`log_lock_waits`).
4. A `pg_stat_statements` snapshot before and after for the advisory-lock statement (calls, total ms). Delta only, no reset.
5. Report each SC as measured, with a short table. No identifiers.

Production before/after needs a later OWNER publication. It is not part of this PR.

## Risks
- **R-A:** a same-user profile change made in another tab or device is no longer picked up on a later auth event; it shows up on the next page load or `profile:updated`. #1309 already accepted the same staleness between events.
- **R-B:** XP badge regressions if a caller treats `stale_identity` as an error. Mitigated by caller-level handling and the XP contract tests.
- **R-C:** `handleAuthChange` still regenerates the award session on every auth event, so it still starts one new status read per event. Removing that is out of scope: it changes identity-bound cache semantics.
- **R-D:** the scripts are shared between WWW and the APK, so the APK needs a new build to get the change.

## Out of scope / HOLD
- Scope 2 (server XP no-op skip): research R5–R7, separate GO.
- Scope 3 (`profile-me` GET without the lock): HOLD.
- Scope 4 (Functions region): HOLD. Needs a plan upgrade (Pro), the Upstash region, and the Candidate/Publish path.
- `chips-balance` dedup (#1315), profile source of truth (#1312), legal SRI pins (#1314).
