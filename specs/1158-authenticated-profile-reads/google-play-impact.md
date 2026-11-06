# #1158 — local Android / Google Play disclosure delta

Local candidate only,2026-10-28. No Play Console submission, APK build/publication or legal publication. Existing email/password/Google OAuth and account deletion paths remain unchanged. No new SDK, permission, identity field or session-transfer mechanism.

## Proposed matching copy (for future tested release)

PL: „Profile graczy i ranking XP są dostępne dla zalogowanych użytkowników. Uczestnicy stołu Poker widzą tożsamość potrzebną do rozgrywki. E-mail i dane logowania nie są wyświetlane w profilu gracza. Logowanie w aplikacji nie loguje automatycznie w zewnętrznej przeglądarce.”

EN: “Player profiles and the XP leaderboard are available to signed-in users. Poker table participants see the identity needed to play. Email and sign-in credentials are not displayed in player profiles. Signing in to the app does not automatically sign you in to an external browser.”

The Account signup/Google notice and four unpublished PL/EN legal proposals are aligned locally. Do not publish them as the current Production behavior before the authenticated-read rollout. Published a1 and packaged legal HTML remain unchanged; an approved legal version and matching web/APK delivery are separate gates. No TermsON/receipt version change here.

## Data safety and remaining review

Login restricts the audience; it does not mean no data is collected, no other user sees a profile, or automatic compliance. Reconcile the actual release's account identifiers, generated profile/avatar, game/XP activity, optional web analytics and SDK behavior with the form; do not silently replace existing answers based only on this access-control change. Read actual app behavior before completing any form. [Google Play Data safety guidance](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en) covers developer declarations, SDKs, controlled WebViews and pseudonymous data (official source checked2026-10-28).

Privacy availability and real account deletion must remain usable in app and on the web. This change neither adds nor certifies UGC reporting/blocking, retention, minors handling or deletion policy compliance. Those are independent existing gates; do not implement phasesB/C/D or #1157 here. [Google Play User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en), official source checked2026-10-28.

## Limited privacy assessment

Signed-in global visibility reduces anonymous/crawler access, but registration remains broadly available and recipients can copy/re-share data already received. Generated identity, no email/credential exposure, leaderboard opt-out and individual operator suppression are preserved. Table participant identity and account-owner access have a distinct purpose from profile-page/leaderboard discovery. The Article25(2)/children/necessity and historical-retention concerns from #1114 remain explicit; no new user switch/age gate or LEGAL PASS. Krzysztof Cal remains the named controller; no JDG/address or Google photo change.

## Manual acceptance after separate GO

Use a future authorized APK pinned to the child Stage API, not the existing Preview1155 backend. Test app logged in/browser signed out → existing HTTPS profile link → clear browser login notice → login via existing Account → Back/reopen profile; then browser logout/Back clears data. Also test browser already signed in and browser account different from app: the browser's account governs access, with independent logout. No JWT, refresh token or handoff code in navigation/history/analytics. No funded JOIN. Physical behavior remains NOT TESTED for this local diff.
