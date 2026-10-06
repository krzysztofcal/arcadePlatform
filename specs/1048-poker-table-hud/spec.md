# #1048 — live specification

## Goal

Fix Poker Table HUD collisions **without redesigning the table**.

The existing Poker V2 visual design, table/felt, assets, chip graphics, community-card presentation and overall composition are the baseline. The change should make the six player HUDs deterministic and collision-free while preserving the current look.

Manual smoke of draft PR #1049 on 2026-10-05 rejected its first layout direction: the table became vertically scrollable, seats became large framed/card-like panels, chip presentation changed materially, and the whole table composition moved away from the existing design. That direction is **not accepted** and must be reworked.

## Hard acceptance rule: one viewport, no scrolling

The complete playable table must fit inside a single viewport in both:

- portrait/mobile;
- landscape/mobile;
- supported desktop widths.

There must be **no vertical or horizontal page scrolling to play the table**.

The layout must reserve space for the top table HUD, poker table/scene and bottom action controls so they cannot push one another outside the viewport or overlap. Scale/spacing may adapt to the viewport, but the user must always see the whole playable table at once.

## Preserve the current Poker V2 design

Do not redesign unrelated table UI.

Preserve, unless a tiny placement adjustment is required for collision avoidance:

- existing poker table/felt appearance and assets;
- existing avatars and avatar art;
- existing card art;
- existing chip graphics / chip-stack presentation;
- existing community cards;
- existing action controls;
- existing pot presentation;
- existing best-hand presentation;
- existing reactions/settlement/celebration visuals;
- current overall visual language.

Do **not** add large frames, cards, panels or boxes around each player HUD. A seat control should visually remain part of the poker table, not become a separate rectangular card.

Do not replace graphical chip stacks with plain stack/bet text panels.

## Six deterministic seat controls

Treat the six poker positions conceptually like six fixed reusable user controls:

- Seat 1 / hero;
- Seat 2;
- Seat 3;
- Seat 4;
- Seat 5;
- Seat 6.

Each control may have a different orientation appropriate to its physical position around the table, but its internal anchors must be deterministic. Do not continuously calculate arbitrary free-floating positions from current content.

The six controls must be placed around the table so their reserved areas do not overlap each other, the community-card area or the player action controls.

Default implementation should refine Poker V2 rather than create a second poker implementation. A new table-v3 is allowed only if repo review shows that it is materially simpler and avoids duplicate gameplay/state logic; do not create a parallel poker runtime or duplicate WS/gameplay code.

## Required per-seat anatomy

For every occupied seat, define fixed semantic anchors.

### Avatar

- Avatar is the visual center of the seat HUD.
- Avatar placement inside that seat control is stable.

### Player name and seat marker

- Player name is always directly below the avatar.
- Seat marker/number has one defined place and must not cover the avatar/name/cards/chips.

### Received gifts

- Exactly three persistent received-gift slots.
- They sit around the avatar circumference at predefined fixed positions and a consistent radius from the avatar center.
- Their positions do not move based on content.
- They must live outside the avatar clipping region.
- #1042 owns gift state/content; #1048 owns these anchors.

### Quick Gift action

- Reserve one small stable Quick Gift action anchor for #1042.
- It should sit at a defined avatar corner/adjacent position.
- It must never cover cards, player name, action badge, received gifts, dealer chip or stack.
- #1048 provides placement only; #1042 owns behavior.

### Action/status badge

- ACTIVE/FOLDED/CALL/RAISE/etc. presentation must have a predictable location around the avatar.
- Prefer a fixed corner/anchor.
- It may use a small seat-specific alternate position if that is the simplest way to avoid a genuine collision, but it must remain deterministic rather than free-floating.

### Private cards

- Opponent private/back cards have a fixed anchor relative to that seat control.
- Hero private cards remain larger than opponents' cards as in the existing design.
- Do not move cards into large seat panels.

### Player chips / stack

- The player's graphical chip stack remains **on the felt/table near the player**.
- It may use a seat-specific table-side position and may move within a small predefined safe area if necessary.
- It must not cover avatar/cards/dealer/gifts/action badge.
- The numeric stack value must always appear directly below the graphical player chip stack.

### Dealer button

- Dealer `D` remains on the felt near the relevant player's avatar.
- It may use a seat-specific safe position.
- It must never cover another player element.

### Reactions / settlement / social UI

Reuse existing visual behavior but attach it to defined seat anchors so it cannot collide with the critical HUD elements above.

## Table center contract

The table center has its own protected area.

