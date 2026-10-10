# Presentation data model — arcade review v2

No database model, migration, persisted preference or live reward state is introduced by this design PR.

| Entity | Fields / source | Validation / transition |
| --- | --- | --- |
| Mode card | online/single/world/seasons/sitgo; label, original v2 art, status, description, destination | Fixed order. Online links existing lobby; four future modes open details only |
| Player presentation | existing identity, XP, CH; UserUiState pending/ready/stale | Preview unset; no fabricated rank, balance or currency |
| Progression | balance, tiers, availableBuyIns; buyIn/stakes/available/unlocked/unlockBankroll/progressPercent | Existing rules unchanged; unlocked does not imply currently available |
| Free theme | six existing TABLE_THEME_CATALOG IDs, actual room/dealer/rail/felt/card/frame assets | All six FREE for all players; no ownership/CH/VIP/entitlement checks |
| Local choice (proposed #800) | {mode:"auto"} or {mode:"manual",themeId}; key kcswh:poker-cosmetics:v1:<userId> or distinct guest key | Default auto; only known modes/IDs; malformed/storage failure → Classic/static dealer |
| Resolved auto theme (proposed #800) | stable hash of normalized identity + tableId, modulo six IDs | Resolve on new participation; stable for same participant/table through hand, redraw, reconnect/reload. No DB/scheduler. Manual choice takes precedence |
| Apply request (proposed #800) | identity + monotonically increasing generation | Identity transition invalidates old requests; full preload → atomic local scene, failure → safe Classic |
| Daily concept | Day 1 example completed, Day 2 example current, Days 3–4 example upcoming; no amount or timestamp | Review-only markup, no claim event/status fetch/state transition. Disabled claim, Not configured availability |
| Future daily status (#1079) | existing campaign code/title/claimPolicy/amount/eligible/alreadyClaimed/reason; approved history/timing contract later | Existing GET omits claimed entries; cannot synthesize completed days or countdown from absence. Separate economic/status design required |

Prototype state is ephemeral carousel/dialog/manual art-preview choice only. Auto uses a labeled fixed Neon Vegas sample, not a shipped randomization algorithm. No localStorage/sessionStorage writes, authenticated campaign reads or economic actions. Day states are a sample visual journey, not the user's history.
