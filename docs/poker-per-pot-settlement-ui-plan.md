# Poker per-pot settlement presentation

Status: proposed implementation plan. This document is planning-only and does not change poker runtime behavior.

## Goal

Present every settled poker award according to its accounting meaning instead of marking the union of all recipients as equivalent `Winner` seats.

The browser must show the exact server settlement as ordered main pot, side pots, and unmatched-bet returns. A player who only receives a return must never be described as a winner. Split pots and one player receiving several awards must remain exact and understandable on desktop, mobile, reconnect, resync, and reduced-motion clients.

## Scope

In scope:

- preserve and validate the existing `showdown.potsAwarded`, `showdown.potAwardedTotal`, and `handSettlement.payouts` data in the browser;
- build one deterministic client presentation model containing ordered pots and exact per-recipient amounts;
- render a compact ordered settlement summary and per-seat award rows such as `+288 Main pot`, `+6 Side pot 1`, and `+1 Returned`;
- retain the existing showdown-card reveal and best-hand information without using the generic `Winner` badge as the settlement model;
- make settlement display stable across the `SETTLED` reveal window, next-hand deferral, reconnect, and duplicate snapshots;
- add focused unit and browser behavior coverage for settlement presentation;
- add sequential chip-flow animation only in a follow-up PR after the information model is correct.

Out of scope:

- changing hand evaluation, pot construction, payout, ledger, escrow, or poker rules;
- changing persisted poker state or database schemas;
- changing WS settlement timing merely to accommodate animation;
- replaying historical hands or adding a hand-history screen;
- repairing unrelated audit-row serialization or introducing a new animation framework;
- adding environment variables, secrets, external assets, or third-party dependencies.

## Confirmed current architecture

### Server settlement is authoritative

- `ws-server/poker/shared/settlement/poker-side-pots.mjs::buildSidePots()` orders contribution bands by increasing contribution level. The first contested band is the main pot and later contested bands are side pots. A final band with one eligible user represents unmatched excess.
- `ws-server/poker/shared/settlement/poker-payout.mjs::awardPotsAtShowdown()` evaluates each pot independently. It emits ordered `showdown.potsAwarded` entries containing `amount`, ordered `winners`, and `eligibleUserIds`.
- Split-pot chips are allocated as `Math.floor(amount / winners.length)`, with one remainder chip assigned in the stable winner/seat order already stored in `pot.winners`.
- The same function also builds `showdown.winners` as the union of every user who received chips from any pot. That union is compatibility data, not proof that every member jointly won the main pot.
- `ws-server/poker/shared/settlement/poker-materialize-showdown.mjs::materializeShowdownAndPayout()` stores aggregate per-user totals in `handSettlement.payouts` and moves the hand to `SETTLED`.
- The `all_folded` path produces a singleton award for the whole contested pot. It is a legitimate main-pot result and must not be reclassified as a return merely because only one user remains eligible.

No engine or ledger defect is indicated by the analyzed flow. The implementation must consume this settlement without changing it.

### WS snapshot already preserves per-pot data

- `ws-server/poker/read-model/room-core-snapshot.mjs::normalizeShowdown()` and `ws-server/poker/read-model/state-snapshot.mjs::normalizeShowdown()` already project `winners`, `potsAwarded`, `potAwardedTotal`, `reason`, and `handId`.
- Both read models also project `handSettlement.handId`, `settledAt`, and `payouts`.
- `room-core-snapshot.mjs::resolveRevealedShowdownParticipants()` already uses `potsAwarded[].eligibleUserIds` to reveal compared hands without exposing unrelated private cards.
- Existing read-model behavior tests confirm that terminal settlement fields reach seated players and observers.

The first implementation does not require an additive or breaking WS contract change. `showdown.winners` remains available for compatibility, but the poker table UI must no longer use it as its sole presentation source.

### Exact loss and misleading presentation in the browser

The per-pot information is lost in `poker/poker-v2.js`:

1. `normalizeShowdown()` retains only `winners`, `reason`, `handId`, and revealed cards; it discards `potsAwarded` and `potAwardedTotal`.
2. `normalizeHandSettlement()` retains only `handId` and `settledAt`; it discards `payouts`.
3. `syncStickyWinnerReveal()` stores only the union of winner IDs, revealed cards, and community cards.
4. `getDisplayWinnerUserIds()` and `isWinnerSeat()` treat every member of the union as the same kind of winner.
5. `renderSeats()` renders the same `Winner` badge for each union member.
6. `captureVisualSnapshot()` stores only the union, and `animateChipDiff()` divides the entire pot decrease approximately equally among those IDs for visual purposes. This can animate the main pot toward a side-pot recipient or a player who only received a return.

This is the root cause of the misleading production result. The authoritative stack and ledger outcome can be correct while the browser labels and animation are wrong.

`poker/poker.js` contains older `buildShowdownWinnerPayoutMap()` and `renderShowdownPanel()` helpers, but they are not a correct reusable settlement model: they aggregate payouts by the same winner union and label entries only as `Pot #N`. That file powers the lobby page rather than `table-v2.html`. Do not copy its lossy classification into v2 or expand this fix into dead/legacy table UI. The new pure projector may replace that older logic in separate cleanup only if the lobby later presents live settlements again.

## Architecture decision

Implement correctness and animation in two PRs.

### PR 1 — authoritative static per-pot presentation

Preserve existing settlement fields, project them through one small pure browser helper, render ordered per-pot information, and remove the incorrect aggregate payout animation. Keep the existing bet-to-pot animation unchanged.

This PR fixes the user-visible meaning without changing settlement timing, server state, or WS payloads. It is independently releasable and is the blocker for correctness.

### PR 2 — sequential per-pot animation

After PR 1 is verified, reuse the same presentation model and existing chip-flight primitives to animate each ordered award. Animation remains decorative: the complete static summary and per-seat amounts render immediately and remain the source of truth.

Separating the PRs prevents animation sequencing, timing, and motion preferences from delaying or obscuring the accounting fix. PR 2 must not modify how pots are calculated or introduce another settlement model.

## Client settlement model

### Small pure projection helper

Add `poker/poker-settlement-presentation.js` as a JSP-compatible, dependency-free external script loaded before `poker-v2.js`. It exposes one narrow browser namespace, `window.ArcadePokerSettlement`, containing deterministic normalization/projection functions. This keeps accounting-display logic testable without a DOM and avoids a framework or build step.

The primary function is `buildSettlementPresentation({ showdown, handSettlement })`. Its closed result is:

```text
handId
settledAt
totalAmount
pots[]
  awardId
  potIndex
  kind              main | side | return
  sidePotNumber     null for main/return, positive integer for side
  amount            total amount represented by this pot entry
  recipients[]
    userId
    amount           exact share for this recipient
byUserId
  <userId>[]         ordered recipient awards for that seat
valid
failureReason       controlled local reason, never raw snapshot content
```

`awardId` is deterministic for the snapshot: `<handId>:pot:<potIndex>`. The helper must not mutate the snapshot, read the DOM, use time/randomness, log user identifiers, or infer poker rules not present in the payload.

### Validation and exact shares

The projector fails closed unless:

- showdown and settlement hand IDs are present and equal;
- pot amounts and aggregate payouts are finite non-negative integers;
- `potAwardedTotal` equals the sum of `potsAwarded[].amount`;
- each pot has unique non-empty eligible IDs and unique non-empty winner IDs;
- every winner is eligible for that pot;
- every non-zero pot has at least one recipient;
- per-pot shares reconstructed in the server-provided winner order sum exactly to the pot amount;
- accumulated per-user shares exactly match `handSettlement.payouts` in both directions.

For a split pot, reuse the existing server rule exactly: integer floor share, then one remainder chip for each earliest ordered winner until the remainder is exhausted. Do not divide the total settlement across `showdown.winners`.

If validation fails, stacks remain authoritative and gameplay remains usable. The UI shows a neutral localized `Settlement complete` state without guessed amounts, generic multi-user `Winner` badges, or payout animation. Existing safe client logging may emit one aggregated `klog` event with only the controlled failure reason; never use `console.log` or include cards, email, token, raw payload, or user IDs.

