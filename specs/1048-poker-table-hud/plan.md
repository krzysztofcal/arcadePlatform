# Owner-directed replacement plan

## Constitution and scope
Existing fundamental checks and pure Other tables test only; no new UI/CSS/JSP suite, dependencies, graphics or gameplay changes. External preview geometry probes are evidence, not repository tests. Browser-only: no WS deploy or database mutation. No inline scripts.

## Geometry
`poker/poker-v2.js::renderSeats` remains one renderer. Two static table-local geometry maps define six physical seat variants for portrait and landscape. Reserve avatar, directly-below name, avatar-edge status/action/compact opponent indicators, seat marker, hero cards, settlement/social, graphical stack plus label, committed chips and dealer. Hero best hand uses a single horizontal five-symbol row. Three gift anchors use predefined angles and equal radius around the avatar, outside its clipped element. One small Quick Gift anchor is a DOM contract only.

`fitTableScene` scales the whole composition using only available viewport scene width/height after the header; lower-right controls occupy a predefined corner reserved by seat geometry. No content-driven seat measurements or collision engine. Scene fits in one viewport in both orientations. Reuse original felt, avatars, chip artwork, cards, badges and reactions. Center has reserved pot amount → graphical chips → community cards; hero best hand has a separate left area.

`poker/poker-v2.css` restores original visual rules and replaces conflicting geometry rules with deterministic anchors. No seat panels or scrolling layout. `poker/table-v2.html` adds only a scene viewport container; retain existing controls and accepted CH HUD.

## Retained CH contract
Existing ChipsClient; document chips:tx-complete; authoritative wallet/projection reads, identity/generation guards, Other tables exclusion, valid changed-wallet pulse with first/error/reduced-motion/identity-reset exclusions. No topbar, XP badge, endpoint, balance cache or local subtraction.

## Verification and handoff
Required syntax/check:all/ci:guards/CSP and focused existing fundamental tests. Self-review against main. Narrow real exact browser SHA Deploy Preview at 390×844, 320×640, 844×390 and desktop: six occupied seats, no scroll, popup clickability and screenshots. Do not expand collision probes before owner review. Old 20/20 and replacement 40+4 layout evidence are superseded by owner corrections, not acceptance. Owner manual smoke and actual authenticated Stage verification remain pending. Keep draft; never merge.

## #1047 integration
Seat articles carry data-seat-no + data-user-id. Exactly three data-poker-gift-slot children in data-poker-gift-slots, outside avatar, and one data-poker-quick-action-slot. Rebuilt by renderSeats; #1047 must repopulate/reconcile occupant-scoped content. No purchase, retry, cooldown, no-self or picker logic here.

## Second owner smoke correction plan

Refine renderSeats/configureSeatHud and existing CSS only: shared occupied size, minimal OPEN, meaningful badges; transient owner column, anchored avatar motion, aligned action controls and narrow best-hand symbols. Preserve action-rail placement, scene scaling, CH and protocol. Verify focused fundamental suite and required guards, then two real Preview orientations with screenshots; manual owner and authenticated Stage gates stay pending.
