# PR #1141 review follow-up — 2026-10-23

## Code fixes and web behavior

`js/account-page.js::renderPublicProfile()` delegates only native navigation to `MobilePoker.publicProfileUrl(handle)`. `security.cjs::publicProfileUrl()` validates the pinned Stage configuration and URL-encodes the handle; `runtime.js` supplies this adapter. The existing external-link listener opens the Stage HTTPS URL in Capacitor Browser. No second profile UI. Without MobilePoker the original relative `/u/<encoded handle>` is unchanged.

`runtime.js` starts the existing Supabase refresh on resume but dispatches its online hint only when `navigator.onLine` is true. Offline resume preserves the offline banner and does not notify WS consumers that connectivity returned. This checks the browser connectivity indication; true is not proof of Internet reachability. Existing WS reconnection ownership is unchanged.

Fundamental origin/lifecycle tests were extended first: they failed on the missing Stage URL helper and offline synthetic event, then passed after the fixes. Existing Account/Auth/WS/sidebar regression checks cover the web fallback. No rendering/layout test suite added. Physical external-browser navigation and backgrounding remain NOT TESTED.

## Netlify Preview exit 2: environment mismatch, not PR regression

Historical failed deploy: `6adb7e9e0dda2437e0343622`, source `0407e886fb3c4f056cd7af529b373fd31ba8bad3`. Read-only authenticated Netlify build-log subscription (the same `socketeer.services.netlify.com/build/logs` service used by the installed CLI) returned the actual failure:

`Error: xp_redis_build_configuration_invalid` in `scripts/generate-build-info.js::generateServerDeployContext()`; Netlify wraps the build-command failure as exit 2. Previous observability-log 404 was a different endpoint, not an explanation of this failure.

Read-only, key-specific inspection of public configuration confirmed:

| Setting | Default deploy-preview | Required by existing v3 guard |
| --- | --- | --- |
| XP_REDIS_VERSION | absent | 3 |
| XP_REDIS_ENV | absent | stage |
| XP_KEY_NS | kcswh:xp:v2 | kcswh:stage:xp:v3 |

The approved v3 floor was already present in base `f9137918`; this PR does not change that build script or backend. Existing branch-specific Stage overrides cover several older branches but not `feat/1139-android-poker-m0`. In-memory execution of the real base and PR guard reproduces the same exception with the observed default tuple; both accept the correct Stage tuple. Filesystem writes were mocked. This establishes a pre-existing environment/configuration mismatch exposed by this branch, not a mobile code regression. No guard, check, environment variable or deploy was bypassed/applied.

**Separate GO needed if owner wants Preview repaired:** prepare a branch-scoped Stage tuple for `feat/1139-android-poker-m0` (`3`, `stage`, `kcswh:stage:xp:v3`), verify existing Stage Redis binding without exposing/changing credentials, and separately authorize a Preview build/deploy. Do not change Production or the default context for unrelated branches implicitly.

## Pinned API / APK / live Stage WS compatibility

- APK baseline: `0407e886fb3c4f056cd7af529b373fd31ba8bad3`.
- API remains `https://deploy-preview-1095--playkcswh.netlify.app`; public BUILD_INFO pins source `18f9f0fab9dc34bbb1cac4165c1370f2606a20f7`, deploy `6acd5f7a8897eeb7d7b78e55`, 2026-10-12. Original PR branch: `feat/1077-single-player-poker` (merged). Stage Supabase remains `krydukthwdvccggbyjfw`.
- Running WS release receipt: `6c662d524d158e439d3888cfc667a923806100d1`, environment preview. The deployment checkout's git HEAD is stale; release metadata plus hashes of running `server.mjs` and `poker/auth/verify-token.mjs` match that release. Do not use checkout HEAD as deployed SHA.
- `/healthz`: HTTP 200, buy-in materialization capability 2. Read-only WS upgrade with Origin `https://localhost`: HTTP 101, then closed without sending hello/auth/JOIN/actions. No origin rejection at transport layer.
- APK client vs released WS client differs only in explicit mint URL resolution. Server, auth, handlers, read models and runtime protocol source are unchanged between released WS and APK baseline. Existing version 1.0 frames, token response and HS256 sub/exp contract are structurally compatible. Mint signing-secret alignment and authenticated snapshots/actions are NOT TESTED; no credential/session/funded requests performed.
- **Full API compatibility FAIL:** Preview 1095 lacks account-delete (404), inactivity-aware progression updates and current account-deletion safeguards in mint/quick-seat/shared helpers. XP namespace/runtime settings also predate the current v3 floor. CORS alone cannot bring this old deployment to current feature/safety parity. No origin changed and no old API rebuilt.
- Public `/u/mobile-poc-navigation-probe` route responds HTTP 200 HTML via HEAD, confirming external profile-page routing exists; actual profile data/feature availability and native Browser behavior remain NOT TESTED.

