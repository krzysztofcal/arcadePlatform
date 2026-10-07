## SpecKit implementation plan — 2026-10-07

Baseline: `main` at `6c8ab3fad1570f7906a04dd09a05cf05c0fa36d2` after merged #1049.

### Architecture decision

Keep this **browser-only** unless implementation evidence proves otherwise. The current runtime already exposes everything required:
- `getHeroBestHand()` returns the evaluated best five from Hero hole cards + board;
- `state.revealedShowdownCardsByUserId` / `getSeatRevealCards()` provide authoritative opponent showdown cards;
- `state.betThisRoundByUserId` is already used by `getOpponentHeldCardCount()` as authoritative dealt-in participation;
- `state.foldedByUserId` / seat folded status provide authoritative fold state;
- `processSnapshotFrame()`, `frame.initial`, reconnect gating and existing settlement-animation suppression provide the live-vs-resync boundary;
- deterministic SeatHud anchors already own opponent card placement.

Do **not** add a WS field, backend endpoint, DB change, dependency or second poker runtime for this feature.

Use one new scene-owned cosmetic card-FX layer for **deal, showdown flip and fold/muck motion only**. Persistent/static card DOM remains the authoritative rendered end state. Animations are passengers and must never gate actions, timers or WS state.

### T001 — Best-five highlight without disturbing persistent Hero cards

**Files:** `poker/poker-v2.js`, `poker/poker-v2.css`.

- Reuse `getHeroBestHand()` / `evaluateViewerBestHand()`; do not create another evaluator.
- Add one small helper that converts the returned five cards to canonical card identities and applies/removes a presentation class on:
  - `#pokerCommunityCards .poker-card`;
  - `#pokerHeroCards .poker-card`.
- Invoke the highlight sync after `renderCommunityCards()` and `renderHeroCards()` have established their current DOM.
- Important: `renderHeroCards()` intentionally returns early for the same two-card deal. Therefore highlight updates must **not depend on rebuilding Hero cards**; a board street change must still update which unchanged Hero cards are highlighted.
- Highlight only when Hero has two authoritative cards and `getHeroBestHand()` returns exactly five cards. Otherwise clear the class.
- CSS: one subtle bright/cyan-gold-compatible border/glow class (for example `poker-card--best-five`) that does not change card dimensions or layout.

Acceptance: exactly the evaluated best five are highlighted; unused board/Hero cards are normal; no evaluator/gameplay change.

### T002 — Replace tiny opponent indicators with readable overlapping card pairs

**Files:** `poker/poker-v2.js`, `poker/poker-v2.css`.

- In `renderSeats()`, keep the existing `hud.cards` semantic anchor and `getOpponentHeldCardCount()` participation rule.
- Replace the current 8×12 `poker-seat-card-indicator` placeholders with two real compact card elements using the existing `createCard()` / `poker-card--back` visual path where practical.
- Increase only the deterministic opponent-card footprint in `configureSeatHud()` enough to make the pair readable; keep the anchor center fixed. Tune the smallest safe size on Preview rather than moving seats.
- Arrange the pair with slight overlap and opposing rotation. Preserve portrait/landscape SeatHud geometry, central felt, avatar/name/action/gift/chip/dealer anchors and one-viewport/no-scroll.
- Folded players should have a stable post-fold presentation suitable for T005; do not clear authoritative card state.

**Future skin boundary:** `.poker-card--back` is the visual hook. Keep back pattern/border/background in CSS, not JS. A future TableSkin must be able to replace that visual without touching SeatHud/card lifecycle. Do not build a skin engine now.

### T003 — Render authoritative opponent showdown faces

**Files:** `poker/poker-v2.js`, `poker/poker-v2.css`.

- In `renderSeats()`, use existing `getSeatRevealCards(seat)`.
- When two authoritative reveal cards exist, render the two actual face cards at the same `hud.cards` anchor instead of facedown backs.
- When reveal data does not exist, render backs only. Never infer cards from settlement text, winner status or hand category.
- Sticky winner reveal remains supported through the existing `getSeatRevealCards()` fallback.
- Initial load/reconnect/resync with already-revealed cards renders final faces directly; it must not require animation to become correct.

Acceptance: authoritative losing/winning compared players can show their real revealed cards; non-revealed opponents never leak faces.

### T004 — Add one card-FX layer and a minimal transition snapshot/claim model

**Files:** `poker/table-v2.html`, `poker/poker-v2.js`, `poker/poker-v2.css`.