### Main pot, side pot, and return classification

Use the server order; do not sort pots in the browser.

1. `showdown.reason === "all_folded"`: the single whole-pot award is `Main pot`, even though only one player is eligible.
2. `showdown.reason === "computed"`: pot index `0` is `Main pot` and must be contested by at least two eligible users.
3. Later computed entries with two or more eligible users are `Side pot 1`, `Side pot 2`, and so on in their original order. Return entries do not increment side-pot numbering.
4. A later computed entry is `Returned` only when it has exactly one unique eligible user and exactly that same sole recipient. It is the unmatched contribution band, not a won pot.
5. A singleton or reordered shape that does not meet these rules is invalid rather than guessed.

This classification distinguishes a real uncontested main-pot win after folds from a returned unmatched bet.

### Split and multi-pot presentation

- A split pot is one ordered pot row with several recipients and exact individual shares.
- Every recipient seat receives its own amount from that pot, including any deterministic remainder chip.
- One user winning multiple pots receives multiple ordered seat rows rather than one ambiguous aggregate badge.
- Different users winning different pots receive only the rows that apply to them.
- A return row uses `Returned` and never `Winner`, `Main pot`, or `Side pot` styling/copy.
- `showdown.winners` may be retained for revealed-hand compatibility but cannot determine award labels, amounts, or chip destinations.

## PR 1 — exact files and changes

### `poker/poker-settlement-presentation.js` — new pure helper

- add closed normalizers for IDs, chip amounts, per-pot entries, and `handSettlement.payouts`;
- add `allocatePotRecipients(amount, orderedWinnerIds)` using the existing server split/remainder rule;
- add `classifyPot({ reason, potIndex, eligibleUserIds, winners, sidePotNumber })` with the main/side/return rules above;
- add `buildSettlementPresentation({ showdown, handSettlement })` and construct `pots` plus `byUserId` in server order;
- expose only the functions required by `poker-v2.js` and focused unit tests through `window.ArcadePokerSettlement`;
- use function/`var` syntax compatible with the current non-module poker page and JSP delivery; do not rely on bundlers or Node-only APIs.

### `poker/table-v2.html`

- load `/poker/poker-settlement-presentation.js` with `defer` immediately before `/poker/poker-v2.js`, preserving deterministic deferred-script order;
- add one hidden settlement summary inside `.poker-center-layer`, with `role="status"`, `aria-live="polite"`, and `aria-atomic="true"`;
- keep all behavior in external scripts; add no inline JavaScript.

### `js/i18n.js`

- add PL/EN keys for `Main pot`, `Side pot {number}`, `Returned`, `Settlement complete`, and the settlement summary accessible label;
- keep semantic classification in the pure projector as `kind` plus `sidePotNumber`; `poker-v2.js` resolves visible copy through the existing `t()`/`window.I18N.format()` APIs;
- listen to the existing `langchange` event or allow the next normal `render()` to rebuild the visible settlement so changing language cannot leave stale labels;
- do not embed English presentation copy in the settlement model.

### `poker/poker-v2.js`

