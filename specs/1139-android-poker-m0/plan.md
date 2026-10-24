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

## Android API integration

PATCH XP_CORS_ALLOW exact branch value, compare unrelated settings, push documentation to rebuild Preview1141. Audit real OPTIONS for actual native API consumers and preserve existing method/header policy. Only after all PASS change mobile/poker/stage-public.json apiOrigin. Run existing fundamentals/syntax/CSP; normal Draft PR push builds hosted APK. Verify embedded receipt/config/CSP and checksum in memory, document phone checklist and Auth/WS limits. No local Android tooling or dependency install.

## Second S24+ diagnosis and correction

Read Stage Auth config and follow public Google authorize redirect only to302 (no provider sign-in); inspect stored probe referrer without reading auth codes/tokens. Correlate owner Netlify request with function logs and Stage Postgres errors; inspect avatar schema/triggers/buckets/flags read-only. Stop Auth/avatar configuration scope at concrete proposed GO. For landscape replace SystemBars decor-padding owner with one AndroidX WebView margin listener in configure-android.mjs, disable only SystemBars inset listener, retain style/edge-to-edge/viewport-fit=auto. Reserve systemBars/displayCutout/systemGestures and maximum IME bottom; return zero already-handled insets. Keep mobile.css/package-web/shared poker-v2.css unchanged. Run existing fundamentals/syntax/CSP and hosted APK; inspect receipt/config/native callback in APK, report candidate fix and physical keyboard/rotation retest.

## Stage Auth + Avatar approved activation

Read Stage project/Auth configuration in process; PATCH uri_allow_list only and compare all other fields without logging values. Check controlled authorize302 and referrer-only flow metadata after propagation. PATCH tracking flag exact branch context; compare every other context/variable/secret unchanged and deletion acceptance OFF. Existing local in-memory tracking-before-deletion fundamental test plus Auth/avatar mock tests. Push evidence-only documentation to trigger normal Preview1141 rebuild for exact SHA; verify deployment context/receipt and real OPTIONS/GET availability/disabled deletion. No real upload/signing/finalize or Google login.

## Immersive table implementation

configure-android.mjs: retain sole native inset listener; table route uses zero window margins except IME, publishes density-corrected CSS safe vars; non-table native margins unchanged. Local page commit resets route/CSS and reapplies insets; explicit platform cutout policy, transient bars by swipe, one re-hide on IME close. runtime.js uses injected SystemBars hide/show for exacttable route at each local document ready and app active/background independently of Auth readiness. SystemBars inset listener remains disabled; remove unused viewport hint. package-web.mjs retains table viewportcover and other pagesauto; remaps existing generated poker-v2.css safe-area rules to one native CSS source, leaving shared source and fitTableScene unchanged. One mobile action-bar max-width guard. Extend existing fundamental lifecycle/Auth test only, no layout suite. Existing syntax/CSP + hosted APK/receipt/content verification and manual physical checklist.

## Final review / appearance freeze (2026-10-24)

Record owner acceptance of exact857159ca APK, separating visual fit from gesture/resume/IME/financial coverage; no new appearance/native changes. Independently review full mainf9137918→PR3d775b7c diff and verify current CI/Netlify/Stage boundaries read-only. APK857159ca and3d775b7c native DEX identical and packaged assets equal after source-SHA normalization. Real P1: existing WS Preview build emits deploy-preview/null-origin metadata, rejected by new store selector. Record NO-GO and minimal follow-up correction preserving immutable Netlify fail-closed selection and WS legacy-token behavior; do not deploy WS or mutate Redis. No new requirements/tests beyond fundamental context preservation and existing manual lifecycle scenarios.
