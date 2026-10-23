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
