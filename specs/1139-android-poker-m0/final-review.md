# Final independent PR1141 review — 2026-10-24

## Recommendation: NO-GO, one real M0 blocker

Base mainf9137918f54fd285d00dad5c7d91c1120bab6e33, independently confirmed live GitHub main. Reviewed HEAD3d775b7cfc00b6c077c1546735a0c289da012e93. A fresh independent reviewer inspected complete runtime/workflow diff read-only; root independently reproduced finding. No visual/native implementation edits are part of this review.

**P1 — next WS Preview deployment fails while importing Redis store.** Existing .github/workflows/ws-preview-deploy.yml:101 invokes CONTEXT=deploy-preview generate-build-info.js --server-context-only without DEPLOY_PRIME_URL. Generator writes BUILD_DEPLOY_ORIGIN=null. Workflow packages store-upstash.mjs and generated context; ws-server/poker/runtime/account-deletion.mjs:6 imports the store. New selector store-upstash.mjs:14 rejects this actual context with stage_preview_redis_environment_mismatch before server startup. The main implementation used legacy token, so this violates approved WS-preservation contract. Isolated execution of actual selector with synthetic Stage3 config/legacy token and deploy-preview/null origin reproduces exception; no secrets/network/data mutations. Current test calls WS context unknown and expects null-origin Preview rejection, so green CI misses actual workflow shape.

Earlier statements that WS metadata is always unknown were incorrect. ws-server/** and shared/** source/protocol are unchanged, but imported store helper is a deployable runtime dependency and is not behavior-identical for real WS Preview metadata. Currently running older Stage WS is unaffected; owner physical success does not cover a future deployment from PR source.

Minimal follow-up: unambiguously distinguish immutable Netlify Functions build identity from WS build identity; preserve legacy token for real WS Preview and Production, require protected alias/fail-closed for Netlify Stage Previews. Keep existing V3 namespace/environment/epoch and lifecycle guards. Do not solve by accepting an absent alias for Netlify or weakening origin checks indiscriminately. Add/adjust only fundamental test using actual generated WS context. No WS deploy or environment change authorized/needed merely to reproduce this import regression. No fix made in this review-only task.

## Other review areas

No additional concrete M0 blocker found in PKCE/external Browser/exact callback validation, optional API resolver/web fallback, Stage pins/CORS, hosted APK isolation, native lifecycle/insets or packaging. Production selector remains legacy under production context. No migration/WS-server source/protocol/financial rule edits. Stage Redis is physically shared with Production as approved: branch/namespace guards and build-review policy matter; do not treat namespace as credential isolation. Personal secret is protected deploy-preview only, builds/functions/runtime; untrusted_flow=review is still active. Existing approved Stage alias/defaults and branch flags verified read-only. Stable signing/Verified App Links intentionally M1, not blockers introduced here.

Native appearance is owner accepted. Exact857159ca physical fullscreen both orientations PASS; controls/scene are visual PASS only. Remaining transient bars/resume/IME need owner coverage. No concrete new native defect found; do not change native/UI code speculatively.

## Fresh evidence

- HEAD3d775b7c:34 checks finished, no failure/pending at audit. Hosted CI40035892504, WS PR Checks40035892590, Tests40035892515 and APK40035892499 successful (links/status should be read from final PR check report). Neutral/skipped landing/deploy/apply checks are not deployments.
- Netlify Preview6adbe4202a8abd1cd82faaaa ready for exact3d775b7c, public receipt verified. Mobile OPTIONS mint/profile/progression/balance204 with ACAOhttps://localhost. calculate-xp GET405 after store availability guard; this is not a Redis-write/financial smoke.
- Effective Stage metadata: Redis3/stage/kcswh:stage:xp:v3; protected alias deploy-preview context only; branch localhost CORS, avatar tracking1, deletion acceptance OFF, pinned Supabase krydukthwdvccggbyjfw. Stage Auth native callback still allowed, Google enabled, Site URL unchanged. No settings changed by review.
- Running WS Preview health200, release receipt6c662d524d158e439d3888cfc667a923806100d1. No deploy performed; API/WS protocol frames unchanged, previous authenticated helloAck/authOk and owner gameplay PASS retained. Future build regression above is separate.
- Physically accepted APK857159ca artifact12537340661 SHA2569f9cd14ecf0ba72dbc753f9476df06f2f58a7d03476c54519b48d78d68904f32. Latest pre-review automatic APK3d775b7c artifact12536783574 SHA256d573ebfed49f4e99a1b6a2399e8197db27c173cd8b9d7cf8f19b497cc532292b. Both receipts/checksums verified in memory. All packaged assets equal after normalizing source-SHA metadata; all native DEX identical. Source diff857159ca→3d775b7c contains documentation only. Thus physical acceptance applies to current app payload, not to an untested server dependency deployment. No artifact files written to VPS.

Focused existing security/Auth/avatar/Redis/client WS/sidebar/mint/CORS fundamentals80/80 PASS during final review; isolated actual-context WS selector reproduction still throws as described. Passing tests do not clear the uncovered workflow-context contract regression.

## Minimal handoff before merge recommendation

1. Correct/review actual WS Preview context regression with fundamental fixture, then confirm required CI. This is the only proven code blocker.
2. Owner can close already-approved manual scenarios: swipe bars and auto-hide; background/resume and return Lobby/Profile; IME open/close and rotation/re-entry. No new layout suite or full financial smoke is required by this review.
3. Keep exact APK/source/CI/deploy provenance. No automatic merge: only explicit human authorization. Stable signing and Verified App Links remain M1.

Docs-only final evidence commits do not change app/source payload; their automatically triggered check/deploy status is recorded in the final PR comment. VPS6.5GB free; no SDK/JDK/Gradle/install/checkout/cleanup, service restart, Production/Stage writes or financial actions.
