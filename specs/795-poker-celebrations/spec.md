# Feature Specification: Poker cinematic celebrations

**Feature Branch**: `795-poker-celebrations` | **Created**: 2026-09-23 | **Status**: Implementation brief
**Input**: https://github.com/krzysztofcal/arcadePlatform/issues/795 (authoritative scope).

## V5 delta — 2026-09-24 (six verified winning hands)

Continue from the current v4 HEAD `94c90f5a513626fe2cde0a560101a5e4f0baf31d` in the same open draft PR #1016. Preserve every accepted v4 behavior, including its fixed `userId + seatNo` compact target and no-fallback Preview FX selection.

The same existing Royal Flush card celebration now applies to a confirmed winning best five of Straight, Flush, Full House, Four of a Kind, non-royal Straight Flush, or Royal Flush. Every category uses the same art, layout, size by viewer ownership, 1600 ms hero and 400 ms exit. Only the title and its five actual winning cards vary. The existing evaluator chooses the true best category and five; do not substitute a lower qualifying combination.

Live cards require a confirmed positive contested-pot award and sufficient proof: the viewer's two current cards or both publicly revealed opponent cards plus the board. A public-board Royal Flush is independently exact proof because no private cards can improve it. For every other category, a board without both hole cards cannot prove the winner's best five and must not trigger hand art. Missing, malformed or contradictory cards fail closed. Never inspect or reveal unrevealed opponent cards.

Selection remains one effect per result: a verified hand celebration takes precedence over Monster Pot, which takes precedence over Win Streak; within eligible hand winners retain the existing viewer-first traversal. Existing calculations, streak counting, awards, presentation sizes, Winner and game flow remain unchanged.

Keep the Preview FX button behind its current deploy-preview metadata gate. Add synthetic demos for all six hand titles/cards in both existing presentation modes, retaining Monster Pot, Win Streak and exact selected-opponent revalidation. Demo cards are never live result data. Expand the existing fundamental settlement-selection test only; add no UI, CSS, layout or glue suite.

## V3 delta — 2026-09-24 (continues the accepted v2 presentation)

Continue the same draft PR #1016 from confirmed v2 HEAD `36929e216d3919266a20fe29310ed7bb7f0f4c1d`. Preserve its approved large first-person and compact avatar-anchored variants, Winner, settings, touch previews and game flow. Use one overlay and one selected effect per result; Royal Flush > Monster Pot > Win Streak. Start only from a newly observed authoritative settled-hand transition.

Both variants now complete a natural entrance, impact and fade/flyout in about 2 seconds total: 1600 ms hero plus 400 ms decorative exit. Normal hand, reveal, turn, action, snapshot and due-time changes never cut a started effect short. A new hand/turn immediately makes a remaining large effect translucent enough to read gameplay while it finishes. Explicit OFF, reduced motion, navigation/unmount, identity/seat change and unsafe session loss may clear it immediately. The effect never changes Winner, reveal deadlines, snapshots, actions or gameplay timing.

Automatic Royal cards must be the exact five verified same-suit cards from the current hand and legally visible to that viewer. Live rendering has no synthetic-card fallback. Automatic Monster Pot displays that winner's verified contested main/side award sum as `WIN {amount} CH`, excluding returns and other recipients. Win Streak counts newly observed consecutive results locally per table and user; split awards count for each recipient, known losses reset, and reconnect/reload/rejoin/uncertain continuity starts at zero. No persisted history or backend source is added. Synthetic cards, amounts and streak counts remain clearly labeled PR Preview FX.

PR-only touch Preview FX adds My win (large) / Other player-bot (small near avatar), reused for all three kinds. The latter requires an actual visible nonlocal seat, otherwise disabled with an explanation. No fabricated winner, private cards, network call or game-state mutation. Physical Android and natural rare triggers remain owner acceptance, separately from browser emulation.

## V4 delta — 2026-09-24 (compact anchor safety and explicit preview target)

