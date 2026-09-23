# Feature Specification: Poker cinematic celebrations

**Feature Branch**: `795-poker-celebrations` | **Created**: 2026-09-23 | **Status**: Implementation brief
**Input**: https://github.com/krzysztofcal/arcadePlatform/issues/795 (authoritative scope).

## User Scenarios & Testing

### US1 — Royal Flush and touch preview (P1)

Players can enjoy a gold/platinum five-card Royal Flush on the actual V2 table. On a genuine PR deploy, joining a table exposes Preview FX; choosing Royal Flush closes the panel and plays a labeled demonstration without a console or a fictitious result. Controls and real cards remain visible and usable throughout.

### US2 — Preferences and other variants (P2)

Guests and signed-in players can disable Celebration animations in existing Table settings. Default is ON; refresh preserves their separate choices. OFF clears active FX immediately and retains normal results/payouts. Reduced motion skips effects. Monster Pot and Win Streak ×5 have touch previews; streak is preview-only because reconnect snapshots cannot prove consecutive results.

### US3 — Verified live moments (P2)

A same-hand observed transition to SETTLED can play at most one effect: Royal Flush before Monster Pot. Royal requires a confirmed award recipient and a proven suited A/K/Q/J/10 from legally visible cards. Monster Pot requires one player's verified contested main/side awards totaling at least 5× authoritative buy-in, excluding returns. Missing or invalid data suppresses the effect.

### Edge cases

Initial/reconnect/resync/stale snapshots, repeated results, missing payout/buy-in, ordinary straight flush, splits, returned chips, short reveal windows, next-hand snapshots held by existing reveal, identity switch, tab hiding, navigation, OFF during animation, and reduced-motion changes must fail closed or clear FX. No uncertain live streak tracking.

## Requirements

- FR-001: Browser-only disposable decoration; no changes to game timing, snapshots, rules, payouts, WS, DB, ledger, or authoritative state.
- FR-002: Full automatic hero ends within the earliest existing local/authoritative reveal deadline. Target 2–2.5 seconds total; skip when insufficient time remains. Decorative ring-only exit ≤500 ms; new hand/turn removes text/cards immediately. No queue or new deferral.
- FR-003: Overlay is noninteractive, below gameplay layers, scoped away from action/turn/result/leave/rebuy areas. Bounded particles; no strobe, shake, sound, 3D runtime, new framework or dependency.
- FR-004: Preview exists only when build context is deploy-preview AND isPreview is true, fails closed otherwise, has no global debug API and no network/game mutations. All three variants are explicitly labeled previews.
- FR-005: Extend existing normalized preferences and per-user storage; isolated guest celebration key; changes and session/identity/table loss clear FX immediately.
- FR-006: Real events dedupe by table and hand; never replay initial or already-consumed results. Live streak deferred.

## Key Entities

Transient celebration: visual variant, legally visible royal cards if applicable, table/hand identity, absolute end time, demo flag. Preference: celebration enabled per browser guest or signed-in identity. No persisted gameplay entities.

## Success Criteria

- All three previews can be invoked by touch after joining on Android and desktop, without network mutations.
- OFF persists across refresh and is isolated from signed-in preferences; reduced motion produces no dynamic celebration.
- Automatic effects never extend reveal, block actions or obscure required information; decorative residue ends within 500 ms.
- Invalid/duplicate/reconnect data produces no automatic effect; correct royal and 5× per-recipient award classify correctly.
- One draft PR and actual working PR deploy delivered for artistic and real-device acceptance; no Production deploy or merge.

## Assumptions

5× remains the proposed threshold for owner review; 8× is an alternative only if preview feedback requests it. Use existing CSS/assets first. Only independent critical deterministic classification/deadline/dedupe tests, no new presentation/glue suites.
