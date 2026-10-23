# Arcade Poker Android M0

Locally bundled Stage-only Capacitor PoC for #1139. Source: existing `poker/index.html`, `poker/table-v2.html`, `account.html`; no second account/Poker UI. `package-web.mjs` stages only referenced JS/CSS and Poker assets, composes navigation and supplies a local pinned Supabase UMD. Web files retain existing behavior when `MOBILE_POKER_CONFIG` is absent. No server.url, OTA, payments, engine, database or WS deployment.

## Build and provenance

Build only on GitHub-hosted ubuntu-24.04 using **Android Poker M0 APK**, from a same-repo Draft PR or manual dispatch after the workflow exists on main. Workflow checks exact source HEAD, disk, hosted identity, uses locked Capacitor 8.5.3 dependencies, Node 22.23.1 and JDK 21.0.10+7.0.LTS, generates Android from the pinned template, uses its Gradle Wrapper and runs assembleDebug. SDK/build-tools/Gradle versions are controlled by the pinned template and recorded in toolchain.txt. No emulator, release key or environment secrets. Debug signing is ephemeral; APK bytes/signature can differ between builds; reproduction means the same locked sources/toolchain and behavior, not byte-identical debug signatures. Installed builds signed by a different ephemeral key require uninstall first (loses app-local session).

Actions artifact `arcade-poker-stage-<full SHA>` expires after seven days and contains APK, SHA256SUMS, build-receipt.json and toolchain.txt. The receipt pins Stage API/Supabase/WS and source SHA. The APK workflow itself never deploys anything. Existing repository PR checks/Netlify Preview automation are separate; they do not deploy the packaged app or WS.

Hosted build steps (single-line commands, run in mobile/poker):

`npm ci --ignore-scripts --no-audit --no-fund`

`node package-web.mjs`

`./node_modules/.bin/cap add android`

`node configure-android.mjs`

`./node_modules/.bin/cap sync android`

`cd android && ./gradlew --no-daemon --max-workers=2 assembleDebug`

Do not run these build/install commands on the VPS. Existing generated www/android directories cause packaging to stop rather than deleting files.

## Stage integration GO — prepared, NOT applied

Public settings were read from approved Preview 1095; project is pinned to `krydukthwdvccggbyjfw`, WS to `wss://ws-preview.kcswh.pl/ws`. `stage-public.json` contains a public anon key, never a privileged key. It is not a runtime-secret channel. Change the preview origin deliberately when a newer authorized Preview is needed.

Read-only OPTIONS on 2026-10-23 to Preview 1095 ws-mint-token with Origin https://localhost and Authorization/Content-Type preflight returned **403 without Access-Control-Allow-Origin**. Thus API/token mint/gameplay is blocked until Stage configuration GO. No authenticated requests, JOIN or ledger writes were performed.

Required separate **GO Stage mobile CORS/OAuth**:

1. Add exact `https://localhost` to existing **Stage-only** `XP_CORS_ALLOW`, preserving other origins. Review every used function's OPTIONS/Bearer CORS. Do not change Production or use wildcard/native HTTP bypass. Applying Netlify config/redeploy is separate authorization.
2. Add exact `arcadepoker-stage://auth/callback` to **pinned Stage** Supabase Auth redirect allowlist; enable Google only if approved/configured there. Keep Google's provider redirect at Supabase's normal auth callback. App launches external Custom Tab through Browser, never Google in WebView; local Supabase PKCE verifier is used to exchange the callback code. Custom scheme is PoC-only and can be claimed by other installed apps; PKCE prevents code redemption without verifier. Verified Android App Links are an M1 release gate.
3. Check Stage WS accepts the actual app origin and minted Stage token; if WS configuration/deployment is required, prepare and obtain separate GO. This PR changes no WS protocol or server runtime. Do not dispatch WS Preview Deploy implicitly.

Callback expiry/cancel/error is retryable from Account; no provider tokens/URLs are logged. Email verification/recovery redirects use the mobile callback but need real-device verification. Android Back on table follows existing lobby link (does not silently cash out); from Account goes to lobby; from lobby minimizes. Resume restarts Supabase refresh; existing WS heartbeat/reconnect/resync remains authoritative. Android process death may require reopening a table. No offline game mode.

