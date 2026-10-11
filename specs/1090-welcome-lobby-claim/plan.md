# Implementation plan

Follow issue #1090 T001–T006 sequentially, based on live main e7fd0ce2.

- `poker/poker.js::initLobby()`: local Welcome pending state and identity guard, use `refreshWelcomeBonusBanner()` and `ChipsClient.fetchWelcomeBonusStatus(payload)` before `claimBonusCampaign(status.code)`. Serialize Daily/Welcome claim actions using existing pending guards. Preserve normal transaction balance/progression events.
- `refreshWelcomeBonusBanner()`: render the fetched campaign amount; preserve shared 60-second/UTC freshness, in-flight join and generation checks. Block unrelated shared refresh while Welcome posts; invalidate/reconcile after the result.
- `poker/index.html`: dynamic banner heading, independent persistent live status and minimal Welcome overlay using `.daily-flyin` art. Manual popover top layer where supported, fixed overlay fallback.
- `poker/poker.css`: only Welcome viewport/popover reset; reuse existing Daily keyframes, art and reduced-motion rule. One physical line per selector.
- `setLobbyIdentity()`/visibility/unload: reset Welcome UI and timer; discard old responses and clear hidden-document animation.

## Constitution Check
PASS: minimal existing client mechanisms; server authoritative/idempotent; JSP IIFE, klog, one-line CSS; no inline scripts/CSP changes; no DB/WS/runtime deployment or shared Stage effects. Planned verification uses existing fundamental tests and temporary browser mocks only. No UI/CSS/JSP/glue suites, tooling/ignore/dependency changes or real funded claims.

## Review and delivery
Record reproduction, browser request counts and viewport evidence, existing checks, self-review and breaking impact. Draft PR linked to #1090; Netlify Git Deploy Preview only. Leave merge and Production to owner final review.
