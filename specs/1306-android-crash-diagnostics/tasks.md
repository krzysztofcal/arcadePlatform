# Tasks: Android crash and non-fatal diagnostics (#1306)

**Input**: [spec.md](spec.md), [plan.md](plan.md) (r4 execution baseline). OWNER authorised PR1 collection-off implementation. Stage device testing and activation remain gated.
**Tests**: fundamental only (constitution V). They test fail-closed config and privacy sanitising, extending
`tests/mobile-poker-channel.test.mjs`, `tests/mobile-poker-security.test.mjs` and `tests/mobile-legal-packaging.test.mjs`.
There are no UI, CSS, layout or glue tests. Validation command: see the plan header.
Format: `[ID] [P?] [Story] Description`.

## Phase 0: Review and decisions (no code)
- [x] T001 Stage A: two independent architecture reviews, posted in #1306 (Claude Code coordinator and a separate Claude Code CLI run).
- [x] T002 Stage B: two plan reviews (P0–P3) and a round-2 verification posted in #1306. The earlier Claude rounds and Codex C1–C7 review are recorded in #1306. Local r4 incorporates the C1–C7 dispositions and the OWNER closed plan-only review.
- [x] T003 OWNER: authorise r4 implementation using C1–C7 and end plan-only review rounds. D1–D3 and D5–D7 are recorded in plan §1. D4 is finalised after T013a and T013c.

## Phase 1: Setup (OWNER, phone; Gate C)
- [ ] T004 OWNER creates the dedicated Firebase project and posts the public `google-services.json` in #1306. Agents never create cloud resources.
  - Spark plan, no billing, no Analytics.
  - Two Android apps: `pl.kcswh.arcadepoker` and `pl.kcswh.arcadepoker.stage`.
  - Plan §4 settings: data sharing off, API-only key restriction, new fatal/non-fatal/ANR e-mail alerts, OWNER as the sole member.

## Phase 2: Foundational (PR1: agent Draft with a Netlify Deploy Preview, collection off)
- [ ] T005 [US1] Code implemented. Blocked on T004 and hosted compile. Required input: `mobile/poker/google-services.json` (from T004) and `mobile/poker/configure-android.mjs`. Every template anchor and file check fails closed.
  - `FIREBASE_CRASHLYTICS_DEPENDENCIES`, `CRASHLYTICS_GRADLE_CLASSPATH`.
  - An unconditional google-services + Crashlytics `apply plugin`.
  - `FIREBASE_PROJECT_ID`, `assertFirebaseConfig`, a file-presence check and the copy to `android/app/`.
  - `DIAGNOSTICS_COLLECTION`, `configureDiagnosticsManifest`.
  - `buildResources`, with the SHA read from `www/build-receipt.json`.
  - The `PokerDiagnosticsPlugin` copy and `registerPlugin`.
- [ ] T006 [P] [US1/US2/US3] New `mobile/poker/PokerDiagnosticsPlugin.java`. It has no crash, user-ID or free-text methods.
  - PR1 implements the disabled bridge, allowlist and caps. Apply plan §2 startup and backlog gates at the native boundary. `load()` sets keys only on the authorised path. Demonstrate that legacy queued Crashlytics and transport reports cannot upload. If the supported API or migration cannot establish that property, stop with diagnostics off.
  - `report` validates against the single `ALLOWED` map (plan §3).
  - `record` applies the disabled check and the caps (1 per code:stage, 7 per process), builds the synthetic frame, and swallows all errors.
- [x] T007 [US2] `mobile/poker/PokerGoogleSignInPlugin.java`: record `google_credential` with `credential_manager`, `unexpected_credential` or `config_missing`.
  - Keys are the simple exception name and `getType()` only, regex 128.
  - Never record cancel or no-credential. Record `config_missing` only when the channel resource is `production`.
  - Reject codes stay unchanged.
- [x] T008 [P] [US2] New `mobile/poker/diagnostics.js` IIFE, with no allowlist or cap (both are native):
  - `MobilePokerDiagnostics.report`.
  - `error` and `unhandledrejection` listeners for `https://localhost` scripts only. `js_file` is the `.js` basename only; `js_line` is the line.
  - Stage `window` or `offline`, a re-entrancy guard, and handled bridge failures.
- [x] T009 [US2] `mobile/poker/runtime.js`:
  - In `signInWithGoogle`, a `stage` variable reports `google_failed:<stage>` only on the `google_failed` result.
  - Report `auth_callback_failed:callback_exchange` in `callback`.
  - Report `google_clear_failed:sign_out` in `queueClear`.
  - Nothing else is reported.
- [x] T010 [US2] `mobile/poker/package-web.mjs`:
  - Inject `diagnostics.js` into the head block, non-deferred, before `/mobile/config.js`.
  - For Offline, insert it with SRI before `avatar-catalog.generated.js` and prepend its hash to `script-src`.
  - In the Stage-only packaging, add the new `mobile/diagnostics-selftest.js` on `account.html`.
  - Production packaging throws if the self-test file is present.
