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

## Current activation preflight — 2026-10-29

Read-only verification: main `6b9dc511a72953e2d3f096f6aec5096fbaca147c`; #1163 Draft/mergeable at `24f0766a3ade7f64008557c7dc3d68373a4a7ec5`, #1155 Draft at `810a77b1ed7a341f95eb2f9ce2c1099543a6c9bb`, #1160 Draft at `30e9711684c14cc004f7c8fb51711b945f424a07`, still based on the parent. Required actionlint and native Netlify checks for #1163 PASS. Existing logic is sufficient; no additional runtime change is proposed.

Stage C rotation is complete: #1155 deployment `6ae3a39a7050004c02614bc8`, source 810a77b; WS Preview release `a87e06c4335e7c8170d523b4f8d9497c4372c3cc`, PID 591020. Root verification established effective C, TEST absent, unchanged internal token, health/guest auth/old-A rejection PASS; OWNER confirmed Stage login and Lobby. Reuse these accepted results; no new rotation, retirement or financial audit is required. The local Date fix is excluded.

playkcswh retains Production branch main, enabled branch list containing only main, sensitive-variable policy review, and builds enabled. Production publication remains `6ae3785cd7852c1a7f9588b0`. Parent is not enrolled. Missing branch-deploy values do not inherit production-context values; explicit unsafe branch-deploy records are distinguished from missing records below. Protected masked values are not compared as plaintext evidence.

### Effective configuration gaps

All proposed branch overrides below target only `feat/1114-profiles-phase-a`, preserving other contextual values. Parent overrides do not configure the child Deploy Preview.

| Variables | Parent effective state | Required parent action / source |
|---|---|---|
| SUPABASE_URL, SUPABASE_DB_URL, SUPABASE_ANON_KEY, SUPABASE_ANON_KEY_V2, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STAGE_PROJECT_REF | Missing | Existing approved Stage project credentials; preserve primary/V2 consistency; no Production copy |
| SUPABASE_JWT_SECRET, SUPABASE_JWT_SECRET_V2 | Explicit branch-deploy values MATCH Production | Override with existing approved Stage JWT values |
| XP_REDIS_VERSION, XP_REDIS_ENV | Missing | Set 3 / stage |
| XP_KEY_NS | Legacy branch-deploy namespace | Set kcswh:stage:xp:v3 |
| UPSTASH_REDIS_REST_URL | Shared endpoint | Preserve approved shared endpoint; namespace is logical isolation, not a separate Redis instance |
| ARCADE_STAGE_REDIS_TOKEN | Protected Deploy Preview value exists; missing on parent | Copy existing approved Stage V3 credential through authorized custody, protected exact-parent value; no legacy token fallback |
| WS_AUTH_HS256_SECRET | Protected branch-deploy record exists, but no parent C assignment | Copy existing root-custodied C to protected exact-parent override; masked API cannot prove equality; no generation/rotation |
| POKER_WS_PREVIEW_URL, POKER_WS_INTERNAL_BASE_URL, POKER_WS_INTERNAL_TOKEN | Missing | Existing Stage URL/internal token; accepted Stage token MATCH must be preserved |
| ADMIN_USER_IDS | Branch-deploy MATCH Production | Approved Stage operator identities only; never publish identifiers |
| XP_CORS_ALLOW | Existing exact-parent value | Preserve; PR2 adds localhost only for recognized Stage identity, no panel CORS workaround |
| PUBLIC_PROFILES_ENABLED / AUTH_GOOGLE_ENABLED and public build flags | Parent lacks some Stage build values | Mirror reviewed Stage behavior where consumed; retain Phase A/profile and OAuth functionality, without provider changes |

Independent isolation gaps remain: current Deploy Preview values of POKER_DEAL_SECRET, XP_DAILY_SECRET, CHIPS_ADMIN_SECRET and POKER_SWEEP_SECRET MATCH Production. Corresponding branch-deploy records also MATCH Production. XP_SESSION_SECRET is absent for these Stage contexts, so XP signing falls back to XP_DAILY_SECRET. Parent-only changes cannot isolate child #1160. Do not copy these records wholesale. A separate narrow GO must approve Stage-only replacements or explicit disabling of unused administrative paths for parent and child. Existing internal token must remain unchanged. No WS deal/recovery key change is included. POKER_SWEEP_SECRET has no active code consumer found; disabling an unused setting still requires configuration GO. A distinct Stage XP signing source must be approved; do not repurpose WS/internal keys.

SUPABASE_DB_URL, SUPABASE_SERVICE_ROLE_KEY, primary/V2 JWT and several operational keys currently have is_secret=false. Protected signing and Redis alias keys are already secret. Plan supports protected keys but not granular Functions-only scopes. Secret metadata is key-wide and irreversible; setting is_secret=true on existing keys affects metadata across contexts, including Production. This is a separately authorized hardening operation, not an exact-parent-only edit. Preserve existing values/scopes and all contextual records; STOP if protection cannot be established without unsupported or destructive operations. Do not log values or masked-value equality claims.

