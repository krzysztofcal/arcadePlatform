# Tasks: Android crash and non-fatal diagnostics (#1306)

**Input**: [spec.md](spec.md), [plan.md](plan.md) (r2). Nothing below is authorised before the OWNER approves the plan and D1–D7.
**Tests**: fundamental only (constitution V). They test fail-closed config and privacy sanitising, extending
`tests/mobile-poker-channel.test.mjs`, `tests/mobile-poker-security.test.mjs` and `tests/mobile-legal-packaging.test.mjs`.
There are no UI, CSS, layout or glue tests. Validation command: see the plan header.
Format: `[ID] [P?] [Story] Description`.

## Phase 0: Review and decisions (no code)
- [x] T001 Stage A: two independent architecture reviews, posted in #1306 (Claude Code coordinator and a separate Claude Code CLI run).
- [x] T002 Stage B: two plan reviews (P0–P3) and a round-2 verification posted in #1306. r2 and r3 apply the supported fixes, and the dispositions are posted in #1306. Two Claude runs were used, as the OWNER instructed; see D7.
- [ ] T003 OWNER: approve the plan and record D1 (variant), D2 (`ACCESS_NETWORK_STATE`), D4 (collection model, can be finalised after T013a), D5 (Stage QA Draft), D6 (WS descope) and D7 (reviewer pair; optional Codex Stage B review) in #1306.

## Phase 1: Setup (OWNER, phone; Gate C)
- [ ] T004 OWNER creates the dedicated Firebase project and posts the public `google-services.json` in #1306. Agents never create cloud resources.
  - Spark plan, no billing, no Analytics.
  - Two Android apps: `pl.kcswh.arcadepoker` and `pl.kcswh.arcadepoker.stage`.
  - Plan §4 settings: data sharing off, API-only key restriction, new fatal/non-fatal/ANR e-mail alerts, OWNER as the sole member.

## Phase 2: Foundational (PR1: agent Draft with a Netlify Deploy Preview, collection off)
- [ ] T005 [US1] `mobile/poker/google-services.json` (from T004) and `mobile/poker/configure-android.mjs`. Every template anchor and file check fails closed.
  - `FIREBASE_CRASHLYTICS_DEPENDENCIES`, `CRASHLYTICS_GRADLE_CLASSPATH`.
  - An unconditional google-services + Crashlytics `apply plugin`.
  - `FIREBASE_PROJECT_ID`, `assertFirebaseConfig`, a file-presence check and the copy to `android/app/`.
  - `DIAGNOSTICS_COLLECTION`, `configureDiagnosticsManifest`.
  - `buildResources`, with the SHA read from `www/build-receipt.json`.
  - The `PokerDiagnosticsPlugin` copy and `registerPlugin`.
- [ ] T006 [P] [US1/US2/US3] New `mobile/poker/PokerDiagnosticsPlugin.java`. It has no crash, user-ID or free-text methods.
  - `load()` calls `deleteUnsentReports()` while disabled, and once on the first run of an enabled build. Otherwise it sets the custom keys.
  - `report` validates against the single `ALLOWED` map (plan §3).
  - `record` applies the disabled check and the caps (1 per code:stage, 7 per process), builds the synthetic frame, and swallows all errors.
- [ ] T007 [US2] `mobile/poker/PokerGoogleSignInPlugin.java`: record `google_credential` with `credential_manager`, `unexpected_credential` or `config_missing`.
  - Keys are the simple exception name and `getType()` only, regex 128.
  - Never record cancel or no-credential. Record `config_missing` only when the channel resource is `production`.
  - Reject codes stay unchanged.
- [ ] T008 [P] [US2] New `mobile/poker/diagnostics.js` IIFE, with no allowlist or cap (both are native):
  - `MobilePokerDiagnostics.report`.
  - `error` and `unhandledrejection` listeners for `https://localhost` scripts only. `js_file` is the `.js` basename only; `js_line` is the line.
  - Stage `window` or `offline`, a re-entrancy guard, and a local `klog`.
- [ ] T009 [US2] `mobile/poker/runtime.js`:
  - In `signInWithGoogle`, a `stage` variable reports `google_failed:<stage>` only on the `google_failed` result.
  - Report `auth_callback_failed:callback_exchange` in `callback`.
  - Report `google_clear_failed:sign_out` in `queueClear`.
  - Nothing else is reported.
- [ ] T010 [US2] `mobile/poker/package-web.mjs`:
  - Inject `diagnostics.js` into the head block, non-deferred, before `/mobile/config.js`.
  - For Offline, insert it with SRI before `avatar-catalog.generated.js` and prepend its hash to `script-src`.
  - In the Stage-only packaging, add the new `mobile/diagnostics-selftest.js` on `account.html`.
  - Production packaging throws if the self-test file is present.