- extend `normalizeShowdown()` to preserve normalized `potsAwarded` and `potAwardedTotal` instead of dropping them;
- extend `normalizeHandSettlement()` to preserve normalized `payouts`;
- add `state.settlementPresentation` or derive it once in `mergeSnapshot()` through `ArcadePokerSettlement.buildSettlementPresentation()` when phase is `SETTLED`;
- detect a missing/invalid `window.ArcadePokerSettlement` helper and fall back to the neutral state instead of throwing during snapshot handling;
- replace `stickyWinnerReveal.winners` with a cloned immutable `settlementPresentation`; retain revealed cards and community cards;
- add `lastPresentedSettlementHandId` so duplicate/replayed snapshots for the same hand cannot restart or extend an expired reveal window;
- calculate the local reveal deadline from `handSettlement.settledAt + WINNER_REVEAL_MS`, falling back to receipt time only when the server timestamp is absent; never reset the deadline for the same hand;
- replace `getDisplayWinnerUserIds()`/`isWinnerSeat()` with `getDisplaySettlementPresentation()` and `getSeatSettlementAwards(userId)` for labels and amounts;
- retain a separate helper for which compared hands/cards are revealed; award recipients and revealed showdown participants are different concepts;
- add `renderSettlementSummary()` and call it from `render()`;
- change `renderSeats()` to append ordered award rows at each recipient seat and remove the generic `Winner` title from per-pot settlements;
- keep the evaluated hand name/cards as secondary showdown detail, not as proof that the seat won every pot;
- extend `captureVisualSnapshot()` with the closed presentation/award IDs rather than the winner union;
- in PR 1, remove only the `payoutLike` aggregate branch from `animateChipDiff()`; keep the existing contribution-to-pot animation;
- keep `shouldDeferSnapshotUntilRevealEnds()` and `scheduleRevealDismiss()`, but key their state by the settlement hand ID so a queued next-hand snapshot is applied exactly once.

### `poker/poker-v2.css`

- add compact summary, pot-row, recipient, per-seat award-row, and `Returned` variants;
- allow several award rows at one seat without covering the avatar, cards, status, action badge, or turn clock;
- constrain and wrap the center summary on narrow screens, with an internal maximum height only if all rows cannot fit safely;
- add a `prefers-reduced-motion: reduce` rule that disables existing chip-flight and pulse animation without hiding settlement information;
- write every new selector on one line as required by the project style.

### Focused tests

- `tests/poker-settlement-presentation.unit.test.mjs` — load only the pure browser helper in the existing VM style and test deterministic model output.
- `tests/poker-v2-live.behavior.test.mjs` — extend the existing poker DOM/WS harness for labels, seat rows, sticky settlement, next-hand transition, and safe fallback.
- `ws-server/poker/read-model/room-core-snapshot.behavior.test.mjs` and `ws-server/poker/read-model/state-snapshot.behavior.test.mjs` — strengthen existing settled-snapshot assertions to prove ordered `potsAwarded`, `eligibleUserIds`, `winners`, total, and aggregate payouts survive transport. No read-model source change is expected.

### PR 1 acceptance

- a single contested pot renders as `Main pot` with its exact recipient amount;
- main plus one or several side pots render in server order with stable numbering;
- an unmatched contribution renders only as `Returned`;
- a split pot shows one pot and exact shares whose sum equals its amount;
- one user can display several distinct award rows;
- multiple recipients are never collectively labeled as winners of the whole hand;
- no pot-to-seat animation runs from the aggregate winner union;
- duplicate snapshots do not extend the reveal or render rows twice;
- a full initial/reconnect `SETTLED` snapshot renders a static summary immediately without fabricating a live transition;
- the next hand remains deferred only for the remaining reveal deadline and is then applied once;
- malformed or legacy settlement data cannot produce guessed labels/amounts or block gameplay.
- PL/EN language changes update settlement labels without changing amounts or classification.

## PR 2 — sequential award animation

PR 2 may start only after PR 1 is deployed and its static presentation is verified.

### Exact files and functions

- `poker/poker-v2.js::captureVisualSnapshot()` — retain the settlement hand ID and immutable ordered awards needed to identify a new live settlement.
- `poker/poker-v2.js::animateChipDiff()` — delegate the settlement branch to a new `animateSettlementAwards(previousVisual, nextVisual)` while leaving bet-to-pot behavior unchanged.
- `poker/poker-v2.js::spawnChipFly()` — reuse unchanged for each recipient trajectory; do not create another animation engine.
- add page-lifetime `lastAnimatedSettlementHandId`, `settlementAnimationGeneration`, and a bounded list of animation timers so stale callbacks can be cancelled on hand change, disconnect, or teardown.
- `poker/poker-v2.css` — add only small award-active/returned visual states and reduced-motion overrides, one line per selector.
- `tests/poker-v2-live.behavior.test.mjs` — add live transition, split, return, duplicate resync, reconnect, cancellation, and reduced-motion cases.

