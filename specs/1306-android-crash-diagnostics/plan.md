# Implementation Plan: Android crash and non-fatal diagnostics (#1306)

**Branch**: `1306-android-crash-diagnostics` | **Date**: 2026-11-22 r4 execution baseline | **Spec**: [spec.md](spec.md) | **Base**: `main` @ `89374212`
**Status**: implementation authorised for PR1 with collection off. Independent implementation review is required before readiness. D1–D3 and D5–D7 are recorded below. D4 remains conditional on T013a and T013c.
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

Collection defaults to off. Before any enablement, demonstrate that an unauthorised backlog cannot upload. D4 determines which SDK operations can occur in each state.

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
| III Fail-closed / env separation | CONDITIONAL. A missing or mismatched Firebase config, a missing plugin or an unknown permission fails the build. D4 and T013a must demonstrate early startup gating and safe handling of queued data. Stage and Production are separate Android apps |
| IV JSP / logging / CSP | PASS. `diagnostics.js` is a classic external script with no imports. Online pages already allow `script-src 'self'`; Offline gets an SRI hash. No inline script, no new `connect-src` (the native SDK uploads), no CSS |
| V Tests / concrete plan | PASS. Only fail-closed configuration and privacy-sanitising logic is tested, in the existing files. No UI/CSS/glue tests and no Git commands (the SHA is read from `www/build-receipt.json`) |
| VI Workspace | Implementation reuses the #1306 worktree on the verified Hetzner Volume |
| Deploy / merge | No deploy, Play upload or merge. Every gate in §6 needs its own OWNER GO, and the WWW legal release uses the existing OWNER WWW path |

## 1. OWNER decisions
- **D1** Repo-owned native bridge (variant B). Keeps the allowlist and caps native and avoids exposing generic Crashlytics methods to WebView JS.
- **D2** Approve `android.permission.ACCESS_NETWORK_STATE` in both APK/AAB checks. DataTransport uses it to schedule uploads.
- **D3** OWNER provisions the dedicated Spark project and two Android apps on the phone at Gate C.
- **D4** Conditional. Notice-only requires a supported LIA, a separate ePrivacy/PKE basis for covered device access/storage and an objection path. Otherwise select a reviewed opt-in design or reconsider the architecture. T013a and T013c feed the final OWNER decision.
- **D5** Stage QA uses an OWNER-authorised, unmerged Draft and the OWNER’s test device.
- **D6** WS reconnect reporting remains out of scope. The WS client retries indefinitely.
- **D7** Plan review ends with the recorded Claude and Codex work and OWNER implementation GO. The complete implementation PR remains subject to the mixed-authorship review rule in AGENTS.md.

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
  - **Startup and activation**:
    - Keep the Crashlytics manifest default off. `DIAGNOSTICS_COLLECTION` defaults false for both channels and describes eligibility, not per-install permission.
    - Audit the merged manifest and the pinned SDK startup path, including `FirebaseInitProvider`, eager components, Sessions, Installations and DataTransport.
    - Where D4 requires consent for local access/storage, gate SDK initialisation itself on the persisted valid choice before any component triggers covered activity. If the pinned SDK or manifest cannot enforce this, keep the feature off and return to the OWNER.
  - **Build resources**:
    - `buildResources(channel, sha)` adds separate diagnostic resources. `googleSignInResource` preserves its existing contract.
    - It writes `poker_build_channel` and `poker_source_sha`. The boolean `poker_diagnostics_enabled` lives in manifest metadata and is checked on the built artifact.
    - The `sha` comes from `www/build-receipt.json`, written earlier by `package-web.mjs`, and must be 40 lowercase hex.
  - **Plugin registration**: add `PokerDiagnosticsPlugin` to the copy loop at `configure-android.mjs:250`, and
    `registerPlugin(PokerDiagnosticsPlugin.class);` in the generated `MainActivity.onCreate`.
