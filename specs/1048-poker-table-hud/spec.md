# #1048 — Poker V2 HUD final contract

Source of truth: live GitHub issue #1048 and Draft PR #1049. This document records the final owner-directed contract; superseded layouts and iteration history remain on GitHub and in Git history. Initial seat-grid/card-panel designs were rejected and are not acceptance evidence.

## Composition and physical seats

Use the existing Poker V2 runtime, one seat renderer and six static physical variants in portrait/landscape. Logical seats rotate around Hero; no logical-player layout exceptions or runtime collision engine. The whole playable table, compact chrome and action controls fit one viewport with no horizontal/vertical page scroll.

Retain the approved premium emerald/walnut/gold table, original luxury room and dimensional dealer artwork (`casino-room-v2.webp`, `dealer-v2.webp`). Portrait uses a long-axis perspective table, north-center dealer opening and perimeter players. Landscape uses a large table, five non-Hero perimeter players and bottom Hero, equal occupied-avatar sizes, readable typography and horizontal lower-right controls derived from main. Dealer hands rest on the table. Existing card/chip/avatar assets remain.

Each occupied seat has stable avatar, directly-below name, marker, meaningful avatar-edge action/status, compact opponent card backs, felt-side remaining stack with its value below, separate committed bet and nearby dealer D. No persistent ACTIVE badge. Empty avatar position shows OPEN; normal Seat N may remain. Opponent indicators reuse canonical public hand participation: active/folded participants have two symbols, waiting/out-of-hand seats none; no numeric count, invented one-card state or new protocol field.

Protect the center lane: pot label, graphical pot chips, then community cards. Pot chips are at least as large as player chips. Hero retains larger private cards and a dedicated left best-hand area: name and five readable narrow cards in one horizontal row, hearts/diamonds red and spades/clubs black. Controls never overlap seat/card/chip content. Physical anchor values live in seatSceneGeometry rather than duplicated prose.

## Presentation ownership and authoritative lifecycle

Hero private cards and their DOM are scene-owned. A received pair survives same-hand/same-occupant turn updates, omitted or transient empty private projection, incomplete seat/HUD projection and same-user auth pending/reconnect when authoritative ownership/participation remains valid. New/different hand, explicit seat change/loss, leave, sign-out/user change or confirmed waiting/out-of-hand transition revoke it. No unbounded cache/debounce. Transition-only klog diagnostics contain lifecycle context, never card values/tokens.

Seat stack/bet visuals live in pokerSeatChipLayer, keyed by seat/user/role. Unchanged amounts retain exact nodes/images; pot likewise. Same-hand partial omission preserves known stacks/bets/pot/dealer; explicit authoritative values/maps override, including reset/null. New-hand boundaries reset hand-scoped presentation. Dealer is a persistent scene node positioned by physical geometry. Avatar reuse is keyed by seat/occupant/source; replacement fallback remains until the new image loads.

Layer order: felt/background < normal seat UI < static chips < player names < chip FX < player transient notifications/reactions. Player payouts/settlement and compact non-Hero celebrations stay above their owner; Hero special hand retains large poker-celebration--own. Avatar shake is a transient anchored transform returning to base. Human/bot reaction text is complete, wraps only between normal words, with no ellipsis/hyphenation; edge bubbles may shift inward within scene-safe width. Targeted reaction motion remains avatar-center to avatar-center, with contextual winner Nice hand at the target edge.

## Chrome and account HUD

Fixed compact one-row chrome: hamburger, small CH badge, conditional Join, reaction and history/chat. Technical connection/table/phase/pot/acting information is read-only Diagnostics in existing Table Settings. User-facing errors/reconnect still use compact notices. North transients and chrome have safe separate areas.

