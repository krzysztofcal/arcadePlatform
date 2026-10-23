# First physical Galaxy S24+ smoke — owner evidence

## Evidence identity

Owner-reported physical Samsung Galaxy S24+, APK source `bebbdc6a2ac5c6d556d6028bd33fc0bbbc5d4b8c`. Android/One UI/WebView versions, orientation and screenshots were not supplied; do not infer them. Results below are the owner's observations, not an agent-operated device run.

| Scenario | Owner result | Interpretation |
| --- | --- | --- |
| Install and launch | PASS | First real packaged-app launch evidence |
| Poker Lobby and Account display | PASS | Shared pages render on the physical phone |
| Basic screen navigation | PASS | Basic native/local route flow works |
| Poker Online: WS disconnected | FAIL | Consistent with blocked local-origin mint API; not evidence of Poker engine bug |
| Single Player cannot start | FAIL | Requires API/WS; known backend boundary remains blocked, exact phone request trace absent |
| Progression: Loading bankroll | FAIL | Missing API data; no inference of economy/reducer failure |
| Tables absent / buy-in Loading | FAIL | Missing API/progression data; no funded action verified |
| Account recognizes user, profile/CH absent | FAIL | Auth identity evidence only; profile/balance API integration not working |
| Android status bar overlaps header | FAIL — mobile UI defect | Insets/window ownership correction prepared |
| Account bottom nav contains Search | FAIL — mobile scope defect | sidebar.js injects Search after SidebarModel filtering |
| Stage banner overlap | Risk confirmed by source, not separate owner PASS/FAIL | Fixed bottom overlay could cover controls; remove overlay |

This smoke supersedes earlier NOT TESTED labels only for installation, launch, rendered Lobby/Account and basic navigation. It does not prove OAuth/deep-link return, session expiry, profile/CH loading, WS auth/snapshots/actions, rotation, background/reconnect, avatar upload or deletion. No successful game, funded action or deletion is reported.

## Backend boundary remains blocked — no workaround

Pinned API1095 rejects https://localhost preflight (403), lacks account-delete (404) and predates current safeguards. The separate Redis V3 GO stopped before any mutation: inherited branch token failed read-only PING (401). No Redis variables/credentials were changed and no Redis-repair Preview was deployed. This UI task does not resume/expand that GO. CORS/OAuth/apiOrigin/WS/Production/DB and financial operations remain untouched. Do not replace Poker logic or bypass CORS to mask these symptoms.

## Minimal mobile-only corrections

