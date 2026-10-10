# Research — live requirements and owner review v2

Baseline main `d8f48bd3b7dd47e6c2619646b3b708149d4af4d4` reconfirmed live on 2026-10-10; existing PR branch HEAD at start `710c792cd77ecb5eb6478bd239c29c68f4a72be3`. Read latest agents.md/skills.md, constitution and full issue bodies #1069/#800/#1079/#1070/#1072. Earlier #1075/#1077/#797 mode ownership remains unchanged.

Owner review: https://github.com/krzysztofcal/arcadePlatform/pull/1078#issuecomment-6098655623. Previous design is NOT approved. Continue this Draft PR; no new PR, final lobby, merge or production work. Screenshot files are not attached to GitHub or this prompt; their detailed art direction is authoritative, not a claimed file reference.

| Decision | Rationale | Alternatives considered |
| --- | --- | --- |
| Saturated mobile arcade art/type/frames/buttons | Review calls for blue/purple/magenta bokeh, glossy 3D chip/robot/globe/trophy, bright beveled frames and CTA | Editorial serif/dark restrained luxury styling rejected by owner |
| Five existing cards + illustrated five-shortcut bar | Keep mode lineup and coming-soon semantics; Daily Bonus belongs below | Sixth game tile, fake jackpot/sale/rewards violate scope |
| Four example Day cards and disabled Claim | Visual approval without real rewards/timing or wallet changes | Showing even template CH amounts or fake timer would misrepresent a live campaign |
| All six existing themes FREE | Explicit correction in #800/#1070/#1072 supersedes earlier access assumption | Restricting to the default, locked, access-not-assigned or paid/VIP entitlement for these themes is prohibited |
| Proposed Auto / Random + optional manual choice | Owner preference; minimal deterministic identity/table choice stays stable on reconnect/reload | Every-hand/snapshot randomization causes flicker; scheduler/DB adds unauthorized scope |
| Actual rail/felt/dealer/room assets | Each shipped theme differs; preview should reflect it | Common gold rail/green felt gives misleading preview |
| Isolated native review routes and same-origin IIFE | Preserve working lobby/platform and existing CSP | New app framework/live flag adds unnecessary risk |
| CSS media blocks with one full rule per physical line | Review specifically identifies compressed media multi-rule lines | Entire media block on one line hides selector discipline |
| Bounded temporary browser inspection | Fundamental-tests-only constitution; no maintained UI suite | New UI framework/CSS test suite prohibited |

## Daily Bonus feasibility boundary (source inspection only)
`netlify/functions/_shared/bonus-campaigns.mjs:buildClaimPeriodKey()` supports UTC daily period keys and `getBonusCampaignStatus()` uses existing campaigns/claims. `netlify/functions/bonus-campaigns.mjs:createBonusCampaignsHandler()` GET filters `eligible && !alreadyClaimed`; `publicClaimableItem()` returns current eligible item fields, not full history/next-claim schedule. `js/chips/client.js:fetchBonusCampaigns()/claimBonusCampaign()` reuses authenticated PROMO_BONUS and emits `chips:tx-complete` on successful claim. `js/admin-page.js` has a 20 CH Daily Login template, not proof of an active environment campaign.

No authenticated Admin/campaign API, DB/Stage/Production inspection or activation was performed for this design-only task. Active campaign existence remains unverified and is not claimed. #1079 requires owner approval of actual amounts/cycle/missed-day policy/reset/audience/caps/funding/timezone/budget before any economy or history implementation. The bounded future history/status projection belongs to its independent plan.

## Integration facts retained
Actual poker owner is `poker/poker.js:initLobby()`; skills.md `portal/portal.js` mapping is stale. Topbar/sidebar are `js/topbar.js`/`js/sidebar.js`; account and welcome-bonus destination is `/account.html`. Preserve available versus unlocked tier semantics, existing guest/auth/actions and URL contract. #792 loader is preview-only/nonpersistent; free assets do not imply #800 is already implemented. Paid #1070 or VIP #1072 can only use future distinct approved assets; free current themes cannot be paywalled. Daily Bonus and welcome bonus are distinct.
