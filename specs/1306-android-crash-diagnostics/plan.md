# Implementation Plan: Android crash and non-fatal diagnostics (#1306)

**Branch**: `1306-android-crash-diagnostics` | **Date**: 2026-11-22 r3 | **Spec**: [spec.md](spec.md) | **Base**: `main` @ `89374212`
**Status**: plan only. Nothing is implemented, provisioned, collected, signed or uploaded until the OWNER approves this plan and D1–D7.
**Validation command (PR1):** `node --test tests/mobile-poker-security.test.mjs tests/mobile-poker-channel.test.mjs tests/mobile-legal-packaging.test.mjs`.
Run it plus the Draft-PR Android build. Never run the full suite on the VPS.

## Summary
**Firebase Crashlytics** is the single remote reporter. It runs on a new dedicated Spark project that never has billing linked,
next to the existing Play Android vitals. Both Stage A reviews (#1306) independently endorse this provider. They reject the alternatives:
- Sentry Developer: 5k errors, 30 days and 1 user; ESM/bundler-only JS; needs WebView `connect-src`; IP/PII defaults.
- Android vitals only: no handled or JS failures.
- Self-hosted GlitchTip/ACRA or a Netlify/Supabase sink: a new service or log server.

The integration has three parts:
- The SDK is added through the existing `configure-android.mjs` mechanism (dependency injection plus Java plugin copy).
- A small repo-owned `PokerDiagnosticsPlugin.java` is the single enforcing allowlist and cap.
- A small Android-only IIFE, `mobile/poker/diagnostics.js`, forwards constant codes.

Collection is off by default, and anything buffered while it is off is deleted.

## Technical Context
- **Platform**:
  - Capacitor 8.5.3 generates `android/`, which is never committed.
  - The template has AGP 8.13.0, `google-services:4.4.4`, `minifyEnabled false`, minSdk 24, compile/target SDK 36 and Java 21.
  - Builds: `.github/workflows/android-poc.yml` produces the Stage debug APK. It runs only for same-repo **Draft PRs with a
    successful Netlify Deploy Preview** (`preview-preflight.mjs`). `.github/workflows/android-release-aab.yml` produces the
    Production AAB on manual dispatch from `main`.
  - Both run `package-web.mjs` → `cap add android` → `configure-android.mjs` → `cap sync`.
- **New pinned artifacts** (all verified on Google Maven, 2026-11-22):
  - `com.google.firebase:firebase-crashlytics:21.1.0`. It pulls in `firebase-sessions:4.0.2`, `firebase-installations:20.0.0`,
    `transport-*:5.0.0`, `firebase-common` and kotlin-stdlib.
  - The `com.google.firebase:firebase-crashlytics-gradle:3.0.8` classpath. Its build-ID injection is required: without it the SDK
    can throw "Crashlytics build ID is missing" at startup.
- **Verified manifest impact**: the AAR manifests of `firebase-crashlytics:21.1.0`, `firebase-installations:20.0.0`,
  `transport-runtime:5.0.0` and `transport-backend-cct:5.0.0` declare `ACCESS_NETWORK_STATE`. This is a normal install-time
  permission with no user prompt. PR1 CI logs the merged permission set.
- **Constraints**: JSP-compatible global/IIFE JS, `klog` (never `console.log`), packaged CSP/SRI from `package-web.mjs`,
  fundamental tests only, and an OWNER who works from a phone only.

## Constitution Check (v1.6.0)
| Gate | Result |
|---|---|
| I Simplicity / existing mechanisms | PASS. Reuses `GOOGLE_SIGNIN_DEPENDENCIES`, the plugin copy, `registerPlugin`, `window.Capacitor.Plugins` (as `runtime.js::plugin`), the Offline `audioHash` SRI pattern and the `legal-candidate-aN` manifest mechanism. No npm dependency, server, DB or endpoint. One allowlist, one cap, both native |
| II Runtime boundaries | PASS. No WS, poker engine, ledger, `poker/*.js` or Netlify function change |
| III Fail-closed / env separation | PASS. A missing or mismatched Firebase config, a missing plugin or an unknown permission fails the build. Collection is off by default and pre-consent buffers are deleted. Stage and Production are separate Android apps |
| IV JSP / logging / CSP | PASS. `diagnostics.js` is a classic external script with no imports. Online pages already allow `script-src 'self'`; Offline gets an SRI hash. No inline script, no new `connect-src` (the native SDK uploads), no CSS |
| V Tests / concrete plan | PASS. Only fail-closed configuration and privacy-sanitising logic is tested, in the existing files. No UI/CSS/glue tests and no Git commands (the SHA is read from `www/build-receipt.json`) |
| VI Workspace | Implementation runs in an `agy/*` worktree created via `scripts/ops/agent-workdir-preflight.mjs` |
| Deploy / merge | No deploy, Play upload or merge. Every gate in §6 needs its own OWNER GO, and the WWW legal release uses the existing OWNER WWW path |

## 1. OWNER decisions required before implementation
- **D1 Integration variant.** Recommended: **B, the repo-owned bridge**. This deviates from the OWNER's earlier stated preference
  for `@capacitor-firebase/crashlytics`. Review #2 slightly preferred variant **A**, the plugin pinned to 8.6.0 (32 vs 31). Review #1
  preferred B (31 vs 27).
  - **Reasons for B**:
    - (b) A exposes `crash()`, `setUserId()`, free-text `log()`/`recordException(message, stacktrace)` and `setCustomKey` to
      any WebView JS. B accepts only allowlisted constants natively and caps them natively.
    - (c) A adds a single-maintainer npm dependency that defaults to `firebase-crashlytics:20.0.3`.
  - **Not a reason**: native auth reporting. A could call `FirebaseCrashlytics.getInstance()` from Java too, so both variants need
    the same Java edit in `PokerGoogleSignInPlugin`.
  - **Delta if A is chosen**:
    - Pin `@capacitor-firebase/crashlytics@8.6.0` exactly in `mobile/poker/package.json` and the lockfile.
    - Write `firebaseCrashlyticsVersion = '21.1.0'` into `variables.gradle`.
    - `diagnostics.js` calls `Capacitor.Plugins.FirebaseCrashlytics.recordException({message:'<code>:<stage>', keysAndValues})`
      and owns the allowlist and cap in JS. It must never call `stacktrace`, `crash`, `setUserId` or `log`.
    - The native Java edits stay.
    - Gates C–G are identical.
- **D2 Permission.** Approve `android.permission.ACCESS_NETWORK_STATE` in both manifest checks. The `REMOVED_LIBRARY_PERMISSIONS`
  pattern does not apply here, because datatransport uses this permission to schedule uploads.
- **D3 Firebase project.** The OWNER creates it on the phone (Gate C) and pastes the public `google-services.json` into #1306.
- **D4 Collection model.** Notice-only (GDPR Art. 6(1)(f) plus the right to object) or opt-in. This needs the ePrivacy Art. 5(3) /
  PKE art. 399 assessment, with the collection-off QA facts from T013a as input. The engineering default is off. If opt-in or
  opt-out is required, T014 applies.
- **D5 Stage QA enablement.** A GO for a **Draft PR that is never merged**, with `DIAGNOSTICS_COLLECTION.stage = true`. Only that PR's
  APK collects data, so later Stage PR APKs stay off.
- **D7 Reviewer pair.** The OWNER asked (2026-11-22) that Stage A/B be run by the Claude Code coordinator and a separate Claude
  Code CLI run. The issue protocol named Claude + Codex, and review #1 of the plan is author self-review. Choose one: accept this
  deviation, or require one Codex read-only Stage B review of the final SpecKit SHA before T003. The AGENTS.md Codex gate for PR1
  is unaffected either way.
- **D6 WS scope.** Accept the descope of WS reconnect reporting. `poker/poker-ws-client.js` retries indefinitely with backoff
  (`DEFAULT_RECONNECT_MAX_MS`) and has no terminal failure. Instrumenting it would change shared WWW `poker/*.js`. Uncaught JS errors
  on poker pages are still captured.

## 2. File-level design
- **`mobile/poker/google-services.json`** (new, committed, public). It holds one project with two Android clients,
  `pl.kcswh.arcadepoker` and `pl.kcswh.arcadepoker.stage`.
- **`mobile/poker/configure-android.mjs`** (new exports in this file):
  - **Constants**:
    - `FIREBASE_CRASHLYTICS_DEPENDENCIES = ['com.google.firebase:firebase-crashlytics:21.1.0']`, injected next to
      `GOOGLE_SIGNIN_DEPENDENCIES`.
    - `CRASHLYTICS_GRADLE_CLASSPATH = 'com.google.firebase:firebase-crashlytics-gradle:3.0.8'`. It is inserted after the
      `classpath 'com.google.gms:google-services:4.4.4'` anchor in `android/build.gradle`.
  - **Gradle changes**:
    - In `android/app/build.gradle`, the template `try { def servicesJSON … }` block is replaced by unconditional
      `apply plugin: 'com.google.gms.google-services'` and `apply plugin: 'com.google.firebase.crashlytics'`.
    - A missing anchor throws.
  - **Firebase config**:
    - `FIREBASE_PROJECT_ID` is pinned after Gate C.
    - `assertFirebaseConfig(json, appId)` requires the pinned `project_info.project_id` and exactly one client whose
      `android_client_info.package_name === appId` with a public-format `api_key`.
    - The directly-run block also throws if `mobile/poker/google-services.json` is absent. It then copies the file to
      `android/app/google-services.json`.
  - **Collection flag**:
    - `DIAGNOSTICS_COLLECTION = { stage: false, production: false }`.
    - `configureDiagnosticsManifest(xml, enabled)` adds `<meta-data android:name="firebase_crashlytics_collection_enabled" …/>`
      inside `<application>`, and throws on a duplicate.
  - **Build resources**:
    - `googleSignInResource` is generalised to `buildResources({clientId, channel, sha, diagnostics})`.
    - It writes `poker_build_channel`, `poker_source_sha` and the boolean `poker_diagnostics_enabled`.
    - The `sha` comes from `www/build-receipt.json`, written earlier by `package-web.mjs`, and must be 40 lowercase hex.
  - **Plugin registration**: add `PokerDiagnosticsPlugin` to the copy loop at `configure-android.mjs:250`, and
    `registerPlugin(PokerDiagnosticsPlugin.class);` in the generated `MainActivity.onCreate`.
- **`mobile/poker/PokerDiagnosticsPlugin.java`** (new, about 70 lines, `@CapacitorPlugin(name = "PokerDiagnostics")`):
  - `load()` reads the resources. If diagnostics are disabled, it calls `deleteUnsentReports()`. Otherwise it sets the custom keys
    `channel` and `source_sha`.
  - On the first run of an enabled build (a persisted `SharedPreferences` flag `poker_diag_purged_<versionCode>`), it calls
    `deleteUnsentReports()` once. This stops a report buffered under an earlier collection-off build from uploading after the
    upgrade.
  - `@PluginMethod report(call)`:
    - It takes `code` and `stage`, optional `js_file` (`^[a-z0-9_.-]{1,40}\.js$`) and optional `js_line` (1–999999).
    - It checks them against a static `Map<String, Set<String>> ALLOWED` (plan §3), the **single** allowlist.
    - It always resolves.
  - `static record(code, stage, Map<String, String> keys)`:
    - It returns immediately when diagnostics are disabled, when the pair is not allowed, when the `code:stage` pair has already
      been reported (static `Set`), or when 7 reports have been sent this process.
    - Otherwise it builds `PokerDiagnostic extends Exception` with message `code:stage` and a single synthetic
      `StackTraceElement("PokerDiagnostic", code, stage, 1)`.
    - It calls `FirebaseCrashlytics.getInstance().recordException(e, CustomKeysAndValues)` inside `try`/`catch (Throwable)`, and
      ignores any failure.
  - `selftest:handled` is accepted only when the channel is `stage`. A Stage-only fallback, `crashForTest`, is added **only if**
    T013 shows that `am crash` is not captured. It is guarded by `poker_build_channel == stage`.
  - There are no crash, user-ID or free-text methods. `setEnabled` is added only if T014 applies.
- **`mobile/poker/PokerGoogleSignInPlugin.java`**:
  - `onError`: every branch except the cancellation and no-credential branches records
    `google_credential:credential_manager` with `exception = getClass().getSimpleName()` and `type = getType()`.
    Both must match `^[A-Za-z0-9_.]{1,128}$`; otherwise the value is `other`.
  - The failed `onResult` path records `google_credential:unexpected_credential`.
  - `webClientId()==null` records `google_credential:config_missing`, but only when the `poker_build_channel` resource equals
    `production`. This is a native guard, so it does not rely on the JS channel check.
  - The reject codes do not change.
- **`mobile/poker/diagnostics.js`** (new IIFE, about 40 lines, exposes `window.MobilePokerDiagnostics = { report(code, stage) }`):
  - It looks up `window.Capacitor.Plugins.PokerDiagnostics` lazily. If the plugin is missing, the call does nothing.
  - It has a re-entrancy guard and a local `klog(kind)`, the same as `runtime.js::klog`.
  - `error` listener: it acts only when `filename` has origin `https://localhost`. It sends `js_file` (basename, only if it ends in
    `.js`) and `js_line`, with stage `offline` on `/poker/offline/play.html` and `window` elsewhere.
  - `unhandledrejection` listener: sends `js_unhandled_rejection` with the same stage rule.
  - It holds no allowlist and no cap; both are native.
- **`mobile/poker/runtime.js::signInWithGoogle`**:
  - A local `stage` starts as `unexpected`. It becomes `bridge` around `plugin('PokerGoogleSignIn')`, `credential_manager` when
    `pickerError.code` is `failed`, and `id_token_exchange` around `signInWithIdToken` and the session check.
  - The `catch` reports `google_failed:<stage>` only for the `google_failed` result.
  - It never reports for `canceled`, `unavailable` or `in_progress`.
  - Two other existing `klog` sites also report: `auth_callback_failed:callback_exchange` in `callback`, and
    `google_clear_failed:sign_out` in `queueClear`.
  - `bridge_unavailable` (undeliverable when the bridge is missing) and `launch_url_failed`, `system_bars_failed` and
    `external_link_failed` (low value) are not reported.
- **`mobile/poker/package-web.mjs`**:
  - It writes `mobile/diagnostics.js` with `put`, and injects it into the shared head block before `/mobile/config.js`, not
    deferred.
  - In `poker/offline/play.html`, it inserts `<script src="/mobile/diagnostics.js" integrity="…">` before
    `<script src="/poker/offline/avatar-catalog.generated.js"` and prepends the hash to `script-src`, using the same code as
    `audioHash`.
  - When `channel === 'stage'`, it also packages `mobile/diagnostics-selftest.js` (new) on `account.html` only. This IIFE adds one
    "Diagnostics self-test" button that emits `selftest:handled`, then throws in a `setTimeout` and rejects a promise. There is no
    dialog.
  - The Production packaging throws if the self-test file or its tag is present. The existing CSP/SRI validation covers the new
    files.
- **`.github/workflows/android-release-aab.yml`**:
  - The step 7 allowlist adds `android.permission.ACCESS_NETWORK_STATE` (D2) and logs the merged permission list (it already
    prints this).
  - A new check reads `firebase_crashlytics_collection_enabled` from `artifacts/manifest.txt`. It must equal
    `DIAGNOSTICS_COLLECTION.production`, read by `node -e` import of `configure-android.mjs`.
  - `release-receipt.json` gains `diagnostics: { provider: 'firebase-crashlytics', collection: <bool> }`.
  - Source provenance already rests on the `config.js` SHA check. No new secrets are needed.
- **`.github/workflows/android-poc.yml`**: adds a new step after the APK build. It runs `aapt2 dump xmltree --file AndroidManifest.xml`
  on the APK, finding `aapt2` the same way as `apksigner` at `android-poc.yml:138`. It applies the same permission allowlist and
  requires the collection flag to equal `DIAGNOSTICS_COLLECTION.stage`.
- **Legal (T015, WWW-affecting)**:
  - New files: `legal/privacy.<date>-a5.{en,pl}.html` and `specs/1306-android-crash-diagnostics/legal-candidate-a5/manifest.json`
    (`previousVersion` a4, `basedOn` hashes).
  - An a5 block in `tests/mobile-legal-packaging.test.mjs`, plus the alias update and the `legalPages` entry in `package-web.mjs`.
  - Content:
    - The processor is Firebase Crashlytics (Google: DPST, global processing, EU-US DPF), and processing happens in the **Android
      app only**.
    - It lists the data from spec Key Entities, the 90-day retention, the purpose (stability and security), the D4 legal basis and
      how to object or opt out.
    - The "no Analytics/AdSense in Android" statement stays.
  - A Play Data Safety draft goes into #1306:
    - Crash logs and Diagnostics (including Firebase Sessions app/device metadata) and Device or other IDs.
    - Collected, not shared, encrypted in transit.
    - Purpose follows Google's definitions; optional or required follows D4.
- **Unchanged**: `js/debug.js`, `js/auth/supabaseClient.js`, `js/account-page.js`, `poker/*.js`, every WWW page except the T015
  legal files, `netlify.toml`, WS and Supabase.

## 3. Native allowlist (`PokerDiagnosticsPlugin.ALLOWED`, the single source)
| Code | Stages |
|---|---|
| `google_credential` | `credential_manager`, `unexpected_credential`, `config_missing` (native only) |
| `google_failed` | `bridge`, `credential_manager`, `id_token_exchange`, `unexpected` (the initial stage, for non-mapped exceptions) |
| `auth_callback_failed` | `callback_exchange` |
| `google_clear_failed` | `sign_out` |
| `js_uncaught` | `window`, `offline` |
| `js_unhandled_rejection` | `window`, `offline` |
| `selftest` | `handled` (only in the Stage channel) |

## 4. Privacy and operations
- **Firebase project settings, before any real data**:
  - Turn data sharing off (the "Firebase Service Data" used for other Google purposes).
  - Do not link Analytics; no breadcrumbs.
  - Keep the OWNER as the only member.
- **API key**: restrict the API key **by API only**: Firebase Installations, Crashlytics and the Firebase logging/session APIs the
  console lists. There is no Android-app SHA-1 restriction, because Stage debug signing is ephemeral (`mobile/poker/README.md:7`).
  The residual risk is the public key and possible junk reports.
- **Alerts**: enable the **new fatal, new non-fatal and new ANR** e-mail alerts. By default only *regressed* and *trending* alerts
  fire, which a small user base will not trigger.
- **QA on the debuggable Stage APK** (Termux wireless ADB):
  - Commands: `adb shell setprop log.tag.FirebaseCrashlytics DEBUG`, `adb logcat -s FirebaseCrashlytics FirebaseSessions
    FirebaseInstallations`, and `adb shell run-as pl.kcswh.arcadepoker.stage ls -R shared_prefs files`.
  - T013a checks a **collection-off** build. Expect no upload, no Installations call and no buffered reports kept. Record whether a
    UUID/FID is written, as input to D4.
  - **STOP rule:** if any Firebase network call or retained report appears with collection off, STOP before the PR1 merge. A
    reviewed mitigation follows. One candidate is the global manifest flag `firebase_data_collection_default_enabled=false`
    and/or a Sessions switch, re-checked against the official docs.
  - T013b checks a **collection-on** build. Expect offline buffering, upload on relaunch and that the Installations call succeeds.
- **DSAR**: no account linkage and no user ID. Requests are answered by deleting the issues, or by the 90-day expiry.
- **Runbook**: `mobile/poker/README.md` covers where to look, triage, coverage gaps, retention and a hotfix to turn collection off.

## 5. Breaking impact
- **Android**:
  - About +1.5–2.5 MB on the AAB (measured in PR1 CI).
  - The new `ACCESS_NETWORK_STATE` permission.
  - The Google Services and Crashlytics Gradle plugins.
  - With collection on, network egress to the Crashlytics/Installations/logging hosts.
- **Builds**: every Android build fails until `google-services.json` is committed, which is intended (Gate C before PR1).
  `[skip netlify]` must **not** be used on PR1 or the Gate E PR, because the Stage APK build depends on the Deploy Preview.
- **Stage reinstalls**: a different ephemeral debug key forces an uninstall, which drops the local session and buffered reports.
- **WWW**: only the T015 legal revision changes WWW, and it goes through the OWNER WWW release.
- **No change** to:
  - Netlify functions, WS, Supabase or KLog
  - Google OAuth config (Crashlytics is independent of the #1300 signer setup)

## 6. Delivery and gates
- **Gate A (done)**: two independent Stage A architecture reviews (#1306).
- **Gate B (this task)**: two Stage B plan reviews and a round-2 verification; the r2/r3 fixes and dispositions are in #1306. Then
  OWNER approval of the plan and D1–D7.
- **Gate C (OWNER, phone)**: create the Spark project and two Android apps without Analytics, apply the §4 settings, and paste
  `google-services.json`.
- **Gate D, PR1 (agent Draft, Deploy Preview kept)**: T005–T012 with collection off. The PR1 Stage APK is the compile, manifest and
  T013a evidence. Codex review per AGENTS.md: at most 3 rounds and 0 P0/P1/P2 on the final SHA. Only the OWNER merges.
- **Gate E (OWNER GO for D5)**: an unmerged Draft PR with `stage = true`; the OWNER installs its APK and runs T013b.
- **Gate F (privacy, OWNER)**:
  - T014 if D4 requires it.
  - T015 (the a5 candidate, then OWNER WWW Candidate → Publish, plus the Data Safety draft).
  - After D4 approval, a reviewed PR sets `production: true`.
- **Gate G (Play internal, separate OWNER GO)**: build and sign the release AAB with the existing workflow, the OWNER uploads it, then
  T016.
- Public Production stays blocked until the OWNER accepts #1306 and the remaining #1140 gates.

## Complexity Tracking
| Addition | Why needed | Simpler alternative rejected |
|---|---|---|
| `PokerDiagnosticsPlugin.java` | single native allowlist/cap and native auth-failure reporting | Capawesome plugin (D1-A): adds an npm dependency and exposes an unrestricted JS API |
| `diagnostics.js` | JS errors are not captured natively, and Offline does not load `runtime.js` | inline code in `runtime.js` |
| Stage-only self-test file | phone-only QA with no Production test trigger | ADB alone cannot raise JS errors without desktop DevTools |
