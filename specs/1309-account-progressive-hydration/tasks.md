# Tasks: Progressive Account hydration and profile latency (#1309)

- [x] T001 Baseline and diagnosis: Netlify timings plus code paths, recorded in plan §Diagnosis (sanitized, no identifiers).
- [x] T002 Progressive hydration: `js/account-page.js::loadPublicProfile` (base) and `loadPokerProjection` (Poker), with independent states.
- [x] T003 Safe deduplication: `js/profile-client.js::getMe/updateMe/clear/invalidate`, and `js/profile-google-photo.js::request` invalidation.
- [x] T004 Measured backend path: `netlify/functions/profile-me.mjs` single lifecycle transaction for GET, plus the bounded `profile_me_timing` klog.
- [x] T005 Fundamental tests: added to the existing `tests/account-auth.contract.test.mjs`, `tests/account-page.test.mjs` and `tests/public-profiles.behavior.test.mjs`. They cover late or failing Poker, coalescing across writes, gallery stability, GET/PATCH lifecycle and the identity guards that are already there.
- [x] T005a Gallery stability: `js/account-page.js::renderAvatarGallery` Google-tile rule, and `getPresentation().copyKnown`.
- [x] T005b SRI pins updated for the changed scripts.
- [ ] T006 Deploy Preview: the OWNER does the real-device acceptance. Then read the Preview `profile-me` timings in Netlify observability, plus `profile_me_timing`.
- [ ] T007 Draft PR by Claude Code, with an independent read-only Codex review (max 3 rounds, 0 P0/P1/P2 on the final diff). OWNER merge only.
