# Feature Specification: Android crash and non-fatal diagnostics (#1306)

**Feature Branch**: `1306-android-crash-diagnostics`
**Created**: 2026-11-22 · **Base**: `main` @ `89374212` · **Status**: DRAFT, awaiting OWNER plan approval (no implementation GO)
**Input**: issue #1306 body, its research/decision comments and SpecKit drafts (2026-11-21/22), and two independent Stage A reviews.

Release gate: **no public/Production Google Play rollout** until this feature is OWNER-accepted (#1140). Play internal
testing may continue separately. The OWNER has only a Samsung Galaxy S24+ with Termux; every build runs on GitHub-hosted CI.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Native fatal crash and ANR visibility (Priority: P1)
As OWNER, I see a Java fatal crash or ANR from a real Android install in a remote dashboard, with app id,
versionName/versionCode, channel and source SHA. I get an e-mail when a new issue appears.
**Independent test**:
1. On the Stage QA APK, run `adb shell am crash pl.kcswh.arcadepoker.stage` (Termux wireless ADB). No crash code is added to the app.
2. Relaunch the app.
3. The issue appears in the Crashlytics console with `channel=stage` and `source_sha=<SHA>`, and a new-fatal e-mail arrives.

ANR is accepted on the SDK's documented capability; nobody deliberately stalls a device.

### User Story 2 — Classified handled failures, native and WebView JS (Priority: P1)
As OWNER, I can tell where a failure happened, instead of seeing a generic "sign-in failed". The possible places are:
- the native Credential Manager exception class/type
- the Supabase ID-token exchange
- the native bridge being unavailable
- the auth callback

I also see uncaught JS errors and unhandled promise rejections from the packaged WebView pages, including Offline, grouped by stable code.
**Independent test**:
1. On the Stage QA APK, a Stage-only self-test emits one handled report, one uncaught error and one unhandled rejection.
2. After relaunch, three issues with fixed codes appear. None contains message text, a URL, a token or a user ID.

### User Story 3 — Privacy-correct and lawful collection (Priority: P1)
As a player, I am told accurately:
- what diagnostics are collected
- by whom, and for how long
- on what legal basis

I can object or opt out where the law requires it. No data leaves the device in any distributed build until both of these are true:
- the OWNER has approved the legal basis
- the EN/PL Privacy Policy and Play Data Safety match the real SDK behaviour

**Independent test**:
- The release AAB manifest shows `firebase_crashlytics_collection_enabled=false` unless the reviewed per-channel constant is `true`.
- The policy revision and the Data Safety draft list Crashlytics, Installations, Sessions, their identifiers and the 90-day retention.

### User Story 4 — Free, bounded and non-blocking (Priority: P1)
Diagnostics never delay or break startup, sign-in or gameplay, never flood reports, and never cost money.
**Independent test**:
- In airplane mode, play and sign-in behave exactly as before.
- Reports arrive after the network recovers and the app is relaunched.
- The Firebase project shows the Spark plan with no billing account.

### Edge Cases
- These are not failures and are never reported: the user cancelling the Google picker, `no_credential`, the sign-out race
  (`google_canceled`), `google_in_progress`, offline mode, and a normal WS reconnect.
- If the reporter itself fails, or the native plugin is missing, the error never propagates into the app. It is dropped,
  with at most one `klog`, and the reporter never reports itself.
- Cross-origin `Script error.` events and errors from non-packaged scripts are ignored.
- The SDK keeps only the 8 newest non-fatals until the next launch. The JS cap (6 per launch) stays below that.
- While collection is disabled, the SDK may buffer reports locally. Any opt-out therefore also deletes unsent reports.
- Known coverage gaps:
  - crashes before Firebase initialises
  - the WebView renderer process dying (`onRenderProcessGone`)
  - native NDK code (the app has none)
  - Play Console-only data

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001** There is one remote reporter: **Firebase Crashlytics**, on a new dedicated Spark project with **no** billing account.
  The project has no Analytics, BigQuery, Performance or other linked paid service. Play Android vitals remains a second, independent view.
- **FR-002** The Firebase SDK captures native Java fatal crashes and ANRs automatically.
- **FR-003** `PokerGoogleSignInPlugin.signIn` reports native handled failures with only the exception **class simple name
  and `GetCredentialException.getType()`**, both validated by regex. It never sends `getMessage()`, and never reports
  `canceled` or `no_credential`.
- **FR-004** Packaged WebView JS reports only **allowlisted codes and stages**, listed in plan §3. It reports from three places:
  - uncaught `error`
  - `unhandledrejection`
  - selected handled boundaries in `mobile/poker/runtime.js`

  It never sends raw `Error.message`, stacks, URLs or query strings. It never sends user, session or account IDs, tokens, the nonce, headers, chat, cards, table state or response bodies.
  The native plugin rejects any value outside the allowlist, so it is enforced twice.
- **FR-005** Each report carries the custom keys `channel` and `source_sha`; the SDK adds versionName and versionCode itself.
  No per-user identifier is set: `setUserId` and free-text `log` are never used.
- **FR-006** Each launch is capped at one report per code+stage and six JS-origin reports in total. Every call is fire-and-forget
  and swallows its own errors. Nothing awaits the SDK on startup, sign-in or gameplay paths.
- **FR-007** Collection is **off by default**, set at build time through the manifest flag, which comes from a reviewed per-channel constant.
  The flag is turned on only by a separate reviewed change after the OWNER has given a GO:
  - Stage QA: OWNER GO for the controlled test.
  - Production: OWNER approval of the legal basis and of the disclosures.

  If the approved legal model requires an opt-in or opt-out control, the Account page gets one switch. The switch persists
  the choice, calls the native enable/disable, and deletes unsent reports on opt-out.
- **FR-008** Diagnostics code ships only in the Android package. These stay unchanged:
  - ordinary WWW/Stage web pages
  - `js/auth/supabaseClient.js`, `js/account-page.js`
  - `js/debug.js` KLog
  - the website consent tooling

  `klog` stays the local logger, and KLog buffers are never forwarded.
- **FR-009** The build fails closed when any of these is true:
  - the Firebase config is missing
  - its Android client does not match the channel appId
  - the Crashlytics Gradle plugin is not applied
  - an unreviewed manifest permission appears

  The only new permission is `android.permission.ACCESS_NETWORK_STATE`, which Firebase Installations and datatransport declare. It is accepted only after explicit OWNER approval.
- **FR-010** No R8/mapping work while the Capacitor 8.5.3 template keeps `minifyEnabled false`.
- **FR-011** A new immutable Privacy revision `legal/privacy.<date>-a5.{en,pl}.html`, the updated aliases and a Play Data
  Safety change draft must exist before any distributed build has collection enabled. Publishing them is a separate OWNER step.
- **FR-012** This feature makes none of the following:
  - a Play upload
  - a Production backend, WS, Supabase or Netlify change
  - a DB table, endpoint or VPS service

### Key Entities
- **Diagnostic report**: a non-fatal with the synthetic exception class `PokerDiagnostic` and the message `<code>:<stage>`. Its custom keys are
  `code`, `stage`, `channel` and `source_sha`, plus optional `js_file` (packaged basename) and `js_line`.
- **SDK-automatic data**:
  - Crashlytics installation UUID, Firebase installation ID, session ID
  - device model, OS, RAM and disk, rooted flag, thread stacks
  - for native fatals, the exception class and message

  Retention is 90 days (Firebase privacy page).

## Success Criteria *(mandatory)*
- **SC-001** The Stage QA APK produces 1 fatal, 1 native handled report and 3 JS reports. All are visible in the console with the right SHA and channel and sanitised keys.
- **SC-002** The OWNER receives at least one Crashlytics e-mail alert (new fatal or new non-fatal).
- **SC-003** Play and sign-in in airplane mode are unaffected, and reports arrive after recovery and relaunch.
- **SC-004** The release AAB passes the existing manifest checks with exactly the approved permission set and collection off by default.
- **SC-005** The OWNER accepts the dashboard, a sample report, the Privacy revision and the Data Safety draft before any public release GO.

## Assumptions
- Crashlytics stays "No-cost" on Spark (firebase.google.com/pricing, checked 2026-11-22). A project becomes Blaze only if billing
  or paid Cloud services are linked, which is why the project is dedicated.
- `google-services.json` is public configuration, not a secret. Its API key is restricted to the Android packages and Firebase APIs.
- The legal basis is an OWNER/legal decision: GDPR Art. 6(1)(f), and separately ePrivacy Art. 5(3) as implemented in Poland
  (Prawo komunikacji elektronicznej, art. 399). This spec supplies the facts and does not claim legal clearance.
