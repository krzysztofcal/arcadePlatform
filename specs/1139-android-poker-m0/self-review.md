# Self-review — #1139

- Reused main f9137918 audit and all seven issue comments. No parallel prototype or duplicated editable account/Poker UI. Generated nav removes Arcade routes; shared SidebarModel returns Poker/account under explicit mobile context.
- Shared fetch adaptation is explicit and optional, leaving other web entry points compatible. Absolute storage/Supabase URLs unchanged. Caught/fixed malformed Auth settings call during existing regression tests.
- CSP: packaged pages have script-src self plus hashes of existing inline scripts; no unsafe-eval/unsafe-inline scripts, remote JS or fetch interception. Existing web CSP unchanged. Mobile consent/analytics loading omitted, no ads included.
- Stage origin/project/WS locked; public anon JWT role/ref checked. OAuth authorize URL and code callback validated, PKCE, no bearer token callback or credential logging. Custom-scheme interception remains an M1 verified-links limitation.
- No WS protocol/server/backend/DB change, environment application, deployment, financial request, Production action or merge. Preflight from mobile origin returned 403: separate Stage CORS/OAuth GO documented.
- Workflow is hosted-only, same-repository Draft PR/manual, read-only token, no credentials persisted, locked mobile dependencies, resource guards, debug-only, receipt/SHA256, seven-day artifact.
- VPS no install tree/SDK/JDK/Gradle/cache cleanup/global Node changes. Lock metadata only, 96 KB mobile source at first disk check; disk remains 6.2 GB.
- NOT TESTED: real APK launch, Samsung/WebView/rotation/Back/background/offline, Google or email callback/session, avatar picker, authenticated Stage HTTP/WS/gameplay/deletion. No phone attached; integration blocked on Stage configuration GO. Do not mark merge-ready.

## Review and verification follow-up

Independent read-only reviewer found CSS root-path resolution, native plugin proxy access and Account recovery reload issues; all corrected. Re-review found 82 referenced assets without missing source files and no further confirmed critical/important finding. Added native PKCE/recovery test. Cold/repeated launch callbacks remain device-only verification.

52 tests pass (mobile security, existing Account Auth, Poker WS and sidebar contracts/behavior), web syntax 228 files passes, CSP 55 served documents passes, explicit web/Stage API resolver checks pass, mobile JS/MJS/CJS syntax passes. Hosted actionlint and APK build pass on first successful source 839bb943906205d65ca6b9b36314d2d23676e14e; final package sanitizer correction requires its own APK evidence. CodeQL's script-tag sanitizer finding was addressed by selecting whole trusted source lines rather than replacing partial tags.

Netlify Preview automatic PR build failed with build-script exit 2. Connected deploy metadata confirms error; CLI build-log retrieval is unavailable (404). No Netlify settings or bypass were applied, and Preview/web runtime is NOT verified. This PR remains Draft with that CI limitation. System Node remains /usr/bin/node v20.20.0; inherited session PATH already contained user Node 22.23.1 before this task. No Node installation/upgrade performed.

## Final hosted evidence

- APK source SHA: `0407e886fb3c4f056cd7af529b373fd31ba8bad3`.
- Successful ubuntu-24.04 build: https://github.com/krzysztofcal/arcadePlatform/actions/runs/39979500333
- Artifact: https://github.com/krzysztofcal/arcadePlatform/actions/runs/39979500333/artifacts/12512069127 (expires 2026-10-30).
- APK SHA256: `92678604804e483c80ad3533a7777cf109ac2386391ea7c79175093249c78749`.
- Streamed artifact into memory, verified receipt/source and matching SHA256SUMS. APK has exactly account.html, index.html, poker/index.html and poker/table-v2.html; no game catalog or AdSense script. Generic img/games/placeholder.svg is a shared CSS dependency, not a game. No APK saved to VPS.
- Final CodeQL check and all three language analyses pass. Android template versionName explicitly 0.0.1; callback replay test passes. Explicit mobile /poker/index.html avoids Capacitor html5mode directory fallback/root-entry loop. Independent narrow re-review confirmed navigation normalization.
- Native launch, cold callbacks, public-profile link navigation, rotation/Back/resume, OAuth/email/session/avatar and authenticated WS/gameplay are NOT TESTED. Mobile includes account/profile editor, not a separately packaged public-profile page.
- Netlify Preview remains failed at https://app.netlify.com/projects/playkcswh/deploys/6adb7e9e0dda2437e0343622 (build script exit 2; unavailable detailed logs). No web runtime success or merge readiness claimed. Existing broad hosted Playwright check was still pending at final evidence collection.
- Final VPS free disk 5.9 GB (initial 6.2 GB), above warning/stop thresholds; no SDK/JDK/Gradle/Node install, extra checkout or manual data cleanup. Remaining task is owner-gated Stage integration and physical phone smoke.

The final documentation-only commit does not change the APK runtime. Compare its diff to the source SHA above before reusing artifact evidence.

## User review follow-up

See [review-followup.md](review-followup.md) for the new exact-SHA APK, public-profile/offline-resume fixes, 69 passing selected checks, Netlify Redis context root cause, API1095 incompatibilities, live WS receipt/protocol evidence and Stage-only CORS proposal. No environment/origin/deploy change was applied. This supersedes the earlier unavailable-log diagnosis and old APK link; physical/authenticated integration remains pending.