- **`mobile/poker/PokerDiagnosticsPlugin.java`** (new, about 70 lines, `@CapacitorPlugin(name = "PokerDiagnostics")`):
  - `load()` applies the bridge policy and sets custom keys on the authorised path. It runs after provider startup and cannot guard Firebase initialisation.
  - For legacy data, keep upload blocked until pre-authorisation data is excluded, including any persisted SDK enablement and previously queued transport jobs. On Android the public `deleteUnsentReports()` queues deletion while automatic collection is disabled and returns without a completion result. It is a no-op while automatic collection is enabled. No first-run purge marker based on the call returning. Never use `sendUnsentReports()` to activate diagnostics.
  - If an upgrade can carry pending reports, demonstrate a supported migration with off-state verification and a same-install upgrade test. If clearance cannot be demonstrated, keep activation blocked and return to the OWNER. A clean install can be assessed separately from an upgrade.
  - `@PluginMethod report(call)`:
    - It takes `code` and `stage`, optional `js_file` (`^[a-z0-9_.-]{1,40}\.js$`) and optional `js_line` (1–999999).
    - It checks them against a static `Map<String, Set<String>> ALLOWED` (plan §3), the **single** allowlist.
    - It always resolves.
  - `static record(code, stage, Map<String, String> keys)`:
    - It returns immediately when the effective native policy is off, when the pair is not allowed, when the `code:stage` pair has already
      been reported (static `Set`), or when 7 reports have been sent this process.
    - Otherwise it builds `PokerDiagnostic extends Exception` with message `code:stage` and a single synthetic
      `StackTraceElement("PokerDiagnostic", code, stage, 1)`.
    - It calls `FirebaseCrashlytics.getInstance().recordException(e, CustomKeysAndValues)` inside `try`/`catch (Throwable)`, and
      ignores any failure.
  - `selftest:handled` is accepted only when the channel is `stage`. A Stage-only fallback, `crashForTest`, is added **only if**
    T013b shows that `am crash` is not captured. It is guarded by `poker_build_channel == stage`.
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
  - It has a synchronous re-entrancy guard and handles bridge failures locally. `runtime.js` retains its existing `klog` calls.
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
  - A new check reads `firebase_crashlytics_collection_enabled` from `artifacts/manifest.txt`. Require the pinned off default and validate the reviewed activation configuration independently of the eligibility flag in `configure-android.mjs`.
  - `release-receipt.json` gains the provider, manifest default and approved build eligibility. Runtime permission is verified on device.
  - Source provenance already rests on the `config.js` SHA check. No new secrets are needed.
- **`.github/workflows/android-poc.yml`**: before publishing the APK, Android SDK `apkanalyzer manifest print`
  extracts the final manifest. `mobile/poker/verify-android-diagnostics.mjs` checks app ID, permissions and both explicit off values
  for the APK and the release AAB.
- **Legal (T015, WWW-affecting)**:
  - New files: `legal/privacy.<date>-a5.{en,pl}.html` and `specs/1306-android-crash-diagnostics/legal-candidate-a5/manifest.json`
    (`previousVersion` a4, `basedOn` hashes).
  - An a5 block in `tests/mobile-legal-packaging.test.mjs`, plus the alias update and the `legalPages` entry in `package-web.mjs`.
  - Content:
    - The processor is Firebase Crashlytics (Google: DPST, global processing, EU-US DPF), and processing happens in the **Android
      app only**.
    - It lists the data and retention by service, the purpose (stability and security), the D4 legal basis and
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
  - T013a records local changes and device/network evidence from cold start, a synthetic crash, restart and an in-place off-to-candidate upgrade. Use a consistent QA signer for the upgrade. Logcat and file listings supplement device-level network observation with an on-state positive control. Exclude app traffic unrelated to Firebase and record ambiguous traffic as unresolved.
  - STOP before PR1 merge on unauthorised or ambiguous egress, storage, queued uploads or version/choice transitions. Send T013a evidence to T013c. Any mitigation must be reviewed against the pinned SDK and rechecked on the same matrix before the gate passes.
  - T013b exercises the enabled Stage Draft with synthetic events and checks offline buffering and authorised upload.