An owner decision is needed before treating any backend as the complete mobile integration target. A repaired current Stage Preview is a candidate only after explicit environment/deploy GO and a separate origin-change GO; this report does not silently switch away from 1095.

## OPTIONS inventory: actual loaded mobile consumers

Only OPTIONS was sent; no POST/PATCH/DELETE business request, JOIN, bonus claim, deletion, login or DB mutation. Probe headers were `Access-Control-Request-Headers: authorization,content-type`; the actual avatar-remove method is DELETE. The first diagnostic POST preflight on avatar-remove advertised DELETE and was followed by the correct DELETE preflight below.

| Function | Actual method(s) | Mobile origin | Preview 1095 origin |
| --- | --- | --- | --- |
| poker-create-table | POST | 403, no ACAO | 204, methods/headers allowed |
| poker-quick-seat | POST | 403, no ACAO | 204, methods/headers allowed |
| poker-progression | GET | 403, no ACAO | 204, methods/headers allowed |
| poker-guest-session | POST | 403, no ACAO | 204, methods/headers allowed |
| ws-mint-token | POST | 403, no ACAO | 204, methods/headers allowed |
| profile-me | GET, PATCH | 403, no ACAO | 204, methods/headers allowed |
| profile-avatar-upload-url | POST | 403, no ACAO | 204, methods/headers allowed |
| profile-avatar-finalize | POST | 403, no ACAO | 204, methods/headers allowed |
| profile-avatar-remove | DELETE | 403, no ACAO | 204, methods/headers allowed |
| chips-balance | GET | 403, no ACAO | 204, methods/headers allowed |
| chips-ledger | GET | 403, no ACAO | 204, methods/headers allowed |
| chips-tx | POST | 403, no ACAO | 204, methods/headers allowed |
| bonus-campaigns | GET, POST | 403, no ACAO | 204, methods/headers allowed |
| account-delete | GET, POST | 404, absent | 404, absent |
| start-session | POST | 403, no ACAO | 204, methods/headers allowed |
| calculate-xp | POST (includes XP status) | 403, no ACAO | 204, methods/headers allowed |

`profile-public` is used by the external public-profile page rather than Account's direct native profile editor. Mobile sidebar deliberately skips admin-me; no game catalog loader is reachable. `poker-export-log` is an unused constant in the loaded lobby controller; legacy REST poker join/actions are not the authoritative client path and are not added to this CORS proposal.

Signed avatar Storage PUT (image content-type) goes directly to pinned Stage Supabase, separately from Netlify. Supabase Auth requests also do not use XP_CORS_ALLOW. These integrations are NOT TESTED; generating signed uploads or changing provider configuration was not authorized.

## Minimal proposed CORS change — NOT applied

Observed default Stage `deploy-preview` value:

`https://play.kcswh.pl,https://landing.kcswh.pl,http://localhost:4173`

Proposed additive value:

`https://play.kcswh.pl,https://landing.kcswh.pl,http://localhost:4173,https://localhost`

Append exactly `https://localhost`, preserve all existing origins, no wildcard/port/scheme broadening, no native HTTP bypass. Keep existing per-function method/header restrictions; needed methods are GET/POST/PATCH/DELETE/OPTIONS, with authorization and content-type (XP's existing optional x-api-key remains untouched). Existing policy normalizes/exact-matches HTTPS origins, so no shared CORS source change is necessary.

**Scope/GO:** this is Stage-only, never Production or an all-context variable. Prefer a branch-specific override for the owner-approved integration backend; if staying on API 1095, its original branch is the target, not PR 1141. Changing the Stage deploy-preview default would affect other Stage previews and needs explicit approval of that broader scope; existing branch overrides may shadow it. Environment edits do not retrofit immutable deployed function artifacts, so a build/redeploy is a separate GO. Given the stale API contract above, do not rebuild old 1095 merely to add CORS without an owner decision on backend compatibility. This task applies nothing.

## Local verification and review

PASS: 69 selected fundamental/security and existing Auth/WS/sidebar/token-mint/CORS tests, run sequentially with `NODE_ENV=test XP_TEST_MODE=1`. This is the existing scripts/test-all.mjs memory-store test setup, not an environment or guard bypass. An initial standalone CORS invocation without that required test flag failed with xp_redis_v3_required; it was rerun correctly without changing code or shared configuration. PASS: existing syntax control (228 tracked files), CSP control (55 documents), explicit mobile JS/CJS syntax, diff whitespace check. Independent read-only reviewer found no important issues in the changes or scope proposal.

No SDK/JDK/Gradle/Node installation or extra checkout; disk 6.0 GB before, 5.9 GB after local work. No service interrupted, secret value logged, environment changed, authenticated call, business-method request, JOIN, financial operation, deletion or merge. New APK must be built by the existing hosted-only workflow; device/Google/session integration remains NOT TESTED.
