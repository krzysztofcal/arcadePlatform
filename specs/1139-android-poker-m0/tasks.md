# Tasks — #1139

- [x] T001 Reuse existing issue audit, read instructions, issues/comments, constitution and verify live main SHA/resources.
- [x] T002 Record approved design/constraints and concrete plan; no alternative prototype.
- [x] T003 Add explicit API resolver and conditional shared auth/navigation hooks; fundamental security tests.
- [x] T004 Add mobile/poker package/lock/config, generated shared-page packager, App/Browser runtime, CSP, CSS and generated-directory ignore.
- [x] T005 Add hosted-only android-poc.yml resource/SHA checks, pinned toolchain, debug build and short-lived artifact receipt.
- [x] T006 Run sequential lightweight security/auth/WS/CSP/syntax checks, package inspection and self-review; check VPS disk.
- [x] T007 Push feature branch, create Draft PR, obtain exact-SHA hosted APK or record evidenced blocker. No merge/deployment.
- [ ] T008 Phone installation and authorized Stage smoke; report NOT TESTED and pending Stage CORS/OAuth GO. No funded smoke without GO.

## Runtime gates

T008 remains pending: no physical phone attached; mobile-origin Stage preflight is HTTP 403. Separate Stage CORS/OAuth GO and funded gameplay GO required. No environment change was applied. Netlify Preview build currently fails (exit 2); root-cause logs unavailable via connected read API/CLI (404), so web Preview runtime remains unverified.

Final APK: source `0407e886fb3c4f056cd7af529b373fd31ba8bad3`, successful run [39979500333](https://github.com/krzysztofcal/arcadePlatform/actions/runs/39979500333), artifact [12512069127](https://github.com/krzysztofcal/arcadePlatform/actions/runs/39979500333/artifacts/12512069127). Device/Stage integration remains uncompleted T008.

## PR review follow-up

- [x] R001 Route shared account publicProfileUrl through validated Stage external-browser adapter; preserve web relative link. Guard resume online event using navigator.onLine; extend only fundamental security/lifecycle tests.
- [x] R002 Diagnose Netlify exit 2 using build logs and read-only comparison; no configuration bypass or deployment.
- [x] R003 Inventory actual packaged API consumers, compare Preview 1095 and current Stage WS revisions/contracts, inspect read-only OPTIONS; propose Stage-only XP_CORS_ALLOW additive change without application.
- [x] R004 Run fundamental tests and existing syntax/CSP controls; hosted-only new APK, exact source receipt, update Draft PR/evidence.

Review APK: `bebbdc6a2ac5c6d556d6028bd33fc0bbbc5d4b8c`, [successful hosted workflow](https://github.com/krzysztofcal/arcadePlatform/actions/runs/39996051429), [artifact](https://github.com/krzysztofcal/arcadePlatform/actions/runs/39996051429/artifacts/12520250698). [Review findings and required GO](review-followup.md).

## First physical Galaxy S24+ review

- [x] D001 Record owner evidence for APK bebbdc6a, separate UI defects from API1095/CORS symptoms.
- [x] D002 Mobile presentation only: built-in SystemBars native insets plus generated viewport-fit=auto; filter bottom navigation to Poker/Profile; diagnostics in normal flow/table menu. Existing web viewport/styles/menus unchanged.
- [x] D003 Existing fundamental/syntax/CSP checks, hosted-only APK artifact and review; physical retest remains pending. No backend/environment action.

- [ ] D004 Owner visual retest of `006cef6e0b0399d81cc128b5fd1b869f0cd6786e` on S24+; record OS/WebView versions. No funded/backend smoke. [Device evidence and APK](device-smoke-s24.md).

## Owner GO — shared Stage Deploy Preview secret adapter

- [x] S001 Validate Personal secrets capability, review policy, approved Stage PING/epoch and branch override impact.
- [x] S002 Implement/test Stage Deploy Preview selector, fail-closed cases, unchanged Production/WS legacy behavior.
- [x] S003 Create protected ARCADE_STAGE_REDIS_TOKEN and shared Preview XP tuple; verify unrelated configuration and overrides unchanged.
- [x] S004 Push passing SHA and verify exact-SHA Preview1141 build/configuration/read-only endpoints; report remaining blockers. No APK/backend business operation.
