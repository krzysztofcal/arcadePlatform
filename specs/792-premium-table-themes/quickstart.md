# Preview verification — #792

## Current design milestone

Open the Draft PR Deploy Preview at `/specs/792-premium-table-themes/design/`. All six visual boards, component detail notes and unchanged baseline captures must load. The gallery is static review material and does not implement or demonstrate product switching. Open `/poker/table-v2.html` for the existing table; runtime files must be unchanged at this milestone.

## After owner approval and implementation

1. Open the latest Draft PR Deploy Preview; record URL and deployed SHA. Use `/poker/table-v2.html` in demo and an existing preview table for live checks.
2. Table menu → Table settings → Diagnostics → Preview FX → Theme. Select all six complete packages, then Classic. Check every component, readable ranks/suits and unchanged default. Reload must restore Classic.
3. Repeat as guest/spectator, seated user, reconnecting user and during live dealing/showdown/fold. Existing celebration/gift demos must remain gated as before. Check theme-only selection creates no account writes or WS/gameplay messages.
4. With identical viewport, demo state and scene orientation, wait for existing animations to settle, then compare bounding boxes of `#pokerRoomDealer`, `.poker-seat-avatar`, `.poker-seat-hud`, `#pokerCommunityCards`, `#pokerHeroCards`, `#pokerDealerChip`, `#pokerAccountHud`, `#pokerActionBar` and its visible buttons before/after at 390×844, 844×390 and 1440×900; expect 0 CSS-pixel displacement and no added document scroll. Inspect dealer hand/origin alignment and its overlay clip.
5. Keyboard: reach/open/select via native select; verify label, focus and status. Emulate reduced motion: static switch, no new animation. Check UI text/card suit contrast and smallest opponent faces.
6. Temporarily block one requested asset in browser tooling; expect retained current complete scene and readable error. Select A→B→Classic rapidly with delayed loads; expect Classic final. Cached selection target ≤100 ms on the recorded device.
7. Inspect non-preview or absent BUILD_INFO: chooser absent, Classic unchanged. Do not spoof production metadata in shipped code.
8. Run `node --check poker/poker-v2.js` and `npm run check:csp-inline`; record output. No UI/CSS/glue test suite is added. Any actual WS/protocol diff requires revisiting the exact-SHA WS Preview Deploy gate.

Before final handoff review the actual diff, complete optimized artwork manifest and limitations. Keep Draft; never merge or deploy Production. Any unperformed live runtime scenario remains explicitly pending.
