# #1158 — local implementation / self-review

2026-10-28. Local security/regression **PASS**; hosted and physical acceptance NOT TESTED. Branch feat/1158-authenticated-profile-reads, parent810a77b1ed7a341f95eb2f9ce2c1099543a6c9bb. No new commit/push/PR/deploy. #1155 unchanged/Draft. LEGAL OPEN.

## Final behavior and review

Both HTTP GET handlers require extractBearerToken/verifySupabaseJwt before identity/XP/leaderboard/rate reads; no token/invalid auth401, generic blocked/unknown404 after auth, all gated responses no-store. CORS and unauthenticated OPTIONS retained, existing rate limits and Redis fail-closed guard preserved. Auth/schema/read errors cannot return an anonymous projection. Profile error logging uses a safe code, not verifier message/token. Owner handler, block filters, leaderboardVisible, table identity, reconnect and financial paths remain unchanged.

ProfileClient.getPublic uses the existing bearer bridge, no-store and a viewer/generation guard. Public page resets DOM/currentProfile immediately on auth change/pagehide; late responses are ignored and browser pageshow rechecks auth. Leaderboard invalidates/clears all previous rows (not only owner row), aborts in-flight work and verifies the current viewer before rendering. Auth callbacks defer session-loading work to avoid awaiting Supabase session APIs inside onAuthStateChange. No extra token cache/URL handoff/redirect store. Removed obsolete owner-row-only refresh function. Existing hidden-state CSS already covers the card/results: no CSS or layout test needed.

Account/signup/Google/public profile hints updated in existing PL/EN/i18n. App profile link remains external HTTPS with an explicit separate-login hint; no native/Auth/OAuth config change or duplicated profile UI. noindex meta plus response headers added to existing Netlify config, preserving CSP and AdSense removal. Four legal markdown proposals plus their manifest/README changed locally; immutable published/packaged HTML and versions untouched. Google Play notes are a candidate disclosure delta, not a Console submission or compliance approval.

## Fundamental verification

Existing Node20 tests: **88 PASS,0 FAIL,1 SKIPPED**, covering HTTP401/200/404, rate/quota/store errors, real JWT malformed/expired/other-secret rejection, owner access/XP projection, SQL block/opt-out filtering, critical viewer race/logout clearing, shared auth bridge and mobile security. New auth-denial cases were confirmed failing against the old anonymous handlers before implementation. Existing Redis-unavailable test now uses authenticated GET for the newly gated handlers, preserving its503/no-memory-fallback assertions rather than bypassing auth. Existing disclosure/XP tests updated to the approved signed-in model.

Single SKIPPED is the pre-existing optional isolated PostgreSQL17 profile-block migration test, requiring PROFILE_BLOCK_TEST_DB_URL; no database or migration change in this task, and parent #1155's approved full schema contract remains valid. It is not a skipped new auth test. The legacy Vitest auth-identity file is not a registered Node-test contract and its package is absent; no dependency was installed. The final suite uses the existing Supabase JWT and Account auth contracts instead of claiming a Vitest PASS.

Syntax234 files PASS, CSP hashes58 served documents +4standalone landing PASS, static migration guard121/14 PASS, TOML parse/noindex routes PASS, diff whitespace PASS. No new inline scripts/SRI-bound script change, so no CSP hash or SRI regeneration needed. Both applied Production SQL hashes/manifest, Stage SQL, owner/read-model/WS/shared/mobile/active legal sources and canonical CSP remain byte-identical to parent. No new framework/package/schema/funded test.

## Breaking impact / limitations

Anonymous profile deep links, ranking embeds/crawlers and old tokenless clients now get401; a browser login is required and an APK session does not transfer. Signed-in users can still copy/share received data; noindex is not authorization or retroactive removal. Audience/copy changes need coordinated web/backend/APK and separate legal/version/Play approval. Existing app apiOrigin still points to parent Preview1155, so no claim of new-device compatibility. Current live environments were not changed or used for new authenticated smoke. Real browser/phone behavior, served noindex and child environment config remain for the limited future GO in publication-handoff.md.

#1154 remote update NOT COMPLETED: GitHub403; exact prepared decision is provided locally. All other requested implementation is local. No Stage/Production apply, Ready/merge, TermsON, APK build or #1157 work.
