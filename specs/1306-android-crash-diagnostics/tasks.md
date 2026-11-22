# Tasks: Android crash and non-fatal diagnostics (#1306)

**Input**: [spec.md](spec.md), [plan.md](plan.md). Everything is unchecked; nothing below is authorised before OWNER plan approval and decisions D1–D5.
**Tests**: fundamental only (constitution V). The plan extends `tests/mobile-poker-channel.test.mjs` and `tests/mobile-poker-security.test.mjs`. It adds no UI, CSS, layout or glue tests.
Format: `[ID] [P?] [Story] Description`.

## Phase 0: Review and decisions (no code)
- [x] T001 Stage A: two independent architecture reviews, by Claude Code (coordinator) and a separate Claude Code CLI run, posted in #1306.
- [ ] T002 Stage B: two independent reviews of spec/plan/tasks (P0–P3) posted in #1306. Supported fixes go into these files, re-checked within the same review budget.
- [ ] T003 OWNER: approve the plan and record D1 (variant), D2 (`ACCESS_NETWORK_STATE`), D4 (collection model) and D5 (Stage QA enablement) in #1306.

## Phase 1: Setup (OWNER, phone; Gate C)
- [ ] T004 OWNER creates the dedicated Firebase project (Spark, no billing, no Analytics) with the Android apps `pl.kcswh.arcadepoker` and `pl.kcswh.arcadepoker.stage`, and applies plan §4: data sharing off, API-key restriction, new-fatal/non-fatal/ANR e-mail alerts, sole member. OWNER then pastes `google-services.json` into #1306. Agents never create cloud resources.

## Phase 2: Foundational (PR1, agent Draft `[skip netlify]`, collection off)
- [ ] T005 [US1] `mobile/poker/google-services.json` (from T004) and `mobile/poker/configure-android.mjs`:
  - `FIREBASE_CRASHLYTICS_DEPENDENCIES`, `CRASHLYTICS_GRADLE_CLASSPATH` and the app-module `apply plugin` lines
  - the unconditional google-services apply
  - `assertFirebaseConfig`, the copy to `android/app/`
  - `DIAGNOSTICS_COLLECTION` and `configureDiagnosticsManifest`
  - `buildResources` (`poker_build_channel`, `poker_source_sha`)
  - the `PokerDiagnosticsPlugin` copy and `registerPlugin`

  Each template anchor fails closed when it is missing.
- [ ] T006 [P] [US1/US2] New `mobile/poker/PokerDiagnosticsPlugin.java`: `load` custom keys, `report` with the native allowlist (plan §3), and static `record` with swallow-all. It has no crash, user-ID or free-text methods; `setEnabled` exists only if D4 requires it.
- [ ] T007 [US2] `mobile/poker/PokerGoogleSignInPlugin.java`: in `onError`/`onResult`, call `PokerDiagnosticsPlugin.record` with the exception simple name and `getType()` only. Never for cancel or no-credential. Reject codes stay unchanged.
- [ ] T008 [P] [US2] New `mobile/poker/diagnostics.js` IIFE: `window.MobilePokerDiagnostics.report`, the allowlist, the caps (1 per code:stage, 6 per launch via `sessionStorage`), and `error`/`unhandledrejection` listeners for packaged `https://localhost` scripts only (`js_file` basename, `js_line`). It also has a re-entrancy guard and a local `klog`.
- [ ] T009 [US2] `mobile/poker/runtime.js`: the `stage` variable in `signInWithGoogle`, and reports at the existing `klog` sites listed in plan §2. User cancellation, unavailability and in-progress paths are never reported.
- [ ] T010 [US2] `mobile/poker/package-web.mjs`:
  - inject `/mobile/diagnostics.js` before `/mobile/runtime.js`
  - add the SRI script and `script-src` hash to `poker/offline/play.html`
  - package `diagnostics-selftest.js` (new, Stage-only, `account.html` button) and assert it is absent in Production
- [ ] T011 [US3] `.github/workflows/android-release-aab.yml` and `.github/workflows/android-poc.yml`:
  - add `ACCESS_NETWORK_STATE` to the permission allowlist (after D2)
  - check that the collection flag equals `DIAGNOSTICS_COLLECTION.<channel>`
  - check that `poker_source_sha` equals `SOURCE_SHA`
  - add the receipt field `diagnostics`
- [ ] T012 [US2/US3] Fundamental tests:
  - `tests/mobile-poker-channel.test.mjs`:
    - `assertFirebaseConfig`: missing file, wrong package, mismatched project
    - `configureDiagnosticsManifest`: off by default, and fails on a duplicate
    - Gradle injection anchors
    - the SHA resource regex
  - `tests/mobile-poker-security.test.mjs`:
    - load `diagnostics.js` in a VM sandbox like the existing security tests
    - check unknown or free-text code/stage rejection and caps
    - check that no message, stack or URL is forwarded and cross-origin events are ignored
    - check that the JS allowlist equals the Java allowlist, parsed from the source
  - CI compiles the Java in the existing Android build; there are no Java unit tests.

## Phase 3: Controlled acceptance
- [ ] T013 [US1/US2/US4] Gate E, after a one-line PR that sets `DIAGNOSTICS_COLLECTION.stage = true` (D5 GO). The OWNER installs the Stage APK artifact, then:
  1. Runs `adb shell am crash pl.kcswh.arcadepoker.stage` over Termux wireless ADB and relaunches.
  2. Presses the self-test button and relaunches.
  3. Tries a Google sign-in on Stage, which uses browser OAuth; the native stage is checked in T016.
  4. Repeats steps 1–2 in airplane mode, then recovers and relaunches.
  5. Checks the console issues, keys, absence of PII and the e-mail alert.
  6. Records the logcat/`run-as` findings (plan §4) as D4 input.
- [ ] T014 [US3] Conditional on D4: an Account switch for opt-in/out (existing dialog/style patterns, no `window.confirm`) plus `PokerDiagnosticsPlugin.setEnabled`, with `deleteUnsentReports` on opt-out. Tests are limited to the persisted-choice logic, if it is non-trivial.
- [ ] T015 [US3] Write a new immutable `legal/privacy.<date>-a5.{en,pl}.html`, update the aliases and the `package-web.mjs` `legalPages` list, and post the Play Data Safety draft in #1306. The OWNER publishes both; after D4 approval, a reviewed PR sets `DIAGNOSTICS_COLLECTION.production = true`.
- [ ] T016 [US1/US2] Gate G: under a separate OWNER GO, build and sign the release AAB through the existing workflow, and the OWNER uploads it to the Play internal track. Verify the Play-installed version, SHA, collection state and one real native `google_credential` report, if one occurs naturally (never forced on Production). Check Android vitals separately; a low sample is not proof that monitoring is absent. Add the `mobile/poker/README.md` runbook section (plan §4). The OWNER accepts #1306.

## Dependencies
T002 → T003 → T004 → T005–T012 (T006/T008 in parallel) → PR1 review/merge (OWNER) → T013 → T014? → T015 → T016. Public Production follows the remaining #1140 gates.