Use existing ChipsClient only. Poker is the sum of authoritative fetchPokerProjection().tables stacks; Wallet is exclusively the authoritative fetchBalance() wallet value. Display Wallet: <balance> CH independently. Following js/topbar.js, append Poker: <sum> CH only when projection.inPoker is true and the valid authoritative sum is positive. Empty/zero, unavailable or invalid projection hides the Poker segment, including its loading placeholder; it never changes a valid Wallet. Never display a combined total or exclude the current table. Compact k/M formatting. Never fabricate zero on errors; guests see no authenticated values. Canonical document chips:tx-complete refreshes both reads. Accepted authoritative WS snapshots also refresh both when the current user becomes seated, loses/changes seat or their remaining stack changes. Compare existing merged seat/stack before/after; unrelated turn/pot/opponent updates do not refetch. Projection remains the aggregate source, never a locally calculated Poker amount. Keep identity/generation guards and changed-wallet pulse, excluding initial/error/identity reset and reduced motion. No endpoint, cache, topbar.js or local price subtraction. Remove only table XP badge/dead table-only XP bindings/scripts; XP elsewhere is unchanged.

Preview FX is available only in Table Settings > Diagnostics on PR/Deploy Preview using existing BUILD_INFO signal, absent from normal chrome and Production. Preserve special-hand/winner options. Ordinary fresh JOIN WAITING_NEXT_HAND is reserved/joining-next-hand, not sitout/bust/rebuy; actual OUT_OF_CHIPS and real rebuy remain unchanged.

## Gift integration for #1047

.poker-seat[data-seat-no][data-user-id] identifies the occupant. Exactly three [data-poker-gift-slot] children in [data-poker-gift-slots] sit at predefined equal-radius angles outside avatar clipping. One [data-poker-quick-action-slot] sits at the avatar edge and coordinates with contextual Nice hand. [data-poker-avatar-center], getSeatAvatarAnchor and renderedSeatAnchors provide animation endpoints. #1047 owns gift contents, purchases, no-self, picker, retry/cooldown and delivery; it must reconcile occupant-scoped content after seat rendering. No gift purchase logic here.

## Constraints, verification and gates

JSP-compatible IIFE JS, one physical CSS line per selector, klog only, no dependencies/second runtime/inline script. Preserve authoritative WS/gameplay, rules, stack/ledger, settlement, bot bankroll/progression and XP outside Poker Table. Browser-only scope; no WS deploy or Production mutation.

Only existing fundamental deterministic tests (private lifecycle, partial-frame/DOM ownership, reaction/settlement and account pure logic) and required repo checks. No broad UI/CSS/JSP suite or collision matrix. Real Deploy Preview and owner visual review remain required; authenticated Stage CH verification is pending. Draft, not merge-ready; do not merge.

Final tree keeps only spec.md, plan.md, tasks.md and review.md under this feature directory. No screenshots or historical evidence JSON are shipped; detailed iteration evidence stays on live GitHub/PR and in Git history.

## Breaking impact

Poker Table presentation changes substantially: physical HUD anchors, premium composition, compact opponent indicators/chrome and CH instead of XP. Gameplay/API/WS/backend/accounting contracts remain unchanged. Final cleanup adds no behavior change and removes only unreferenced v1 artwork and historical review artifacts.

## Player-name stacking contract

Both orientations preserve felt/normal seat UI < static chips < player names < chip FX/player notifications/reactions/celebrations. Only names use the scene-owned name layer (z-index 5), between static chips (4) and effects (12/20/100). Existing avatar/seat layer (3), name anchors, widths, font sizes and folded opacity remain unchanged; 20px portrait/26px landscape line-height and min-height prevent descender clipping without moving those anchors. No new UI/CSS/glue tests; reuse existing checks and narrow portrait/landscape Preview visual smoke.

## Portrait room event lines

Portrait status remains the same viewport-owned persistent node; no box/font/anchor/text-source changes. Paint its existing gradient only below a4-visible-px inset (7px at portrait max-height:820px). Bound Hero-card shadows to inset and Hero-avatar paint to the existing4px halo, without moving/resizing HUD. Short-portrait Hero-card lift is8 scene px, below the measured safe upper limit (~8.9px at320×640 with6px glyph clearance); tall portrait card anchor/rotation/size and landscape are unchanged. Minimum6px clearance is measured from complete card visual footprint to painted status background; both upper and lower visual budgets matter, not card border boxes alone. No dynamic layout/collision engine, new state, WS or gameplay change.