- [ ] T011 [US3] Workflow checks (both are D2-gated):
  - `.github/workflows/android-release-aab.yml`: add `ACCESS_NETWORK_STATE` to the allowlist, check that the collection flag equals `DIAGNOSTICS_COLLECTION.production`, and add the `release-receipt.json` `diagnostics` field.
  - `.github/workflows/android-poc.yml`: a new `aapt2 dump xmltree` step running the same permission allowlist and `DIAGNOSTICS_COLLECTION.stage` flag check.
- [ ] T012 [US2/US3] Fundamental tests:
  - `tests/mobile-poker-channel.test.mjs`. Only fail-closed cases; no anchor-by-anchor glue tests.
    - `assertFirebaseConfig` rejects a wrong project, a missing package and a duplicate client.
    - `configureDiagnosticsManifest` defaults to off and throws on a duplicate.
    - The `buildResources` SHA regex.
    - `poker_diagnostics_enabled` equals `DIAGNOSTICS_COLLECTION[channel]`.
  - `tests/mobile-poker-security.test.mjs`: `diagnostics.js` loaded via the existing `vm.runInNewContext` pattern.
    - It forwards only constant code/stage plus `js_file`/`js_line`.
    - It never forwards a message, stack or URL.
    - It ignores cross-origin events, drops `js_file` (keeping `js_line`) for non-`.js` filenames, and does not recurse.
  - Java is compiled by the PR1 Draft APK build (the Deploy Preview must stay). There are no Java unit tests.

## Phase 3: Controlled acceptance
- [ ] T013a [US3/US4] On the PR1 APK (collection off), the OWNER uses Termux wireless ADB to confirm:
  - logcat and `run-as` show no Firebase upload, no Installations call and no buffered reports retained;
  - whether a UUID or FID is written (this is D4 input);
  - startup, sign-in and Offline are unaffected.

  Post the results in #1306. **STOP** before the PR1 merge if any Firebase network call or retained report appears (plan §4).
- [ ] T013c [US3] Agent drafts a concise LIA and an ePrivacy note in #1306, using the T013a facts. This is not legal clearance.
  - LIA: purpose, necessity versus alternatives, minimisation, balancing, objection handling.
  - ePrivacy: Art. 5(3) and PKE art. 399, covering the device storage and identifier access, and the strict-necessity exemption or consent.
  - It states the OWNER preference (notice only, no checkbox). If either assessment fails, STOP: the OWNER chooses opt-in (T014) or another architecture, and D4 is finalised here.
- [ ] T013b [US1/US2/US4] Gate E: an unmerged Draft PR sets `DIAGNOSTICS_COLLECTION.stage = true` (D5 GO). The OWNER installs its APK and:
  1. runs `adb shell am crash pl.kcswh.arcadepoker.stage` and relaunches (if nothing arrives, add the plan §2 Stage-only `crashForTest` fallback in that Draft);
  2. presses the self-test button and relaunches;
  3. repeats in airplane mode, then recovers and relaunches;
  4. checks three distinct non-fatal issues plus one fatal, the `channel`/`source_sha` keys, no PII, the Installations success and the e-mail alert.

  The Draft is then closed without merging.
- [ ] T014 [US3] Conditional on D4: an Account opt-in/out switch using existing dialog and style patterns (no `window.confirm`), backed by `PokerDiagnosticsPlugin.setEnabled`, which calls `deleteUnsentReports` on opt-out. QA confirms the setting takes effect on the **next app start**, as the SDK documents. A test is added only if the persisted-choice logic is non-trivial.
- [ ] T015 [US3] The a5 Privacy candidate, a WWW-affecting PR with a Deploy Preview:
  - `legal/privacy.<date>-a5.{en,pl}.html` and `specs/1306-android-crash-diagnostics/legal-candidate-a5/manifest.json`;
  - the a5 block in `tests/mobile-legal-packaging.test.mjs`, the aliases and the `package-web.mjs` `legalPages` entry;
  - the Play Data Safety draft in #1306.

  The OWNER publishes through the WWW Production Release (Candidate → Publish) and Play Console. After D4 approval, a reviewed PR sets `DIAGNOSTICS_COLLECTION.production = true`.
- [ ] T016 [US1/US2] Gate G: a separate OWNER GO is required.
  1. The existing workflow builds and signs the AAB; the OWNER uploads it to the internal track.
  2. Verify the Play-installed version, SHA and collection state, and a native `google_credential` report if one occurs naturally (never forced on Production).
  3. Check Android vitals separately; a low sample does not prove anything is missing.
  4. Add the `mobile/poker/README.md` runbook section.
  5. The OWNER accepts #1306.

## Dependencies
T003 → T004 → T005–T012 (T006 and T008 in parallel) → T013a → T013c (D4) → PR1 Codex review → OWNER merge → T013b → T014 (if required) → T015 → T016.
Public Production follows the remaining #1140 gates.