### Animation contract

- render the complete static summary and seat awards before starting animation;
- animate `Main pot`, then each `Side pot N`, then each `Returned` entry in the exact presentation order;
- for a split pot, animate the same pot step toward every recipient using that recipient's exact share for color/quantity selection;
- animate a return as `Returned`, never as a winner flow;
- keep the total sequence within the existing reveal window by using a bounded stagger; if there are too many recipients, shorten decorative spacing rather than delay server rollover;
- do not replay animation for the same `handId` after duplicate snapshots, patch resync, reconnect, or full snapshot;
- animate only when the current page observed a live transition for that same hand into `SETTLED`; an initial/reconnect snapshot already in `SETTLED` is static;
- cancel pending callbacks when the hand changes or the client disconnects;
- when `matchMedia('(prefers-reduced-motion: reduce)')` matches, create no flying-chip DOM nodes or timers. Static information remains complete and immediate.

No change to `ws-server/server.mjs::maybeScheduleSettledRollover()`, `resolveSettledRevealDueAt()`, or `WS_POKER_SETTLED_REVEAL_MS` is planned. Animation is subordinate to the authoritative reveal/rollover lifecycle.

## Required automated verification

### Pure unit cases

The PR 1 unit suite must cover:

- one main pot;
- main pot plus one side pot;
- main pot plus several side pots with stable numbering;
- a computed singleton unmatched band classified as `Returned`;
- an `all_folded` singleton classified as `Main pot`, not returned;
- an even split and an odd split with the remainder following server winner order;
- one recipient winning several pots;
- different recipients winning different pots;
- exact `byUserId` totals matching `handSettlement.payouts`;
- invalid amount, duplicate recipient, winner outside eligibility, hand mismatch, total mismatch, payout mismatch, and malformed return shapes failing closed.

### Browser behavior cases

The existing behavior harness must cover:

- exact summary and per-seat copy/amounts for the user-story example;
- returned chips never rendering `Winner`;
- compared losing players retaining revealed cards without award badges;
- full `SETTLED` snapshot on first load/reconnect rendering static content;
- duplicate resync for the same hand not duplicating awards or extending the timer;
- next-hand snapshot deferred until the remaining reveal deadline, then applied once;
- narrow/mobile DOM remaining usable with multiple rows;
- reduced motion retaining all information;
- PR 2 only: no replay after resync, ordered animations, split destinations, return destination, and cancellation on hand change.

Run the existing repository checks in addition to the focused tests. Do not broaden engine/ledger test scope because their rules are unchanged.

## Manual verification

Use a controlled table or fixture that produces known contributions and compare every UI amount with the received WS snapshot.

1. Single winner: verify `Main pot <amount>` and no generic multi-seat winner treatment.
2. Main plus side: verify each ordered pool, exact recipient, and exact seat amount.
3. Several side pots: verify numbering does not skip or count a return.
4. Unmatched excess: verify `Returned` at the correct seat and no winner styling/copy for that row.
5. Split pot: verify recipient shares, including an odd remainder, sum to the pot.
6. One player winning several pots: verify separate rows and correct aggregate stack change.
7. Different players winning different pots: verify no seat is presented as winner of another pot.
8. Fold-ended hand: verify the sole recipient is the main-pot winner, not a return.
9. During `SETTLED`, disconnect/reconnect and request full resync; verify static information remains exact and does not replay or duplicate.
10. Receive the next hand while reveal is active; verify the settlement remains readable and the queued snapshot applies once afterward.
11. Test desktop and narrow mobile widths with the maximum realistic number of award rows and action controls visible.
12. Enable reduced motion and verify complete static labels with no chip-flight nodes.
13. Switch between Polish and English and verify only labels change; classification and chip amounts remain identical.
14. Block or delay the new helper script during failure testing; the poker page must fail safe without invented winner labels and must not expose raw HTML or block unrelated controls.
15. For PR 2, compare animation order/destinations with the already visible static rows; the static result must remain correct if animation is interrupted.