Continue v3 on the same open draft PR #1016 from its current HEAD. A live compact effect is bound to the verified winner's exact `userId + seatNo` for its complete lifetime, including the ring-only tail. Existing render/layout reposition calls resolve that same seat each time and move the effect with its visible avatar. If identity or seat ownership changes, clear immediately. If the same seat remains but its geometry or safe placement temporarily becomes unavailable, fade the effect promptly and clear it within its original two-second maximum lifetime; never leave visible art at an obsolete position or switch to another avatar. A compact effect with no valid visible anchor at start is skipped. Large self-win behavior is unchanged.

In PR-only Preview FX, retain the large self-win option and add a selector for a specific currently visible opponent/bot when compact mode is selected. Royal Flush, Monster Pot, and Win Streak demos all use exactly that selected seat. Refresh the available options with table/layout rendering while retaining the selection only if the same user remains visible. A missing or stale selection disables/fails the compact demo safely, with no implicit fallback to another seat. All demos remain synthetic and labeled; the preview gate and live gameplay stay unchanged.

## User Scenarios & Testing

### US1 — Verified winning hands and touch preview (P1)

Players can enjoy the existing gold/platinum five-card effect for a confirmed Straight, Flush, Full House, Four of a Kind, Straight Flush or Royal Flush win on the actual V2 table. Live art renders exactly that verified best five and its title; when the winner's exact hand cannot be proven for that viewer, it does not show cards. On a genuine PR deploy, Preview FX demonstrates all six categories using clearly synthetic legal hands in both large own-win and compact selected-opponent modes. Controls and real cards remain visible and usable throughout.

### US2 — Preferences and other variants (P2)

Guests and signed-in players can disable Celebration animations in existing Table settings. Default is ON; refresh preserves their separate choices. OFF clears active FX immediately and retains normal results/payouts. Reduced motion skips effects. PR Preview FX includes Monster Pot and selectable Win Streak ×5, ×6, ×7, ×8 and ×12 demos.

### US3 — Verified live moments (P2)

A same-hand observed transition to SETTLED can play at most one effect: a proven qualifying hand before Monster Pot before Win Streak. Hand proof uses the actual best five and never hidden opponent cards. Monster Pot requires one player's verified contested main/side awards totaling at least 5× authoritative buy-in, excluding returns, and shows that exact individual award. Win Streak increments exactly once from complete, newly observed results within the current uninterrupted client session; it shows the actual count from ×5 onward and resets to zero on reconnect/resync, reload, rejoin, identity/seat change or uncertain sequence. Missing or invalid data suppresses the effect.

### Edge cases

Initial/reconnect/resync/stale snapshots, repeated results, missing payout/buy-in/cards, unproven best hands from a hidden opponent, splits, returned chips, missing/out-of-order hand results, next-hand snapshots held by existing reveal, identity switch, navigation, OFF during animation and reduced-motion changes must fail closed or reset/clear FX. Sit-outs add no result; folds are known losses; an uncalled return is not a win.

## Requirements

