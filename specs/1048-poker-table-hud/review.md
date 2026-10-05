# Owner corrections — implementation ready, awaiting manual visual smoke

Both earlier layouts remain unaccepted: the initial seat-grid/card-panel FAILED owner smoke; the replacement at a19e4e2 still needed correction. Old 20/20 and 40+4 matrices are superseded, not acceptance evidence.

## What changed

- Hero best hand again uses the original capsule styling and label, with all five symbols in one horizontal row. No grid.
- Action controls are a compact lower-right rail with vertical amount slider. Hero is shifted left; the scene uses the space below the header rather than losing a full-width action row. Static portrait/landscape seat variants reserve that corner.
- Action/status badges sit on avatar edges. Non-hero hole-card controls are replaced by tiny facedown count indicators; hero cards remain larger. Existing public betThisRoundByUserId membership identifies dealt-in participants, including zero bets and FOLDED users. Waiting/out-of-hand seats show 0; confirmed participants show 2. No hypothetical 1 or private ranks/suits are invented.
- Reaction/history popups are absolute to their buttons. The old portrait fixed + top:100% rule put the history at y=852 in an 844px viewport despite a successful click. The lower history z-index override is removed so canonical social stacking stays above Preview FX.
- Existing Nice Hand affordance uses the avatar-edge quick-action anchor. Targeted effects use sender and recipient avatar centers, not social bubble anchors.

## Intentionally unchanged

One Poker V2 runtime/renderer and original assets. No table-v3, purchases, gift_send, retry/cooldown, new catalog/service/dependency, WS/backend/protocol/config, accounting, poker actions/rules, settlement/reveal logic, stacks, bot bankroll or XP outside Poker Table changes. table-v2.html and accepted CH HUD logic remain unchanged in this correction: existing ChipsClient, canonical document event, authoritative refresh, identity/generation guards, Other tables exclusion and wallet pulse. No new inline script; CSP guard passed.

## #1047 integration contract

Seat identity remains `.poker-seat[data-seat-no][data-user-id]`. Exactly three `[data-poker-gift-slot]` anchors are outside the clipped avatar on predefined equal-radius positions. `[data-poker-quick-action-slot]` is on the avatar edge; it hosts the existing contextual Nice Hand affordance during settlement, so later gift integration must preserve/coordinate that content. No gift behavior was copied here.

`[data-poker-avatar-center]` identifies the actual avatar element. `getSeatAvatarAnchor()` / `renderedSeatAnchors` give its center in table-local normalized coordinates and are the endpoints for targeted animation. #1047 must use these centers for gift travel as well; gift animation/purchase integration remains in #1047.

## Checks and self-review

Required syntax, check:all, ci:guards, CSP and diff checks passed. Focused existing tests: 121/121. Removed two obsolete layout tests with no meaningful remaining assertions. Reveal/privacy tests now check the authoritative reveal function through test-only closure access instead of removed opponent card DOM; no new UI/CSS/JSP test or production test hook.

Self-review checked authoritative state/CH preservation, popup stacking, static placement, avatar-center endpoints, one renderer, JSP compatibility, logging and CSS one physical line per selector. Breaking impact: HUD placements, lower-right action rail and compact opponent indicators visibly change; full-size opponent hole-card controls no longer render. Authoritative showdown reveal/settlement summaries still use existing state and logic.

## Narrow real Deploy Preview

Runtime SHA `916569cdcc0b1f1d2b996d5fc73bc54730415d11` on [Deploy Preview](https://deploy-preview-1049--playkcswh.netlify.app/poker/table-v2.html). BUILD_INFO and served JS/CSS matched the checkout. [owner-sanity-evidence.json](owner-sanity-evidence.json) records only four sanity cases: six seats, portrait/landscape/desktop, no page scroll, one-row best hand, no full opponent controls, real pointer clicks opening in-viewport reaction/history popups, history hit target above Preview FX, and targeted avatar-center endpoints. No extended collision probe.

The composition uses more space: portrait width ≈374 vs357px, small portrait ≈294 vs240px, landscape 828 vs608px in the previous replacement fixtures. Desktop remains width-limited at 1424px. No portrait/landscape page scroll: scrollWidth equals clientWidth and scrollHeight equals clientHeight in all recorded cases.

Controlled six-seat state and ChipsClient replies are used for screenshots; these are not a real authenticated Stage account. Netlify collaboration toolbar is excluded from product screenshots. Accepted account behavior was retained, not replaced by fixture logic in production.

| Viewport | Screenshot |
| --- | --- |
| 390×844 | [Portrait](evidence/owner-portrait.png) |
| 320×640 | [Small portrait](evidence/owner-small.png) |
| 844×390 | [Landscape](evidence/owner-landscape.png) |
| 1440×1000 | [Desktop](evidence/owner-desktop.png) |
| History popup | [Clickable history](evidence/owner-history.png) |

Owner must now assess the visual layout manually. Actual authenticated Stage verification also remains pending. PR #1049 stays draft / not merge-ready. No merge, WS redeploy or Production mutation.

## P1 opponent indicator participation correction

The old handId + !folded inference was wrong. The public snapshot does not expose engine handSeats; existing betThisRoundByUserId is initialized for every hand participant and reset from getSeatsForHand, including folded and zero-bet players. Indicator uses only its key membership, with waiting/out-of-chips excluded. Full snapshots and hand changes clear stale membership if the field is absent; partial frames preserve it only within the same hand. The existing reserved-seat snapshot test now asserts active/folded → 2 and waiting/out-of-hand → 0 through the pure helper, not DOM/layout assertions. Layout/assets/rail/CH/social/animation endpoints remain untouched. Required checks and a narrow two-viewport Preview sanity follow; owner manual portrait/landscape smoke remains pending.
