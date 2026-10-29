# PR2 — environment activation handoff (2026-10-29)

> **Current procedure:** the final section “No-deal-key Stage path” supersedes earlier hardening, CHIPS and deal-rotation gates. Global hardening and deal rotation are not PR2 prerequisites. Prior sections are evidence/history, not executable alternatives. Do not restore A or deploy with the shared Production deal key.

## Decision and evidence

**STOP before all mutations**, under OWNER condition 5. Fresh GET-only comparison at 2026-10-29T20:32:06Z confirms required privileged credentials remain unprotected and include post_processing. Protected-secret conversion excludes this scope and is key-wide/irreversible. No partial public-variable changes, secret copying, settings writes, enrollment, build or push performed. Existing Stage signing C is retained, not regenerated or rewritten. Native child acceptance remains OPEN; LEGAL remains OPEN.

Private before-state evidence: /tmp/pr2-effective-contexts-current.json and /tmp/pr2-context-comparison-output.json, mode 0600, contain only context metadata, presence/target classifications and MATCH/DIFFERENT/NOT VERIFIED. No secret values or secret hashes. Before future mutation, preserve a new private snapshot and confidential original values via approved custody; masked API reads are not rollback material. Current publication playkcswh 6ae3785cd7852c1a7f9588b0, allowed branches main only, sensitive policy review. No settings changed.

Definitions: D = deploy-preview, P = branch:feat/1114-profiles-phase-a. Existing parent branch-deploy records are not exact-parent overrides. D covers existing Previews and child #1160 unless an exact-child override takes precedence. No table entry authorizes Production values to change. All contextual operations must use targeted value updates, never replace the whole key/value collection. Preserve existing scopes until separately authorized hardening.

## A — Deploy Preview manifest

| Key | Current effective source / shared with Production? | Target / existing Stage source | Action and Production impact |
|---|---|---|---|
| SUPABASE_URL | D / DIFFERENT, Stage | D, existing | Preserve; no value mutation |
| SUPABASE_STAGE_PROJECT_REF | D / Stage | D, existing | Preserve |
| SUPABASE_ANON_KEY, SUPABASE_ANON_KEY_V2 | D / Stage anon | D, existing | Preserve public keys; no secret conversion of public anon keys |
| SUPABASE_DB_URL | D / DIFFERENT, Stage | D, existing | Preserve value; hardening blocked by section C |
| SUPABASE_SERVICE_ROLE_KEY | D / DIFFERENT, Stage | D, existing | Preserve value; section C first |
| SUPABASE_JWT_SECRET, SUPABASE_JWT_SECRET_V2 | D / DIFFERENT | D, existing Stage JWT | Preserve values; section C first |
| XP_REDIS_VERSION, XP_REDIS_ENV, XP_KEY_NS | D / valid Stage V3 | D, existing | Preserve 3/stage/kcswh:stage:xp:v3 |
| UPSTASH_REDIS_REST_URL | D / MATCH | D, existing shared endpoint | Preserve; approved namespace isolation, no new Redis instance |
| ARCADE_STAGE_REDIS_TOKEN | Protected D / comparison NOT VERIFIED | D, approved Stage V3 | Preserve, no rewrite |
| UPSTASH_REDIS_REST_TOKEN | D / DIFFERENT | D | Preserve legacy record; recognized Netlify Stage must use protected alias, never fallback |
| WS_AUTH_HS256_SECRET | Protected D / masked; accepted C evidence | D, C | **No change**; C already works |
| POKER_WS_PREVIEW_URL, POKER_WS_INTERNAL_BASE_URL | D / Stage | D, existing | Preserve |
| POKER_WS_INTERNAL_TOKEN | D / DIFFERENT; accepted Stage MATCH | D, existing | Preserve value, no rotation; section C first |
| ADMIN_USER_IDS | D / DIFFERENT | D, approved Stage IDs | Preserve; identifiers stay private |
| XP_DAILY_SECRET | D / MATCH | D, isolated Stage source not yet established | BLOCKED: do not copy shared Production value or invent credential. Confirm existing approved distinct Stage source; otherwise separate generation GO required |
| XP_SESSION_SECRET | D missing | D, optional existing distinct Stage XP source | BLOCKED pending source. Prefer existing supported XP_SESSION_SECRET to shared fallback only after all XP signing consumers verified; no silent key reuse |
| CHIPS_ADMIN_SECRET | D / MATCH | D, approved isolated Stage source or disabled admin route | BLOCKED until source/explicit disabling choice approved; cannot silently break existing Stage Admin |
| POKER_SWEEP_SECRET | D / MATCH, no active consumer found | D explicit empty | Proposed disable unused credential, after approved consumer confirmation; no Production value/scope change |
| POKER_DEAL_SECRET | D / MATCH | D, isolated approved source or proved-unused path disabled | BLOCKED: do not invent/rotate WS deal key or silently remove legacy functionality |
| WS_MINT_ADMIN_SECRET | D missing | D absent | Keep bypass unavailable |
| XP_CORS_ALLOW | Exact child branch override, DIFFERENT | Existing exact child and D records | Preserve all origins/records. Code PR2 adds localhost for immutable Stage identity; no UI CORS mutation |
| PUBLIC_PROFILES_ENABLED, existing public XP/session/bot settings | D values and build TOML | D unchanged | Preserve accepted behavior; no Continuous Tables activation |
| ACCOUNT_DELETION_ENABLED / tracking flags and marker | D missing / marker empty | D unchanged | Preserve current OFF/defaults and history; no activation |
| POKER_WS_URL | D missing | D absent | Do not copy Production URL |

