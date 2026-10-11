# Self-review / evidence — #1090

## Scope and breaking impact
Three client files only; existing ChipsClient, generic endpoint, topbar event wiring, profile/home claims, Daily keyframes and server payout/idempotency remain intact. Intentional behavior change: lobby Welcome CTA no longer navigates to `/account.html` (#1083/#1069 contract superseded only here). Daily and Welcome POST actions are serialized while pending. No DB/WS/config/dependency/inline-script changes; no shared Stage or Production mutations.

## Before proof (MOCK)
Existing Netlify Preview `https://deploy-preview-1088--playkcswh.netlify.app/poker/`, runtime lobby matching base main e7fd0ce2: mock eligible campaign `welcome-mock-1090`, amount 731. CTA visibly advertised the old static 500 CH, then navigated to `/account.html` instead of claiming. No actual CH award.

## Claim flow reviewed
1. Existing combined GET populates eligible Welcome and Daily cache (60 seconds / UTC boundary).
2. Click disables Welcome with PLEASE WAIT and blocks duplicate/Daily POST. Warm click reuses payload; stale click joins/refreshes the combined GET and selects actual campaign code.
3. `ChipsClient.claimBonusCampaign(code)` performs existing authenticated POST. Its synchronous transaction event refreshes topbar/balance/progression; lobby suppresses competing cache invalidation until the Promise settles.
4. Unchanged identity plus strict `claimed === true` and positive safe integer POST amount hides banner, announces static receipt and shows independent manual-popover top-layer reward for 1800ms using Daily art/keyframes. Reduced motion/hidden documents receive static confirmation only. Never opens Daily.
5. Reconcile campaigns with GET only. Denial/already-claimed/uncertain results produce no celebration; transport failures never auto-POST. Failed/uncertain outcomes also refresh authoritative balance/progression. The generic client's existing explicit-401 auth-refresh retry remains unchanged (no transport retry).
6. Auth identity change clears pending/status/timer/popover; old response/finally cannot reset or celebrate on the new account. Daily retains its own status, receipt, dialog and fly-in.

## Existing controls
- `tests/chips-client-cache.behavior.test.mjs`: pass.
- `tests/bonus-campaigns.behavior.test.mjs`: 17/17 pass (mock server dependencies; no remote ledger).
- `node --check poker/poker.js`: pass (poker files are outside the general syntax script's JS path filter).
- Existing syntax: 226 files pass; CSP: 55 served documents pass; ci:guards pass; diff whitespace check pass.

## Browser/Preview
Temporary Playwright mock matrix and exact-SHA Preview evidence are recorded after deployment. Mock values deliberately differ: banner 731 CH, successful POST 902 CH. They are simulated responses, NOT confirmation of real environment posting. No real Stage/Production Claim is authorized or executed.
