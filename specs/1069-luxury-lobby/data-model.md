# Presentation data model — Variant A review v3

No database model, migration, player appearance storage or live reward state is introduced.

| Entity | Fields / source | Validation / transition |
| --- | --- | --- |
| Mode card | online/single/world/seasons/sitgo; label, original v2 art, status, description, destination | Fixed order; Online links existing lobby, four Coming Soon details |
| Player presentation | existing identity, XP, CH; UserUiState | Preview unset; existing runtime remains authority |
| Progression | balance, tiers, availableBuyIns; buyIn/stakes/available/unlocked/unlockBankroll/progressPercent | Existing available versus unlocked semantics |
| Theme catalog (future #800) | six existing TABLE_THEME_CATALOG IDs and seven-resource asset lists | All FREE; Classic native scene; fixed V1 mapping order in plan.md |
| Table assignment (future #800) | canonical authoritative tableId → resolvedThemeId | Non-empty string, reject whitespace/control characters; no identity/seat/hand input. FNV-1a unsigned hash modulo fixed six. Immutable table ID means immutable assigned ID for table lifetime |
| Apply request (future #800) | resolvedTableId, resolvedThemeId, generation in memory | Resolve once per accepted table identity, idempotent on snapshots; full preload applies atomically only if generation/table still match. Missing art → readable Classic, no different assignment |
| Daily concept | Day 1 completed, Day 2 current, Days 3–4 upcoming, all EXAMPLE STATE | No amount/timestamp or state transition; disabled claim, Not configured availability |
| Future daily status (#1079) | existing campaign code/title/claimPolicy/amount/eligible/alreadyClaimed/reason; approved history/timing contract later | GET omits claimed entries; absence cannot imply completed days or countdown. Independent economic/status approval |

Prototype state consists only of carousel position and open dialog. No theme assignment is executed here. New table may hash to the same or a different theme; fairness/economic randomness is not implied. V1 list/hash cannot be reordered or extended while retaining lifetime stability. Event precedence/weekly transitions are future #1075 design.