Do not modify all Previews merely to resolve one child if sources/consumers are uncertain. Any D change affects future builds of all Previews, not immutable already deployed Functions. Explicit child overrides must be inventoried and rechecked; they can shadow D. No build is authorized now. Existing published functions remain unchanged until redeploy, so configuration alone is not live acceptance.

## B — exact parent branch manifest

Each target is P, not global branch-deploy. Production values and other branch records must remain byte-for-byte unchanged.

| Key | Current parent source / shared with Production? | Existing Stage source | Required targeted operation / Production effect |
|---|---|---|---|
| SUPABASE_URL, SUPABASE_STAGE_PROJECT_REF | Missing | D Stage | Add P public values; none |
| SUPABASE_ANON_KEY, SUPABASE_ANON_KEY_V2 | Missing | D Stage anon | Add P existing public credentials; none |
| SUPABASE_DB_URL, SUPABASE_SERVICE_ROLE_KEY | Missing | D approved Stage | Add P only **after C hardening**; no Production value change |
| SUPABASE_JWT_SECRET, SUPABASE_JWT_SECRET_V2 | branch-deploy / MATCH | D approved Stage | Add P overriding unsafe branch-deploy; after C; preserve other branches |
| XP_REDIS_VERSION, XP_REDIS_ENV | Missing | D 3/stage | Add P |
| XP_KEY_NS | branch-deploy / legacy namespace | D Stage V3 | Add P kcswh:stage:xp:v3 |
| UPSTASH_REDIS_REST_URL | branch-deploy / MATCH | Existing approved endpoint | Preserve |
| ARCADE_STAGE_REDIS_TOKEN | Missing | Approved protected Stage V3 custody, not masked GET | Add protected P value; no metadata change; STOP if authoritative value unavailable |
| UPSTASH_REDIS_REST_TOKEN | branch-deploy / DIFFERENT | Not needed | Preserve; no fallback allowed |
| WS_AUTH_HS256_SECRET | Protected branch-deploy / C not assigned | Existing root-only C custody | Add protected P C only, do not alter D C, Production or key metadata; STOP without authorized custody |
| POKER_WS_PREVIEW_URL, POKER_WS_INTERNAL_BASE_URL | Missing | D Stage | Add P public Stage targets |
| POKER_WS_INTERNAL_TOKEN | Missing | Existing approved Stage token | Add P unchanged token after C; no rotation |
| ADMIN_USER_IDS | branch-deploy / MATCH | D approved Stage identities | Add P approved Stage IDs; no Production change |
| XP_DAILY_SECRET, XP_SESSION_SECRET | branch-deploy MATCH / missing | Same unresolved Stage XP source as A | BLOCKED; no Production fallback |
| CHIPS_ADMIN_SECRET, POKER_SWEEP_SECRET, POKER_DEAL_SECRET | branch-deploy / MATCH | Same decisions/sources as A | BLOCKED; exact P overrides only after approved source/disable decision |
| WS_MINT_ADMIN_SECRET, POKER_WS_URL | Missing | Not needed | Keep absent; no Production bypass/WS URL copy |
| XP_CORS_ALLOW | Existing P / DIFFERENT | Already configured | No change |
| PUBLIC_PROFILES_ENABLED, AUTH_GOOGLE_ENABLED | Missing parent build flags | Reviewed D behavior/build TOML | Mirror only required public flags into P, preserving profile/OAuth behavior; no provider change |
| XP_REQUIRE_SERVER_SESSION, XP_SERVER_SESSION_WARN_MODE | Missing parent API values | Reviewed existing Stage policy | No guessed values; verify code/TOML effective defaults before any public flag copy |
| ACCOUNT_DELETION flags/marker and bot/session limits | Missing or existing branch-deploy | Accepted current defaults/settings | Preserve; do not activate deletion or Continuous Tables |

No SUPABASE_URL_V2 key currently exists; do not create an unnecessary alternate source.

## C — global metadata changes: separate GO required, not authorized

All following keys currently have is_secret=false and scopes Builds/Functions/Post processing/Runtime:

- SUPABASE_DB_URL
- SUPABASE_SERVICE_ROLE_KEY
- SUPABASE_JWT_SECRET
- SUPABASE_JWT_SECRET_V2
- POKER_WS_INTERNAL_TOKEN
- XP_SESSION_SECRET
- XP_DAILY_SECRET
- CHIPS_ADMIN_SECRET
- POKER_DEAL_SECRET
- POKER_SWEEP_SECRET
- WS_MINT_ADMIN_SECRET
- UPSTASH_REDIS_REST_TOKEN

These are the exact sensitive-key hardening inventory, not authorization to retain unused secrets. For retained keys, proposed is_secret=true is irreversible and applies to every context, including Production. Secret keys cannot retain post_processing; the proposed allowed set is Builds/Functions/Runtime. This removes access from Production post-processing and changes masking/secret-scanning behavior in future builds. It is therefore **not a verified zero-impact Production metadata change**, even when Production values stay unchanged. Before a separate GO, verify no post-processing consumer and preserve all contextual values through authorized custody; never PUT masked values. Do not weaken policy or scanning to make builds pass. For unused keys, separately decide whether disabling Stage values suffices without global conversion.

