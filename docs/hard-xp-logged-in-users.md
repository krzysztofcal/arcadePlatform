Hard XP for Logged-in Users – Specification (v1)
Arcade Hub — Functional & Technical Requirements
Scope: Implement persistent “hard XP” for authenticated Supabase users.
Out of scope: Anonymous → Account XP conversion (described in a separate spec).
1. Purpose
Arcade Hub currently supports:
Anonymous XP (“soft XP”), stored in an anon profile.
Supabase-based user accounts (login / signup).
Logged-in users do not yet have persistent XP bound to their accounts.
This document defines how to implement Hard XP (Account XP) stored on the server and keyed to the Supabase user.id.
Goals:
XP persists across devices for logged-in users.
Anonymous XP flow remains unchanged.
Backend never trusts userId from the client.
Design remains compatible with future:
anonymous → account XP auto-conversion,
chip / poker economy.
2. Product Goals
Logged-in players earn XP into a server-stored profile (UserProfile).
Anonymous players continue to earn XP via the existing anonymous profile.
XP for logged-in players is consistent across all devices using the same account.
Anonymous XP and Hard XP remain logically separated.
Implementation is compatible with planned auto-conversion of anon XP.
No regression to XP logic for guest users.
3. Definitions
3.1 Anon Profile
Existing anonymous XP structure, tracked by anonId and stored server-side (Upstash or equivalent).
Used for guests / non-authenticated players.
3.2 User Profile (Hard XP)
New persistent XP profile structure linked to Supabase user.id.
Fields:
userId – Supabase user.id (UUID).
totalXp – total Hard XP for this account.
createdAt – ISO timestamp when the profile was first created.
updatedAt – ISO timestamp of last XP change.
(future) hasConvertedAnonXp – flag for anon → account conversion v1.
(future) other fields for chip economy / stats.
3.3 Hard XP
XP that is:
tied to userId,
stored on the server,
shared across all devices / sessions for that account,
used later as the “authoritative” XP for chips and poker.
4. Functional Requirements
4.1 XP earning for logged-in users
If a user is logged in and the backend successfully verifies the Supabase JWT:
XP is awarded to UserProfile.totalXp.
If the user is not logged in or JWT verification fails:
XP is awarded to the anon profile (current behavior).
4.2 XP display (topbar, xp.html)
When logged in:
XP badges and XP page display Hard XP from UserProfile.totalXp.
When anonymous:
XP badges and XP page display the anon XP (existing behavior).
UI always shows a single XP number per context (no mixed display).
4.3 Cross-device consistency
Hard XP must be identical for the same Supabase user across all devices.
Earning XP on device A must be visible on device B after sync or reload.
Eventual consistency is acceptable (after next XP sync), but there must be no divergent “per-device” totals.
4.4 Backwards compatibility
Anonymous flow remains fully working and unchanged.
Logged-in XP starts accumulating only after login.
Auto-conversion of anon XP is not part of this spec, but must be supported later by extending UserProfile.
5. Technical Design
5.1 Data Model – UserProfile
Storage key pattern:
kcswh:xp:user:
Stored structure (conceptually):
userId: Supabase UUID of the user.
totalXp: integer, total Hard XP.
createdAt: ISO timestamp string.
updatedAt: ISO timestamp string.
Helpers required:
getUserProfile(userId)
Fetches profile from Upstash.
If not found, returns a default object with totalXp = 0 and fresh timestamps.
saveUserProfile(profile)
Persists profile back to Upstash.
Updates updatedAt.
Behavior:
totalXp must never become negative.
Data model must allow adding hasConvertedAnonXp later without migrations.
5.2 Backend – Identity verification
Backend logic (Netlify award-xp function):
Extract Supabase access token from request headers, for example from an Authorization header with a bearer token.
Verify the JWT using Supabase configuration (project URL and anon key or JWT secret).
Derive at least:
userId = JWT subject (sub).
emailVerified (from JWT or user metadata) if needed.
Rules:
Never trust userId supplied in the request body or query string.
If verification fails:
Either treat the request as anonymous and fall back to anon XP logic, or
Reject with 401 or 403.
The chosen behavior must be consistent and documented in the code.
5.3 Backend – Awarding XP for logged-in users
High-level flow:
Main handler awardXp:
Verifies Supabase JWT from request headers.
If JWT is valid and email is verified:
Calls awardXpForUser(userId, request).
Otherwise:
Calls existing awardXpForAnon(request).
awardXpForUser behavior:
Load profile using getUserProfile(userId).
Compute xpDelta using existing XP rules (score, combo, caps etc.).
Compute nextTotal = max(0, profile.totalXp + xpDelta).
Update:
profile.totalXp = nextTotal.
profile.updatedAt = now (ISO timestamp).
Save profile using saveUserProfile.
Return a response that includes at least:
userId.
totalXp (current hard XP after update).
Shared logic:
XP capping, daily limits, and anti-cheat logic should live in helpers reused by both anon and user paths.
Future anon → user conversion will also use UserProfile as defined here.
5.4 Frontend – XP requests when logged in
When logged in:
xpClient.js must:
Read the Supabase access token from the Supabase client or session.
Attach the token to all XP requests, for example via an Authorization header with a bearer token.
When not logged in:
XP requests remain unchanged (no Authorization header).
Backend treats these as anonymous and uses anon XP logic.
Frontend stays display-only:
It does not compute caps or totals.
It uses only the values returned by backend, which is the source of truth.
5.5 Frontend – Displaying XP
For XP pages and the topbar badge:
Detect Supabase session (logged-in vs guest).
Make XP fetch with or without token accordingly.
Render the XP field from the response:
Logged-in: use totalXp from UserProfile.
Anonymous: use existing anon XP fields.
No UX changes are required beyond choosing which value to display.
6. Security Requirements
Backend must never trust userId from client payload.
Hard XP writes only happen after successful JWT verification.
Hard XP must not be decremented below zero.
Each UserProfile is isolated per userId (no shared keys between users).
Data model must be compatible with:
hasConvertedAnonXp flag.
future chip economy fields.
A logged-in user must not be able to force XP to be stored as anonymous XP by faking identity.
7. Acceptance Criteria
AC1 – Anonymous users unchanged
Anonymous users still earn XP as before.
Existing daily caps and anti-cheat behavior remain valid.
AC2 – Logged-in XP persists across refresh
Steps:
Log in.
Play and earn XP.
Refresh the page.
Result:
Hard XP value remains and reflects earned XP.
AC3 – Cross-device consistency
Steps:
Log in as the same Supabase user on device A and device B.
Earn XP on device A.
Refresh or sync XP on device B.
Result:
Both devices show the same totalXp after sync.
AC4 – No spoofing of userId
Attempts to send a fake userId in request payload are ignored.
Only JWT-derived userId is used to select the profile.
AC5 – Correct data model
UserProfile is stored under the key kcswh:xp:user:.
Contains at minimum userId, totalXp, createdAt, updatedAt.
AC6 – Ready for conversion
Data model allows adding hasConvertedAnonXp without migrations.
No structural changes are required later to support anon → account conversion.
AC7 – No performance regressions
XP award requests are still fast enough for gameplay.
No visible slowdown versus the current anon-only XP system.
8. Implementation Plan (v1)
Phase H1 — Data Model and Helpers
Add getUserProfile(userId) and saveUserProfile(profile) helpers.
Store UserProfile in Upstash next to existing anon profiles.
Add basic unit tests for these helpers.
Phase H2 — JWT Verification in XP Backend
In award-xp Netlify function:
Read Supabase access token from headers.
Verify token and extract userId and emailVerified.
Add diagnostic logs that do not expose secrets.
Phase H3 — Award XP to UserProfile
Implement awardXpForUser(userId, request).
Integrate it into the main awardXp handler.
Keep anonymous XP award logic unchanged.
Phase H4 — Frontend Token Handling
In xpClient.js:
When Supabase session exists, attach Authorization with the bearer token to XP calls.
Anonymous flow remains unchanged.
Phase H5 — XP UI and Badge
Ensure XP badge and xp.html always read XP from the backend response.
Verify:
Logged-in: shows Hard XP.
Guest: shows anon XP.
Phase H6 — Regression and Cross-device Testing
Manual and automated tests:
Earn XP as guest: behavior unchanged.
Earn XP as logged-in user: XP persists after refresh.
Two devices logged in with same account: XP converges.
Ensure there is no duplicate XP, no negative XP, and no security warnings.
