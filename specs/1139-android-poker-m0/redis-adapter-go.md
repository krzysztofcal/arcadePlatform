# Shared Stage Redis V3 Deploy Preview GO

Supersedes the earlier branch-only proposal, which stopped on HTTP403 with no configuration applied. New official API preflight confirms Personal credit-personal: env_var_secrets=true, env_var_scopes=false, Owner role. Installed official CLI uses Builds/Functions/Runtime for secrets and omits Post processing. Existing public-repository sensitive-variable policy is untrusted_flow=review: unrecognized authors/forks require member approval; connected site-member Git identities are trusted even from forks. Do not approve an unreviewed external build: approved code can access the shared physical Redis, including Production data. Namespace guards do not replace this trust gate.

Approved Stage sources deploy-preview-1124 and feat/1117-account-deletion-v2 agree on endpoint/token and Stage V3 tuple. Read-only PING/PONG and existing epoch presence PASS; no credential logged or saved and no Redis data writes. New ARCADE_STAGE_REDIS_TOKEN creation returned HTTP201, is_secret=true, scopes Builds/Functions/Runtime, one deploy-preview value only. Existing credentials/metadata unchanged. Three deploy-preview contextual XP values now 3/stage/kcswh:stage:xp:v3. All eight existing branch override tuples already match; comparison confirms overrides and every unrelated variable unchanged. No Production or branch-deploy value changed.

Minimal store-upstash.mjs adapter uses immutable build context/origin, accepts canonical playkcswh Deploy Previews only, enforces exact Stage V3 tuple and requires alias without legacy fallback. Production/WS/non-Preview retain legacy token. Existing shared Redis client, XP business logic, namespace, epoch and lifecycle fences unchanged. Scope reaches all functions importing this store in newly built Previews, not just Poker. Existing deployed artifacts are not rebuilt automatically by environment edits; future approved PRs inherit the tuple/secret, but need this adapter in their source lineage. Old branches without the adapter still use the old token: rebuild/rebase required. Production unchanged.

Verification: 73 fundamental tests PASS; syntax228 PASS; CSP55 PASS. No browser UI/APK change. Runtime deploy evidence is recorded below. API1095/CORS, OAuth/authenticated gameplay and physical retest remain separate blockers; no CORS/OAuth/API origin/WS/financial/JOIN/bonus/deletion/merge action.

References: https://docs.netlify.com/build/environment-variables/secrets-controller/ and https://docs.netlify.com/build/environment-variables/get-started/#sensitive-variable-policy . VPS6.5GB free; no install/cleanup.

## First deployment and CI follow-up

Source 0cf891e3312e57b8838d54d13947c57b60506a01, Netlify deploy6adbc14e93a222dd69c857f2 ready PASS. Public build receipt matches SHA/context/PR1141. GET calculate-xp405 (after xpStoreUnavailable guard), profile-me401, poker-progression401, no business writes. Direct Redis PING/epoch PASS; no deployed command-level Redis PING endpoint was added, authenticated Redis-consuming flow NOT TESTED.

Hosted xp-v3-fundamentals exposed an old fixture with deploy-preview origin=null. New origin validation correctly rejects it before the missing-credentials test. Fixture now uses canonical Stage Preview1124 and explicitly clears the new alias while keeping legacy-token variants, so no-fallback denial remains asserted. Re-run required on final SHA. No guard weakened. Existing test copies/cleans its own temporary fixture; run this control on GitHub rather than doing extra VPS fixture writes.

## Final verification

Fixture correction source19b9295f6e2dbbaa9c38c654d95379fcb46392ee: Netlify deploy6adbc1b68f61e653fff00c83 ready, build receipt matches exact source/deploy PASS. Read-only GET calculate-xp405, profile-me401, poker-progression401 PASS. No public Redis-health endpoint exists; direct approved-credential PING/epoch and runtime store-presence guard are the available evidence, not proof of authenticated gameplay.

Hosted xp-v3-fundamentals PASS after fixture correction (18 tests), CI verify/actionlint PASS. Local adapter plus selected fundamentals73 PASS, syntax228/CSP55 PASS. Production fallback/missing legacy token and malformed/missing Preview config covered with synthetic tokens; Production was not deployed or probed. No web or APK source changed. PR1141 remains Draft. No CORS/OAuth/WS/origin change; API1095/CORS still blocks phone integration. Subsequent documentation-only source can reuse runtime evidence per repository policy; Netlify may rebuild automatically on documentation pushes.