## Preview, rollout, and rollback

### Preview requirements

- Both implementation PRs require a Netlify Deploy Preview because they change browser JavaScript, HTML, CSS, and visual behavior.
- A WS Preview Deploy is not required for the planned implementation because no WS server source, protocol, persistence, settlement, or timing changes are needed.
- The browser preview must still connect to a compatible preview WS and inspect a real `SETTLED` payload to confirm `potsAwarded` and `handSettlement.payouts` are present.
- If implementation analysis unexpectedly requires any change under `ws-server/`, stop and update this plan; that revised PR must run a WS Preview Deploy before merge.

### Rollout

1. Merge and deploy PR 1 first.
2. Verify exact labels/amounts in production-like play before enabling any new settlement animation.
3. Monitor only existing safe client telemetry for controlled invalid-presentation reasons; no new user/table/card identifiers.
4. Implement and deploy PR 2 separately after the static behavior is accepted.

### Rollback

- PR 1 can roll back to the prior renderer without changing authoritative server state, balances, or stored hands.
- PR 2 can independently remove only the settlement animation and retain PR 1's correct static summary.
- Mixed cached versions are safe because the WS fields are additive/existing and old clients continue their previous presentation until refreshed.

## Breaking and operational impact

| Area | Impact |
| --- | --- |
| Poker rules and ledger | None. Pot construction, payout, stack mutation, escrow, and settlement persistence remain authoritative and unchanged. |
| WS contract | No schema/version change. Existing `potsAwarded`, totals, payouts, and compatibility `winners` are consumed more fully. |
| Browser behavior | Intentional visible change: generic `Winner` badges and aggregate payout animation are replaced by localized exact per-pot labels and amounts. |
| Reveal timing | No server change. Client reveal becomes keyed to the original `settledAt`/hand ID and cannot be restarted by duplicate snapshots. |
| Reconnect/resync | Initial settled state is static; duplicate state does not replay awards. This is an intentional idempotency improvement. |
| HTML/JSP | One external deferred helper and one semantic container. The helper uses browser-compatible non-module JavaScript and requires no build transform. |
| Localization | Additive PL/EN settlement keys in the existing dictionary; no new i18n system. |
| CSS | Additive responsive selectors only, with one line per selector. Reduced motion becomes explicitly supported. |
| CSP | No inline script or external origin. Existing same-origin `script-src` covers the new file, so no SHA or provider-domain change is required. |
| Database/ENV/secrets | None. No migration, configuration, or secret. |
| Deployment | Netlify preview/production only under the planned scope; no WS Preview Deploy. |

The browser-global `window.ArcadePokerSettlement` is an additive page-local interface. The main compatibility risk is old cached `poker-v2.js` loading with new HTML or the reverse; both scripts must fail closed when the helper is absent, and versioned deploy cache invalidation must be verified on preview.

## Definition of Done

- The complete server settlement reaches a validated client presentation model without using `showdown.winners` as the award source.
- Main pots, numbered side pots, returns, split shares, and multi-pot recipients are labeled and summed exactly.
- A return is never rendered or animated as `Winner`.
- Static settlement remains correct without animation, on mobile, with reduced motion, and after reconnect/resync.
- Duplicate snapshots cannot duplicate awards, replay animation, or extend the same hand's reveal deadline.
- The next hand is applied once after the readable remaining reveal window.
- Focused pure unit and browser behavior cases pass together with existing repository checks.
- PR 1 is verified before PR 2 starts.
- No poker rule, ledger, DB, ENV, WS contract, CSP origin, or server timing change is introduced.

## Plan verdict

The backend already holds and publishes the information required for correct UX. The defect is a browser projection bug: `normalizeShowdown()` and `normalizeHandSettlement()` discard the detailed award model, after which badges and animation use the lossy union `showdown.winners`.

The smallest safe fix is a static, validated per-pot presentation in PR 1 and a separate decorative animation PR 2. This restores accounting meaning immediately, keeps the server and ledger untouched, and gives animation one reusable authoritative client model instead of duplicating or guessing settlement logic.
