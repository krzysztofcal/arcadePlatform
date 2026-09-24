# Feature Specification: Poker cinematic celebrations

**Feature Branch**: `795-poker-celebrations` | **Created**: 2026-09-23 | **Status**: Implementation brief
**Input**: https://github.com/krzysztofcal/arcadePlatform/issues/795 (authoritative scope).

## V3 delta — 2026-09-24 (continues the accepted v2 presentation)

Continue the same draft PR #1016 from confirmed v2 HEAD `36929e216d3919266a20fe29310ed7bb7f0f4c1d`. Preserve its approved large first-person and compact avatar-anchored variants, Winner, settings, touch previews and game flow. Use one overlay and one selected effect per result; Royal Flush > Monster Pot > Win Streak. Start only from a newly observed authoritative settled-hand transition.

Both variants now complete a natural entrance, impact and fade/flyout in about 2 seconds total: 1600 ms hero plus 400 ms decorative exit. Normal hand, reveal, turn, action, snapshot and due-time changes never cut a started effect short. A new hand/turn immediately makes a remaining large effect translucent enough to read gameplay while it finishes. Explicit OFF, reduced motion, navigation/unmount, identity/seat change and unsafe session loss may clear it immediately. The effect never changes Winner, reveal deadlines, snapshots, actions or gameplay timing.

Automatic Royal cards must be the exact five verified same-suit cards from the current hand and legally visible to that viewer. Live rendering has no synthetic-card fallback. Automatic Monster Pot displays that winner's verified contested main/side award sum as `WIN {amount} CH`, excluding returns and other recipients. Win Streak counts newly observed consecutive results locally per table and user; split awards count for each recipient, known losses reset, and reconnect/reload/rejoin/uncertain continuity starts at zero. No persisted history or backend source is added. Synthetic cards, amounts and streak counts remain clearly labeled PR Preview FX.

PR-only touch Preview FX adds My win (large) / Other player-bot (small near avatar), reused for all three kinds. The latter requires an actual visible nonlocal seat, otherwise disabled with an explanation. No fabricated winner, private cards, network call or game-state mutation. Physical Android and natural rare triggers remain owner acceptance, separately from browser emulation.

## User Scenarios & Testing

### US1 — Royal Flush and touch preview (P1)

Players can enjoy a gold/platinum five-card Royal Flush on the actual V2 table. A live effect renders the exact verified royal with its real suit; when those cards cannot be proven for that viewer, it shows no cards. On a genuine PR deploy, joining a table exposes Preview FX; choosing Royal Flush closes the panel and plays a labeled demonstration without a console or a fictitious result. Controls and real cards remain visible and usable throughout.

### US2 — Preferences and other variants (P2)

Guests and signed-in players can disable Celebration animations in existing Table settings. Default is ON; refresh preserves their separate choices. OFF clears active FX immediately and retains normal results/payouts. Reduced motion skips effects. PR Preview FX includes Monster Pot and selectable Win Streak ×5, ×6, ×7, ×8 and ×12 demos.

### US3 — Verified live moments (P2)

A same-hand observed transition to SETTLED can play at most one effect: Royal Flush before Monster Pot before Win Streak. Royal requires a confirmed award recipient and a proven suited A/K/Q/J/10 from legally visible cards. Monster Pot requires one player's verified contested main/side awards totaling at least 5× authoritative buy-in, excluding returns, and shows that exact individual award. Win Streak increments exactly once from complete, newly observed results within the current uninterrupted client session; it shows the actual count from ×5 onward and resets to zero on reconnect/resync, reload, rejoin, identity/seat change or uncertain sequence. Missing or invalid data suppresses the effect.

### Edge cases

Initial/reconnect/resync/stale snapshots, repeated results, missing payout/buy-in, ordinary straight flush, splits, returned chips, missing/out-of-order hand results, next-hand snapshots held by existing reveal, identity switch, navigation, OFF during animation and reduced-motion changes must fail closed or reset/clear FX. Sit-outs add no result; folds are known losses; an uncalled return is not a win.

## Requirements

- FR-001: Browser-only disposable decoration; no changes to game timing, snapshots, rules, payouts, WS, DB, ledger, or authoritative state.
- FR-002: Automatic and manual effects start on a valid event and last about 2 seconds total, including the 400 ms decorative exit. Do not suppress a valid effect because little or no Winner reveal time remains. Normal transitions never shorten it; when gameplay resumes, dim it immediately and finish without delaying game flow. No queue, new deferral or reveal-time change.
- FR-003: Overlay is noninteractive, above table gameplay art and below controls/menus/dialogs; own-win overlap of Winner is allowed only within the existing reveal window. Bounded particles; no strobe, shake, sound, 3D runtime, new framework or dependency.
- FR-004: Preview exists only when build context is deploy-preview AND isPreview is true, fails closed otherwise, has no global debug API and no network/game mutations. All three variants are explicitly labeled previews.
- FR-005: Extend existing normalized preferences and per-user storage; isolated guest celebration key; changes and session/identity/table loss clear FX immediately.
- FR-006: Real events dedupe by table and hand; never replay initial or already-consumed results. Track all confirmed local-session wins per table and user, including bots, exactly once. Display the actual consecutive count from ×5 onward; reset all streaks on reconnect/resync/reload/rejoin, identity/seat/table change or uncertain sequence. No history persistence.

## Key Entities

Transient celebration: visual variant, legally visible royal cards if applicable, table/hand identity, absolute end time, demo flag. Preference: celebration enabled per browser guest or signed-in identity. No persisted gameplay entities.

## Success Criteria

- All three previews can be invoked by touch after joining on Android and desktop, without network mutations.
- OFF persists across refresh and is isolated from signed-in preferences; reduced motion produces no dynamic celebration.
- Automatic effects never extend reveal, block actions or obscure next-hand information; decorative residue ends within 500 ms.
- Invalid/duplicate/reconnect data produces no automatic effect; live royal cards match the actual five-card combination and suit; Monster Pot shows the exact individual award; true streaks advance ×5→×6→×7 and reset correctly.
- One draft PR and actual working PR deploy delivered for artistic and real-device acceptance; no Production deploy or merge.

## Assumptions

5× remains the proposed threshold for owner review; 8× is an alternative only if preview feedback requests it. Use existing CSS/assets first. Only independent critical deterministic classification/deadline/dedupe tests, no new presentation/glue suites.

## V3 observed-result rules

- A positive recipient award from a main/side pot is a win; split-pot recipients each receive a result. A user eligible for a contested pot but absent from its positive recipients is a known loss. A folded seat is a known loss. A sit-out is neither a win nor a loss. A return-only hand is not a win and resets that recipient's streak.
- Process a result only from a newly observed non-initial same-hand transition to SETTLED with a valid `buildSettlementPresentation()`, a distinct `handId`, and a strictly newer accepted version. If a previous hand changes before its result was observed, the complete result is invalid, or ordering/continuity is uncertain, clear local counts; the next fully observed result starts at one.
- Counts exist only in this page's memory. They are never seeded from an initial settled snapshot or storage and are discarded on disconnect, reconnect, resync, reload, table/seat/user identity change or leaving/rejoining.