## Samsung Galaxy S24+ test

1. Open the successful Actions run, download the exact-SHA artifact; extract ZIP in My Files. Compare SHA256 on a trusted computer if available: `sha256sum -c SHA256SUMS`.
2. Tap APK, temporarily allow installation from that browser/My Files when Android asks. If Samsung Auto Blocker blocks sideloading, use device-owner settings to permit this controlled installation, then restore protection. No Play upload required. Launch **Arcade Poker Stage**. A build signed by another debug key may need uninstall/reinstall.
3. Confirm Stage/SHA banner, Poker-only lobby, account/login/profile and existing deletion navigation (do not confirm deletion). Check portrait/landscape, keyboard/avatar picker, Back, cold start, offline message and resume.
4. After Stage configuration GO, use only approved Stage identity: email/password login, Google external-browser cancel/success, email links/recovery, expired session. Verify returning to app keeps session and no token appears in UI/logs.
5. **Separate funded gameplay GO required** before JOIN/New Game/buy-in/action/Leave/bonus claims. Then verify lobby/table action, loss of network, heartbeat reconnect/resync, screen lock/background and return. Record Android/WebView version, APK SHA, scenario/result and sanitized failures.

A phone is not attached to this VPS. APK build/syntax/unit results do not prove OAuth/session/gameplay/device behavior. Keep PR Draft pending runtime evidence.

## Compatibility / decision matrix

| Client | UI revision | API / WS |
| --- | --- | --- |
| Web | current Netlify deploy | existing relative APIs, existing deployment WS config |
| Android 0.0.1 Stage | artifact's exact SHA | Preview in receipt + pinned Stage WS, existing protocol |
| Older installed APK | stays bundled at old SHA | backend must retain compatible token mint, snapshots/actions and idempotency |

A web deploy never updates installed UI. UI changes need a new APK; backend changes must preserve older app contracts or coordinate a new release first. Roll back by reinstalling a known artifact (debug signature caveat); no OTA. M1 owns stable signing, verified links, release AAB, legal/Play gates and compatibility version enforcement.

| Approach | M0 decision / fallback threshold |
| --- | --- |
| Capacitor | approved; keeps shared UI; prove external OAuth/local-origin CORS/WS on device |
| TWA/PWA | documentation only; verified hosted origin simplifies origin but weakens local bundle/iOS sharing requirement |
| Flutter / React Native | documentation only; a UI rewrite and bridge maintenance, only after demonstrated material blocker |
| .NET MAUI / Kotlin Multiplatform | documentation only; new toolchain and UI/platform integration cost; no M0 prototype |

Future iOS can share packaged assets/adapters but needs separate GO, macOS/Xcode, signing and Apple policy work. No iOS implementation.

References: [Capacitor config](https://capacitorjs.com/docs/config), [App events](https://capacitorjs.com/docs/apis/app), [Supabase native deep links](https://supabase.com/docs/guides/auth/native-mobile-deep-linking). Current Supabase changelog inspected; TLS cipher retirement does not require changing modern Android WebView configuration.

## PR review follow-up

Public-profile links use the unchanged Stage origin through the external Browser; offline resume no longer emits an online event. [Detailed environment/API/CORS audit](../../specs/1139-android-poker-m0/review-followup.md) identifies the Netlify XP Redis v3 context mismatch and stale Preview 1095 contract. No environment/origin change applied; native and authenticated integration remain pending.

## Galaxy S24+ visual retest

The owner confirmed installation/Lobby/Account/basic navigation on bebbdc6a, but found system-bar overlap and unwanted Search. [Device evidence and focused no-gameplay retest](../../specs/1139-android-poker-m0/device-smoke-s24.md) separate these presentation defects from blocked API1095/CORS. The next APK uses built-in native insets with generated viewport-fit=auto, explicit AndroidX EdgeToEdge, Poker/Profile-only bottom navigation and a status footer/table-menu message rather than a fixed banner. Physical visual PASS remains pending. Redis repair is still stopped at the earlier credential mismatch; this changes no backend setting.
