# Implementation Plan: Android crash and non-fatal diagnostics (#1306)

**Branch**: `1306-android-crash-diagnostics` | **Date**: 2026-11-22 | **Spec**: [spec.md](spec.md) | **Base**: `main` @ `89374212`
**Status**: plan only. Nothing is implemented, provisioned, collected, signed or uploaded until the OWNER approves this plan and decisions D1–D5.

## Summary
The provider is **Firebase Crashlytics** on a new, dedicated Spark project that never has billing linked. It sits next to the
existing Play Android vitals. Both Stage A reviews (#1306) independently endorse this provider and reject the
alternatives:
- Sentry Developer: 5k errors, 30 days and 1 user; ESM/bundler-only JS; WebView `connect-src`; IP/PII defaults.
- Vitals only: no handled or JS failures.
- Self-hosted GlitchTip/ACRA or a Netlify/Supabase sink: a new service or log server.

The SDK arrives through the existing `configure-android.mjs` mechanism, which injects dependencies and copies Java
plugins. A small repo-owned `PokerDiagnosticsPlugin.java` enforces the privacy allowlist natively. A small
Android-only IIFE `mobile/poker/diagnostics.js` reports allowlisted JS failures. Collection is off by default.

## Technical Context
- **Platform**: Capacitor 8.5.3, generated `android/` (never committed); template has AGP 8.13.0, `google-services:4.4.4`,
  `minifyEnabled false`, minSdk 24, compile/target 36, Java 21. Builds run in `.github/workflows/android-poc.yml` (Stage debug APK)
  and `.github/workflows/android-release-aab.yml` (Production AAB). Both run `cap add android` → `configure-android.mjs` → `cap sync`.
- **New artifacts**, pinned and verified on Google Maven when implemented:
  - `com.google.firebase:firebase-crashlytics:21.1.0`; Firebase docs, BoM 35.2.0. It pulls in firebase-sessions, -installations, -common and datatransport, plus kotlin-stdlib.
  - The `com.google.firebase:firebase-crashlytics-gradle:3.0.8` classpath, so the plugin injects the build ID. Without it the SDK can throw "Crashlytics build ID is missing" at startup.
- **Verified manifest impact**: `firebase-installations:18.0.0`, `transport-runtime:3.3.0` and `transport-backend-cct:3.3.0` declare
  `android.permission.ACCESS_NETWORK_STATE`. This is a normal install-time permission and the user sees no prompt.
  `FirebaseInitProvider` runs automatic initialisation.
- **Constraints**: JSP-compatible global/IIFE JS, `klog` not `console.log`, packaged CSP/SRI from `package-web.mjs`, fundamental tests only, phone-only OWNER.

## Constitution Check (v1.6.0)
| Gate | Result |
|---|---|
| I Simplicity / existing mechanisms | PASS. The plan reuses the `GOOGLE_SIGNIN_DEPENDENCIES` + plugin-copy + `registerPlugin` pattern and `window.Capacitor.Plugins` access as in `runtime.js::plugin`. It adds no npm dependency, server, DB or endpoint, and does not migrate KLog. It adds exactly two files (one Java, one JS) plus a public config file |
| II Runtime boundaries | PASS. No WS, poker engine, ledger or Netlify change |
| III Fail-closed / env separation | PASS. Missing or mismatched Firebase config, a missing plugin or an unknown permission fails the build. Collection is off by default. Stage and Production are separate Android apps, and Production only collects after an OWNER legal GO |
| IV JSP / logging / CSP | PASS. `diagnostics.js` is a classic external script with no imports. The online pages already allow `script-src 'self'`. Offline gets the script's SRI hash, following the `mobile/audio.js` pattern. No inline script, no new `connect-src` (the native SDK uploads), no CSS |
| V Tests / concrete plan | PASS. The plan only extends `tests/mobile-poker-channel.test.mjs` and `tests/mobile-poker-security.test.mjs`. No UI, CSS or glue tests and no Git commands |
| VI Workspace | Implementation uses an `agy/*` worktree created via `scripts/ops/agent-workdir-preflight.mjs` |
| Deploy / merge | No deploy, Play upload or merge. Each gate in §6 needs its own OWNER GO |

## 1. OWNER decisions required before implementation
- **D1 Integration variant.** Recommended: **B, the repo-owned bridge**. Review #2 slightly preferred **A**, the
  `@capacitor-firebase/crashlytics@8.6.0` plugin (scored 32 vs 31); review #1 preferred B (31 vs 27).

  Why B:
  - (a) The #1300-type signal is the native `GetCredentialException` in `PokerGoogleSignInPlugin.onError`, which needs a direct
    SDK call in Java in either variant.
  - (b) A exposes `crash()`, `setUserId()`, free-text `log()`/`recordException(message, stacktrace)` and `setCustomKey` to any
    WebView JS, while B accepts only allowlisted values natively.
  - (c) A adds an npm dependency with one maintainer and pins the older `firebase-crashlytics:20.0.3` by default.
  - (d) The Gradle, Firebase and permission changes are identical in both.

  If the OWNER picks A, the delta is:
  - pin `@capacitor-firebase/crashlytics` exactly in `mobile/poker/package.json` and the lockfile
  - set `firebaseCrashlyticsVersion` in the generated `variables.gradle`
  - `diagnostics.js` calls `Capacitor.Plugins.FirebaseCrashlytics.recordException` with only `{message:'<code>:<stage>', keysAndValues}`, never `stacktrace`, `crash`, `setUserId` or `log`
  - the native `onError` report stays as direct Java
- **D2 Permission.** Approve `android.permission.ACCESS_NETWORK_STATE` in both manifest allowlists. Without it, the plan stops.
- **D3 Firebase project.** The OWNER creates it on the phone (§6 Gate C) and pastes the public `google-services.json` into #1306.
- **D4 Collection model.** Notice-only (GDPR Art. 6(1)(f) + objection) or opt-in. This needs the ePrivacy Art. 5(3) / PKE
  art. 399 assessment. Engineering default: off. If opt-in or opt-out is required, task T014 applies; otherwise it is skipped.
- **D5 Stage QA enablement.** GO to set `DIAGNOSTICS_COLLECTION.stage = true` for the controlled QA builds that the OWNER installs.

## 2. File-level design
- **`mobile/poker/google-services.json`** (new, committed, public). One Firebase project with two Android clients,
  `pl.kcswh.arcadepoker` and `pl.kcswh.arcadepoker.stage`. No OAuth client entries are needed.
- **`mobile/poker/configure-android.mjs`**:
  - New export `FIREBASE_CRASHLYTICS_DEPENDENCIES = ['com.google.firebase:firebase-crashlytics:21.1.0']`, injected next to `GOOGLE_SIGNIN_DEPENDENCIES`.
  - New export `CRASHLYTICS_GRADLE_CLASSPATH = 'com.google.firebase:firebase-crashlytics-gradle:3.0.8'`. It is inserted after the
    template's `classpath 'com.google.gms:google-services:4.4.4'` line in `android/build.gradle`, which fails if the anchor is missing.
  - `apply plugin: 'com.google.firebase.crashlytics'` goes after the template's `google-services` try-block in `android/app/build.gradle`. The block itself is replaced by an unconditional `apply plugin: 'com.google.gms.google-services'`, so a missing file now fails the Gradle build.
  - New `assertFirebaseConfig(json, appId)`: exactly one `client[].client_info.android_client_info.package_name === appId`,
    `project_info.project_id` matching a pinned constant, and `api_key[].current_key` matching the public format. The file is copied to `android/app/google-services.json`.
  - New `DIAGNOSTICS_COLLECTION = { stage: false, production: false }`.
  - New `configureDiagnosticsManifest(xml, enabled)` adds
    `<meta-data android:name="firebase_crashlytics_collection_enabled" android:value="true|false"/>` inside `<application>`
    and fails if the entry already exists.
  - `googleSignInResource` is generalised to `buildResources({clientId, channel, sha})`, which writes `poker_build_channel`
    and `poker_source_sha` strings (SHA regex `^[0-9a-f]{40}$`). The source is `SOURCE_SHA`, or `git rev-parse HEAD` as `package-web.mjs` does.
  - Copy `PokerDiagnosticsPlugin` in the existing loop over `['PokerAudioPlugin','PokerGoogleSignInPlugin']`, and add
    `registerPlugin(PokerDiagnosticsPlugin.class);` in the generated `MainActivity.onCreate` before `super.onCreate`.
- **`mobile/poker/PokerDiagnosticsPlugin.java`** (new, about 60 lines, `@CapacitorPlugin(name = "PokerDiagnostics")`):
  - `load()` sets the custom keys `channel` and `source_sha` from the resources.
  - `@PluginMethod report(call)` reads `code` and `stage`, plus optional `js_file` and `js_line`. It validates them against fixed `Set`s and
    regexes (`js_file` `^[a-z0-9_.-]{1,40}\.js$`, `js_line` 1–999999), then always resolves.
  - `static record(code, stage, Map<String,String> keys)` calls `FirebaseCrashlytics.getInstance().recordException(new PokerDiagnostic(code + ":" + stage), CustomKeysAndValues)` inside a `try`/`catch (Throwable)` that does nothing.
  - `setEnabled(call)` is added only if D4 requires it: `setCrashlyticsCollectionEnabled(b)`, plus `deleteUnsentReports()` when `false`.
  - There is no crash, user-ID or free-text method.
- **`mobile/poker/PokerGoogleSignInPlugin.java`**:
  - In `onError`, every branch except the `GetCredentialCancellationException` and `NoCredentialException` ones calls
    `PokerDiagnosticsPlugin.record("google_credential", "credential_manager", {exception: error.getClass().getSimpleName(), type: error.getType()})`.
    Both values are regex-checked against `^[A-Za-z0-9_.]{1,80}$`, and anything else becomes `other`.
  - The `onResult` failure path records `stage = "unexpected_credential"`.
  - Existing reject codes are unchanged.
- **`mobile/poker/diagnostics.js`** (new IIFE, about 60 lines, `window.MobilePokerDiagnostics = { report(code, stage) }`):
  - It resolves `window.Capacitor.Plugins.PokerDiagnostics` lazily. If the plugin is missing, the report is a no-op.
  - It applies a JS-side allowlist identical to the Java one.
  - The cap is one per `code:stage` and six per page load; a counter in `sessionStorage` carries it across page navigations in one app run.
  - `window.addEventListener('error')` handles only events whose `filename` origin is `https://localhost`, sending `js_file` = basename and `js_line`.
  - `unhandledrejection` sends `js_unhandled_rejection:window`.
  - There is a re-entrancy guard and a local `klog(kind)` identical to `runtime.js::klog`.
- **`mobile/poker/runtime.js::signInWithGoogle`** keeps a local `stage` variable:
  - `bridge` before `plugin('PokerGoogleSignIn')`
  - `credential_manager` once the picker fails with `failed`
  - `id_token_exchange` around `signInWithIdToken` / a missing session

  The `catch` reports only `google_failed:<stage>`. `canceled`, `unavailable` and `in_progress` are never reported.
  The other existing `klog('mobile:…')` sites also call `MobilePokerDiagnostics.report`:
  - `auth_callback_failed:callback_exchange`
  - `bridge_unavailable:startup`
  - `google_clear_failed:sign_out`
  - `launch_url_failed:startup`

  `system_bars_failed` and `external_link_failed` are left out as low value.
- **`mobile/poker/package-web.mjs`**:
  - `put('mobile/diagnostics.js', …)`, injected **before** `/mobile/runtime.js` (not deferred, so listeners attach early) in the shared head block.
  - In `poker/offline/play.html`, it is added with an `integrity` hash and that hash goes into `script-src`, following the existing `audioHash` code.
  - For `channel === 'stage'` only, `mobile/diagnostics-selftest.js` is also packaged on `account.html`. It is a small IIFE that adds one
    "Diagnostics self-test" button. Pressing it emits `selftest:handled`, then throws inside `setTimeout` and rejects a promise.
    It uses no dialog.
  - The Production packaging asserts that `diagnostics-selftest.js` is absent. Existing CSP/SRI validation covers both files.
- **`.github/workflows/android-release-aab.yml`**:
  - Step 7 allowlist adds `android.permission.ACCESS_NETWORK_STATE` (D2).
  - A new check reads `firebase_crashlytics_collection_enabled` from `artifacts/manifest.txt` and requires it to equal `DIAGNOSTICS_COLLECTION.production`.
  - A new check runs `bundletool dump resources` for `string/poker_source_sha` and requires it to equal `SOURCE_SHA`.
  - The build receipt gains `diagnostics: { provider: 'firebase-crashlytics', collection: <bool> }`.
  - The Firebase files are not secrets, and no new secret is added.
- **`.github/workflows/android-poc.yml`**: same permission and collection-flag check on the Stage APK manifest (`aapt2 dump xmltree` or apkanalyzer from the SDK already used).
- **`legal/privacy.<date>-a5.{en,pl}.html`** (new immutable revision), `legal/privacy.{en,pl}.html` aliases, and the `package-web.mjs` `legalPages` list:
  - names Firebase Crashlytics (Google as processor, DPST, global processing, EU-US DPF)
  - lists the data from the spec's Key Entities and the 90-day retention
  - states the purpose (app stability and security), the legal basis from D4 and how to object or opt out
  - keeps the "no Analytics/AdSense in Android" statement

  A Play Data Safety draft goes in the #1306 comment: Crash logs, Diagnostics and Device or other IDs; collected, not shared, encrypted in transit; purpose "App functionality / Analytics" per the Google definitions; whether it is optional follows D4.
- **Unchanged**: `js/debug.js`, `js/auth/supabaseClient.js`, `js/account-page.js`, every WWW page, `netlify.toml`, WS and Supabase.

## 3. Allowlist (single source, duplicated in Java and JS; the tests compare them)
Codes and their stages:
- `google_credential`: `credential_manager`, `unexpected_credential` (native only)
- `google_failed`: `bridge`, `credential_manager`, `id_token_exchange`, `unexpected`
- `auth_callback_failed`: `callback_exchange`
- `bridge_unavailable`: `startup`
- `launch_url_failed`: `startup`
- `google_clear_failed`: `sign_out`
- `js_uncaught`: `window`, `offline`
- `js_unhandled_rejection`: `window`, `offline`
- `selftest`: `handled` (accepted only when the channel resource is `stage`)

## 4. Privacy and operations
- Before the Firebase project carries real data:
  - Data-sharing controls are off ("Firebase Service Data" for other Google uses).
  - No Analytics is linked and Crashlytics breadcrumbs stay off.
  - The API key is restricted to Android apps (package + upload/app-signing SHA-1, including the three Play signer SHA-1s from #1300) and to the Firebase Installations and Crashlytics APIs.
  - Only the OWNER is a project member.
- Alerts: enable **new fatal, new non-fatal and new ANR** e-mail alerts. The defaults are only *regressed* and *trending*, which will not fire for a small user base.
- QA verifies four things with `adb logcat -s FirebaseCrashlytics FirebaseSessions` and `adb shell run-as pl.kcswh.arcadepoker.stage ls shared_prefs files` on the debuggable Stage APK:
  - no network upload while collection is off
  - whether a UUID or FID is written while collection is off; this is ePrivacy input for D4
  - offline buffering
  - upload on relaunch
- DSAR/deletion: Crashlytics data is not linked to an account, and no user ID is set. The policy says requests are handled by deleting
  the issues, or by the 90-day expiry. The runbook lives in `mobile/poker/README.md`, which already holds the Android release notes and
  records where to look, how to triage, the coverage gaps, retention, and how to switch collection off in a hotfix.

## 5. Breaking impact
- Android only: new SDK, about +1.5–2.5 MB AAB (measured in CI), the new `ACCESS_NETWORK_STATE` permission, and the Google Services and Crashlytics Gradle plugins.
- If `google-services.json` is missing, every Stage PR APK build fails. That is intended and needs D3 first.
- Data Safety and the Privacy text change before collection is enabled. Collection-on changes the app's network egress: to firebase-settings.crashlytics.com, crashlyticsreports-pa.googleapis.com, firebaseinstallations.googleapis.com and firebaselogging.
- No change to WWW/Stage web, Netlify, WS, Supabase, Google OAuth configuration (Crashlytics is separate from the #1300 signer setup) or KLog.

## 6. Delivery and gates
- **Gate A (done)**: two independent Stage A architecture reviews, posted in #1306.
- **Gate B (this task)**: two independent reviews of this spec, plan and tasks. Fixes are applied, then the OWNER approves the plan and D1–D5.
- **Gate C (OWNER, phone)**: create the Spark project and the two Android apps without linking Analytics; apply the §4 settings; paste
  `google-services.json`. The agent creates nothing in Firebase.
- **Gate D, PR1 (agent, Draft, `[skip netlify]`)**: tasks T004–T011 with collection off. Codex reviews it per AGENTS.md
  (max 3 rounds, 0 P0/P1/P2 on the final SHA). Only the OWNER merges.
- **Gate E (QA, OWNER GO for D5)**: a one-line follow-up PR sets the Stage flag to true; the OWNER installs the Stage APK from the CI artifact and runs T013.
- **Gate F (privacy, OWNER)**: T014 if D4 requires it, then T015 (Privacy a5 and the Data Safety draft); the OWNER publishes. A PR sets `production: true` only after D4 approval.
- **Gate G (Play internal, separate OWNER GO)**: release AAB build and signing via the existing workflow, upload by the OWNER, then T016.
- Public Production stays blocked until the OWNER accepts #1306 and the remaining #1140 gates.

## Complexity Tracking
| Addition | Why needed | Simpler alternative rejected |
|---|---|---|
| `PokerDiagnosticsPlugin.java` | native allowlist plus direct native auth-failure reporting | Capawesome plugin (D1 variant A): adds an npm dependency and an unrestricted JS API, and native reporting is still needed |
| `diagnostics.js` | JS errors are not captured natively | inline code in `runtime.js`: Offline does not load `runtime.js`, and the listeners must attach first |
| Stage-only self-test file | phone-only QA without adding test triggers to Production | ADB-only: JS errors cannot be triggered without a desktop DevTools |