Already protected WS_AUTH_HS256_SECRET and ARCADE_STAGE_REDIS_TOKEN need no metadata change. Public anon keys, URLs, namespaces and administrator identity lists are not included in secret conversion. Existing main / sensitive-variable policy / all other scopes remain untouched in this task.

Required future GO must explicitly authorize the retained key list, irreversible secret conversion, removal of post_processing per key after consumer verification, protected preservation of Production values and Stage-only overrides. If preservation is impossible, STOP. No new secret generation is implied; unresolved Stage operational sources remain blocked.

## Activation order / acceptance / recovery

1. Resolve protected storage and Stage operational credential sources; authorize C separately. Capture fresh private before-state, use targeted updates, independently verify contextual record sets, Production equality, metadata and source identity. Never log values. Any inherited Production credential or uncertainty means STOP.
2. Apply only reviewed D/P deltas with no build/enrollment. Re-read effective parent and exact-child values; masked equality requires approved custody/build-time verification, not a synthetic MATCH.
3. Separate code propagation GO: existing PR2 into parent (retain profile-terms.mjs in Docker conflict), then parent enrollment only after compatible code/config. Require native parent branch-deploy READY with exact SHA/alias/Stage receipt.
4. Propagate updated parent into child and observe natural native #1160 Deploy Preview. Require own exact SHA/review_id, Stage Supabase/Redis V3/C and unchanged internal token; localhost OPTIONS allowed, foreign origin rejected, Production CORS unchanged. Nonfinancial auth/API/WS smoke only. No tables/JOIN/financial mutations.
5. Parent/child SHA changes can update Preview aliases and trigger hosted debug APK; APK API currently pins #1155, not proof of #1160 integration. PR3 owns binding. Runtime-affecting code needs the existing exact-SHA WS Preview gate before full integration acceptance; no WS rollout authorized by this manifest. DB apply stays explicit trusted-main dispatch, no automatic Draft/Ready apply.

Recovery: before enrollment restore only changed approved Stage records from confidential custody, never A. Global secret conversion cannot be reversed. Do not rebuild old contexts from masked reads. Existing immutable deployments remain separately accessible; restoring config does not rewrite them. Stop on drift/unknown source/unsupported scope/Production change. No financial or schema rollback. Future main merge still classifies deploy_ws=true and requires separately approved no-Production-release procedure.

Documentation-only update: no JS/CSS/inline changes, no CSP/SRI changes or new tests. Fundamental check is manifest/read-only evidence consistency and diff whitespace validation; native acceptance remains NOT TESTED.

## Limited five-key hardening GO — read-only execution gate

OWNER authorized only SUPABASE_DB_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET, SUPABASE_JWT_SECRET_V2 and POKER_WS_INTERNAL_TOKEN for irreversible protection and removal of post_processing, conditional on verified support/preservation. **No mutations executed.** This is a new authorization; the earlier blanket metadata NO-GO above is superseded only for these five keys, subject to this gate.

Fresh site/env/accounts/snippets GETs: caller role Owner; five keys still is_secret=false, scopes Builds/Functions/Post processing/Runtime, contextual value counts respectively 5/5/7/7/5. Snippet inventory is empty; site processing settings show pretty URLs and ignore HTML forms, with no credential-consuming post-processing configuration found in the reviewed repository. Publication remains 6ae3785cd7852c1a7f9588b0. Stage C unchanged. An unsupported membership-list URL returned 404; Owner access was independently confirmed through the supported accounts listing, not inferred from that error.

Private custody of actual unmasked originals for every context of all five keys was created outside the repository, directory 0700 and file 0600. No values/hashes are in this report. Custody is readable original data, not masked reconstruction. No new credential was generated. Keep the exact path in private operator records only.

**BLOCKED support gate:** current account capabilities report env_var_secrets.included=true but env_var_scopes.included=false. Official updateEnvVar schema describes scopes as Pro-and-above, and describes PUT as replacement of all contextual values. setEnvVarValue PATCH changes individual values, not key-wide scopes/is_secret. Existing protected keys with Builds/Functions/Runtime demonstrate a resulting configuration, but do not prove the supported transition for these existing unprotected keys on this account. Do not use an irreversible write as a capability probe, omit values on an undocumented preservation assumption, or reconstruct any masked values. Required next evidence is a supported account-specific operation (Netlify UI/API/provider confirmation) that removes only post_processing while preserving Builds/Functions/Runtime and every contextual original on this Personal account. No plan upgrade, weakened protection, global key replacement trial or new framework is authorized.

Secrets Controller is already active for signing C and the Stage Redis alias. No site-level SECRETS_SCAN overrides were returned. Protecting the five additional keys expands explicit-value scanning on subsequent builds; default scanning covers repo/build output and can fail a future Production build if a secret is embedded. No build was authorized or run, so future build success is NOT TESTED. Do not disable/omit scanning to make it pass. Marking secret is irreversible and makes non-dev values unreadable via API; pre-change custody is mandatory. Current published Functions are not rebuilt by this preflight.

Operational isolation remains unchanged: no confirmed isolated sources for XP_DAILY_SECRET and CHIPS_ADMIN_SECRET; do not introduce XP_SESSION_SECRET unnecessarily. POKER_SWEEP_SECRET has no active reference found, but was not disabled. POKER_DEAL_SECRET remains unchanged pending historical compatibility; WS_MINT_ADMIN_SECRET stays absent in Stage. Protected Redis alias and C preserved. No conversion of the other seven keys, settings edits, enrollment, pushes, builds, WS or DB operations occurred.

