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
- mobile/poker/runtime.js: strict Stage config, exact callback code exchange, external Browser, App Back/resume. mobile.css scopes presentation.
- mobile/poker/configure-android.mjs: exact custom-scheme intent filter in generated manifest. Capacitor config contains no server.url.
- .github/workflows/android-poc.yml: same-repo draft PR or manual, contents:read, ubuntu-24.04, resource checks, npm ci in isolated mobile directory, package/add/sync, wrapper assembleDebug, 7-day artifact with SHA256/receipt. No deploy job, environment or secrets.

## Review focus / verification
Invalid Stage host/key, malformed callback, foreign OAuth URL, absent PKCE code, web fallback; run fundamental node:test security checks. Existing auth/WS tests and CSP/syntax checks run sequentially. Package inspection checks navigation, scripts and missing references. Device smoke covers Back, rotation, offline, login, resume and reconnect; gameplay requires separate GO.

## Execution decisions
Reuse existing T001 audit at main f9137918f54fd285d00dad5c7d91c1120bab6e33 and all seven #1139 comments. Owner explicitly requested immediate implementation and constrained checkout use; implement inline in existing checkout, no extra approval/worktree/install cycle. Capacitor-generated Android template is reproducible from locked package, rather than committing generated SDK artifacts. No WS protocol changes, so no WS deploy performed.
