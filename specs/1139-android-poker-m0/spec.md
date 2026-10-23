# Android M0 — Arcade Poker, Capacitor-first

**Issue:** #1139; parent #1138; release work deferred to #1140. Approved scope: owner request 2026-10-23.

## User stories and acceptance
1. As an Android tester I install a debug APK built from an exact SHA on GitHub-hosted ubuntu-24.04, launch locally bundled Poker Lobby, open the existing table and existing account page. Other Arcade games and navigation are absent.
2. As an existing web user I retain existing UI, relative APIs and OAuth behavior. Mobile reuses poker/index.html, poker/table-v2.html, account.html and their controllers; generated output is disposable, never a second editable UI.
3. As a Stage tester I use public configuration for pinned Supabase project krydukthwdvccggbyjfw and wss://ws-preview.kcswh.pl/ws. API resolution is explicit; no fetch monkeypatch/native HTTP bypass. Google login uses external Browser + App callback with PKCE, exact callback validation and no token logging. Back/resume use native events and existing WS reconnect.
4. As an operator I download an APK, receipt with source SHA/tool versions and SHA256, and install on Samsung Galaxy S24+. Device evidence must distinguish tested from NOT TESTED.

## Constraints and authorization
Capacitor only; no parallel PoCs. No engine/backend/schema/protocol change. No Production, DB migrations, WS/environment deployments, payments, Play or OTA. Stage CORS/OAuth changes prepared only; separate GO before application. No funded JOIN/action/deletion smoke without separate GO.
VPS: source edits/light checks only; no SDK/JDK/Gradle/emulator/Node upgrade, extra checkout/dependency tree or cleanup. Check disk before/after significant writes; warn below 5 GB, stop such writes below 4 GB. Existing untracked files remain untouched.
Explicit setup scope: mobile/poker/package.json and lockfile, capacitor.config.json, package-web.mjs, configure-android.mjs, security.cjs, stage-public.json, runtime.js, README.md, mobile.css, .gitignore; .github/workflows/android-poc.yml; shared js/api-url.js, API call sites, auth adapter hooks and SidebarModel. No generic setup changes.
Classic IIFE/global browser JS, one CSS line per selector, klog, strict script CSP with hashes for existing inline scripts; local pinned Supabase UMD. Fundamental deterministic security tests only; existing syntax/CSP checks, manual device smoke.

## Success criteria
Hosted build produces debug APK and exact-SHA receipt; source packager excludes game routes. Auth/WS/gameplay are not claimed until real Stage/device evidence exists. Missing configuration or integration GO is reported as a blocker, not bypassed. Draft PR only, no merge.
