# Arcade Poker Android M0 Implementation Plan

**Branch:** feat/1139-android-poker-m0 | **Date:** 2026-10-23 | **Spec:** [spec.md](spec.md)

## Summary / Technical Context
Use Capacitor 8 with App/Browser plugins; Android template generated from pinned npm package in hosted CI, Gradle Wrapper provided by that template. Node 22 / JDK 21 only on hosted runner. VPS Node 20 handles dependency-free packaging and syntax/security checks. Shared classic JS UI; no new storage or backend.

## Constitution Check
PASS: existing UI and authoritative WS preserved; no financial/business rule changes. Only critical origin/callback validation tests; no UI/glue/layout suite. No migrations or shared Stage mutations intended. Public Stage config only; exact Stage API origin constrained to Netlify Preview for playkcswh. No Production fallback in APK. All setup/config/dependency/ignore changes explicitly scoped in spec/tasks. Web changes conditional; existing inline script hashes retained and packaged CSP computed. Deployment and device evidence remain separate gates.

## Files and interfaces
- js/api-url.js: ArcadeApi.url(path) keeps web relative URLs; mobile validates and resolves function paths to Stage.
- Existing API consumers: call resolver at fetch boundary, including XP/profile/avatar/account/token mint.
- js/auth/supabaseClient.js: optional MobilePoker authOptions, redirectTo, openOAuth; normal web behavior unchanged.
- js/core/sidebar-model.js: mobile returns Poker/account only; js/sidebar.js skips admin lookup on mobile.
- mobile/poker/package-web.mjs: package three shared pages/dependency assets, public config, exact SHA receipt, local Supabase UMD, CSP meta. Generated mobile-only navigation transforms never edit source pages.
- mobile/poker/security.cjs and stage-public.json: validate pinned Stage origins and callback; runtime.js: strict Stage config, exact callback code exchange, external Browser, App Back/resume. mobile.css scopes presentation.
- mobile/poker/configure-android.mjs: exact custom-scheme intent filter in generated manifest. Capacitor config contains no server.url.
- .github/workflows/android-poc.yml: same-repo draft PR or manual, contents:read, ubuntu-24.04, resource checks, npm ci in isolated mobile directory, package/add/sync, wrapper assembleDebug, 7-day artifact with SHA256/receipt. No deploy job, environment or secrets.

## Review focus / verification
Invalid Stage host/key, malformed callback, foreign OAuth URL, absent PKCE code, web fallback; run fundamental node:test security checks. Existing auth/WS tests and CSP/syntax checks run sequentially. Package inspection checks navigation, scripts and missing references. Device smoke covers Back, rotation, offline, login, resume and reconnect; gameplay requires separate GO.

## Execution decisions
Reuse existing T001 audit at main f9137918f54fd285d00dad5c7d91c1120bab6e33 and all seven #1139 comments. Owner explicitly requested immediate implementation and constrained checkout use; implement inline in existing checkout, no extra approval/worktree/install cycle. Capacitor-generated Android template is reproducible from locked package, rather than committing generated SDK artifacts. No WS protocol changes, so no WS deploy performed.

## Review corrections

Use security.cjs::publicProfileUrl(config, handle) through runtime.js and renderPublicProfile() for Stage-only external navigation; preserve the web relative link. Guard the existing resume hint with navigator.onLine. Extend only origin/lifecycle security assertions. Inspect build logs/config/release metadata and OPTIONS without applying changes; record compatibility and scoped XP_CORS_ALLOW proposal in review-followup.md. Rebuild APK only on hosted runner.

## S24+ presentation follow-up

Use built-in Capacitor 8.5.3 SystemBars `insetsHandling=native` with `initialViewportFitValueHint=auto`; package-web.mjs changes only staged pages to viewport-fit=auto, leaving native system-bar/cutout padding outside the WebView and avoiding double safe-area padding. No plugin/dependency upgrade or Android edge-to-edge opt-out. js/sidebar.js::bottomNavItems() returns only Poker/Profile in mobile context; mobile.css uses two equal columns. runtime.js::notice() appends status inside pokerMenuPanel when present, otherwise normal body flow; remove fixed overlay and generic body padding. Verify existing fundamentals/syntax/CSP and inspect hosted artifact; all physical visual fixes remain awaiting owner retest.

`mobile/poker/configure-android.mjs` enables AndroidX EdgeToEdge in the generated MainActivity.onCreate, using the existing Capacitor AndroidX dependency, so native SystemBars padding has consistent window ownership on older Android as well. No checked-in parallel Android UI or new dependency.

## Isolated Stage Redis implementation

Import immutable BUILD_DEPLOY_CONTEXT/BUILD_DEPLOY_ORIGIN in store-upstash.mjs. resolveRedisRestToken selects ARCADE_STAGE_REDIS_TOKEN for deploy-preview and canonical playkcswh Preview origin with Stage V3 tuple; reject mismatches and fail closed on missing alias. Other contexts retain UPSTASH_REDIS_REST_TOKEN. Preserve existing client/namespace/epoch/fence logic. Validate Personal capabilities, sensitive-variable review policy and existing branch overrides before mutation. Create protected deploy-preview secret using CLI standard secret scopes; PATCH three XP deploy-preview values only and compare all unrelated settings. Run fundamental tests and syntax/CSP controls, then push exact passing SHA to trigger Preview1141; verify build commit/context and read-only endpoints. No WS or APK deployment.
