# Hard XP for Logged-in Users – Specification (v1)
Arcade Hub — Functional & Technical Requirements  
Scope: Implement persistent “hard XP” for authenticated Supabase users.  
Out of scope: Anonymous → Account XP conversion (handled in a separate spec).

---

## 1. Purpose

Arcade Hub currently supports:
- Anonymous XP (“soft XP”), stored in an anon profile.
- Supabase-based user accounts.

Logged-in users do **not** yet have persistent XP bound to their accounts.  
This document defines how to implement **Hard XP (Account XP)** stored on the server and keyed to the Supabase user ID.

Goals:
- XP persists across devices for logged-in users.
- Anonymous XP flow remains unchanged.
- Backend never trusts userId from the client.
- Design remains compatible with future XP conversion and chip system.

---

## 2. Product Goals

1. Logged-in players earn XP into a server-stored profile (`UserProfile`).
2. Anonymous players continue to earn XP as today.
3. XP for logged-in players is consistent across all devices using the same account.
4. XP for anonymous players remains isolated.
5. Implementation remains compatible with planned auto-conversion of anon XP.
6. No regression to XP logic for guest users.

---

## 3. Definitions

### Anon Profile
Existing anonymous XP structure tracked by `anonId` and stored server-side. Used for all anonymous users.

### User Profile (Hard XP)
A new persistent XP profile structure linked to Supabase `user.id`. Fields include:
- `userId`
- `totalXp`
- `createdAt`
- `updatedAt`
- (future) `hasConvertedAnonXp`

### Hard XP
Permanent XP tied to Supabase userId, stored in Upstash (or same backend store).

---

## 4. Functional Requirements

### 4.1 XP earning for logged-in users
- If a user is logged in and the backend verifies the Supabase JWT:
  - XP is added to `UserProfile.totalXp`.
- If user is not logged in:
  - XP is added to the anon profile (current behavior).

### 4.2 XP display (topbar, xp.html)
- Logged-in → display Hard XP from `UserProfile.totalXp`.
- Anonymous → display anon XP.
- UI always shows a single XP number.

### 4.3 Cross-device consistency
- Hard XP must be identical for the same Supabase user across all devices.
- Earning XP on device A must update visible XP on device B after sync/refresh.

### 4.4 Backwards compatibility
- Anonymous flow remains fully untouched.
- Logged-in XP begins accumulating only after login, until conversion is implemented.

---

## 5. Technical Design

### 5.1 Data Model — UserProfile

Storage key pattern:
kcswh:xp:user:
Skopiuj kod

Stored structure:
```json
{
  "userId": "<Supabase UUID>",
  "totalXp": 12345,
  "createdAt": "2025-01-01T00:00:00Z",
  "updatedAt": "2025-01-02T00:00:00Z"
}
Helpers required:
getUserProfile(userId)
saveUserProfile(profile)
Behavior:
If no profile exists, getUserProfile returns default (totalXp = 0).
XP never becomes negative.
5.2 Backend — Identity verification
Backend must:
Extract the Supabase access token from the request.
Verify the JWT using Supabase configuration.
Derive:
userId = jwt.sub
emailVerified
Never trust userId supplied by the browser.
If verification fails:
Treat request as anonymous or reject (implementation decision).
5.3 Backend — Awarding XP for logged-in users
Pseudocode outline:
Skopiuj kod

awardXp(request):
    auth = verifySupabaseJWT(request.headers)
    userId = auth.userId if verified else null
    emailVerified = auth.emailVerified if verified else false

    if userId and emailVerified:
        return awardXpForUser(userId, request)
    else:
        return awardXpForAnon(request)   # existing logic
Where:
Skopiuj kod

awardXpForUser(userId, request):
    profile = getUserProfile(userId)
    xpDelta = computeXpForThisEvent(request)
    profile.totalXp += xpDelta
    saveUserProfile(profile)
    return updated XP totals
5.4 Frontend — XP requests when logged in
When logged in:
xpClient.js must attach Supabase access token to all XP requests.
When not logged in:
XP requests stay unchanged.
Front-end does not compute XP caps or totals—backend remains the source of truth.
5.5 Frontend — Displaying XP
Flow for XP pages and topbar badge:
Check Supabase session.
If logged-in:
Send XP request with token.
Backend returns Hard XP.
If anonymous:
Use anon XP as today.
No UI changes required other than using xp.totalXp from the response.
6. Security Requirements
Backend must not trust a client-sent userId.
XP for logged-in users must only be written after JWT verification.
Hard XP cannot be decremented below 0.
Data model must support future fields needed for anon→user conversion and chip economy.
Server storage of Hard XP must be isolated per userId.
7. Acceptance Criteria
AC1 – Anonymous users unchanged
XP earning, caps, and behavior remain identical to existing system.
AC2 – Logged-in XP persists across refresh
Login → play → refresh → Hard XP remains.
AC3 – Cross-device behavior
Same Supabase account on device A and B reflect the same XP eventually.
AC4 – No spoofing
Backend rejects or ignores attempts to state a fake userId.
AC5 – Correct data model
UserProfile stored at kcswh:xp:user:<userId> and contains totalXp.
AC6 – Ready for conversion
UserProfile structure supports adding hasConvertedAnonXp later without migration.
AC7 – No performance regressions
XP earning remains fast.
8. Implementation Plan (v1)
Phase H1 — Data Model & Helpers
Add getUserProfile(userId) and saveUserProfile(profile) functions.
Store profiles in Upstash alongside anon profiles.
Phase H2 — JWT Verification in XP Backend
Read and verify Supabase access token inside award-xp Netlify function.
Extract userId, emailVerified.
Phase H3 — Award XP to UserProfile
Implement awardXpForUser(userId, request).
Keep anon award logic untouched.
Phase H4 — Frontend Token Handling
xpClient.js: attach access token for logged-in users.
Anonymous behavior unchanged.
Phase H5 — XP UI & Badge
Display totalXp returned by backend.
Logged-in behavior identical across pages.
Phase H6 — Regression & Cross-device Testing
Earn XP in logged-in state.
Reload.
Log in on a second device or browser; verify XP is consistent.
