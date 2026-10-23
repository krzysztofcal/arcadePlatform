# Android Stage API integration GO

## Stage CORS gate PASS

Siteplaykcswh/f7e19a84-28f7-41f7-978a-f3b4552a404d, repo identity and DraftPR1141 verified. PATCH XP_CORS_ALLOW contextbranch/context_parameterfeat/1139-android-poker-m0 only. Existing origins https://play.kcswh.pl, https://landing.kcswh.pl, http://localhost:4173 retained; appended exactly https://localhost. All other variables, credential flags/scopes and contexts compared unchanged. No CORS source/method/header change.

Documentation push rebuilt Stage Preview1141 source2c6f23daf5f47f4e0b59f6c4489f36dc6fc1532d, deploy6adbc543278f8840161bc416 ready. Actual OPTIONS19/19 PASS for16 functions: create/quick-seat/progression/guest-session/mint, profile GET/PATCH and avatar upload/finalize/DELETE, chips balance/ledger/tx, bonus GET/POST, deletion GET/POST, XP start/calculate. Requests were OPTIONS only, not the financial/deletion methods. Each204, ACAOhttps://localhost, requested method and authorization/content-type allowed.

## Native integration

Only stage-public.json apiOrigin changes1095→1141; public Supabase project/anon key and WS Preview unchanged. Existing security test fixture updated to1141. No shared web UI/logic change. Hosted packager derives CSP/config/receipt from this public config; old API must not remain in packaged connect-src/config.

Dedicated Stage account password login200; authenticated progression GET200 and proper native-origin CORS. Token mintPOST200; WS Originhttps://localhost helloAck/authOk PASS using minted token, then closed without lobby/table subscription, JOIN or play. Probe Auth session logged out204. No OAuth config, provider or redirect change. Device OAuth callback remains NOT TESTED. Profile GET and balance GET not invoked because helpers can initialize profile/chips account; their OPTIONS and unauthorized contract remain verified, actual account rendering is phone verification. No bonus/deletion/financial actions.

Fundamental adapter/mobile/Auth/WS/sidebar/mint/CORS tests73/73 PASS, syntax228 PASS, CSP55 PASS. Native binaries/SDK/Gradle/dependency install only on existing GitHub-hosted ubuntu24.04 workflow. No VPS package/download cache, cleanup or service restart. Free disk6.5GB before/after code edits.

## Safe Galaxy S24+ checklist

1. Download the exact-SHA debug APK from the linked workflow artifact and verify SHA256SUMS. Install over the existing Stage app (same signing identity); via USB use adb install -r <apk>. Do not uninstall just to replace it: preserve app data.
2. Open app, check SHA/Stage banner, Lobby→Account→Lobby, header/system bars and Poker/Profile-only bottom navigation. Check footer/table menu does not cover controls.
3. Use Stage password login; verify profile/CH/progression/table list loads. Do not claim bonuses, edit/delete account, JOIN, buy in, start Single Player or perform transactions in this GO.
4. Verify WS connected status without entering a game. Toggle airplane mode, resume while offline, restore network and check reconnect. Record Android/WebView versions and any error.
5. OAuth is manual diagnostic only; if callback fails, record exact error and stop OAuth scope for separate GO. Do not change provider or allowlist.

Build receipt/checksum/hosted artifact and exactSHA to be recorded in PR after build. Gameplay and physical retest NOT TESTED; Single Player startup requires separate authorized play scope.