From top to bottom:

1. pot amount;
2. chips currently committed to the hand/pot;
3. community cards.

Nothing from a player seat may cover this center lane.

Keep the existing graphical style/assets where available.

## Hero best-hand area

For the main player:

- keep the current best-hand name and five-card best-hand presentation;
- place it in a dedicated safe area to the **left of the hero**;
- it must not overlap hero avatar, private cards, chip stack, dealer button or action controls.

## Player action controls

Fold/Check/Call/Bet/Raise/All-in/slider controls get a dedicated bottom area.

They must never overlap any of the six seat controls.

The table/seat region and action-control region must be laid out together so the complete experience fits one viewport.

## Account CH HUD

Keep the accepted account-HUD requirement:

- remove Poker Table XP badge;
- authenticated users show `Wallet <balance> CH · Other tables <sum> CH`;
- reuse `ChipsClient.fetchBalance()` and `ChipsClient.fetchPokerProjection()`;
- exclude the current table from `Other tables`;
- guest/signed-out users see no authenticated balances;
- reuse canonical `document` `chips:tx-complete` refresh;
- animate only a changed, newly fetched authoritative wallet value;
- reduced motion disables the animation;
- never locally subtract a gift price or create another balance source/cache/API.

## Gift Shop dependency

- #1042 owns gift purchase/delivery/state/animation/picker/retry/cooldown/no-self behavior.
- #1048 owns only stable seat/HUD placement including exactly three received-gift anchors and one Quick Gift anchor.
- After #1048 is merged, #1047 will integrate T012D/T012E into these anchors.
- Do not implement temporary free-floating gift overlays.

## Scope

Primary files:

- `poker/table-v2.html`
- `poker/poker-v2.js`
- `poker/poker-v2.css`
- existing CH/account UI client reuse, especially `js/chips/client.js`
- existing i18n only where visible copy changes

Do not create a new layout framework, animation framework, state source, wallet API or balance cache.

## Verification

This is primarily visual/HUD work. Do not add broad CSS/layout/JSP tests.

Only add/retain fundamental deterministic tests for non-trivial pure logic, such as the existing Other tables calculation.

Real Deploy Preview verification must include at least:

- 6 occupied seats and representative partial occupancy;
- dealer at hero/top/left/right seat positions;
- visible/folded/hidden cards;
- action/status badges;
- graphical player chip stacks plus stack labels;
- center pot/bet/community-card lane;
- hero best-hand area;
- three gift anchors per occupied seat;
- Quick Gift anchor;
- reactions/settlement state;
- signed-in CH HUD and guest state;
- portrait mobile;
- landscape mobile;
- desktop.

Acceptance requires:

- **zero page scroll in portrait and landscape**;
- whole playable table visible in one viewport;
- no seat-control overlap;
- no overlap with center community-card/pot area;
- no overlap with bottom action controls;
- no new large seat frames/cards;
- existing table look/assets preserved.

## Out of scope

