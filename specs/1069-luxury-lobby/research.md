# Research — final owner Variant A, review v3

Main baseline `d8f48bd3b7dd47e6c2619646b3b708149d4af4d4` reconfirmed by live fetch on 2026-10-10. Revision start HEAD `1c9ecd2a30e9e8eefb31f159e2838b7c5da04034`. Read updated issues #800/#1069/#1075, current agents.md/skills.md and constitution. Final owner review: https://github.com/krzysztofcal/arcadePlatform/pull/1078#issuecomment-6100781471; preceding correction https://github.com/krzysztofcal/arcadePlatform/pull/1078#issuecomment-6100584724. Latest top-of-issue decisions supersede contradictory historical paragraphs. Visual approval remains pending.

| Decision | Evidence / rationale |
| --- | --- |
| Remove all lobby appearance UI | Final owner Variant A; four lower shortcuts, no replacement setting |
| Shared automatic table appearance | All six shipped themes FREE, same assignment for every participant throughout table lifetime |
| Proposed deterministic table-ID mapping | Existing poker-v2.js has FNV-1a hashBotPresentationKey and fixed catalog. mergeSnapshot accepts authoritative payload.tableId/table.tableId into state.tableId. No backend field or module necessary |
| Fixed V1 six-entry order and hash | Catalog reorder/expansion would otherwise change active table appearance on reload; events separate |
| Flow toolbar | Before fix at 320×568 Play Now center hit-tested shortcut-art; sticky footer overlaps the card. Flow removes overlay while allowing short-phone scrolling |
| Preserve original v2 glossy arcade art/Daily concept | Owner asks to retain approved direction; no real rewards/timer or runtime |
| Delete obsolete assets | Five unused V1 illustrations plus gallery/redundant screenshot variants removed; five representative current screenshots retained |
| No new UI test suite | Temporary bounded browser inspection only, existing fundamental guards |

## Table identity and renderer feasibility (source inspection)
`readTableId()` reads URL routing identity. `mergeSnapshot()` rejects a different payload.tableId once state.tableId is established; accepted payload/table metadata establishes canonical table identity. `ws-server/poker/table/table-manager.mjs` loads/materializes tables by tableId and rolls hands under that key; hand identity is separate. The proposed resolver uses the canonical ID after snapshot acceptance, never hand/seat/player ID. This is sufficient for deterministic agreement in matching client versions without persistence or a server random draw; no runtime implementation/proof is claimed.

Existing `applyPreviewTheme()` preloads all seven resources, timeout 15 seconds and generation guard; `bindCelebrationPreview()` creates a deploy-preview-only theme picker. Later #800 repurposes the loader, removes only that picker fragment and reuses native Classic fallback. Existing `tests/poker-v2-live.behavior.test.mjs` uses node:test/vm; extend critical mapping invariants there. No extraction/new preference module needed.

Limitations: pre-#800 clients do not map themes; rollout/cache compatibility must be coordinated. Asset failure can locally render Classic despite the same assigned ID. Hash pseudo-random distribution is not a true persisted draw; different tables may map identically. Lifetime guarantee requires stable identity and permanently frozen mapping; any stronger server-enforced/cross-version guarantee needs separate authorization. Events/World Tour/weekly Seasons precedence and active-table transition belong to #1075, not this plan's V1 assignment.

## Daily Bonus feasibility boundary (source inspection only)
`netlify/functions/_shared/bonus-campaigns.mjs:buildClaimPeriodKey()` supports UTC daily period keys and `getBonusCampaignStatus()` uses existing campaigns/claims. `netlify/functions/bonus-campaigns.mjs:createBonusCampaignsHandler()` GET filters `eligible && !alreadyClaimed`; `publicClaimableItem()` returns current eligible item fields, not full history/next-claim schedule. `js/chips/client.js:fetchBonusCampaigns()/claimBonusCampaign()` reuses authenticated PROMO_BONUS and emits `chips:tx-complete` on successful claim. `js/admin-page.js` has a 20 CH Daily Login template, not proof of an active environment campaign.

No authenticated Admin/campaign API, DB/Stage/Production inspection or activation was performed for this design-only task. Active campaign existence remains unverified and is not claimed. #1079 requires owner approval of actual amounts/cycle/missed-day policy/reset/audience/caps/funding/timezone/budget before any economy or history implementation. The bounded future history/status projection belongs to its independent plan.

## Existing navigation and feature ownership
poker/poker.js:initLobby owns the actual lobby; js/topbar.js/js/sidebar.js own existing navigation (skills.md portal mapping is stale). Current Poker and Profile destinations remain /poker/ and /account.html. Retain guest/auth/access/tier/fixed buy-in/settlement/reconnect behavior. #1077/#1075/#797 still own four future modes; #1079 owns real Daily Bonus. No campaign or Stage/Production read/write, runtime deployment or merge performed.
