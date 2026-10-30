# P1 correction: immutable Redis artifact identity

## Root cause and minimal change

Final review reproduced actual WS Preview build context deploy-preview/null-origin rejected by Netlify-only selector. BUILD_ARTIFACT_IDENTITY is now generated with metadata, not read from runtime env: normal build netlify-functions, server-context-only ws-server, explicit --ws-preview-artifact ws-preview. Generator rejects WS Preview marker unless contextdeploy-preview and no supplied origin; original XP activation floor/namespace/environment checks unchanged. Local committed unknown-context stub is unspecified, not a WS authorization.

Existing WS Preview workflow adds one explicit generation flag and checks marker/null-origin in its existing four artifact-copy V3 validations. SHA, protected configuration, release, packaging, deployment/recovery checks unchanged. Workflow remains manual; never invoked in this task. Production workflow unchanged and naturally generates ws-server metadata while selector retains production legacy credentials.

Selector requires Stage3/stage/kcswh:stage:xp:v3 for every deploy-preview. Only generated ws-preview + null-origin permits UPSTASH_REDIS_REST_TOKEN; other Preview must be netlify-functions + canonical playkcswh Deploy Preview origin and protected alias. Missing alias returns existing unavailable store/503 without legacy/memory fallback. Invalid/missing identity or Netlify origin throws. Runtime env spoof does not affect immutable imports. Existing XP ledger namespace, epoch, fencing, SQL/financial logic unchanged. New helper and metadata must be packaged together; stale metadata without export fails closed and requires normal rebuild, not an environment workaround.

## Fundamental evidence

Existing token regression file extended; before implementation4 PASS/2 FAIL, then6/6 PASS. Cases cover valid Netlify alias, absent/invalid alias, invalid identity, missing/null/foreign origin, WS legacy/missing legacy, runtime-marker spoof, Stage tuple mismatch and Production/non-Preview legacy preservation. New regression reads actual command from workflow and runs actual generator in VM with filesystem writes captured in memory. Then separate Node20 process imports real store and ws-server/poker/runtime/account-deletion.mjs using that generated metadata via a module loader. XP_TEST_MODE0, synthetic URL/token only, no real credentials inherited; fetch/Socket.connect/Redis operations blocked. isMemoryStorefalse and xpStoreUnavailablefalse after import. This validates actual WS dependency import without starting/listening/restarting any server.

52 relevant local fundamentals PASS (token, V3/reset, WS workflow gates, mobile security/Auth). Syntax228/CSP55/whitespace PASS. Existing workflow guard fixtures extended for wrong artifact/origin; existing Netlify missing-credential fixture adds required metadata export. New fundamental file added to existing CI xp-v3 job rather than creating a new suite/job. Independent reviewer found no blocker and independently ran6/6 PASS. No layout tests/framework/dependency added.

## Scope and handoff

No Android/mobile/UI/Auth/avatar/engine changes, environment/secret/DB/Storage/Redis writes, Production change, WS deploy or service restart. Approved physical APK857159ca remains accepted; signing/App Links remain M1. VPS6.5GB before/after, no SDK/install/checkout/cleanup.

Breaking impact: generated metadata gains one required export; atomic build artifacts pair it with new store. Explicit WS Preview flag is mandatory to avoid assuming no-origin means WS. Production token selection unchanged; Stage Netlify rebuild emits correct marker without any variable changes. Existing deployed older releases remain untouched. Required CI/WS PR Checks and exact-SHA status will be recorded in PR after push. Actual live WS startup/deployment NOT TESTED and not authorized by this GO.

## Exact-source result PASS

Correction SHAedf9fb3a86b73da2e5b921dce4053280c50f0902. Required CI https://github.com/krzysztofcal/arcadePlatform/actions/runs/40081736776 and WS PR Checks https://github.com/krzysztofcal/arcadePlatform/actions/runs/40081736795 SUCCESS; all34 PR checks complete with zero fail/pending. Hosted Tests40081736792 and other required validations also succeed. No skip/bypass added; new actual-context test runs in existing xp-v3 job.

Netlify automatically rebuilt exact correction source: deploy6adc78f92a4061b078ec0249 ready. Read-only GET calculate-xp405 after existing store-availability guard confirms Netlify marker/alias/module import path works; no Redis command or business action executed. No environment/configuration variables changed. WS Server Deploy validation SUCCESS with actual deploy job SKIPPED; WS Preview workflow was not dispatched. Real WS startup/deploy remains NOT TESTED/unapproved.

Independent reviewer found no blocker; separately ran6/6 token/artifact tests including real module imports. Final generated identity and guard fixtures,52 relevant local tests, syntax228/CSP55/whitespace PASS. Code diff has no mobile/Poker/UI/Auth/client changes, so accepted physical APK payload remains unchanged (metadata-only rebuilds may differ in source SHA). A following documentation-only commit records results without code changes. User authorization remains required for any live WS deployment/restart or merge.