- Add `#pokerCardFxLayer` / `.poker-card-fx-layer` inside the existing `.poker-scene`, adjacent to the current chip FX layer. It is `aria-hidden`, pointer-events none, and sits above static cards/chips but below player notifications/reactions/actions.
- Add an id to the existing visual room dealer element (for example `#pokerRoomDealer`) and bind it in `els`. Deal origin must be derived from the **actual rendered room-dealer element**, not duplicated from the poker Dealer `D` gameplay button.
- Extend the existing visual-transition snapshot path (prefer `captureVisualSnapshot()`, do not create a second state engine) with only the card fields required to detect:
  - hand identity / dealt-in participants;
  - folded users;
  - revealed showdown cards.
- Add one bounded page-lifetime claim state for the active hand (deal claimed, fold claims by user, reveal claims by user). Reset/prune it on hand/table/identity lifecycle boundaries.
- In `processSnapshotFrame()`, compute whether card FX are eligible **before** reconnect/initial gates are opened. Genuine live transitions may animate; initial snapshot, reconnect/resync recovery and reduced motion render final state only.
- After `render()` has refreshed the current SeatHud anchors, invoke one `animateCardDiff(previousVisual, nextVisual, frame/eligibility)` next to existing `animateChipDiff()`.
- Add `clearCardFx()` for reconnect/error/closed/table/identity teardown and stale timers/nodes. Keep it independent from chip/reaction/celebration cleanup.
- No timers may change poker state or delay rendering.

### T005 — Fast deal animation from the woman dealer to participating seats

**Files:** `poker/poker-v2.js`, `poker/poker-v2.css`.

- Trigger only on a genuine live transition into a new non-null `handId` (including live LOBBY/null → PREFLOP), never on initial snapshot/reconnect/resync and never twice for one hand.
- Participant targets come from the existing authoritative dealt-in participation contract (`state.betThisRoundByUserId` / the same semantics used by `getOpponentHeldCardCount()`), not from guessed occupied seats.
- Add/store one reusable card anchor per rendered seat (for example `hud.cardPoint` + `getSeatCardAnchor(seatNo)`) while `configureSeatHud()` places `hud.cards`; do not duplicate the opponent anchor formula in the animation code.
- Hero destination is the existing Hero card anchor; opponents use their SeatHud card anchor.
- Spawn lightweight facedown FX copies from the rendered room-dealer origin to each participating seat: first round around the table, then second round, with a short stagger. Keep total duration compact; target cards remain authoritative and immediately usable underneath the cosmetic motion.
- Do not animate empty/waiting/out-of-chips seats.
- Reduced motion: no flying cards, final static state only.

### T006 — One-shot showdown flip around the long axis

**Files:** `poker/poker-v2.js`, `poker/poker-v2.css`.

- Detect only hidden/back → two authoritative `getSeatRevealCards()` transition for the same hand/user.
- Claim `handId + userId` once so duplicate patches/renders do not replay.
- Use the card-FX layer for the flip so `renderSeats()` may always render the correct final face state immediately.
- FX presentation: pair starts as the same card backs, rotates around the vertical/long axis toward 90°, swaps/reveals the authoritative face, then completes to 0° and removes itself.
- Initial/reconnect/resync already containing revealed cards: no flip, only final faces.
- Never animate/reveal a player without two authoritative reveal cards.

### T007 — Authoritative fold/muck motion

**Files:** `poker/poker-v2.js`, `poker/poker-v2.css`.

- Detect a genuine not-folded → folded transition for `handId + userId`; do not trigger from the button click or optimistic UI.
- Claim once per user/hand; duplicate snapshots and reconnect/resync do not replay.
- Spawn FX copies from that seat's card anchor toward one fixed, per-orientation muck point on the felt, outside the protected community-card lane; fade the copies out quickly (owner reference: roughly up to ~1 s, but keep gameplay feeling fast).
- Hero: **retain `state.heroCards` exactly as required by #1048**. Only presentation changes after authoritative fold. Do not clear private cards to make the animation.
- Opponents: preserve the same hidden-information rules; only facedown backs are used for fold FX unless cards were already authoritatively public.
- Stable post-fold card presentation may be visually hidden rather than merely dimmed if that best matches the accepted muck effect, but state remains intact.
- Reduced motion: skip movement and show the stable folded result immediately.

### T008 — CSS/card visual quality and future-skin compatibility

**File:** `poker/poker-v2.css`.

- Keep every selector on one physical line.
- Reuse the current card face typography, red/black suit rules, shadows and premium dark/gold table language.
- Improve `.poker-card--back` so the larger opponent pair looks intentional and crisp; no raster asset is required unless existing assets clearly provide a better result.
- Keep the back design replaceable entirely in CSS for a future TableSkin.
- Add only transform/opacity-based animations where possible; no layout-driving animation.
- Add `prefers-reduced-motion` rules for deal/flip/muck FX.
- Preserve accepted #1049 short-portrait Hero-card lift/shadow/status geometry.

