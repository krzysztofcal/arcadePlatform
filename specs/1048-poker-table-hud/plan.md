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

## Third smoke plan

Refine existing positionCelebration/class selection, mergeSnapshot lifecycle guards and static scene geometry. Fixed CSS header rows and presentation polish; preserve gameplay/account HUD/committed chip anchors. Extend existing private-card snapshot test, run required guards, narrow real Preview portrait/landscape and screenshots. Browser-only; no WS deploy or broad collision suite.

## Transient empty private projection correction

Limit edits to poker/poker-v2.js::mergeSnapshot, one existing fundamental private-card lifecycle case and these SpecKit records. Guard retained pairs by unchanged hand/occupant, active phase and existing public participation; explicit nonparticipation clears. Reuse current state/membership method. Required/focused checks, full fix self-review, browser runtime SHA and Deploy Preview handoff for owner smoke; no backend/WS/shared runtime/protocol/config change or broad UI test.

## Current bounded correction plan

Use existing browser model and authoritative ownership: same-user pending auth gates transport/actions instead of replacing a known model. Reconcile a missing public own-seat row only with explicit unchanged canonical you.seat, active same-hand participation and no pending leave; contradictory ownership/real lifecycle clears. Keep hero-card container in scene and reuse its identical DOM. No timeout debounce or second card cache. Extend existing lifecycle regression plus one deterministic auth lifecycle case; transition-only klog contains no private card/token data.

Replace visible verbose header with fixed 36px row and move existing diagnostic nodes/Preview FX into Table Settings. Sum all existing projection stacks and format Total/Poker with existing compact formatter; no endpoint/cache/service. Minimal northern safe band in fitTableScene, unchanged seat geometry/action rail. Required guards/focused tests, full-PR review, exact browser SHA real Preview portrait/landscape screenshots, then stop for owner. No WS/shared/protocol/config changes or WS deploy.

Compact non-hero celebration inherits the same composition scale as its owning avatar; its fixed stacking margins scale with it. Static northern safe bands reserve the combined above-avatar column. Hero special remains the dedicated unscaled --own. No per-content layout measurement or scheduler.

## Chip presentation correction

Reproduce partial-frame loss and exact DOM replacement in the existing fundamental harness before the fix. Reuse field-presence resolution and the existing scene chip layer; reconcile occupants/roles and update only changed amounts. Preserve current table-local anchors, labels and chip-fly/settlement flow. Verify focused tests, required guards, real narrow Preview, then hand off Draft pending owner smoke.

## Unified presentation ownership correction

Extend the existing deterministic live harness: scene dealer ownership/field-presence lifecycle, same-occupant avatar identity plus replacement load, common transient-layer ownership/order. Confirm RED before edits. Reuse renderedSeatAvatars for keyed avatar node reuse and seatSceneGeometry for dealer/stack anchors; retain fresh-element renderSeatAvatar contract. Add only one scene transient layer to table-v2.html/CSS above chip FX; relocate player content with equivalent table-local anchors. Narrow real Preview with six occupied seats validates portrait stack separation, full hero winning-pot/hand notification above chips, reaction/history clicks and no scroll. No backend/WS/CH/gift changes or broad layout tests.

## Perimeter/scale implementation amendment

Modify existing seatSceneGeometry, fitTableScene and configureSeatHud in poker/poker-v2.js. Preserve keyed/persistent ownership and logical-to-physical rotation. Modify only reaction text sizing/wrapping and landscape scene clipping in poker/poker-v2.css. Constitution check: this is geometry/CSS/simple glue; no new UI/layout tests. Run existing fundamental live/static tests and required guards. Verify real exact-browser-SHA Preview portrait/landscape, full long human/bot text, physical dealer proximity, affected lower-right/action separation, no page scroll and clickable controls. Save narrow evidence/screenshots; owner acceptance and authenticated CH remain pending.

## Landscape-only casino design plan

