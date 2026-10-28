# Feature Specification: Authenticated player profiles and XP leaderboard

**Feature:** #1158; **Created:** 2026-10-28; **Status:** Local implementation authorized by OWNER, not pushed or deployed. Branch feat/1158-authenticated-profile-reads, based exactly on #1155 SHA810a77b1ed7a341f95eb2f9ce2c1099543a6c9bb. Independent from #1155 and #1157. Supersedes only #1154's assumption that profile pages remain anonymous; no SSO design is approved. Local ignored SpecKit feature selection points to this directory after the authorized branch switch.

## User Scenarios & Testing

### User Story 1 — Read profiles and ranking after login (P1)

A visitor must sign in before viewing a player profile or XP leaderboard. Direct requests cannot bypass the login requirement. Signed-in users see the existing permitted data; blocked profiles remain unavailable even to signed-in viewers through another player's profile link.

Acceptance: missing/invalid/expired or wrong-environment credentials yield a safe401 without identity/rows; valid authentication allows existing reads. Blocked/unknown handle yields the same404 after authentication. Leaderboard opt-out remains independent of operator suppression. Refused requests do not reveal whether a target exists.

### User Story 2 — Keep private access and table play intact (P1)

Owners keep full Account access and deletion/security operations. Table participants retain the identity needed to play, with existing operator-block fallback. Login gates for directory-style reads do not interrupt reconnect, Resume, Leave or settlement, nor change balances, XP, seats or game state. Offline remains independent.

Acceptance: existing owner/access and identity-suppression regressions remain valid; no new funded game is required solely to prove this change.

### User Story 3 — Follow an APK profile link honestly (P2)

A signed-in app user opens the existing profile link in an external browser. If that browser lacks its own session, it clearly requests browser login instead of claiming that the app is logged out or transferring credentials. After browser login, Back/reopening the original link permits the authenticated read. Existing browser sessions work normally. App and browser logout/account changes remain independent and are described honestly.

**OWNER-approved minimal UX (local implementation GO):** browser login fallback using the existing Account page. Keep existing external navigation and shared profile UI. Seamless SSO or an authenticated in-app page would add a separate implementation/security surface; neither is needed for this proposal. No access/refresh token or authentication code is transferred via URL, page messages, clipboard or shared storage. Standard existing OAuth callback handling is unchanged.

### Edge cases

- Session resolves after page load; expired session or account switch during a response; logout while a request is pending; browser Back restores a stale document. Clear rendered identity/rows and invalidate in-flight work before reuse.
- A blocked or opted-out person was visible in a previous response. Do not cache fresh authenticated data publicly or treat cached rows as authorization. Previously delivered screenshots/copies cannot be recalled.
- App points to Stage1155 but new feature is on another Preview: do not call this a compatible Android acceptance. Pin the tested APK/API/WS environment under a separate later build GO.
- Site shell can load anonymously; it must not contain embedded player data. Noindex does not provide authentication.

## Requirements

- FR001: Both profile and leaderboard data reads require current server-verified authentication, independent of Origin/Referer/client UI; no new anonymous alternate projection.
- FR002: Preserve generic404 for blocked/unknown profiles, operator-only block writes, independent leaderboardVisible, owner access and existing table suppression/replay protections.
- FR003: Reuse existing login/session and public-profile/leaderboard clients; clear sensitive view state on session loss/switch and reject stale responses. No second profile UI, framework or policy fetcher.
- FR004: Return no-store for gated responses, including failures; no authenticated player data in shared CDN/browser caches or initial HTML. Profile/ranking pages and routes receive noindex without weakening CSP.
- FR005: Offer clear PL/EN login guidance and browser-session limitation. No JWT in links, history, analytics, logs or referrers; no new SSO exchange.
- FR006: Reconcile PL/EN signup/Google notice, Terms/Privacy proposals, player-facing copy and Play Data safety with “visible to signed-in users.” Do not overwrite immutable published legal history or activate Terms as a side effect.
- FR007: No schema migration, flag activation, new account, financial write, gameplay change or new public directory. Android/WS deployment requires separate scope-specific GO.

## Key Entities

Existing viewer session, target profile handle, operator block, independent leaderboard preference, leaderboard rows and client request generation. No new database entity or stored handoff credential.

## Success Criteria

1. Anonymous direct HTTP reads return no profile/leaderboard identity or rows; valid signed-in requests work with preserved404/opt-out rules.
2. Owner and active-table paths retain current authorized behavior and operator fallback, without new funded smoke.
3. Manual WWW session loss/change and real Android browser-link checks pass with an explicit safe login fallback; no secret appears in navigation or logs.
4. Exact tested Preview/API and final release SHA are recorded; PL/EN behavior is consistent. Technical acceptance is not LEGAL or Google Play compliance approval.

## Assumptions and open gates

No new schema is needed beyond #1155's Stage121 and Production additive69. OWNER accepted the browser-login fallback and local implementation; seamless SSO remains deferred in #1154. Restricted audience reduces anonymous exposure but does not itself resolve GDPR Art25(2), minors, worldwide signed-in visibility or retention risk; LEGAL OPEN. Implementation GO covers local work only; push/new PR, Preview smoke, APK, Production release and merge still require their respective GO.