### T009 — Fundamental tests only

**File:** `tests/poker-v2-live.behavior.test.mjs`.

Extend the existing harness only for lifecycle/privacy invariants that are fundamental. Do **not** add CSS/layout/screenshot/JSP tests.

Required deterministic cases:
- already-received Hero cards remain in `state.heroCards` across authoritative fold presentation and still clear only at existing real hand/seat lifecycle boundaries;
- opponent face cards are sourced only from existing authoritative showdown reveal data; no reveal data means no face-card presentation;
- a live new-hand transition can claim deal FX once, while initial snapshot/reconnect/resync and duplicate same-hand frames do not;
- an authoritative fold transition can claim muck FX once; duplicates do not;
- an authoritative hidden→revealed showdown transition can claim flip FX once; initial/resync already-revealed state does not.

Do not test exact pixels, CSS rotation angles, animation duration or DOM geometry.

### T010 — Preview verification and handoff

No WS Preview Deploy is expected because the reviewed plan is browser-only. If implementation unexpectedly changes `ws-server/**`, WS runtime dependencies in `shared/**`, or browser/WS protocol behavior, stop treating it as browser-only and apply the exact-SHA WS Preview Deploy gate from `agents.md`.

For the real Netlify Deploy Preview:
- portrait physical/small mobile sanity and landscape sanity;
- best-five highlight changes correctly from flop/turn/river without rebuilding/losing Hero cards;
- opponent pair is readable, attractively overlapped/rotated and collision-free;
- real/controlled authoritative showdown shows one flip then stable revealed faces;
- new hand shows one fast two-round deal from the visual woman dealer;
- Hero fold and one opponent fold show one muck/fade and no replay;
- reconnect/resync shows final correct state without replaying old deal/flip/muck;
- reduced-motion shows final states without motion;
- no page scroll; #1049 status/action/reaction/chat/Wallet/Poker presentation remains intact.

Owner visual smoke remains the acceptance gate for animation quality. Do not merge before owner acceptance.

### Expected changed files

Expected runtime/test surface:
- `poker/poker-v2.js`
- `poker/poker-v2.css`
- `poker/table-v2.html`
- `tests/poker-v2-live.behavior.test.mjs`

SpecKit implementation should materialize/update:
- `specs/1058-poker-card-presentation/spec.md`
- `specs/1058-poker-card-presentation/plan.md`
- `specs/1058-poker-card-presentation/tasks.md`
- `specs/1058-poker-card-presentation/review.md`

No other file should be changed without a concrete repo-proven need.

### Breaking impact

Expected impact is **presentation-only**:
- opponent cards become larger/readable and may show authoritative showdown faces;
- Hero/board best-five cards gain a highlight;
- deal/fold/showdown acquire cosmetic motion;
- folded cards may become visually mucked/hidden while authoritative state remains retained.

No intended gameplay, WS, protocol, ledger/accounting, bot, table lifecycle or CH semantics change.

### SpecKit notes / project constraints

- This is a complex task: inspect the live repo and reason through all lifecycle paths before editing; do not implement from screenshots alone.
- Keep the implementation as simple and condensed as possible. Avoid a general animation framework, theme engine or second card-state model.
- Reuse existing `createCard()`, `getHeroBestHand()`, `getSeatRevealCards()`, SeatHud geometry, `captureVisualSnapshot()`, `processSnapshotFrame()`, reduced-motion handling and existing FX patterns.
- Call out any breaking impact on other Poker V2 presentation before handoff.
- Any browser JS must remain JSP-compatible: existing plain JS/IIFE style, no modules/imports.
- CSS must remain one physical line per selector/declaration block.
- Double-check/refactor before handoff; specifically verify reconnect/resync, duplicate frames, sticky winner reveal, Hero private-card persistence and one-viewport behavior.
- Use `klog`, never `console.log`, if diagnostics are required.
- No new inline script is planned, so no CSP hash change is expected. If an inline script is nevertheless introduced, its SHA must be added to the CSP allowlist.


## Constitution Check

PASS: browser-only existing IIFE/card/evaluator/visual snapshot/SeatHud mechanisms. No dependencies, generic tooling/ignore changes, inline scripts, WS/protocol/accounting/DB changes. T009 only fundamental lifecycle/privacy tests in the existing harness; T010 external Preview evidence, no broad UI/CSS/layout tests or committed screenshot collection. Owner animation smoke remains gate.
