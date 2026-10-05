# Review and evidence — replacement awaiting owner smoke

The initial #1049 seat-grid/card-panel design FAILED manual owner smoke. Its old 20/20 layout evidence is SUPERSEDED, not acceptance. The earlier wallet P1/P2 checks validate only the retained account contract, not this replacement geometry.

## Scope and self-review
Branch remains independent from main 4f798bdd56dba0e11b34e8982895650920ec6944, existing draft #1049. No #1047 purchase code copied. One existing Poker V2 renderer and runtime; portrait/landscape static geometry each define six physical seat variants. Scale uses only available scene viewport dimensions. Header and actions own rows; the table composition scales together. Existing felt, avatar/card/chip/dealer/badge/reaction assets remain; no seat panels, textual replacement stacks or long scrolling table.

Graphical stacks and directly-below numeric labels consume existing resolveStack and createChipStackVisual. Private-card privacy, authoritative dealer/state/settlement, reveal timing, action commands and reaction occupant checks remain. Fixed roles reserve center lane and hero left best-hand name + exactly five cards. Gift anchors have equal radius and predefined angles outside the clipped avatar; quick action is an empty anchor only.

Retained account HUD uses existing ChipsClient, canonical document event, authoritative refetch, identity/generation guards, Other tables exclusion and wallet pulse. No balance subtraction, service/cache/endpoint, XP elsewhere, new inline scripts or dependencies. Browser-only; no WS/shared runtime/protocol/config, ledger, schema, bot bankroll or gameplay mutation. No WS Preview Deploy required. Visible anchor placement is a breaking presentation change; rules/state remain unchanged.

## Verification
Required checks and focused existing tests are recorded with final preview evidence below when complete. No new broad UI/CSS/JSP tests. External geometry probes and screenshots are evidence only and remain outside the test suite. Automated checks cannot substitute for the owner's manual smoke.

## #1047 T012D/T012E integration
- `.poker-seat[data-seat-no][data-user-id]` retains authoritative occupant identity. `data-seat-variant` identifies top/upper-right/lower-right/hero/lower-left/upper-left geometry.
- `[data-poker-gift-slots]` contains exactly three `[data-poker-gift-slot="0"]`, `"1"`, `"2"`; all outside `.poker-seat-avatar`. Each slot is 16 design pixels on the avatar's common radius at −150°, −90°, −30°. Hero radius is 52 portrait / 58 landscape; other seats 42.
- Exactly one `[data-poker-quick-action-slot]` per seat, 16 design pixels at a fixed avatar corner. Table scene scales these anchors together. Empty in #1049; no dormant purchase/picker behavior.
- Containers are recreated by renderSeats. #1047 must reconcile/repopulate on render using seatNo + userId and invalidate removed/replaced targets. Its existing one purchase/retry/cooldown/sendGift path remains separate.
- Existing document chips:tx-complete refreshes both authoritative account reads. Integration happens after owner merge of #1048; no merge here.

## Pending gates
New real Deploy Preview matrix and screenshots; owner manual smoke of replacement layout; actual authenticated Stage balance/projection/transaction verification. Keep #1049 draft / not merge-ready. #1047 T012D/E2 and its final smoke/Production gates are unchanged.
