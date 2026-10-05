# Review and evidence — replacement awaiting owner smoke

The initial #1049 seat-grid/card-panel design FAILED manual owner smoke. Its old 20/20 layout evidence is SUPERSEDED, not acceptance. The earlier wallet P1/P2 checks validate only the retained account contract, not this replacement geometry.

## Scope and self-review
Branch remains independent from main 4f798bdd56dba0e11b34e8982895650920ec6944, existing draft #1049. No #1047 purchase code copied. One existing Poker V2 renderer and runtime; portrait/landscape static geometry each define six physical seat variants. Scale uses only available scene viewport dimensions. Header and actions own rows; the table composition scales together. Existing felt, avatar/card/chip/dealer/badge/reaction assets remain; no seat panels, textual replacement stacks or long scrolling table.

Graphical stacks and directly-below numeric labels consume existing resolveStack and createChipStackVisual. Private-card privacy, authoritative dealer/state/settlement, reveal timing, action commands and reaction occupant checks remain. Fixed roles reserve center lane and hero left best-hand name + exactly five cards. Gift anchors have equal radius and predefined angles outside the clipped avatar; quick action is an empty anchor only.

Retained account HUD uses existing ChipsClient, canonical document event, authoritative refetch, identity/generation guards, Other tables exclusion and wallet pulse. No balance subtraction, service/cache/endpoint, XP elsewhere, new inline scripts or dependencies. Browser-only; no WS/shared runtime/protocol/config, ledger, schema, bot bankroll or gameplay mutation. No WS Preview Deploy required. Visible anchor placement is a breaking presentation change; rules/state remain unchanged.

## Verification
Syntax, check:all, ci:guards, CSP and diff checks passed; focused existing fundamental suite: 123/123. Latest browser runtime CI is tracked on the PR. No new broad UI/CSS/JSP tests. External geometry probes and screenshots are evidence only and remain outside the test suite. Automated checks cannot substitute for the owner's manual smoke.

## #1047 T012D/T012E integration
- `.poker-seat[data-seat-no][data-user-id]` retains authoritative occupant identity. `data-seat-variant` identifies top/upper-right/lower-right/hero/lower-left/upper-left geometry.
- `[data-poker-gift-slots]` contains exactly three `[data-poker-gift-slot="0"]`, `"1"`, `"2"`; all outside `.poker-seat-avatar`. Each slot is 16 design pixels on the avatar's common radius at −150°, −90°, −30°. Hero radius is 52 portrait / 58 landscape; other seats 42.
- Exactly one `[data-poker-quick-action-slot]` per seat, 16 design pixels at a fixed avatar corner. Table scene scales these anchors together. Empty in #1049; no dormant purchase/picker behavior.
- Containers are recreated by renderSeats. #1047 must reconcile/repopulate on render using seatNo + userId and invalidate removed/replaced targets. Its existing one purchase/retry/cooldown/sendGift path remains separate.
- Existing document chips:tx-complete refreshes both authoritative account reads. Integration happens after owner merge of #1048; no merge here.

## Pending gates
Owner manual smoke of replacement layout; actual authenticated Stage balance/projection/transaction verification. Keep #1049 draft / not merge-ready. #1047 T012D/E2 and its final smoke/Production gates are unchanged.

## Replacement preview evidence

Browser runtime SHA **`969bcee9e570722edd42deb6ef1a9d4b463ada27`** on [real Deploy Preview](https://deploy-preview-1049--playkcswh.netlify.app/poker/table-v2.html). BUILD_INFO full SHA and served JS/CSS match this checkout. [replacement-preview-evidence.json](replacement-preview-evidence.json) supersedes old layout evidence.

External probe: 40 reduced-motion cases plus four normal-motion cases. Viewports: 390×844, 320×640, 844×390, 1440×1000. Full six seats, maxSeats=2/two occupants, six slots/two occupants; all dealer positions; visible/back/folded/next-hand-hidden cards; action/status, hero five-card best hand, graphical seat/bet/pot chips and exact stack labels, gifts/quick placeholders, reactions/settlement, long nicknames and 999,999 stacks/pot. Every recorded case satisfies both document scroll inequalities; zero detected critical collisions/out-of-scene clipping. Top and bottom controls are checked as well as seat anchors and protected center. Normal-motion reaction stays within its social anchor.

Four actual guest sessions on the deployed runtime joined with helloAck/authOk/commandResult/table_state/stateSnapshot, four occupied seats, no page scroll, no authenticated values and zero JS errors. Controlled signed-in account checks on this same preview verify initial 500 (no pulse), canonical document event → authoritative refetch 475 (pulse only with normal motion), unchanged/error/reduced-motion exclusions, identity reset and stale sign-out responses. These controlled checks do not verify a real authenticated Stage account.

Manual screenshot inspection found and corrected the old Preview FX offset before this final evidence: its button now stays in header flow. Readability of scaled name/stack labels was checked at 320×640. Screenshots use controlled snapshots/account responses and gift/quick placeholders unless explicitly marked real guest; no purchase behavior was installed.

| Viewport | Hero dealer / six occupied | Top dealer | Settlement / left dealer | Real guest |
| --- | --- | --- | --- | --- |
| 390×844 | [Screenshot](evidence/android-hero-dealer.png) | [Screenshot](evidence/android-top-dealer.png) | [Screenshot](evidence/android-settlement.png) | [Screenshot](evidence/android-real-guest.png) |
| 320×640 | [Screenshot](evidence/small-hero-dealer.png) | [Screenshot](evidence/small-top-dealer.png) | [Screenshot](evidence/small-settlement.png) | [Screenshot](evidence/small-real-guest.png) |
| 844×390 | [Screenshot](evidence/landscape-hero-dealer.png) | [Screenshot](evidence/landscape-top-dealer.png) | [Screenshot](evidence/landscape-settlement.png) | [Screenshot](evidence/landscape-real-guest.png) |
| 1440×1000 | [Screenshot](evidence/desktop-hero-dealer.png) | [Screenshot](evidence/desktop-top-dealer.png) | [Screenshot](evidence/desktop-settlement.png) | [Screenshot](evidence/desktop-real-guest.png) |

Automated geometry and screenshots are review evidence, not owner acceptance. **Owner smoke of the replacement layout and real authenticated Stage verification remain pending. Draft / not merge-ready. No merge, WS redeploy or Production mutation.**