1. Pinned [Capacitor 8.5.3 SystemBars source](https://github.com/ionic-team/capacitor/blob/8.5.3/android/capacitor/src/main/java/com/getcapacitor/plugin/SystemBars.java) handles window/system-bar/cutout insets. Its behavior depends on WebView version and viewport-fit=cover; it supports native handling with padding when cover is absent. Existing shared CSS relies on env(safe-area-inset-*), while fixed elements ignore a generic body's padding. Choose one owner for the whole native viewport: built-in SystemBars native insets, generated mobile viewport-fit=auto and matching initial hint. Generated MainActivity explicitly enables AndroidX EdgeToEdge (already a Capacitor dependency), keeping fitting behavior consistent on older Android. Native padding protects all pages, including fixed headers/table controls; generated pages retain responsive layout inside those bounds. Shared web pages keep viewport-fit=cover. No status-bar plugin, SDK installation, hard-coded pixel inset, CSS-wide rewrite or Android opt-out.
2. Native bottom navigation filters to Poker/Profile before sidebar.js injects Search; web still takes the existing menu path. Mobile-only CSS uses two columns, removing empty slots.
3. Diagnostic status becomes normal-flow content after Lobby/Account and lives inside the explicit table menu on the table page. It has no fixed position/high z-index and cannot act as a persistent overlay above bottom controls. Existing web CSS is unchanged.

These corrections are implementation/inspection evidence, not a physical-device PASS. The first APK's actual Android/WebView version remains unknown; retest is required before saying status-bar overlap is fixed on S24+.

## Focused owner retest, no backend/funded operations

- Install the new exact-SHA artifact; debug signing may require uninstall of the previous Stage build (loses local session). Record Android/One UI/Android System WebView version and SHA.
- Lobby/Account portrait and landscape: system clock/cutout and gesture/3-button area must stay outside app controls, with no doubled inset. Check header, keyboard open/close and page scroll.
- Account bottom nav: exactly Poker/Profile, two equal slots; no Search or other Arcade destination. Existing web still has its original navigation.
- Lobby/Account: status is in document flow, can wrap under larger text, does not cover lower controls. If a table can be viewed without a funded action, diagnostic status appears only inside its menu; do not JOIN/create/fund to reach it.
- Existing API loading/disconnect failures remain expected until separate backend GO. Do not claim bonuses, start Single Player, JOIN, transact, Leave/cash-out or delete an account for this visual retest.

## Local verification and review

69 existing selected fundamental/security/Auth/WS/sidebar/mint/CORS tests PASS with prescribed memory-store XP_TEST_MODE=1; existing syntax control 228 files PASS, CSP 55 documents PASS. Mobile runtime/packager/configure script syntax and diff whitespace checked. No UI/CSS/layout tests or SDK/emulator installed. Independent read-only review confirmed native menu whitelist, CSS specificity and non-overlay banner; recommended the explicit EdgeToEdge call now included. Android compilation and artifact inspection run only on hosted Actions. None of this marks the physical layout corrections PASS before owner retest.

## Prepared visual-retest APK

- Source SHA: `006cef6e0b0399d81cc128b5fd1b869f0cd6786e`.
- Successful GitHub-hosted Android compilation: https://github.com/krzysztofcal/arcadePlatform/actions/runs/40005621668
- Artifact: https://github.com/krzysztofcal/arcadePlatform/actions/runs/40005621668/artifacts/12524536115 (expires 2026-10-30).
- APK SHA256: `9b9b9e2043fde5840353afb2d0dba13f8873e521f27fb9abf5a22cfb1bb7a698`.
- Streamed artifact into memory: checksum/receipt match; all three shared staged pages use viewport-fit=auto; SystemBars native/auto config, native nav filter and non-overlay status styles/host are present; API origin remains Preview 1095. No APK saved to VPS.
- Hosted core, CodeQL/language analyses, existing automatic Playwright and debug-apk PASS. Netlify Preview remains FAILED at the unresolved environment gate; no settings/bypass applied. VPS remains 6.1 GB free.
- Physical visual retest of this new SHA is NOT TESTED. Owner PASS evidence remains attached only to the earlier bebbdc6a scenarios. A later documentation-only commit changes no APK runtime.

## Second owner physical test (2026-10-23)

Owner PASS: email/password, Poker and table use, rotation; portrait header and Poker/Profile navigation. Owner FAIL: Google remains logged in in external browser; avatar upload; slight landscape clipping near cutout/navigation bar. Supplied request UA confirms Android16 SM-S926B WebViewChrome156.0.8078.47. Images were referenced but not available as actual attachments to this agent, so no screenshot measurements are claimed. Exact installed SHA was not explicitly repeated by owner; latest delivered integration APK was2df3b896976dcabfbbbec5a2e7938eed70fa48d1, not proof of device receipt.

These owner results supersede earlier API1095/CORS symptom blocking for tested gameplay. OAuth and avatar are independently diagnosed configuration mismatches, not Poker engine defects. [Read-only diagnoses and required GO](second-device-review.md). Landscape candidate reserves real WebView bounds using native reported cutout/system/gesture/IME insets. Prior portrait fixes, Poker-only nav and normal-flow banner retained. Physical PASS for this new correction NOT TESTED.

Retest the new exact-SHA APK over existing Stage app: portrait and both landscape rotations, cutout on either side, every edge button/slider/menu reachable, system Back/home gestures, three-button navigation if used, keyboard open/close and rotate with keyboard open, Lobby/Account/Poker/table navigation and banner. Do not repeat avatar upload or Google provider flow until separate configuration GO; no new financial/funded smoke is authorized by this review.

## Verified retest artifact

APK source fe4220edfc64adb704f725013ed6545eb6c32930, hosted workflow https://github.com/krzysztofcal/arcadePlatform/actions/runs/40029088421 SUCCESS. Artifact https://github.com/krzysztofcal/arcadePlatform/actions/runs/40029088421/artifacts/12534650511 . APK arcade-poker-stage-fe4220edfc64adb704f725013ed6545eb6c32930.apk,10177331bytes, SHA25620525aa9f3acdb2b1ca4c253bb4f0526e7519b48cfc8e7acdbdaf986f12a8d03. SHA256SUMS/exported/embedded receipt match; API1141/pinned Stage Supabase/WS unchanged; all three generated viewports auto, SystemBars inset handling disable/style DARK. Compiled manifest decoded in memory confirms exact native scheme/host/path, VIEW/DEFAULT/BROWSABLE, exported MainActivity, singleTask. No artifact stored on VPS. Hosted CI40029088504 and WS PR Checks40029088582 SUCCESS for this source.

Signature limitation confirmed by reading APK v2 signing blocks in memory: previous delivered2df3b896 APK certificate SHA256f86bdedda58253dec74cd638b5f09fc86920ae3a0019de638bd60845bfb56e01 differs from new certificate2af9fca238c4adbea743bb14bc7b4644f5afde5f815795975626b266abe30845. Existing workflow generates ephemeral per-run debug keystore. Therefore adb install -r cannot update the previous delivered build; do not promise preserved app state. Owner may choose manual removal/reinstall of only Stage app, losing local session/cache but not server account, then Stage login. No automatic uninstall, keystore/secret/signing configuration change was done. Durable debug signing is a separate scope if desired. Physical landscape/keyboard, OAuth return and real upload remain NOT TESTED for this APK.

## Auth/Avatar GO deployment evidence

Source18fcc732da9e3d22f051d47bf3d623d4a30875f6, Netlify deploy6adbdb65a3df51462dceb4d8 ready/contextdeploy-preview/review1141. Public build receipt matches source/deploy. Final config read confirms exact-branch tracking1/Functions scope, deletion acceptance OFF and native callback present, Site URL unchanged. Thirteen non-mutating endpoint checks PASS from Originhttps://localhost: OPTIONS upload-url/finalize/remove/profile/mint/progression/balance204; GET three avatar action endpoints405; unauthenticated profile/balance401; GET account-delete503 with account_deletion_unavailable, proving disabled acceptance. Expected denials are contract PASS, not attempted business operations. No real upload/signing/finalize/removal or Google login/session exchange; phone completion NOT TESTED and explicitly owner-run. Tests24/24 plus one selected in-memory tracking3-before-deletion test PASS; syntax228/CSP55 PASS. No new APK needed for these environment-only changes; existing1141-targeted APK uses updated Stage configuration. No broader setting, schema/trigger/Storage/secret/Production/WS/Redis change. Evidence-only follow-up does not change deployable code; subsequent automatic Preview rebuild may have a documentation-only SHA.

## Owner confirms Auth/avatar; immersive fullscreen request

Physical PASS: avatar upload/finalization, Google OAuth return into APK with active session, Poker and portrait/landscape. These supersede prior pending Auth/avatar results. Exact installed receipt SHA not repeated by owner. Physical FAIL: landscape shows system bars and unused cutout/edge strips. Two screenshots referenced, but no actual image payload was available to agent; diagnosis comes from owner report and explicit current margin/bar code. Prior safe-viewport behavior is now replaced on table only by immersive fullwindow background/safe content.

New manual checklist: open table, verify full background at both landscape rotations and portrait; all Fold/Call/Raise/All-in/slider/menu/seat controls outside cutout/gesture zone; swipe system bars temporarily and let auto-hide, ensuring no stuck bars; Back/Home gestures; background/resume; keyboard open/close and rotate while open; Lobby/Profile restore bars; repeat table entry. Check scene rescale/control collision/touch targets and menu/footer visibility. No agent-funded game actions. New immersive acceptance NOT TESTED.
