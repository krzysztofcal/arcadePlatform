
XP Anonymous → Account Auto-Conversion Specification (v1)
Arcade Hub – Functional & Security Requirements
1. Purpose
Arcade Hub supports gameplay for both anonymous users and logged-in users. Anonymous players earn XP normally, but their XP is stored in a temporary, browser-bound anonymous profile.
This document defines the official mechanism for automatically converting anonymous XP to a permanent account, once per user, after they create and verify an account.
The goal is to:
Reward users who played before logging in
Reduce loss of progress
Keep the system secure and cheat-resistant
Prevent multiplying XP via anonymous sessions or device hopping
2. Key Product Goals
Allow everyone to earn XP anonymously.
Automatically convert anonymous XP once when a user creates a verified account.
Limit how much anonymous XP can be converted to prevent abuse.
Ensure conversion is atomic and cheat-proof.
Anonymous XP continues to exist after conversion but can never be converted again for that account.
Users are informed once, passively, with no “Convert” button.
3. Definitions
AnonProfile
A temporary XP profile stored client-side with an anonId, synced to Upstash by the XP server.
Properties include:
anonId
totalAnonXp
anonActiveDays
lastActivityTs
convertedToUserId (null until converted)
createdAt
Hard XP (Account XP)
XP linked to:
a Supabase user ID
persistent, secure storage
Conversion
Permanent, one-time transfer of a limited amount of XP from an AnonProfile into a Supabase user’s XP balance.
4. Conversion Trigger (Automatic)
4.1 When does conversion run?
Conversion is automatically attempted on the first verified account session that hits:
account.html
xpClient.js initial sync
any XP function that loads user profile
Trigger conditions:
Condition
Required
User is logged-in
✔
Email is verified
✔
User has never converted before
✔
Current browser has an active anonId
✔
Anonymous profile has convertible XP
✔
If all conditions match → conversion runs instantly.
4.2 User Interaction
No button
No prompt
No user choice
Only a one-time info message:
“We converted X XP from your guest profile to your account.”
5. Conversion Formula
5.1 Eligible XP
Anonymous XP is eligible for conversion only if:
anonActiveDays >= 1
totalAnonXp > 0
Profile has not been previously converted:
convertedToUserId === null
5.2 Conversion Cap
Limit converted XP by:

```
allowedXp = min(
    totalAnonXp,
    DAILY_CAP * anonActiveDays,
    MAX_TOTAL_CONVERSION_CAP
)
```
Defaults:
```
DAILY_CAP = 3000
MAX_TOTAL_CONVERSION_CAP = 100_000
```
5.3 Final value
Converted XP is added to the user’s permanent XP:
```
finalUserXp = userXp + allowedXp
```
6. Security Requirements
6.1 Prevent multi-device abuse
Only XP from the current anonId is convertible.
Other devices’ anon XP never auto-convert (unless explicitly implemented later).
6.2 Prevent repeat conversion
After conversion:
AnonProfile.convertedToUserId = userId
AnonProfile.totalAnonXp = 0
AnonProfile.anonActiveDays = 0
UserProfile.hasConvertedAnonXp = true
Both flags + zeroed XP block repeated conversions.
6.3 Prevent forging anon profiles
Anon XP validation already includes:
signature-free safe model (server calculates day keys itself)
daily cap enforcement
server-only awarding
drift protection
No client-supplied XP values are trusted.
6.4 Prevent boosting by creating multiple accounts
Because each anonId → only one conversion, players cannot farm XP for multiple accounts unless they use multiple browsers/devices.
This is acceptable v1 behavior.
6.5 Prevent retroactive device linking
After conversion:
A new anon session on that browser will never be convertible again for that same account.
7. Backend Logic (Pseudocode)
```
function attemptConversion(userId, anonId):
    user = getUserProfile(userId)
    anon = getAnonProfile(anonId)

    if !user.emailVerified:
        return { converted: false }

    if user.hasConvertedAnonXp:
        return { converted: false }

    if !anon or anon.convertedToUserId != null:
        return { converted: false }

    allowedXp = calculateAllowedXp(anon.totalAnonXp, anon.anonActiveDays)

    if allowedXp <= 0:
        return { converted: false }

    atomicTransaction:
        user.totalXp += allowedXp
        user.hasConvertedAnonXp = true
        anon.convertedToUserId = userId
        anon.totalAnonXp = 0
        anon.anonActiveDays = 0

    return { converted: true, amount: allowedXp }
```
8. Frontend Requirements
8.1 When user logs in:
The XP client sends anonId + session token to backend.
Backend returns:
converted: true|false
amount (if converted)
updated XP totals
8.2 UI changes required
On successful conversion:
Show passive toast/banner:
“We converted X XP from your guest profile.”
Do not show:
Convert buttons
Confirm dialogs
Modal popups
9. Acceptance Criteria
AC1 – Anonymous XP always works
Guest players earn XP using existing system.
Daily cap logic applies.
AC2 – Conversion happens automatically
First verified login with anonId triggers conversion.
User sees 1 info message.
AC3 – Conversion occurs only once
Account A can convert only once.
Same anon profile cannot convert again.
AC4 – Conversion is limited
Converted XP ≤ dailyCap * activeDays
Converted XP ≤ MAX_TOTAL_CONVERSION_CAP
AC5 – Anonymous profile is archived
After conversion:
XP is zeroed.
Marked as converted.
Can't convert again.
AC6 – XP is added atomically
No partial writes or race conditions.
AC7 – Non-cheatable
Client cannot affect the converted value.
Client cannot trigger additional conversions.
Switching browsers generates a new anon profile (acceptable v1 behavior).
AC8 – Conversion info is shown once
Only on successful conversion.
10. Implementation Plan (Phased)
Phase 1 — Data Structures
Backend
Add hasConvertedAnonXp to user profile.
Add convertedToUserId to anon profile.
Phase 2 — Backend Conversion Route
Reuse XP sync endpoint.
Implement attemptConversion(userId, anonId).
Phase 3 — Frontend Integration
XP client sends anonId on login.
XP client receives { converted: true, amount }.
Display one-time toast.
Phase 4 — Cleanup & Dashboard Logic
Anonymous profile zeroing post-conversion.
One-time message is suppressed on page reload.
Phase 5 — Testing
Unit tests: anon days, caps, limit enforcement.
Integration tests: conversion + XP sync.
E2E tests:

Implementation Notes
- Server maintains an internal `lastActiveDayKey` on the anon profile to count active days based on server-computed day keys.
- This helper field does not change external behavior or acceptance criteria.
- Conversion uses `calculateAllowedAnonConversion`, capping migrated XP at `min(lifetimeAnonXp, DAILY_CAP * anonActiveDays, MAX_TOTAL_CONVERSION_CAP)`; any XP above the cap remains on the anon identity.
Play as anon
Create account
Check XP
Reload page
Verify conversion didn’t re-run
11. Future Extensions (Not in v1)
(F1) Cross-device guest XP aggregation
Sync anon profiles stored by key/session or via temporary anonymous tokens.
(F2) Conversion from multiple devices
Require verification that devices belong to same user.
(F3) Chip system
XP → chips conversion for poker economy.
(F4) Conversion partial refunds or bonuses
Promotional: “Get a 10% XP bonus when you sign up.”
(F5) Risk scoring for abnormal XP gain
Detect suspicious XP earning patterns prior to conversion.
