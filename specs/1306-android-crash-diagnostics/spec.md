# Feature Specification: Android crash and non-fatal diagnostics (#1306)

**Feature Branch**: `1306-android-crash-diagnostics`
**Created**: 2026-11-22 · **Revised**: 2026-11-22 r2 (Stage B findings applied) · **Base**: `main` @ `89374212`
**Status**: DRAFT for OWNER plan approval. There is no implementation GO yet.
**Input**: issue #1306 body, its research/decision comments and SpecKit drafts, two Stage A and two Stage B reviews (#1306).

Release gate: there is **no public/Production Google Play rollout** until the OWNER accepts this feature (#1140). Play internal
testing may continue separately. The OWNER has only a Samsung Galaxy S24+ with Termux, so every build runs on GitHub-hosted CI.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Native fatal crash and ANR visibility (Priority: P1)
As OWNER, I see a Java fatal crash or ANR from a real Android install in a remote dashboard. Each report shows the app id,
versionName/versionCode, channel and source SHA, and I get an e-mail when a new issue appears.
**Independent test**:
1. On the Stage QA APK, run `adb shell am crash pl.kcswh.arcadepoker.stage` (Termux wireless ADB), then relaunch the app.
2. The issue appears with `channel=stage` and `source_sha=<SHA>`, and a new-fatal e-mail arrives.

If `am crash` does not reach Crashlytics, use the Stage-only fallback in plan §2. ANR is accepted on documented SDK capability,
with no deliberate device stall.

### User Story 2 — Classified handled failures, native and WebView JS (Priority: P1)
As OWNER, I can tell where a failure happened instead of seeing only "sign-in failed". Each report names its source:
- the native Credential Manager exception class/type, or a missing Production client ID
- the Supabase ID-token exchange
- the auth callback or credential clear

I also see uncaught JS errors and unhandled promise rejections from the packaged pages, including Offline, grouped as one issue per
stable code and stage.
**Independent test**:
1. On the Stage QA APK, use the Stage-only self-test to emit one handled report through the native bridge, one uncaught error and
   one unhandled rejection, then relaunch.
2. Three distinct issues appear. None of them contains message text, a URL, a token or a user ID.

The native Credential Manager path only exists in the Production channel. It is verified by code review and by a natural
occurrence on the Play internal build, and is never forced.

### User Story 3 — Privacy-correct and lawful collection (Priority: P1)
As a player, I am told accurately what diagnostics are collected, by whom, how long they are kept and on what legal basis. I can
object or opt out where the law requires it.

No data leaves the device in any distributed build until two conditions hold:
- the OWNER has approved the legal basis, and
- the EN/PL Privacy Policy and Play Data Safety match the real SDK behaviour.

Reports that the SDK buffered while collection was off are deleted, never uploaded later.
**Independent test**:
- The release AAB manifest shows `firebase_crashlytics_collection_enabled=false` unless the reviewed per-channel constant is
  `true`.
- A collection-off QA build shows no Firebase network upload.
- The a5 policy candidate and the Data Safety draft list Crashlytics, Installations, Sessions, the identifiers and the 90-day
  retention.

### User Story 4 — Free, bounded and non-blocking (Priority: P1)
Diagnostics never delay or break startup, sign-in or gameplay, never flood reports, and never cost money.
**Independent test**:
- In airplane mode, play and sign-in behave as before.
- After network recovery and a relaunch, the reports arrive.
- The Firebase project shows the Spark plan with no billing account.

### Edge Cases
- These are not failures and are never reported:
  - user cancel and `no_credential`
  - the sign-out race (`google_canceled`)
  - `google_in_progress`
  - offline mode
  - a normal WS reconnect
- If the reporter itself fails or the plugin is missing, the error never propagates. At most one `klog` is written, and nothing
  is reported recursively.
- Cross-origin `Script error.` and errors from non-packaged scripts are ignored. Inline-script errors keep only the line number.
- The SDK keeps only the newest 8 non-fatals until the next launch. The native cap (7 per process, 1 per code:stage) stays below that.
- While collection is off, the plugin deletes unsent reports on every start.
- A Stage reinstall with a different ephemeral debug key needs an uninstall first, which also drops buffered reports.
- Known coverage gaps:
  - crashes before Firebase init
  - WebView renderer death (`onRenderProcessGone`)
  - NDK (none in the app)
  - WS reconnect exhaustion: the client retries indefinitely and has no terminal failure (D6)

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001** There is one remote reporter: **Firebase Crashlytics** on a new dedicated Spark project with **no** billing account.
  The project has no Analytics, BigQuery, Performance or other linked service. Play Android vitals remains the independent
  second lens.
- **FR-002** The Firebase SDK captures native Java fatal crashes and ANRs automatically.
- **FR-003** `PokerGoogleSignInPlugin.signIn` reports native handled failures:
  - In `onError`: only the exception class simple name and `GetCredentialException.getType()`, regex-validated. Never
    `getMessage()`, `canceled` or `no_credential`.
  - On a failed `onResult`: `unexpected_credential`.
  - When the Production channel lacks its client ID: `config_missing`.
- **FR-004** Packaged WebView JS reports only fixed constant codes and stages (plan §3) for three cases:
  - uncaught `error`
  - `unhandledrejection`
  - the selected handled boundaries in `mobile/poker/runtime.js`

  It never sends:
  - raw `Error.message`, stacks, URLs or query strings
  - user/session/account IDs, tokens, the nonce or headers
  - chat, cards, table state or response bodies

  The **native plugin is the single enforcing allowlist** and drops everything else.
- **FR-005** Each report carries the custom keys `channel` and `source_sha`, and the SDK adds versionName/versionCode. Each
  `code:stage` gets its own synthetic stack frame so it forms its own issue. `setUserId` and free-text `log` are never used.
- **FR-006** The native cap applies to native and JS reports together: 1 report per `code:stage` and 7 per process. Every call is
  fire-and-forget, swallows errors and is never awaited on startup, sign-in or gameplay paths.
- **FR-007** Collection is **off by default**. A build-time manifest flag is set from a reviewed per-channel constant. While it is
  off, `PokerDiagnosticsPlugin.load()` calls `deleteUnsentReports()` and `record()` returns immediately.

  The flag is switched on only through a separately reviewed change after an OWNER GO:
  - Stage QA: an unmerged Draft QA build.
  - Production: only after the legal basis and the disclosures are approved.

  If the approved legal model needs an opt-in/opt-out control, the Account page gets one switch (T014).
- **FR-008** Diagnostics code exists only in the Android package. These stay unchanged:
  - the ordinary WWW/Stage pages
  - `js/auth/supabaseClient.js` and `js/account-page.js`
  - `poker/*.js`
  - the `js/debug.js` KLog and the website consent tooling

  The only exception is the legal revision in FR-011. KLog buffers are never forwarded.
- **FR-009** The build fails closed if:
  - the Firebase config is missing, or does not match the channel appId or the pinned project
  - the Gradle plugins are not applied
  - an unreviewed manifest permission appears

  The only new permission is `android.permission.ACCESS_NETWORK_STATE`. It is declared by `firebase-crashlytics:21.1.0`,
  `firebase-installations:20.0.0` and `transport-*:5.0.0`, and is accepted only after OWNER approval (D2).
- **FR-010** There is no R8/mapping work while the Capacitor 8.5.3 template keeps `minifyEnabled false`.
- **FR-011** These are ready before any distributed build has collection on:
  - a new immutable Privacy candidate `legal/privacy.<date>-a5.{en,pl}.html`
  - its manifest `specs/1306-android-crash-diagnostics/legal-candidate-a5/manifest.json`
  - the aliases
  - a Play Data Safety draft

  This is a WWW-affecting change: the OWNER publishes it through the existing WWW Production Release (Candidate → Publish), and
  the APK gets it in a new AAB.
- **FR-012** This feature makes none of the following:
  - a Play upload
  - a Production backend/WS/Supabase change
  - a DB table, endpoint or VPS service

### Key Entities
- **Diagnostic report**: a non-fatal `PokerDiagnostic` whose message is `<code>:<stage>`. It has one synthetic frame
  `PokerDiagnostic.<code>(<stage>:1)` and the custom keys `code`, `stage`, `channel` and `source_sha`. Two keys are optional:
  `js_file` (packaged `.js` basename) and `js_line`. Native reports may add `exception` and `type`.
- **SDK-automatic data**: the Crashlytics installation UUID, the Firebase installation ID and a session ID; device model, OS,
  RAM/disk and a rooted flag; thread stacks; and, for native fatals, the exception class and message. Retention is 90 days
  (Firebase privacy page).

## Success Criteria *(mandatory)*
- **SC-001** The collection-off build (PR1 APK) shows no Firebase upload. The Stage QA APK then produces 1 fatal and 3 distinct
  JS-origin/bridge issues, each with the correct SHA/channel and sanitised keys.
- **SC-002** The OWNER receives at least one Crashlytics e-mail alert (new fatal or new non-fatal).
- **SC-003** Play and sign-in in airplane mode are unaffected. Reports arrive after recovery and relaunch.
- **SC-004** The release AAB passes the manifest checks with exactly the approved permission set and collection off by default.
- **SC-005** Before any public release GO, the OWNER accepts the dashboard, a sample report, the a5 policy and the Data Safety
  draft.

## Assumptions
- Crashlytics stays "No-cost" on Spark (firebase.google.com/pricing, checked 2026-11-22). A project becomes Blaze only if billing or
  paid Cloud services are linked, which is why the project is dedicated.
- `google-services.json` is public configuration. Its API key is restricted by API, not by app signature, because Stage debug
  signing is ephemeral.
- The legal basis is an OWNER/legal decision. It covers GDPR Art. 6(1)(f) and, separately, ePrivacy Art. 5(3) as implemented in
  Poland by Prawo komunikacji elektronicznej art. 399. This spec supplies the facts and does not claim legal clearance.