Acceptance order remains protection/support gate → existing approved Stage credentials and reviewed operational isolation → compatible parent code → parent enrollment/READY → child synchronization/own READY Preview → exact-SHA Stage/CORS/nonfinancial auth/API/WS acceptance. Any supported write must re-read fresh originals, verify complete contextual sets and metadata after each single key, and STOP on uncertain result without retry.

Sources: [Secrets Controller policy/scanning](https://docs.netlify.com/build/environment-variables/secrets-controller/), [official API schema](https://github.com/netlify/open-api/blob/master/swagger.yml). Documentation-only diff; whitespace check PASS, no runtime test rerun. LEGAL OPEN.

## Current OWNER activation GO — overrides earlier hardening gate

Global is_secret/scopes hardening is explicitly removed as a PR2 prerequisite. The previous Personal-plan metadata-support gate is historical, not the reason for the current STOP. Existing metadata/scopes must remain unchanged. OWNER authorizes minimal native activation only when Stage configuration does not expose disallowed Production credentials; generating credentials or changing functionality still requires a precise additional approval.

Fresh targeted verification: #1163 Draft 24f0766a3ade7f64008557c7dc3d68373a4a7ec5; #1155 Draft 810a77b1ed7a341f95eb2f9ce2c1099543a6c9bb; #1160 Draft 30e9711684c14cc004f7c8fb51711b945f424a07 with unchanged parent base. For XP_DAILY_SECRET and CHIPS_ADMIN_SECRET, every available configured context (including dev, branch-deploy, deploy-preview and the existing unrelated branch override) MATCHES Production. XP_SESSION_SECRET exists only for Production and is not an alternate Stage source. No approved distinct Stage credential has been identified. Do not reuse Production, signing C, internal or Redis keys. Two independently generated Stage-only values for the existing XP_DAILY_SECRET and CHIPS_ADMIN_SECRET keys, applied only to D and P, require additional OWNER authorization; no new XP_SESSION_SECRET is needed. New XP signing invalidates old Stage XP sessions, not Production sessions. A distinct chips admin value restricts existing privileged Stage callers until their approved configuration matches; no financial tests or admin route activation is implied. Disabling these features is a behavioral change and is not silently substituted.

POKER_DEAL_SECRET remains shared and unchanged. Correction to the earlier Functions-only reference finding: on exact parent SHA, shared/poker-domain/leave.mjs imports the deterministic helper and derives community/deck in maybeBuildPrivateStateForBotAutoplay (with failure handling). WS table snapshot also uses its own helper. Consequently an empty override cannot be called compatibility-preserving merely because standalone replay/start helpers lack direct public imports. No key rotation/removal or code changes made. Building with the existing D/P inheritance would expose the Production value to that build; therefore no build or enrollment can proceed under this GO. A separately approved narrowly scoped exclusion/disable of the affected legacy Stage path would need a fundamental compatibility test before removing the Stage credential; preserving required historic derivation needs its existing key and cannot be promised with a fresh random replacement. No Stage data was read or changed to manufacture compatibility evidence.

POKER_SWEEP_SECRET remains unchanged; no new administrative path enabled. WS_MINT_ADMIN_SECRET remains absent in Stage. C and protected Redis alias remain unchanged. No partial context mutations were performed because they would not satisfy the pre-enrollment isolation gate. No pushes, builds, enrollment, WS restart, DB change or Production write. Deployment IDs and installed runtime remain the previously accepted ones, not new PR2 acceptance.

Next decision must resolve (1) generation/custody and D/P assignment of the two independent Stage operational values, and (2) the conflict between preserving historical deal functionality and preventing Production deal-key injection into a new build. Current result is STOP before configuration/publication, not a claim that hardening is required. After resolution follow the existing parent → child native activation sequence and exact-SHA WS Preview gate; no temporary PR or PR3 work.

## Stage XP/CHIPS preparation — executed scoped GO

Two independent Stage-only values were generated with crypto.randomBytes(48) and kept outside the repository in private custody (directory 0700, files 0600). Distinctness from each other and all configured values of their corresponding keys was checked in memory; no values/hashes logged. The private result journal records the two XP PATCH requests and their response/request identifiers; it contains no claim of a build.

**XP PASS (configuration):** existing XP_DAILY_SECRET received targeted setEnvVarValue PATCH for deploy-preview and branch:feat/1114-profiles-phase-a only. After each operation a fresh GET verified target value equality in memory, unchanged Production and other-context values, unchanged is_secret/scopes, and unchanged records for every other env key. No exact-child XP_DAILY override or effective Stage XP_SESSION_SECRET was present to shadow the intended source. Final site read verified publication, branch enrollment and sensitive-variable policy unchanged. Metadata stays as authorized; global hardening was not performed. Current immutable deployed Functions still use their original build-time configuration. New XP signing takes effect only after a separately authorized build, so mixed old/new deployments can reject one another's XP cookies; old immutable endpoints are not rewritten.

Session renewal: resolveXpSessionSecret selects XP_DAILY_SECRET when Stage XP_SESSION_SECRET is absent; start-session validates configuration and issues a new token. xpClient.js handles invalid_session/requiresNewSession by a bounded renewal and resubmission. Existing xp-client-contract.test.mjs PASS, including its existing mocked client contracts; direct synthetic helper check PASS for old-key rejection and new-key acceptance, without Redis/API writes. Hosted renewal/live award remains NOT TESTED (builds and XP writes not authorized). The Vitest session-token suite could not start because its executable is unavailable; no dependency installation or fake PASS. No runtime files changed.

**CHIPS STOP before assignment:** new independent value generated and preserved, but CHIPS_ADMIN_SECRET on Netlify remains unchanged in every context. Exact #1155 repository scan finds the consumer in chips-tx.mjs: privileged entries and BUY_IN paths require x-chips-admin-secret. No built-in producer of that header was found outside tests; this does not prove absence of external/operator Stage clients. No authoritative external-client inventory/coordination was available. Need operator confirmation of no active dependent integration, or a named approved caller's secure configuration update coordinated with the next Stage Functions build. Do not distribute the value in reports, silently disable the function, perform financial verification, or rotate Production. Generation itself does not activate a new administrative path.

### Deal key — targeted findings and single recommended handoff

Exact parent 810a77b and installed WS a87e06c were inspected; no broader retirement/financial audit repeated.

- shared/poker-domain/leave.mjs::maybeBuildPrivateStateForBotAutoplay derives remaining deck/community from handSeed, seat order and the key. Derivation errors return derive_failed and skip post-leave bot autoplay; a *different nonempty key can derive different cards without raising an error*. Therefore successful helper execution alone is not recovery compatibility evidence.
- netlify/functions/_shared/poker-replay.mjs::replayFromLogs reconstructs private deck/community using the current key, without historical key/version selection. No active importer outside that standalone helper was found in the reviewed parent, but its existence is not permission to lose historical replay.
- ws-server/poker/table/table-snapshot.mjs::applyDerivedCards uses the WS snapshot-runtime helper and catches missing-key errors by returning existing state. Setting a new nonempty key changes that behavior: it can overwrite derived card fields using another deck. An absence of startup POKER_DEAL_SECRET is not evidence that populating it is harmless.

**Recommendation: separate coordinated Stage deal-key cutover, not a Netlify-only override.** Before approving execution, prove on existing synthetic persisted-state/replay/snapshot tests that the intended Stage deal-key configuration does not replace authoritative persisted current-runtime cards. If that fails, STOP and propose the smallest snapshot/recovery code change separately; do not install a key merely to satisfy env isolation.

Operational sequence after that compatibility gate and separate GO: fresh no-work Stage check (Continuous Tables remain disabled, zero OPEN/recoverable hands/human claims/pending, terminal escrow); preserve original configuration and relevant persisted-state evidence; retain the old derivation key only in restricted operator custody for controlled historical reconstruction, never inject the Production-shared old key into a new Stage build. Generate a distinct Stage deal key only with explicit GO, and coordinate the selected compatible Netlify/WS configuration in one supervised window, verifying new deck/snapshot/recovery fundamentally before use. Preserve source versions and old-key provenance for operator-only historic replay; normal deployed old-history re-derivation is **not** guaranteed by this code because it has no key version selector. If online historical replay under both keys is mandatory, a rotation-only procedure is insufficient and needs separately approved minimal key-version/materialized-state handling. Do not conceal that limitation as PASS. No deletion, historical rewrite, dual-key framework or automatic financial repair is proposed here.

No deal key, runtime, C, Redis, enrollment, parent/child SHA, build, WS service, DB or Production setting changed. Current result: XP configuration PASS; CHIPS prepared but switch STOP; deal cutover remains separately gated. Native #1160 acceptance OPEN, LEGAL OPEN. Documentation diff check PASS.

## Latest bounded activation GO — CHIPS completed, deal compatibility STOP

This section supersedes the earlier CHIPS consumer-approval STOP. OWNER accepts that unidentified external Stage administrators may need reconfiguration. Repository search on exact parent SHA found CHIPS_ADMIN_SECRET/x-chips-admin-secret only in chips-tx.mjs outside tests; no built-in client producer identified. Available WS Stage journal yielded zero readable entries, which is NOT evidence of absent usage; Netlify function-log usage was not established by this check. No additional integration requiring coordinated migration was identified in available evidence. The explicit OWNER acceptance covers the remaining external-client uncertainty.

**CHIPS configuration PASS:** reused the previously generated independent Stage value. Targeted official setEnvVarValue PATCH assigned it only to deploy-preview and branch:feat/1114-profiles-phase-a. Each post-write GET checked values in memory, complete context set, unchanged Production/other contexts, unchanged scopes/is_secret and all other environment-variable records. Site publication, enrolled branches and review policy unchanged. Old immutable Functions still use old settings until a build. No financial endpoint invoked. Existing Stage admins must obtain the new value via authorized custody if needed; never distribute via report. XP remains independently assigned as recorded above.

A new independent POKER_DEAL_SECRET candidate was generated in the same protected private custody (0700/0600), **not assigned anywhere**. Production-shared old deal value, C, Redis and WS configuration remain unchanged.

**Deterministic compatibility gate FAIL — rotation/enrollment STOP.** Tested actual installed /opt/arcade-ws-preview WS loadSnapshotInTx and deterministic helper, plus repository Netlify replay/helper, with synthetic old/new keys and a persisted-state-shaped SELECT-only fixture. SUPABASE_DB_URL was explicitly empty; no database/network access. The fixture retained a historical handSeed, three persisted community cards, version401, stacks95/105 and HAND_DONE phase. Under the old key, the loader and replay were captured; under a different key both still returned successfully, but community cards/reconstructed deck changed. Assertions proved input, stacks and version unchanged and NF/WS derivation agreeing under the same new key. This is an actual silent card-projection regression on the existing code path, not a live Stage historical-data inventory or proof that every historical row is affected. It fails the required compatibility gate before any deal-key assignment. No no-work/escrow database claim was refreshed because the rotation was stopped before that operational gate and no restart was attempted.

The three requested paths are accounted for: shared leave bot autoplay derives private cards using the current key; historical replay reconstructs from seed/current key; WS applyDerivedCards overwrites projected cards when a key is present and only falls back on a thrown error. A new nonempty key does not throw. Existing deployed WS starts without a deal key according to accepted root diagnostics; adding one therefore changes successful derivation behavior, not merely secret custody.

**One minimal repair proposal, not implemented:** make snapshot/history recovery preserve verified materialized card state and prevent current-key re-derivation of historical seeds without matching key provenance. Where complete private state is missing, fail closed for the affected historical derivation rather than synthesize different cards. Add only a fundamental old-snapshot/new-key regression in the existing snapshot/replay tests and equivalent leave recovery coverage. No epoch/key field currently identifies old versus new hands, so supporting seed-only historical replay with two keys would require an explicitly approved provenance mechanism; do not silently introduce dual-key or inject the old Production-shared key into a new build. Review actual required historical replay before selecting the exact smallest implementation. Only after this gate passes should a fresh no-work/terminal escrow check and coordinated Netlify/WS Stage key configuration proceed. No blanket history rewrite, deletion, DB migration or financial repair authorized.

HEADs remain #1163 24f0766a3ade7f64008557c7dc3d68373a4a7ec5, #1155 810a77b1ed7a341f95eb2f9ce2c1099543a6c9bb, #1160 30e9711684c14cc004f7c8fb51711b945f424a07, all Draft; parent base unchanged. WS Preview remains release a87e06c4335e7c8170d523b4f8d9497c4372c3cc, PID591020, start2026-10-29T19:56:07UTC, active. No new deployment IDs, enrollment, push, build/APK or exact-SHA rollout. No Production write, global metadata change, DB write, Terms/Continuous Tables activation. Native stacked Preview is still NOT TESTED, not PASS. LEGAL OPEN.

## No-deal-key Stage path — current execution state

OWNER explicitly selected no deal rotation. The generated candidate stays unused in private custody; WS Preview remains without a deal key. Earlier deal-rotation recommendation is superseded; historical key-change recovery remains a separate technical task, not a reason to introduce the key now.

**Empty override PASS:** installed Netlify CLI getValueForContext and formatEnvelopeData were exercised with synthetic Production/branch defaults and empty D/P contextual values. They select and preserve the empty string, not the nonempty fallback. Official env API accepts string values without a minimum length; official context precedence is independently documented. Two targeted POKER_DEAL_SECRET PATCH operations set value="" only for deploy-preview and exact parent. Fresh reads confirmed both explicit empty records, no exact-child override, preserved Production/other values and all metadata. This proves configuration/resolver behavior; hosted environment delivery still requires build verification, and is not marked complete from local evidence. The build guard provides fail-closed protection if unexpected nonempty material arrives.

**Minimal code/test PASS:** scripts/generate-build-info.js::validateStageNetlifyConfig rejects truthy/nonempty POKER_DEAL_SECRET for recognized Stage Netlify builds, with the existing generic sanitized error. Production and WS artifact generation are not subjected to this Stage Netlify check. The existing generator test first failed on missing rejection, then passed for parent and Deploy Preview rejection plus empty acceptance. The existing WS snapshot test verifies missing-key projection retains the persisted community/stacks/version and seed-only replay throws deal_secret_missing. Combined targeted suites: 20 PASS, 0 SKIPPED; node syntax and diff whitespace PASS. No gameplay/runtime snapshot/replay implementation changed. This is not a claim that incomplete historical replay now works: it fails, as required.

**Executed Stage configuration:** copied 16 approved D Stage values to exact parent: Supabase URL/DB/anon/V2/service/JWT/V2/project ref, Redis V3 environment/version/namespace, WS Preview URL/internal base/internal token, Stage admin identities and public-profile flag. JWT/DB/project and key-role targets were checked before writes. PUBLIC_PROFILES_ENABLED was subsequently set to the reviewed Stage build value 1. AUTH_GOOGLE_ENABLED was a missing public key, so a new exact-parent-only value 1 was added to preserve existing Stage OAuth UI; no provider change and no Production contextual value. POKER_SWEEP_SECRET has no actual source consumer in parent Netlify/shared/WS/JS/scripts search; explicit empty D/P overrides disable this unused Stage credential. Every targeted write was followed by a fresh context/value/metadata comparison in memory, preserving Production and unrelated records. No existing key metadata/scopes changed. Existing D/C signing, Redis alias, independent XP/CHIPS values and all accepted profile/Terms data retained. No enrollment/build/push occurred.

**Only remaining configuration access gate:** parent WS_AUTH_HS256_SECRET has no exact C override and ARCADE_STAGE_REDIS_TOKEN remains missing. Both D records are protected and cannot be sourced from masked GETs. C custody and effective Stage Redis source are root-only; copilot has no authorized file-reading sudo. Do not guess, substitute a token or use old branch signing fallback. One-time helper /tmp/arcade-pr2-parent-protected-env.py is prepared for the existing root administrator, not executed. It verifies root-only C custody against effective Stage process, Stage V3 namespace, token isolation from Production, stable services, immutable release, D/P empty deal/sweep and exact parent internal token consistency; then only adds the two protected exact-parent values using targeted PATCH, preserving other contexts and metadata. It does not enroll, build, stop/restart services, rotate or change Production. It stops without retry on any uncertainty. Non-dev values remain masked, so parent build/mint auth remains required proof of delivered value.

Helper SHA-256: 004f05117f19ef774dec7dd25712cc05af5f948bbe50c1c7392155436474a83f. AST syntax verified only, not an execution PASS. Administrator must install into root-owned 0700 directory, root:root0600 script, verify exact SHA and execute from that directory; never execute the /tmp source directly as root. Private root result journal records partial requests for reconciliation; no automatic retry. This is execution of the already authorized Stage-only copy, not a request to expand privileges or rotate keys.

After administrator copy: fresh read-only context verification → resolve/propagate PR2 to parent preserving profile-terms.mjs → only exact-parent enrollment → exact-SHA READY parent → child synchronization → own exact-SHA/review1160 READY Preview → Stage/C/Redis, CORS and nonfinancial auth/API/XP renewal acceptance. No source push/enrollment while the two protected values are unassigned. Exact-SHA WS Preview runtime gate remains separately required for the shared dependency changes; current instruction keeps WS unchanged, so green Netlify alone cannot be full runtime PASS.

Latest readback: Production publication 6ae3785cd7852c1a7f9588b0, allowed branches [main], review policy retained. WS Preview PID591020/start2026-10-29T19:56:07UTC unchanged. Existing SHA/deploy evidence unchanged; no new deployment IDs. No DB mutation, funded action, Terms, Continuous Tables, main merge, Production publication or APK publication.

### Administrator parent copy STOP — diagnostic only, no retry

OWNER ran the checksum-pinned root copy helper and received PRECONDITION_FAILED before its COPY confirmation. Fresh Netlify GET reconciliation confirms exact-parent count remains zero for both WS_AUTH_HS256_SECRET and ARCADE_STAGE_REDIS_TOKEN; no copy mutation occurred. WS Preview is still active PID591020. The old helper's generic require() error is insufficient to identify the failed precondition. No failed predicate is claimed as established from this output.

Do not rerun the mutation helper. A replacement **read-only diagnostic**, /tmp/arcade-pr2-parent-protected-env-diagnostic.py, prints named PASS/FAIL checks and PRESENT/ABSENT/MATCH/DIFFERENT/NOT VERIFIED only, never values, hashes of secrets, UUIDs or raw stderr. It follows the original helper's exact process/env/custody/Netlify read gates, identifies each Redis variable separately and separately labels the original helper's assumed Redis token-difference condition. MATCH there must be investigated against approved Redis custody; it is not permission to weaken the gate or blindly copy a token. Process startup env and generated metadata are distinct sources; absence must not be turned into a passing inference. This diagnostic contains GET only, no configuration writes, prompt, build, DB access or service action; failure exits2. It verifies process identity stability again at completion.

Install/run from root-only 0700 directory with root:root0600 file and exact checksum, never execute /tmp as root. Diagnostic SHA256 4534d1639da6ddfc10de2a017fef755568ee90f4000e9fe82d11d0fb398a9396. AST and synthetic MATCH/DIFFERENT/missing classification tests PASS; no root execution claimed. No mutation retry is included. After operator output, correct only the established source/compatibility error; do not introduce additional broad preflights.

### Root diagnostic resolved — approved Redis source model

OWNER's read-only diagnostic establishes every original gate PASS except token inequality: effective WS Preview and Production Redis tokens MATCH. No parent copy occurred. Signing C is DIFFERENT from Production and matches root custody; V3 Stage tuple/internal/endpoint/process stability pass. No mutation or runtime retry was executed.

Existing approved evidence in specs/1139-android-poker-m0/redis-adapter-go.md identifies deploy-preview-1124 and feat/1117-account-deletion-v2 as the agreeing sources used to create ARCADE_STAGE_REDIS_TOKEN. Current read-only API comparison confirms those source records agree with Production, while their effective Redis tuple remains 3/stage/kcswh:stage:xp:v3. The prior approved model explicitly uses shared physical Redis and warns that namespace guards do not isolate authorization. Therefore the copy helper's mandatory token DIFFERENT condition was an incorrect new prerequisite, not evidence of a newly introduced configuration drift. Do not call this token-ACL isolation or copy an arbitrary Production-context value.

The helper is corrected to require the effective Stage token and endpoint to match **both named approved Stage sources** plus both effective Stage V3 tuples. Masked/ambiguous source, token mismatch, endpoint mismatch or wrong namespace all fail closed. C's Production inequality remains mandatory. Original protected flags, exact-parent absence, internal token, publication, enrollment/policy and no-other-context-change checks remain. No value is sourced from a Production env record; this preserves the previously approved shared-credential model and its trust limitation. Unknown/unreviewed builds must never be approved to receive these credentials.

Current helper /tmp/arcade-pr2-parent-protected-env.py SHA256 **5640144df7174c812a95237aaac559cb374110202d49f89f3e9f3bad16a316b1** supersedes earlier checksum/instruction. It has not been executed by the agent. Administrator installs a fresh root-only copy and confirms the already authorized two-value parent-only copy; no Netlify build, enrollment, service action or Redis/DB write. Root-only result journal remains for uncertain-write reconciliation; no automatic retry. Tests execute the actual extracted source-validation functions with synthetic records: approved shared token passes, altered token/Production namespace/masked source reject. AST syntax and diff whitespace PASS. No credential, scopes, policy, C, runtime or Production mutation during this diagnosis.

### Protected-copy reconciliation — actual partial write confirmed

The second root helper attempt added exact-parent WS_AUTH_HS256_SECRET, then stopped before Redis. Independent GET: signing parent count1, Redis parent count0, Production publication unchanged, parent not enrolled. Comparing signing contextual records against earlier private before-state shows every original contextual record unchanged; only the expected new parent record and key updated_at differ.

Root cause reproduced by two fresh GETs: keyOrderStable=false, allRecordsByKeyStable=true, signingValueOrderStable=true. The old helper compared unrelated env records as an ordered list, falsely treating response reordering as drift. This was a verification bug, not evidence that a protected value failed to write. Do not rerun signing or the entire copy helper. Protected plaintext delivery still requires build/auth proof; API masking is not value equality evidence.

Completed the remaining Redis-only parent PATCH from both approved #1139 Stage source records, after tuple/endpoint provenance validation and confirming C parent exists. Canonical verification matches records by key and contextual identity; all old alias contexts, Production records, scopes/protection and site settings unchanged. Both parent protected records now exist. No signing rewrite, no root retry, no enrollment/build/restart by this reconciliation. Future checks must compare maps/sets rather than API array order. Proceed with the already authorized parent/child code/enrollment sequence, retaining build-time and auth acceptance gates.

## Parent enrollment executed — native branch acceptance pending

Approved Stage configuration completed; exact parent has C (root PATCH, no rewrite) and protected Redis alias (remaining targeted PATCH from approved sources). Owner root-copy failure was the ordered-array verifier bug, not failed credential installation. Production and all unrelated contexts remain unchanged; protected plaintext delivery is still tested by mint/WS after build.

PR2 source guard/test revision 355bee07aa27c593d1b40f93ed946e2f873b98df was propagated into parent, preserving profile-terms.mjs in the only Docker conflict. Parent code SHA f1c795df618d0bfacd893c4a3f900d6a11c6132c. No Phase A SQL, account UI, Android pin or Terms implementation changes in propagation. PR1's trusted-main dispatch-only Stage workflow comes with the accepted main ancestry; no automatic Stage apply introduced.

Netlify parent enrollment PATCH succeeded once: allowed_branches now [main, feat/1114-profiles-phase-a]. Initial post-write checker incorrectly included build_settings.updated_at in behavior equality; independent read-only reconciliation established only allowed_branches and its expected audit timestamp changed. No retry or second settings write. Production publication stays 6ae3785cd7852c1a7f9588b0; main/policy/build settings otherwise unchanged.

Netlify READY #1155 deploy 6ae3c5e1e71d9fdff2dbbf1c at exact parent code SHA f1c795df618d0bfacd893c4a3f900d6a11c6132c, context deploy-preview/review1155; #1163 deploy6ae3c5b5bd7546ecc7e95a08 READY at355bee07. Neither is substituted for native branch acceptance. Enrollment alone did not create the branch build on readback. This substantive operational evidence update is published normally on the enrolled parent; no empty commit/manual build API/temporary PR/retarget/reopen. Native branch exact-source/Stage receipt/CORS/auth checks and then child synchronization remain required. No WS restart or financial/DB mutation; runtime integration gate still pending.

Parent-local fundamentals: 53 PASS, one disposable-PostgreSQL integration SKIPPED because no explicit isolated PostgreSQL test URL was supplied. No real Stage/Production DB substituted. Targeted generator/token/CORS/WS-client/snapshot tests passed; syntax and diff checks passed.

### Native parent receipt and compatibility flag correction

Native branch deploy6ae3c65324bf5d74ae1e17ed READY at source20b2ffb3584be09cf33b0274ada3bf26ac46adc8, expected parent alias, honest branch-deploy identity and Stage V3/project receipt. Initial HTTP smoke stopped before login because balance/progression OPTIONS returned404; seven other localhost preflights passed and foreign origins were denied. Read-only response/source inspection established the cause: parent lacked CHIPS_ENABLED and these two existing handlers return404 before CORS when disabled. This was not a CORS bypass or missing deployed function.

Targeted parent-only CHIPS_ENABLED=1 now mirrors existing deploy-preview value1. Original Production and other contexts, every other env key and metadata unchanged. This restores the existing Stage surface, does not invoke financial operations or activate new administrative code. Publish this concrete configuration/acceptance evidence normally to rebuild the enrolled parent with the corrected context; no empty commit, manual Retry or build API workaround. Full parent smoke and child acceptance remain pending the corrected native build.

### Parent authenticated smoke / explicit ranking default parity

Corrected native parent deploy6ae3c74e367f3b3166972aac READY at e5ab1b00ed1ac67e730d2726ca662a06104e1aac. Exact source/context/Stage receipt PASS; nine localhost OPTIONS204 and foreign-origin403 checks PASS; pinned Stage login, owner profile GET200 and onboarding GET200/required=false PASS. Smoke then stopped at ranking because branch-deploy is not covered by leaderboardEnabled's deploy-preview fallback.

Targeted read/source verification: XP_LEADERBOARD_ENABLED has no D/all value, so current Deploy Preview intentionally defaults ON, while parent branch-deploy defaults OFF. Added only exact-parent XP_LEADERBOARD_ENABLED=1 to mirror that existing Stage behavior. All original contextual values and metadata unchanged; no Production activation and no ranking privacy/blocks logic changed. No XP awarded or financial action. Record this real config/HTTP evidence to rebuild normally; subsequent acceptance remains required before child propagation.
