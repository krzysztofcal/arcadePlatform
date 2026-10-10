# Presentation data model

No database model or migration is introduced.

| Entity | Fields / source | Validation / transition |
| --- | --- | --- |
| Mode card | online/single/world/seasons/sitgo; label, artwork, status, description, destination | Fixed order. Online links existing flow; four future modes only open details. No purchase/game state transition |
| Player presentation | existing identity, XP, CH; UserUiState pending/ready/stale | Preview deliberately unset; future UI never substitutes fabricated rank/currency |
| Progression | balance, tiers, availableBuyIns; tier buyIn/stakes/available/unlocked/unlockBankroll/progressPercent | Existing rendering/access logic unchanged; unlocked is not equal to available |
| Theme catalog | six existing TABLE_THEME_CATALOG IDs and asset lists | One shared catalog in future #800; Classic assets remain shipped default |
| Local preference (proposed #800) | themeId; key kcswh:poker-cosmetics:v1:<userId> or distinct guest key | Only allow catalog IDs with permitted selection; invalid/denied/storage failure → Classic. Never an entitlement |
| Apply request (future #800) | identity + monotonically increasing generation | Identity switch/log out cancels older results; successful full preload → atomic local scene; failure → safe Classic/static dealer |

Preview state is ephemeral carousel index/dialog selection only. It writes no localStorage/sessionStorage and loads no authoritative player state. Selected illustration is not a player theme purchase or a themed play-path identifier.
