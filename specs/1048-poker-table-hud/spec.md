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