- [x] T011 [US3] Workflow checks (both are D2-gated):
  - `.github/workflows/android-release-aab.yml`: add `ACCESS_NETWORK_STATE` to the allowlist, check the manifest off default and approved eligibility independently, and record the provider, manifest default and eligibility in `release-receipt.json`.
  - `.github/workflows/android-poc.yml`: `apkanalyzer manifest print` and the shared `verify-android-diagnostics.mjs` running the same permission allowlist and checks for the manifest off default and expected Stage eligibility.
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
  - Java compilation remains pending. Java is compiled by the PR1 Draft APK build (the Deploy Preview must stay). There are no Java unit tests.

## Phase 3: Controlled acceptance
- [ ] T013a [US3/US4] On the authorised PR1 test APK, use synthetic data on the OWNER’s test device. Follow plan §4 and record evidence in #1306.
  - Check merged startup providers, cold start before UI, UUID/FID/session markers, report and transport storage, synthetic crash and relaunch, and network traffic with logcat plus independent observation. Use the separately authorised D5 test as the on-state positive control before accepting a negative network result.
  - Use the same signer and install data for an off-to-candidate upgrade. Check before and after the gate opens, including after interrupted startup and network recovery. A reinstall is not upgrade evidence.
  - Check startup, sign-in and Offline. Unauthorised or ambiguous storage/egress, or missing evidence of backlog isolation, blocks PR1 merge and any Play activation.
- [ ] T013c [US3] Agent drafts a LIA and a separate ePrivacy/PKE assessment in #1306 using T013a and pinned SDK evidence. Inventory accesses, storage, egress, purpose, necessity, alternatives, minimisation, balancing and objection handling for Crashlytics, Installations, Sessions and the transport queue. The OWNER decides D4 with the completed evidence. If notice-only cannot be supported, choose reviewed opt-in or return to architecture review. Until then, Gate F remains blocked.
- [ ] T013b [US1/US2/US4] Gate E: after separate D5 GO, an unmerged Draft enables diagnostics for synthetic OWNER-only Stage QA. Its positive control can run before PR1 merge to complete T013a. The OWNER installs its APK and:
  1. runs `adb shell am crash pl.kcswh.arcadepoker.stage` and relaunches (if nothing arrives, add the plan §2 Stage-only `crashForTest` fallback in that Draft);
  2. presses the self-test button and relaunches;
  3. repeats in airplane mode, then recovers and relaunches;
  4. checks three distinct non-fatal issues plus one fatal, the `channel`/`source_sha` keys, no PII, the Installations success and the e-mail alert.

  The Draft is then closed without merging.
- [ ] T014 [US3] When D4 requires a control, expose the approved choice in Account using existing UI patterns. Persist an explicit valid choice before permitting covered SDK activity. On refusal or withdrawal, block new app-side events, persist off and enforce the approved cutoff at the actual SDK/transport boundary. Firebase's disable call can take effect on next launch. Record any in-flight limits and verify that pending work cannot resume unauthorised. Stop activation if the approved cutoff cannot be met. QA covers fresh install, explicit allow, deny, withdrawal, offline queued work, restart, upgrade and re-enable.
- [ ] T015 [US3] The a5 Privacy candidate, a WWW-affecting PR with a Deploy Preview:
  - `legal/privacy.<date>-a5.{en,pl}.html` and `specs/1306-android-crash-diagnostics/legal-candidate-a5/manifest.json`;
  - the a5 block in `tests/mobile-legal-packaging.test.mjs`, the aliases and the `package-web.mjs` `legalPages` entry;
  - the Play Data Safety draft in #1306.

  The OWNER publishes through the WWW Production Release (Candidate → Publish) and Play Console. After D4 approval and disclosure readiness, a reviewed PR may enable Production eligibility. Under opt-in the SDK stays off before valid consent.
- [ ] T016 [US1/US2] Gate G: a separate OWNER GO is required.
  1. The existing workflow builds and signs the AAB; the OWNER uploads it to the internal track.
  2. Verify the Play-installed version, SHA and collection state, and a native `google_credential` report if one occurs naturally (never forced on Production).
  3. Check Android vitals separately; a low sample does not prove anything is missing.
  4. Add the `mobile/poker/README.md` runbook section.
  5. The OWNER accepts #1306.

## Dependencies
T003 → T005–T012 (T004 blocks the Android build) (T006 and T008 in parallel) → T013a (including the separately authorised T013b positive control) → T013c (D4) → PR1 independent review → OWNER merge → T014 (if required) → T015 and Gate F activation approval → T016.
Public Production follows the remaining #1140 gates.
