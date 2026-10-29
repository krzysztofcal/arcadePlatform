# PR2 — native trusted stacked Preview

## Scope and acceptance

Implementation based on main `6b9dc511a72953e2d3f096f6aec5096fbaca147c`. Parent #1155 remains Draft at `810a77b1ed7a341f95eb2f9ce2c1099543a6c9bb`; child #1160 remains Draft at `30e9711684c14cc004f7c8fb51711b945f424a07`. Neither is modified here. Native child Preview acceptance remains OPEN until the separately approved Netlify enrollment and code propagation. Temporary PRs, retargeting, close/reopen and parent Preview substitution are not the normal process.

Netlify requires the target of a Deploy Preview to be the Production branch or an enabled branch-deploy branch. Current playkcswh allows only main. Public-repository sensitive-variable policy is `review`; preserve it. Application guards cannot protect a secret already injected into an untrusted build. Never approve a fork/unreviewed source to receive Stage credentials.

## Files and methods

- `shared/netlify-stage-context.cjs`: one public allowlist for exact native parent branch/origin and numbered playkcswh Deploy Previews; no credentials.
- `scripts/generate-build-info.js`: validate Stage Supabase project, DB target, signed anon/service credentials and Redis alias before generating server/browser metadata. Exact native parent becomes immutable `netlify-stage-parent`, retains honest `branch-deploy` context, receives Stage WS routing and noindex. Emit private build-artifact `stage-context-receipt.json` with public identity/config evidence only. This receipt is build validation, not proof of platform secret policy or live DB connectivity.
- `store-upstash.mjs::resolveRedisRestToken`: native parent uses protected Stage alias with XP V3 Stage pins, without legacy fallback. Unknown branch deploys fail closed. Production and explicit WS Preview identity retain existing behavior and namespace/epoch checks.
- `api-cors.mjs::buildApiCorsPolicy`: retain configured origins/methods/headers, add exact `https://localhost` only for recognized immutable Stage Netlify identity. CORS is not authorization.
- `poker/poker-ws-client.js::resolveWsUrl`: Stage parent chooses Preview WS before Production globals; no gameplay change.
- `ws-server/Dockerfile`: include shared policy dependency. Existing release workflows already copy the whole shared directory.
- Existing token/build/CORS/WS-client tests and build fixtures extended; no dependency, SQL, workflow trigger, Auth, Android-origin or inline-script changes.

## Separate OWNER GO: minimum Netlify operations

Do not enable the parent before compatible code and isolated configuration are ready.

1. Approve publication/bootstrap of this code into main and subsequently parent/child without dropping their accepted changes. These are separate branch/merge operations, not performed by PR2 implementation.
2. Preserve playkcswh Production branch main, existing Production values, landing `stop_builds=true` and `untrusted_flow=review`. Configure only exact parent `feat/1114-profiles-phase-a`, with reviewed builds/Functions effective scopes: Stage Supabase URL, DB URL, anon/service keys, JWT secret and any V2 overrides; XP_REDIS_VERSION=3, XP_REDIS_ENV=stage, XP_KEY_NS=kcswh:stage:xp:v3; existing Stage Redis endpoint and protected ARCADE_STAGE_REDIS_TOKEN; Stage WS URL. Secret must stay protected; do not broaden contexts or weaken scopes/protection to work around a plan limitation.
3. Resolve secret-isolation blockers before enrollment: readonly context comparison found parent JWT values inherited from Production and missing parent Supabase/DB/alias values. Existing Preview also shares some generic operational secrets with Production (`WS_AUTH_HS256_SECRET`, `POKER_DEAL_SECRET`, `POKER_SWEEP_SECRET`, `CHIPS_ADMIN_SECRET`, `XP_DAILY_SECRET`). Copying all current Preview values is therefore insufficient. Use approved Stage-only credentials; disable unused administrative routes through branch overrides where supported. A WS signing-key change must remain compatible with current WS Preview and requires its own explicit configuration/rollout GO. No rotation, Production credential modification or WS deployment is authorized here.
4. Independently verify effective branch and deploy-preview values/scopes, including V2 overrides and other operational secrets, without logging values. Preserve all unrelated context records. If a protected exact-branch value cannot be configured safely, STOP.
5. Enroll ONLY the exact parent branch in existing site's branch-deploy list. Do not allow all branches, add a service, activate landing Git builds or alter Production settings. Verify actual parent alias equals `https://feat-1114-profiles-phase-a--playkcswh.netlify.app`; mismatch means STOP, not relaxed matching.
6. With compatible code on parent/child, observe a normal reviewed child synchronization. Require native Netlify check for exact child SHA, deploy-preview context/review ID, Stage receipt, Stage Functions and protected-variable policy. No temporary PR, empty commit, retarget or repeated build workaround. If integration does not create the native Preview, STOP with provider evidence.
7. Verify actual OPTIONS for Android and WWW, denied foreign origin, unauthenticated/authenticated contracts only after environment verification. Existing configured origins remain. New code supplies localhost automatically; no XP_CORS_ALLOW panel edit is required for this implementation. OAuth allowlists are unchanged; any demonstrated redirect issue requires separate GO.

References: [native Deploy Previews](https://docs.netlify.com/deploy/deploy-types/deploy-previews/), [branch deploys](https://docs.netlify.com/deploy/deploy-types/branch-deploys/), [variable precedence/scopes](https://docs.netlify.com/build/environment-variables/overview/), [sensitive-variable policy](https://docs.netlify.com/build/environment-variables/get-started/), [protected secrets](https://docs.netlify.com/build/environment-variables/secrets-controller/).

## Validation and breaking impact

Local Node20 fundamental tests: 58 PASS (Stage identity/token/config, generated context and actual WS module import with network blocked, Redis V3, landing independence, client WS selection). Existing CORS client and E2E origin-allowlist contracts PASS. Artifact guard PASS; two optional local Docker tests SKIPPED because Docker is unavailable, not a runtime PASS. Static HTML, syntax (229 files), full ci:guards and CSP hash/WS allowlist checks also PASS. Hosted checks provide full build coverage. No live DB/Auth/Redis test or native stacked deployment has been performed.

New unknown branch deployments and wrong Stage configuration deliberately fail closed rather than inheriting Production/legacy credentials. Existing approved numbered Deploy Previews must have valid Stage credentials at build time. The new shared dependency is included in Docker and existing release artifacts. Production token/context behavior is unchanged. Parent preview is noindex; this is not access control.

The diff classifies `deploy_ws=true` for a future main push because it includes shared/CORS/Docker code. A future merge therefore needs the existing coordinated no-deploy procedure/OWNER GO; this Draft push does not authorize main deployment or WS restart. Do not disable automatic WS independently. Android may build automatically due to the client path change; its current API pin is not proof of native parent/child acceptance. No manual APK dispatch, installation or publication. Stage apply is explicit trusted-main dispatch after PR1; no automatic Draft/Ready DB mutation is introduced.

LEGAL remains OPEN. No Netlify settings, credentials, Stage SQL, WS runtime installation or Production publication are changed here.
