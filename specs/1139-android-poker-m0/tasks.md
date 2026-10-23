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
