# #1048 — Poker Table HUD

Source: live GitHub issue #1048; reconciled 2026-10-05.

## Goal

Redesign Poker Table presentation so every seat and account-level HUD element has a stable reserved place and cosmetic/social features can be added without overlapping cards, dealer button, stack, avatar, reactions or gifts.

This issue was discovered during #1042 Gift Shop V1 smoke: gift badges were rendered inside `.poker-seat-avatar`, which has `overflow:hidden`, so the persistent received-gift UI was clipped. More broadly, the current table relies on independently positioned elements that can visually collide.

## Problems to solve

- Dealer `D` can overlap seat information.
- Cards, stack/chips, avatar-adjacent UI, reactions and future cosmetics can compete for the same visual space.
- Gift Shop needs three persistent received-gift slots per occupied seat.
- Poker Table currently shows XP, which is not useful table context.
- Signed-in poker users should instead see account CH context consistent with the existing account/topbar projection.

## Seat HUD direction

Each seat must become a bounded layout with predefined semantic slots rather than adding arbitrary absolute offsets for every new feature.

At minimum reserve stable areas for:

- hole cards;
- dealer button;
- avatar;
- nickname/status;
- authoritative poker stack;
- three received-gift slots;
- a small per-seat quick-action slot for contextual actions such as #1042 Quick Gift;
- reaction / contextual social UI;
- current action / best-hand / settlement presentation where applicable.

Exact orientation may differ for top/bottom/side seats, but components must not overlap at supported table sizes or responsive breakpoints.

The three gift slots are part of this HUD contract. #1042 may keep gift state/delivery, but its final persistent badges depend on this issue rather than another z-index/offset patch.

The per-seat quick-action slot is also part of this HUD contract. #1042 owns Quick Gift behavior, target validation and purchase flow; #1048 only guarantees a stable collision-free place beside each occupied seat. Do not implement Quick Gift as another free-floating absolute overlay.

## Account HUD

Remove the Poker Table XP badge.

For authenticated users show poker-relevant CH context using existing mechanisms:

- wallet CH from `ChipsClient.fetchBalance()`;
- authoritative poker table projection from `ChipsClient.fetchPokerProjection()`.

Do not create another balance endpoint.

The current-table stack remains visible at the player's seat. The account HUD should therefore present wallet CH and CH committed to **other** tables without double-counting the current stack.

Example:

`Wallet 400 CH · Other tables 500 CH`

After a Gift Shop purchase, reuse the existing `chips:tx-complete` refresh path. Animate the visible wallet change only toward the newly fetched authoritative balance; never treat a client-side subtraction as source of truth.

For guest mode, do not show authenticated wallet/account balances.

## Gift Shop dependency

- #1042 continues to own gift purchase/delivery, gift state, animation and shop UI.
- This HUD issue owns the stable three-slot seat placement for persistent received gifts.
- This HUD issue also owns the stable per-seat quick-action placement consumed by #1042 Quick Gift.
- #1042 must not be merged while its required persistent gift presentation is visually broken. Either this issue is implemented first/alongside it, or #1042 remains blocked until the new seat slots are available.

## Scope

- `poker/table-v2.html`
- `poker/poker-v2.js`
- `poker/poker-v2.css`
- existing CH/account UI clients where reuse is required, especially `js/chips/client.js`
- existing i18n only where visible copy changes

## Reuse

Reuse:

- current Poker V2 seat rendering/state;
- existing `ChipsClient.fetchBalance()`;
- existing `ChipsClient.fetchPokerProjection()`;
- existing `chips:tx-complete` event;
- current table stack from authoritative poker snapshot/state;
- existing reaction/settlement presentation anchors where practical.

Do not create:

- another wallet/account API;
- another poker state source;
- generic layout framework;
- new animation framework;
- new balance cache.

## Fundamental verification

This is primarily a visual/HUD change. Do not add broad CSS/layout/JSP tests.

Fundamental code tests are only warranted for any non-trivial CH projection calculation such as "other tables" if it is extracted as pure logic.

Required verification is real Deploy Preview / WS Preview across representative:

- 2/6-seat occupancy patterns;
- hero/top/side seat positions;
- dealer button positions;
- cards visible/hidden/folded;
- gifts in all three slots;
- per-seat quick-action control beside other occupied seats without covering avatar/cards/dealer/stack/gifts;
- reaction/best-hand/action state;
- desktop and mobile widths;
- reduced motion;
- wallet CH update after an authoritative gift purchase refresh.

No element listed above may cover another critical seat element.

## Out of scope

- Gift purchase/accounting itself (#1042).
- Persistent gift profile collections (#1043).
- New avatar content packs (#1041).
- New reactions.
- Generic Poker Table redesign unrelated to collision-free HUD placement.
- XP system changes outside Poker Table.

## Breaking impact

Visible Poker Table layout changes materially. Poker rules, WS gameplay state, stacks, ledger accounting and settlement semantics must remain unchanged.

## Implementation constraints

Follow `agents.md` and `skills.md`.

- Keep implementation minimal and reuse existing elements/functions.
- JS must remain JSP-compatible.
- CSS must keep one physical line per selector.
- Use `klog`, never `console.log`.
- Any new inline/browser script requires CSP SHA update.
- Write only fundamental deterministic tests.
- WS-affecting changes require exact-SHA WS Preview; browser-only changes still require real preview visual smoke.


## Baseline and scope

Independent branch from main 4f798bdd56dba0e11b34e8982895650920ec6944. #1047 is not a base. Existing seat/avatar/card/chip/reaction renderers consume authoritative WS state; their positioning currently uses unrelated percentage offsets. Table XP scripts serve only its badge. ChipsClient is intentionally absent under the obsolete static HTML assertion.

This is a browser presentation change only: no WS, protocol, ledger, migrations, payment or gift behavior. No Stage/Production database mutation. Material visual breaking change; gameplay and XP elsewhere unchanged.
