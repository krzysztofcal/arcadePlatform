# Feature Specification: profile-me latency, scope 1 (#1313)

**Feature Branch**: `1313-profile-me-latency` · **Created**: 2026-11-22 · **Base**: `main` @ `e663883e` (includes #1311)
**Status**: Scope 1 (client) in implementation. Scope 2 (server XP) is an analysis only, awaiting a separate OWNER GO. Scopes 3 and 4 are HOLD.

## Problem (evidence, 2026-11-22; details in [plan.md](plan.md) §Diagnosis)
- Large `profile-me` outliers (5–21 s) come from queueing on the `account-lifecycle:<user>` advisory lock. The function region is not the cause of these outliers.
- On every Account open the browser sends up to 8 concurrent `calculate-xp` POSTs. Each status read holds that lock in two transactions that also make Upstash calls. `profile-me` takes the same lock and waits at the end of the queue.
- Each Account open also sends 3 base `profile-me` reads instead of 1, because repeated auth events for the same user refetch the profile.

## Scopes
| Scope | Content | State |
|---|---|---|
| **1 (this PR)** | T1: no profile refetch on repeated auth events for the same user. T2: shared concurrent `XPClient.fetchStatus()` reads | Implementation |
| 2 | Server: skip no-op `migrateAnonXpToUser` / profile-snapshot transactions | Analysis only ([research.md](research.md)); separate GO |
| 3 | `profile-me` GET without the lifecycle lock | **HOLD**: the account-lifecycle guarantee is unchanged |
| 4 | Netlify Functions region | **HOLD**: read-only verification only |

## User Scenarios & Testing *(mandatory)*

### User Story 1: One profile read per Account open (P1)
A signed-in player opens Account. The topbar and the Account page together send one base `profile-me` read and one `includePoker` read. Later auth events for the **same** user (`INITIAL_SESSION`, `SIGNED_IN`, `TOKEN_REFRESHED`) do not trigger a new read and do not reset the status to "Loading your profile…".
**Test**: a same-user auth event after a successful read makes no request; a request is still made after an account switch, a sign-out followed by a sign-in, a profile write, or a failed earlier read.

### User Story 2: One XP status read per moment (P1)
Concurrent `XPClient.fetchStatus()` callers on one page share one `calculate-xp` status request, but only while they have the same identity key (auth subject, anon id and award session id). A caller never receives an answer issued for another identity key or for an older generation.
**Test**: N concurrent callers → 1 request; a call after an identity or session change → a new request; an older answer that resolves after a change is not delivered to callers of the new key and is not applied to the badge.

### Edge Cases
- Account switch, or sign-out then sign-in → the generation changes. Older profile, Poker or XP answers render and apply nothing.
- A failed or cancelled earlier read (`stale_identity`) still lets the next event refresh the same user; the existing single retry stays.
- `profile:updated` and the profile-write paths (`updateMe`, avatar save, Google photo actions) keep refreshing as before.
- A finished answer is never reused: there is no finished-answer cache in `ProfileClient` (#1309 R7) or in `XPClient`.
- On legal pages the pinned old `profile-client.js` is skipped (#1314): the topbar fallback is unchanged.

## Requirements *(mandatory)*
- **FR-001** `js/account-page.js::renderUser`, for the same user key, starts `loadPublicProfile`/`loadPokerProjection` only when that section has no successful or in-flight read in the current `publicProfileGeneration` (for example idle, error or cancelled). A user-key change keeps the existing reset and reload.
- **FR-002** `js/auth/supabaseClient.js::applyResolvedUser`, for the same user, skips `refreshProfile` once a server profile was published for that user in the current UI generation. A user change, sign-out or failed load clears that mark.
- **FR-003** `js/xpClient.js::fetchStatus` shares one in-flight request per identity key (auth subject from the token, anon id, award session id) and per status generation. `handleAuthChange`, `clearServerSession` and identity resets advance the generation. When the key or generation changed before the answer arrived, the answer is rejected with code `stale_identity` and is not applied. Callers treat that code as a no-op, not as an error state.
- **FR-004** No server, DB, migration, flag, endpoint, CSS or inline-script change. JSP-compatible IIFEs, `klog` only. Changed scripts get updated SRI pins on non-legal pages only; `legal/*.html` stays byte-identical (#1314).

## Success Criteria *(mandatory)*
Measured with the method in plan §Measurement, comparing the base `e663883e` with the PR Deploy Preview:
- **SC-001** Base `profile-me` reads per Account open: 3 → 1. `includePoker` reads: 1 → 1.
- **SC-002** `calculate-xp` status POSTs started in the same 100 ms window on Account open: up to 8 → 1.
- **SC-003** Stage: `account-lifecycle` lock waits over 1 s per Account open (Postgres `log_lock_waits`) drop. `profile-me` p99 on the Preview is under 3 s. This is reported as measured, not guaranteed.
- **SC-004** No regression in the fundamental tests listed in tasks T005, and the OWNER real-device acceptance on the Deploy Preview passes.