### Minimal activation order, separate OWNER GO required

1. Approve the exact configuration delta and sources, including the child isolation and key-wide metadata issues above. Snapshot safe metadata and preserve original confidential values through authorized custody before changes. No rollback may restore old signing A. Never reconstruct protected values from masked reads. Preserve main, sensitive-variable policy and unrelated contexts; do not enroll yet.
2. Propagate the existing complete PR2 topic into parent, without merging main first. Local merge analysis found one conflict in ws-server/Dockerfile: retain shared/profile-terms.mjs and add shared/netlify-stage-context.cjs. Keep all accepted parent functionality; do not include the Date patch. Do not cherry-pick only the final test-only commit. Review the resolved diff before separately authorized push.
3. After isolated configuration and compatible parent code are present, enroll only the exact parent. Require native branch-deploy READY with its exact source SHA, expected alias `https://feat-1114-profiles-phase-a--playkcswh.netlify.app`, honest branch-deploy context, immutable netlify-stage-parent identity and Stage receipt. Alias mismatch means STOP.
4. Propagate updated parent into child, keeping its stacked base. A substantive authorized child synchronization should create the native Deploy Preview. Require exact child source SHA, review_id=1160, context=deploy-preview, Stage Supabase/Redis V3, C signing and existing internal-token compatibility. Never substitute the parent Preview as child acceptance. No temporary PR, empty commit, retarget, close/reopen or unsupported review_id build API workaround.
5. Verify actual localhost/WWW OPTIONS and methods/headers, foreign-origin denial, Production CORS unchanged, then approved nonfinancial auth/API/WS smoke. No tables, JOIN or financial writes. Native #1160 acceptance remains OPEN until these observations exist.

Parent/child pushes change their exact SHAs and can rebuild their existing Preview aliases and hosted debug APKs. Existing accepted APK evidence remains historical; automatic APK still pins API #1155 and does not demonstrate #1160 integration. PR3 owns exact Preview/APK binding. Stage DB apply remains trusted-main explicit dispatch after PR1, not push/Draft/Ready automation. No SQL dispatch is required here.

Before any later #1163 main merge, separately approve a no-deploy merge procedure: ordinary protected squash with exact skip markers `[skip netlify] [skip actions]` and empty body, checked again against then-current automation. Do not bypass checks or disable WS deployment independently. This merge SHA would intentionally lack push CI and is not independently validated for Production. Current task authorizes neither merge nor code propagation pushes.

References: [native Deploy Previews](https://docs.netlify.com/deploy/deploy-types/deploy-previews/), [context precedence](https://docs.netlify.com/build/environment-variables/overview/), [protected secrets](https://docs.netlify.com/build/environment-variables/secrets-controller/).

## Validation and breaking impact

Local Node20 fundamental tests: 58 PASS (Stage identity/token/config, generated context and actual WS module import with network blocked, Redis V3, landing independence, client WS selection). Existing CORS client and E2E origin-allowlist contracts PASS. Artifact guard PASS; two optional local Docker tests SKIPPED because Docker is unavailable, not a runtime PASS. Static HTML, syntax (229 files), full ci:guards and CSP hash/WS allowlist checks also PASS. Hosted checks provide full build coverage. No live DB/Auth/Redis test or native stacked deployment has been performed.

New unknown branch deployments and wrong Stage configuration deliberately fail closed rather than inheriting Production/legacy credentials. Existing approved numbered Deploy Previews must have valid Stage credentials at build time. The new shared dependency is included in Docker and existing release artifacts. Production token/context behavior is unchanged. Parent preview is noindex; this is not access control.

The diff classifies `deploy_ws=true` for a future main push because it includes shared/CORS/Docker code. A future merge therefore needs the existing coordinated no-deploy procedure/OWNER GO; this Draft push does not authorize main deployment or WS restart. Do not disable automatic WS independently. Android may build automatically due to the client path change; its current API pin is not proof of native parent/child acceptance. No manual APK dispatch, installation or publication. Stage apply is explicit trusted-main dispatch after PR1; no automatic Draft/Ready DB mutation is introduced.

LEGAL remains OPEN. No Netlify settings, credentials, Stage SQL, WS runtime installation or Production publication are changed here.

## Final configuration gate — 2026-10-29 20:32 UTC

The exact contextual mutation manifest is [pr2-activation-handoff.md](pr2-activation-handoff.md). Fresh GET-only evidence confirms privileged unprotected keys include post_processing; protecting them requires separately authorized key-wide metadata/scopes changes. Under OWNER condition 5 **no configuration mutation was performed**, including otherwise independent public values. Stage C remains unchanged. Operational Stage credential sources/disabling decisions also remain required; no generation is implied.
