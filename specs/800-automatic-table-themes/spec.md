# #800 — Automatic Table Themes

Status: implementation authorized by owner on 2026-10-11.
Latest owner decision supersedes earlier legacy-table restrictions: EVERY table, including existing tables, receives a deterministic theme from tableId. Owner accepts one manual refresh of own tabs after deployment.

## Requirements and acceptance
- One theme per immutable tableId, shared by players, newcomers and reconnecting clients. Existing and new tables follow the same rule.
- Use all six FREE shipped TABLE_THEME_CATALOG entries: Classic Casino, Royal Gold, Neon Vegas, Midnight Sapphire, Crimson Velvet, Emerald Palace. Fixed ID mapping survives hands, snapshots, reload and reconnect.
- Reuse poker/poker-v2.js loader and poker/poker-v2.css art rules; no new artwork or parallel theme system.
- Missing/invalid ID and any image load error, invalid image or timeout -> Classic. Apply alternative art only after all seven assets load. Asset failure may cause the explicitly permitted local Classic fallback without changing assigned identity.
- No theme selectors, Cosmetics UI, preferences, payments, migrations, legacy-ID lists, version compatibility mechanisms, scheduler, Seasons or World Tour.
- Presentation must never initiate join, rebuy, leave, wallet or game actions. Existing authoritative CH/snapshot/reconnect behavior stays unchanged.
- No backend/WS/protocol change, merge or Production operation. Separate Draft PR, CI and Netlify Deploy Preview required.

## Fundamental scenarios
1. Independent clients with the same tableId resolve the same theme; the fixed mapping covers all six catalog entries.
2. Reload, late join, subsequent hand snapshots and reconnect retain the assignment; technical reconnect does not restart asset loading or add buy-in/rebuy calls.
3. Image error, empty decoded image or timeout leaves Classic; complete success applies all art atomically.

## Deployment and manual validation
No Poker update subscription exists in the older client; owner refreshes own tabs once after an eventual authorized deployment. This task deploys Preview only. Verify portrait/landscape, different tables, late join, reload and reconnect using existing Preview/browser mechanisms. For an existing live seat, use an idle table and confirm no extra CH transaction from technical recovery; seat retirement is separate from reconnect. Report pending authenticated runtime verification explicitly if unavailable.