One existing SeatHud renderer and six static physical variants; balanced top/upper-left/upper-right/left/right/hero perimeter. Original room SVG (emerald panels, gold arches, warm lamps) plus original fully clothed dealer WebP behind far table edge; existing card/chip art reused. Landscape CSS only for table/room, compact rail and event strips. fitTableScene reuses the same account node, moving it into right rail in landscape and back to original portrait parent on rotation. renderRoomMessages derives public messages/status; no authoritative model mutation. bindCelebrationPreview mounts solely in Diagnostics with unchanged BUILD_INFO guard.

Constitution: UI/CSS/glue are preview-verified, no new broad UI test. Existing127 fundamental cases and required checks; narrow real Preview landscape844×390/desktop1280×720 plus portrait390×844 regression, targeted winner offer and FX Diagnostics/Production-signal checks. No WS deploy, schema/Production mutation, dependency, inline script or second poker runtime.

## Landscape polish plan — 2026-10-06

Compare controls with origin/main `d7d06b4259bf3b377ff2b89df309b81707b590ce`: flex row, horizontal amount slider, buttons sharing one row. Restore this composition without importing main's obsolete table geometry. Use existing scene-scale CSS variable to keep a short-wide toolbar right of Hero cards; retain main's narrow landscape sizing. Move secondary status into the remaining lower-left safe area. Keep all six physical anchors and portrait unchanged. Replace only landscape art with original WebP assets (dealer alpha, room 1600px), with CSS foreground hand treatment. No browser JS/HTML, inline scripts, tests, backend or environment configuration need changing. Verify existing focused tests/guards plus real Preview at 844x390, 640x360, desktop and unchanged portrait; no new test suite or collision matrix.

## Premium portrait and readable landscape — owner pass

Landscape: shift physical top and upper-right avatar/HUD anchors right by96px (one avatar diameter), keeping scene size/table scale. Reconcile the right-side neighbor below the upper-right seat and dealer anchors with these physical moves; stacks/bets stay on felt in readable lanes. Increase landscape player/stack/pot/event/status typography toward portrait effective size. No logical-seat special cases.

Portrait scope now supersedes the prior portrait-unchanged restriction. Reuse the same v2 room and dealer assets, emerald/walnut/gold table materials, but keep a vertical long-axis composition with a flatter perspective-shaped north rim. Shift northern avatar left and side avatars slightly outward, leaving a dedicated north-center dealer opening. Dealer torso stays behind far rim and hands overlap felt. Preserve Hero/cards/best-hand/actions and current scene fit, persistent presentation ownership, full reactions and all semantics. CSS/static geometry only, no purchase/backend/WS/config change. Existing focused checks and controlled real Preview portrait390x844/small320x640 and landscape844x390/640x360; no new UI suite or broad matrix.

## Small owner positioning polish

Reuse static physical seat geometry only. Confirm owner S1/S2/S5/S6 physical mapping before seat edits because logical numbers rotate around Hero. Move requested HUDs without modifying state or ownership; reconcile adjacent dealer/stack anchors to keep felt/control clearance. Dealer below-name anchors use existing avatar/name design coordinates. Reaction icon uses zero-padding inline flex centering overriding generic chrome button padding, without modifying action/reaction behavior. Existing focused/required checks plus narrow real Preview portrait/landscape screenshots; no new UI tests. Retain Draft and authenticated Stage CH gate.

Final physical mapping assumption for this smoke: S1=top, S2=upper-right, S5=lower-left, S6=upper-left (logical seat numbering/rotation unchanged). Portrait S6 avatar+owned identity/affordances72px down; S5 remaining-stack anchor nearer its owner with clearance from Hero stack; S1 D under name on felt. Landscape S1 moves144px left and43px up (~1.5/.5 avatar diameters), its stack reconciled away from center pot, D at left/below on felt; S2 D below its name. Scene sizes/scale/top reserve and action rail stay unchanged. Landscape scene viewport allows northern presentation in the existing empty center of top chrome; root viewport bounds and horizontal separation from menu/right controls verified, rather than shrinking the table.