- FR-001: Browser-only disposable decoration; no changes to game timing, snapshots, rules, payouts, WS, DB, ledger, or authoritative state.
- FR-002: Automatic and manual effects start on a valid event and last about 2 seconds total, including the 400 ms decorative exit. Do not suppress a valid effect because little or no Winner reveal time remains. Normal transitions never shorten it; when gameplay resumes, dim it immediately and finish without delaying game flow. No queue, new deferral or reveal-time change.
- FR-003: Overlay is noninteractive, above table gameplay art and below controls/menus/dialogs; own-win overlap of Winner is allowed only within the existing reveal window. Bounded particles; no strobe, shake, sound, 3D runtime, new framework or dependency.
- FR-004: Preview exists only when build context is deploy-preview AND isPreview is true, fails closed otherwise, has no global debug API and no network/game mutations. All three variants are explicitly labeled previews.
- FR-005: Extend existing normalized preferences and per-user storage; isolated guest celebration key; changes and session/identity/table loss clear FX immediately.
- FR-006: Real events dedupe by table and hand; never replay initial or already-consumed results. Track all confirmed local-session wins per table and user, including bots, exactly once. Display the actual consecutive count from ×5 onward; reset all streaks on reconnect/resync/reload/rejoin, identity/seat/table change or uncertain sequence. No history persistence.
- FR-007: A live compact effect remains bound to the winning `userId + seatNo` through its full lifetime, including the decorative tail. Existing layout/render updates reposition it beside only that seat's current visible avatar. Identity/seat replacement clears immediately; temporary invalid geometry or unsafe placement fades the effect promptly, within the original lifetime, and never falls back to another seat. If the initial anchor is invalid, do not start.
- FR-008: PR-only Preview FX allows selecting a specific currently visible opponent/bot for every compact Royal Flush, Monster Pot and Win Streak demo. Each activation revalidates that exact selection. A stale/missing selection safely skips the demo without silently changing targets. The large demo, preview-only gate and synthetic labels remain.
- FR-009: Verified best five-card Straight, Flush, Full House, Four of a Kind, Straight Flush and Royal Flush wins use the same existing card art, dimensions and timing. Live selection must prove the exact best five from the viewer's own or publicly revealed cards; only a public-board Royal Flush can qualify without both hole cards. Hand art outranks Monster Pot and Win Streak. Preview FX retains all previous demos and adds both sizes for these six hand categories.

## Key Entities

Transient celebration: `hand|pot|streak` kind, optional verified five-card hand title/cards, visual variant, table/hand identity, absolute end time, demo flag, and for compact effects the fixed winner `userId + seatNo`. Preference: celebration enabled per browser guest or signed-in identity. No persisted gameplay entities.

## Success Criteria

- All three previews can be invoked by touch after joining on Android and desktop, without network mutations.
- OFF persists across refresh and is isolated from signed-in preferences; reduced motion produces no dynamic celebration.
- Automatic effects never extend reveal, block actions or obscure next-hand information; decorative residue ends within 500 ms.
- Invalid/duplicate/reconnect data produces no automatic effect; live royal cards match the actual five-card combination and suit; Monster Pot shows the exact individual award; true streaks advance ×5→×6→×7 and reset correctly.
- One draft PR and actual working PR deploy delivered for artistic and real-device acceptance; no Production deploy or merge.
- During the complete compact effect, portrait/landscape reflow follows only the original winner's avatar; temporarily unsafe placement fades within the same lifetime, while a changed seat identity clears safely.
- Each of the three compact previews anchors at the exact currently selected visible opponent/bot; removing or hiding that selection never redirects a demo to another seat.
- Each of the six live hand categories displays its authentic best five with the same Royal Flush presentation and timing; hidden or unverified cards never reach the renderer.
- Preview FX remains available on valid PR Deploy builds and demos all six hand categories in both ownership sizes alongside Monster Pot and Win Streak. Live selection order is hand, Monster Pot, then Win Streak.

## Assumptions

5× remains the proposed threshold for owner review; 8× is an alternative only if preview feedback requests it. Use existing CSS/assets first. Only independent critical deterministic classification/deadline/dedupe tests, no new presentation/glue suites.

## V3 observed-result rules

- A positive recipient award from a main/side pot is a win; split-pot recipients each receive a result. A user eligible for a contested pot but absent from its positive recipients is a known loss. A folded seat is a known loss. A sit-out is neither a win nor a loss. A return-only hand is not a win and resets that recipient's streak.
- Process a result only from a newly observed non-initial same-hand transition to SETTLED with a valid `buildSettlementPresentation()`, a distinct `handId`, and a strictly newer accepted version. If a previous hand changes before its result was observed, the complete result is invalid, or ordering/continuity is uncertain, clear local counts; the next fully observed result starts at one.
- Counts exist only in this page's memory. They are never seeded from an initial settled snapshot or storage and are discarded on disconnect, reconnect, resync, reload, table/seat/user identity change or leaving/rejoining.