- **Retention and rights**: document retention by service, identifier limitations and the verified mechanism to handle objections/deletion requests. Do not promise per-user deletion or a hard 90-day erasure deadline without evidence.
- **Runbook**: `mobile/poker/README.md` covers where to look, triage, coverage gaps, retention and the verified cutoff and upgrade procedure for disabling diagnostics.

## 5. Breaking impact
- **Android**:
  - About +1.5–2.5 MB on the AAB (measured in PR1 CI).
  - The new `ACCESS_NETWORK_STATE` permission.
  - The Google Services and Crashlytics Gradle plugins.
  - With collection on, network egress to the Crashlytics/Installations/logging hosts.
- **Builds**: every Android build fails until `google-services.json` is committed, which is intended. Gate C is required for the build and can follow Draft creation.
  `[skip netlify]` must **not** be used on PR1 or the Gate E PR, because the Stage APK build depends on the Deploy Preview.
- **Stage reinstalls**: a different ephemeral debug key forces an uninstall, which drops the local session and buffered reports.
- **WWW**: only the T015 legal revision changes WWW, and it goes through the OWNER WWW release.
- **No change** to:
  - Netlify functions, WS, Supabase or KLog
  - Google OAuth config (Crashlytics is independent of the #1300 signer setup)

## 6. Delivery and gates
- **Gate A (done)**: two independent Stage A architecture reviews (#1306).
- **Gate B (done)**: OWNER authorised execution using local r4 and C1–C7. The separate independent implementation PR review remains required. D4 is decided at T013c.
- **Gate C (OWNER, phone)**: create the Spark project and two Android apps without Analytics, apply the §4 settings, and supply
  `google-services.json` plus the project ID. This blocks the Android build, while Draft preparation can proceed.
- **Gate D, PR1 (agent Draft, Deploy Preview kept)**: T005–T012 with collection off. The PR1 Stage APK is the compile, manifest and
  T013a evidence. Only the OWNER merges after T013a/T013c and the author-dependent independent review per AGENTS.md, at most three rounds with zero P0/P1/P2 on the final SHA.
- **Gate E (OWNER GO for D5)**: an unmerged Draft with Stage eligibility for synthetic QA. Its positive control feeds T013a before PR1 merge. The OWNER runs T013b and the Draft closes unmerged.
- **Gate F (privacy, OWNER)**:
  - Implement and independently review T014 if D4 requires a choice control. Verify permission persistence, restart, withdrawal, and no unauthorised backlog release.
  - T015 (the a5 candidate, then OWNER WWW Candidate → Publish, plus the Data Safety draft).
  - After D4 approval and the applicable disclosure gates, a reviewed PR enables Production eligibility. With opt-in, a fresh install remains off pending consent. If objection or withdrawal cannot stop future unauthorised activity, STOP before Gate G.
- **Gate G (Play internal, separate OWNER GO)**: build and sign the release AAB with the existing workflow, the OWNER uploads it, then
  T016.
- Public Production stays blocked until the OWNER accepts #1306 and the remaining #1140 gates.

## Complexity Tracking
| Addition | Why needed | Simpler alternative rejected |
|---|---|---|
| `PokerDiagnosticsPlugin.java` | single native allowlist/cap and native auth-failure reporting | Capawesome plugin (D1-A): adds an npm dependency and exposes an unrestricted JS API |
| `diagnostics.js` | JS errors are not captured natively, and Offline does not load `runtime.js` | inline code in `runtime.js` |
| Stage-only self-test file | phone-only QA with no Production test trigger | ADB alone cannot raise JS errors without desktop DevTools |
