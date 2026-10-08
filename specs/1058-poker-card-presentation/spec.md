# #1058 — Poker card presentation

Source: live GitHub issue #1058, accepted 2026-10-07.

## Goal

Add a focused **Poker card presentation & motion polish** pass after #1049 is merged, without reopening the accepted table/HUD layout.

Owner reference screenshots show several card-specific interactions that make the table feel substantially more polished. The current Poker V2 architecture after #1049 already has deterministic SeatHud card anchors, persistent Hero-card ownership, authoritative showdown/reveal state, player participation/card-back indicators, dealer/scene geometry and existing cosmetic FX layers. This issue should build on those contracts rather than redesigning the table again.

Dependency: implement **after #1049**. Do not extend #1049 with this scope.

## 1. Highlight only the cards forming Hero's made hand

Amendment: [owner visual-smoke correction, 2026-10-08](https://github.com/krzysztofcal/arcadePlatform/issues/1058#issuecomment-6062594479). This supersedes the original instruction to highlight all best-five cards.

Reuse `getHeroBestHand()` and its existing evaluated category/selected best five. Derive the minimal figure subset from that result; do not introduce another evaluator or change hand ranking.

| Evaluated category | Highlight |
| --- | --- |
| High Card | None |
| Pair | The two paired cards |
| Two Pair | The four paired cards |
| Trips | The three matching cards |
| Straight | All five straight cards |
| Flush | All five flush cards |
| Full House | All five cards |
| Quads | The four matching cards, excluding the kicker |
| Straight Flush / Royal Flush | All five cards |

Cards may come from any Hero + board combination. Hero need not contribute: a figure entirely on the board highlights the corresponding board cards. Kickers and unused cards remain normal.

Apply only the existing border/glow presentation to already-rendered cards, using made-hand naming for highlight helpers/classes. Preserve card readability, suit colors, fold treatment, reduced motion and persistent Hero nodes. No highlight without a valid evaluated five-card hand or authoritative Hero private cards. No gameplay, winner, WS, protocol or evaluator changes.

## 2. Improve opponent private-card presentation and add authoritative showdown flip

Owner request:
- Current non-Hero private-card indicators are too small and visually weak.
- Replace/refine them into a more intentional pair of small facedown cards near the player's avatar.
- The two cards should slightly overlap and use small opposing rotations so they read immediately as real hole cards, like in the reference screenshots.
- When an opponent's cards are authoritatively revealed at showdown, animate the cards turning over around their long/vertical axis into their real faces.

Implementation analysis:
- Keep this tied to the existing SeatHud `cards` anchor; do not return to free-floating measured layout.
- #1048 intentionally introduced compact opponent-card indicators. This issue may supersede their visual size/style, but must preserve the deterministic anchor and avoid reclaiming central felt or colliding with name/action/gift/chip/dealer anchors.
- Use the existing authoritative showdown/reveal data. Never reveal a card that the WS/runtime has not actually made public.
- Card flip is cosmetic only: facedown -> ~90deg Y rotation -> face content swap -> 0deg.
- Animate only a genuine authoritative hidden-to-revealed transition. Initial page load/reconnect/resync that already contains revealed cards should render the final state directly rather than replaying stale animation.
- Repeated/duplicate snapshots must not replay the flip.
- `prefers-reduced-motion` should render the final revealed face without the flip.

Acceptance:
- Normal opponent participation shows two crisp, readable, compact card backs without numeric 0/1/2 labels.
- Authoritative showdown reveal flips the correct cards once.
- No hidden information leak.
- Reconnect/resync stays deterministic.

## 3. Fast dealing animation from the room dealer to every participating seat

Owner request:
- Add a short visual deal animation at the start of a hand, similar to the reference screenshots: cards travel from the woman/room-dealer area to each participating player's private-card anchor.
- It should be fast enough that six-player play never feels delayed.

Implementation analysis:
- Reuse the current cosmetic-FX model used by chip/reaction motion: **authoritative state owns the game; animation is only a passenger**.
- The animation must never delay or gate WS state, actions, turn timing or card availability.
- Prefer a dedicated scene-owned card FX layer rather than moving the persistent authoritative card DOM.
- Use SeatHud card/avatar anchors for destinations.
- Add one stable scene-level **deal origin** representing the visual room dealer's hand/area. Keep it separate from the poker Dealer `D` button, which is gameplay state and not the source of the visual deal.
- Suggested visual sequence: one quick card to each participating seat, then the second round, with small stagger; exact timing should be tuned on Preview and kept compact.
- Initial snapshot/reconnect/resync must not replay an old deal.
- Reduced motion renders the final state immediately.

Acceptance:
- New-hand authoritative participation can trigger one short deal sequence.
- Card trajectories terminate at the correct SeatHud card anchors.
- No duplicate/replayed dealing on ordinary same-hand patches.
- No impact on gameplay timing or WS authority.

## 4. Fold / muck animation

Owner request:
- On fold, cards should visibly move from that player's private-card position toward the table/muck area and then fade out, approximately a one-second fade as a visual reference.
- Owner especially wants this for Hero fold, but the same presentation may be used for other players where the client has visible card-back presentation.

Implementation analysis:
- Do **not** clear authoritative Hero hole-card state merely to create the animation. #1048 fixed same-hand private-card ownership and that lifecycle safety must remain.
- This issue may intentionally change the **visual presentation after fold**: internal authoritative card state can remain retained while a scene-owned card-FX copy performs the muck animation and the normal folded presentation is hidden/de-emphasized according to the final accepted design.
- The fold animation is triggered by a genuine authoritative transition to folded state, not by an optimistic button click.
- Duplicate snapshots/reconnect must not replay the muck.
- Reduced motion skips motion/fade and shows the stable folded result immediately.

Acceptance:
- One authoritative fold transition -> one discard/muck animation.
- No stale-card lifecycle regression, no hidden-card leak and no replay on resync.

## Owner amendment: action / pre-action presentation — 2026-10-08

[Latest owner requirement](https://github.com/krzysztofcal/arcadePlatform/issues/1058#issuecomment-6062733792): off-turn controls show the checkbox and queue the existing pre-action. On Hero's authoritative active turn, hide checkbox presentation and use existing immediate Fold / Check-or-Call / Raise-or-Bet / All-in controls. Hidden pre-actions are disabled. Keep the existing action model and availability/keyboard semantics.

Reserve identical label padding and dimensions in both modes; no control, text or neighbor moves when modes switch. Retain existing DOM controls/order. Fundamental tests cover waiting/queueing, active-turn immediate execution and retained structure; verify layout stability externally on real Preview, without pixel/layout test suites.

## Card backs are part of the future table-skin visual language

Owner explicitly likes the idea that card backs should become part of a future table skin/theme.

Design this issue so the new opponent card-back treatment is **replaceable by a future TableSkin contract** together with room/felt/dealer/wood/accent styling.

Do **not** build a full skin engine in this issue (YAGNI). There is currently only one accepted skin.

But avoid hard-coding the new card-back design in a way that would require rewriting card lifecycle/SeatHud code to add a second skin later. Prefer one small visual hook/class/asset boundary so a future skin can substitute the back pattern without touching poker state logic.

The same principle may be used for the scene-level visual deal origin: it belongs to presentation/scene geometry, not poker rules.

## Preserve #1049 architecture

Do not reopen the accepted layout.

Preserve:
- one Poker V2 runtime;
- deterministic SeatHud geometry;
- portrait/landscape geometry ownership;
- one-viewport/no-scroll contract;
- existing player/chip/dealer/reaction/settlement anchors;
- persistent Hero card lifecycle rules;
- authoritative showdown/privacy semantics;
- existing action controls and CH HUD;
- existing center/status layout;
- JSP-compatible browser JS;
- klog for diagnostics, never `console.log`;
- one physical CSS line per selector.

No backend/WS/protocol change unless repo review proves an authoritative event/data gap prevents a requested effect.

## Suggested implementation order

1. Made-hand Hero/board highlighting.
2. Improved opponent card backs.
3. Authoritative showdown flip.
4. Deal animation.
5. Fold/muck animation.

This order deliberately gets the low-risk/high-value visual improvements in first, then adds lifecycle-sensitive motion after the static card presentation is stable.

## Testing / verification

Write only fundamental deterministic tests:
- made-hand selection uses the existing evaluator result: fundamental cases for every category above and board-only figures, excluding High Card and kickers;
- authoritative opponent reveal transitions only once and never leaks unrevealed cards;
- deal FX starts only on a genuine new-hand/dealt transition and does not replay on same-hand/reconnect/resync;
- fold FX starts only on a genuine authoritative fold transition;
- Hero private-card state remains lifecycle-safe even if folded presentation animates away.

Do not add broad CSS/layout/screenshot/JSP test matrices.

Use real Deploy Preview visual smoke for portrait + landscape, including:
- made-hand highlight, including board-only figures and excluded kickers;
- normal opponent card backs;
- one real/fixture authoritative showdown reveal;
- one new-hand deal;
- one fold/muck;
- reduced-motion sanity;
- no new scroll/collisions.

If the implementation changes `ws-server/**`, WS runtime deps under `shared/**`, or browser/WS protocol contracts, follow the required exact-SHA WS Preview Deploy gate before E2E. Otherwise keep this browser-only.

## Out of scope

- Full TableSkin/theme selector/engine.
- New card-state WS fields merely for animation.
- Equity/hand-strength percentage/bar.
- Rank/level/gift redesign.
- New table geometry or 7+ seat support.
- Gameplay timing/rules changes.



## Owner amendment: community-card deal — 2026-10-08

[Latest owner amendment](https://github.com/krzysztofcal/arcadePlatform/issues/1058#issuecomment-6063949580): animate authoritative same-hand board 0→3 as three ordered dealer-to-slot deals; 3→4 only the fourth card; 4→5 only the fifth. Reuse poker-card-fx-layer, existing card primitives and claims. Final authoritative state renders independently; FX never gates gameplay. Initial/reconnect/resync populated board and reduced motion skip historical motion. Duplicate frames cannot replay; hand/table identity boundaries reset claims. Preserve all accepted highlights, other card FX, private lifecycle, controls, geometry and WS/gameplay contracts.

Fundamental transition tests only: 0→3, 3→4, 4→5, duplicates and initial/reconnect/resync/reduced-motion suppression. Verify trajectory/order on real Preview portrait and landscape outside the repo; no timing/pixel/CSS matrices.

## Final owner-smoke corrections

Back to lobby → Yes must use existing leave/queued leave, retry/reconnect and confirmed removal flow before returning to /poker/. Trace the actual failure rather than bypassing leave. Add one fundamental full-flow regression; preserve server semantics. Short landscape must keep the northern settlement/hand/reaction column inside the clipped screen without covering the avatar. Keep scene anchors/geometry and portrait/normal landscape intact. Verify short 1000×300 and normal portrait/landscape externally; no pixel/CSS test matrices.