- Gift purchase/accounting (#1042).
- Persistent gift collections/history (#1043).
- Social gift leaderboards (#1044).
- Bot gifting (#1045).
- New avatar packs (#1041).
- Poker rules/engine changes.
- WS gameplay changes.
- Generic visual redesign unrelated to collision prevention.
- XP changes outside Poker Table.

## Breaking impact

The intended breaking impact is limited to deterministic placement of Poker Table HUD elements and replacing the table XP badge with account CH context.

Poker rules, WS authoritative state, stack/accounting semantics, ledger, settlement, table lifecycle and XP outside Poker Table must remain unchanged.

## Implementation constraints

Follow `agents.md` and `skills.md`.

- Keep the implementation minimal and reuse existing elements/functions/assets.
- Prefer correcting/reverting the rejected #1049 layout over layering fixes on top of it.
- JS must remain JSP-compatible.
- CSS must keep one physical line per selector.
- Use `klog`, never `console.log`.
- Any new inline/browser script requires CSP SHA update.
- Write only fundamental deterministic tests.
- Browser-only work needs real Deploy Preview visual smoke; WS-affecting work requires exact-SHA WS Preview Deploy.
- Double-check/refactor before handoff.
- Explicitly call out any breaking impact.

## Current implementation status

Draft PR #1049 remains the implementation vehicle, but its first seat-grid/panel layout is **rejected by manual owner smoke and is not acceptance evidence**.

The previously recorded 20/20 collision matrix is superseded because it did not enforce the key product requirement that the whole table remain visually equivalent to the existing Poker V2 composition and fit in one viewport without scrolling.

The corrected #1049 must be reworked against this issue before any merge-readiness decision. Do not merge the current layout.

## Reconciliation for owner smoke FAIL

The earlier PR #1049 seat-grid/card-panel implementation and its 20/20 preview matrix are SUPERSEDED and REJECTED by manual owner smoke. Those checks did not establish one-viewport acceptance. Preserve accepted CH Account HUD corrections, but replace the rejected layout with the existing Poker V2 visual skin and deterministic table-local SeatHud anchors. No new poker runtime or Gift Shop behavior. Current baseline main: 4f798bdd56dba0e11b34e8982895650920ec6944. Draft #1049 remains not merge-ready until the owner verifies the replacement layout and actual authenticated Stage reads.

## Replacement implementation handoff

Current browser runtime: a19e4e272a1fa9313d90e8d3554cf82bef1bf6bb. Existing draft #1049 now implements the owner-directed Poker V2 anchor layout, retains accepted CH HUD and provides three circular gift anchors plus one quick-action anchor without gift behavior. Live #1048 evidence/status and PR description updated. See review.md, replacement-preview-evidence.json and evidence/ screenshots. Old seat-grid/card-panel and 20/20 evidence remain explicitly superseded by owner smoke FAIL.

Required local checks and focused existing fundamental suite (123/123) passed. Real preview: 40 reduced-motion + four normal-motion geometry cases, both document scroll inequalities, zero detected critical collisions/out-of-scene clipping; four actual guest sessions and controlled signed-in wallet event/pulse checks. Actual authenticated Stage and owner smoke of this replacement remain pending. No WS deploy, Production mutation or merge. Not merge-ready.

## Latest owner corrections — supersedes replacement layout acceptance evidence

Owner review rejected the a19e4e2 replacement as final: restore single-row hero best-hand symbols, lower-right action rail with hero shifted left, use more viewport space, restore reaction/history popup interaction, move action badges and targeted social affordances to avatar edges, and replace opponent hole-card controls with compact 0/1/2 indicators. Targeted effects use sender/recipient avatar centers; #1047 gift integration must use those same centers. Keep CH account behavior, gameplay/privacy/settlement logic and purchase flow untouched. Narrow real Preview sanity/screenshots only; no expanded geometry matrix. Both previous layout matrices are historical and do not establish owner acceptance. Owner visual smoke and real authenticated Stage verification remain pending.

## P1 opponent participation semantics

Reuse the existing public betThisRoundByUserId membership (all current-hand users, zero values included); handSeats is not transmitted by the current public read model. Folded participants remain 2. Waiting/out-of-hand/out-of-chips seats outside the hand remain 0. No inferred 1, new WS field, endpoint or engine eligibility implementation. Snapshot merge must clear stale membership on full snapshots/hand change. No layout, asset, account, social or animation-anchor changes.

## Second owner smoke correction

Current layout remains unaccepted. Remove persistent ACTIVE and visible opponent count labels; empty avatar contains OPEN. Share occupied-avatar size, preserve meaningful edge states. Use one aligned action visual template and narrow single-row five-card best hand with red H/D and black S/C. Player-owned reaction, payout and special celebration center above owner avatar; motion preserves anchored transforms. Keep avatar-center targeted endpoints and edge quick affordance. No CH/backend/gameplay/purchase changes or broad geometry/UI tests.

## Third manual owner smoke corrections

Keep accepted second-pass presentation, including OPEN plus Seat N. Restore large --own for hero special hand only; non-hero remains compact above avatar, ordinary reactions/payout remain owner-centered. Fixed top reservation: 40px wide, 64px narrow portrait, ellipsis without runtime height changes. Move portrait non-hero centers toward perimeter, nearby remaining-stack anchors without changing bet anchors/accounting. Casino CSS dealer/card-back polish only; pot outer scale .5 matches player .5 while preserving center lane.

Private cards: omitted fields on same-hand/same-seat refresh retain the dealt cards. The earlier explicit-empty revocation rule is superseded by the active-deal correction below. Different/null hand, changed/lost seat, WAITING_NEXT_HAND/OUT_OF_CHIPS clear; identity resets use existing live-state lifecycle. No WS change, endpoint or unbounded cache. Fundamental existing snapshot test covers preservation and clears. Narrow Preview only; owner visual and authenticated Stage gates pending.

## Fresh-JOIN presentation correction (2026-10-05)

Ordinary authoritative WAITING_NEXT_HAND after JOIN is a reserved seat, not a bust/sitout. Use existing normal banner/NEXT HAND presentation, with neutral Joining next hand turn copy. Rebuy panel requires OUT_OF_CHIPS + canRebuy, or waiting with an existing real rebuyOperation. Keep real rebuy recovery and no waiting preactions. Browser-only: no WS/backend/#1055 changes, no new UI test or state source. Owner preview smoke and authenticated CH gate remain pending.


## Owner blocker: transient empty private projection (2026-10-06)

Stage table 42c2db29-f7fc-4860-a550-52f59cabea2f: owner confirmed durable pairs remain in poker_hole_cards, but resolvePrivateBranch normalizes temporarily absent runtime holeCardsByUserId to an empty array. Earlier omitted-only preservation is insufficient and its explicit-empty rule is superseded here.

mergeSnapshot retains an existing pair for an explicit empty projection only when handId and seat occupant are unchanged, phase is PREFLOP/FLOP/TURN/RIVER/SHOWDOWN and existing public per-round membership confirms participation. Reuse getOpponentHeldCardCount and the existing state; no second cache, endpoint, backend or protocol change. Authoritative explicit loss of membership clears cards. New/null hand, changed/lost seat, WAITING_NEXT_HAND, OUT_OF_CHIPS, leave and existing identity/session reset continue to clear; nonempty private arrays remain authoritative. Folded participants retain their dealt cards.

Implementation ready, awaiting owner manual runtime verification on Deploy Preview #1049. No unrelated HUD/layout/CH/reaction/asset change; no inline script or WS deploy required. Public breaking impact: none; same-hand empty projections no longer flicker a known active deal. No merge.

## Current owner FAIL: deal presentation ownership and compact chrome

Previous transient-empty-array correction is incomplete, and its checks are not owner acceptance. Preserve the received pair throughout the same authoritative hand/occupant across same-user auth pending/reconnect and incomplete public projection. Explicit seat loss/change, leave, hand change, nonparticipation, waiting/out-of-chips and identity change/sign-out still revoke it. Hero-card DOM belongs to the persistent scene, not the disposable seat HUD. Log only visible/hidden/placeholder transitions with lifecycle context, never card values/tokens.

Visible 36px one-row chrome contains menu, compact CH account badge, conditional Join, reaction and history. Badge: Total = authoritative wallet + all projection table stacks; Poker = all projection table stacks, compact k/M. Fail-safe/loading, identity/generation protection, canonical document transaction refresh and wallet pulse remain. Technical connection/table/phase/pot/acting and Preview FX move into Diagnostics in existing Table Settings. Errors/reconnect remain separate compact notices. Reserve a small table-local northern transient band without changing seat/action anchors. Owner smoke and actual authenticated Stage verification remain mandatory/pending.

## Owner chip flicker blocker (2026-10-06)

Owner private-card smoke is PASS; chip smoke remains FAIL/pending. Static seat stack/bet visuals belong to the existing persistent pokerSeatChipLayer, keyed by seat/user/role. Unchanged amount/variant retains the exact visual and image DOM; pot likewise retains unchanged DOM. Same-hand omitted committed/bet fields preserve known presentation; explicit maps (including empty) override. New hand clears omitted hand-scoped bets/pot; remaining stacks preserve omitted values and respect explicit updates. No WS/backend/layout/assets changes.

## Dealer/avatar/transient ownership pass (2026-10-06)

Dealer remains a persistent scene-owned node positioned by logical seat -> current physical slot -> existing orientation geometry; same-hand omission preserves dealer, explicit change/null and new-hand boundary apply. Seat/avatar source reuse is keyed by seat + occupant + URL/default variant; new images retain fallback until their own load, and occupant/source changes replace nodes. Player notifications/reactions, avatar toast, action/waiting/out-of-chips badges and best-hand/quick-action anchors belong to a common scene-owned transient layer above static chips and chip FX; targeted reaction FX retain their existing layer. Settlement precedes rebuy toast/social within the vertical player transient stack. Only portrait physical lower-left stack changes, from [130,425] to [218,455]; no logical-seat exception or landscape changes.

## Owner perimeter/scale correction (2026-10-06)

Supersedes earlier landscape-geometry restriction and compact reaction clipping. Keep portrait Hero at [150,500]; move physical nonhero avatars outward: top [180,50], right x322, left x44. Landscape equal occupied avatars96, scene reserve24 instead of64; mobile landscape composition aligned below chrome. Physical lower-right moves to [760,85], with owned stack/bet moved clear of the fixed action rail. Other Hero/board/pot/action geometry remains unchanged.

Dealer uses nearer physical owner anchors in both orientations; scene ownership and explicit/omitted lifecycle unchanged. Perimeter marker/card/quick anchors point inward; three gift anchors retain fixed radius with side-specific inward angles. Human and bot reaction text is complete, content-sized up to deterministic scene-edge budget and wraps; no ellipsis. Landscape scene viewport permits northern transients through the existing empty central chrome lane while the playable screen stays clipped to its viewport. No backend, protocol, purchase, accounting or authoritative state changes. Draft until new owner smoke and authenticated Stage CH gate.

## Owner approved landscape casino composition (2026-10-06)

This amendment supersedes previous landscape incremental anchors/composition; portrait physical geometry, scales, artwork and normal chrome remain unchanged. Six landscape physical slots: top [520,55], upper-right [810,65], right [940,150], Hero [430,298], left [95,185], upper-left [230,65]. Hero retains cards/stack/bet/best-hand anchors; all occupied avatars remain96px. Preserve physical rotation, persistent ownership and high transients.

Original emerald/walnut/gold table shell uses most scene width; original vector casino-room background and one original generated dealer cutout stand behind far edge. Owner reference is composition-only and is not a runtime/repository asset. Compact account/reaction/history sit top-right, hamburger top-left. Landscape rail142px with compact existing controls, no gameplay changes. Center event line occupies clear lower-center felt beneath board and to the right of Hero, away from cards/dealer; bottom secondary status has its own scene strip. Reuse public roster/hand/current-turn state for concise joining/new-hand/status copy; one ephemeral five-second message replaces prior copy, no protocol/log service.

Preview FX is a direct child of existing Settings Diagnostics, created only by existing deploy-preview/isPreview BUILD_INFO contract; no fallback mounting elsewhere, no Production tester. Existing special/winner options and contextual contested-pot Nice-hand window/motion are retained. Draft/not merge-ready pending landscape owner smoke and authenticated Stage CH.

## Landscape visual polish — owner pass 2026-10-06

Supersedes the previous landscape vertical action rail and v1 room/dealer art only. Restore current main's horizontal amount/slider-left, action-buttons-right composition at the bottom-right. Keep existing action semantics, equal avatars, six perimeter slots, scene scale, event lines and all ownership fixes. On short-wide screens constrain toolbar width to clear existing Hero cards; narrow landscape uses main's wider row below the scene. Portrait remains unchanged.

Use original generated transparent dealer artwork with dimensional satin/lighting and visible forearms/hands, plus an original subdued luxury casino room background. Dealer torso remains behind the far table edge, with only foreground hands passing over the rim. No copied reference assets, new dependencies, JS, protocol or gameplay changes. Preview FX remains Diagnostics-only with the existing deploy-preview BUILD_INFO gate, absent in Production. Visual breaking impact: landscape action composition and art change; none to data/runtime contracts. Owner smoke and authenticated Stage CH remain gates.

## Owner scope amendment — premium portrait

The latest owner pass extends approved premium landscape materials to portrait: same original v2 luxury room/dealer/outfit/pose, hands on north table rim, long-axis table with a more side-view perspective. Northern player moves sideways to leave dealer space; side players spread slightly. Landscape north/upper-right HUDs shift right by approximately one avatar diameter, readable typography increases. Preserve no-scroll, all ownership/reactions/FX/contextual Nice hand/gameplay contracts. This explicitly supersedes the previous portrait-unchanged limitation.

## Small positioning polish — owner pass

Maintain accepted premium direction. Adjust only requested physical seats/remaining chips/dealer D and reaction glyph centering; preserve semantics/ownership/assets/FX. Physical mapping for owner labels is top/upper-right/lower-left/upper-left, not logical-user-specific exceptions. Landscape northern HUD may occupy vacant center of chrome inside the viewport without clipping; no table scale/action rail redesign. Owner smoke and Stage CH gate remain pending.

## Owner chip association / best-hand readability correction

Landscape S1 chips/bet belong visually below its shifted name on felt, separate from common pot; portrait S5 chips near owner/name, Hero/S4 chips right/up outside avatar. Readable five-card best-hand symbols retain horizontal layout/card proportions and red/black suits. No state/amount/accounting/ownership/lifecycle/WS changes. Owner smoke and authenticated Stage CH gate remain pending.


## Owner reaction word wrapping correction
Normal human/bot reaction words remain intact: normal word wrapping, no hyphenation/ellipsis. Edge bubbles use a scene-safe inward offset and up to 220px width; only reaction content moves.
