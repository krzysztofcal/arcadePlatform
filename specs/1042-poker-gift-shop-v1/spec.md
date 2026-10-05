# Poker Gift Shop V1 — SpecKit implementation plan

**Parent:** #786
**Status:** implementation ready, awaiting manual runtime verification

Implementation progress and validation are tracked in tasks.md and review.md.
**Scope:** one complete V1 vertical slice: Poker V2 UI → authoritative WS purchase → CH BURN → durable receipt → table gift event → session-visible gift badges.

## Accepted product decisions

V1 is intentionally small:

| gift_key | Presentation | Price |
|---|---|---:|
| `coffee` | ☕ Coffee | 10 CH |
| `beer` | 🍺 Beer | 25 CH |
| `whisky` | 🥃 Whisky | 50 CH |
| `pizza` | 🍕 Pizza | 100 CH |
| `cake` | 🎂 Cake | 250 CH |
| `diamond` | 💎 Diamond | 1,000 CH |

- Buyer: authenticated, seated **human account** only. Guest sessions cannot purchase.
- Recipient: one currently ACTIVE seat at the same table; another human or bot is valid; self-gifting is rejected.
- Whole-table gifts are **not** V1.
- Cooldown: **3,000 ms per buyer per table**, enforced authoritatively.
- Presentation: emoji-based V1; no premium image asset set yet.
- Received gifts remain attached to the recipient's current table participation. Display at most **3 gift types** beside an avatar, aggregate duplicates as e.g. `🍺 ×4`, and show a compact overflow indicator for additional types.
- One short bounded fly animation/notification per delivered gift. Keep a bounded presentation queue; gameplay never waits for it.
- A minimal durable purchase receipt is required in V1 for payment/delivery idempotency and future #1046 compatibility.
- Payment source in V1 is only `CH`.
- CH purchase is a real chip sink: balanced ledger `BURN` = buyer USER `-price` + `SYSTEM/GENESIS +price`. Never HOUSE, TREASURY, table ESCROW, bot bankroll, or recipient account.

## Baseline / existing mechanisms to reuse

Live `main` is authoritative.

Reuse instead of creating parallel systems:

- `netlify/functions/_shared/chips-ledger.mjs::postTransaction()` for balanced, idempotent ledger writes; `BURN` already exists.
- `SYSTEM/GENESIS` is the existing issuance offset. A BURN reverses circulation by crediting GENESIS.
- `ws-server/poker/runtime/session.mjs` exposes `identityMode`; only `user` is allowed to buy.
- `ws-server/server.mjs` already owns authenticated table commands, table association, commandResult, broadcast, resync and live WS authority.
- `poker/poker-ws-client.js` already provides the JSP-compatible command/frame client.
- `poker/poker-v2.js` already owns table seat rendering, current seat identity, social UI and cosmetic event presentation.
- `poker/table-v2.html` top-right social control rail is the natural Gift Shop entry point.
- Existing `chips:tx-complete` browser event refreshes the global chip badge; successful gift purchase should reuse it.
- `poker_seats.joined_at` identifies the current seat participation and can prevent gifts from a prior leave/rejoin session from reappearing.
- Existing Production migration manifest/inventory rules remain authoritative; do not bypass them.

## Architecture

### 1. Canonical V1 gift catalog

Add a very small server-authoritative catalog in:

- `shared/poker-domain/gift-catalog.mjs`

Expose only simple pure helpers, for example:

- `GIFT_CATALOG`
- `resolveGift(giftKey)`
- `isGiftKey(value)`

Each catalog row contains only stable product semantics needed by the server: `giftKey`, exact `priceCh`, and presentation tier if needed.

The browser may keep the corresponding six display labels/emojis in `poker/poker-v2.js`, but **the browser price is never authoritative**. The WS purchase operation always resolves the current server catalog and charges that exact price.

Do not add DB-managed pricing, Admin pricing, remote catalog service, generic commerce catalog or seasonal scheduler in #1042.

### 2. Minimal durable receipt schema

Create one forward-only Stage migration generated through the repository's normal Supabase migration workflow:

- `supabase/migrations/<generated>_poker_gift_purchases.sql`

Add backend-only table `public.poker_gift_purchases` with the minimum fields required for V1 correctness and later #1043/#1046 reuse:

- `id uuid primary key default gen_random_uuid()` — also the stable public `eventId`;
- `purchase_key text not null unique` — deterministic internal V1 idempotency identity derived from table + buyer + WS requestId;
- `payment_source text not null` — V1 CHECK permits only `CH`;
- `payment_reference text not null` — V1 stores the authoritative ledger transaction ID as text; later providers may extend this contract in a forward-only migration;
- `buyer_user_id uuid not null`;
- `sender_seat_no int not null`;
- `sender_joined_at timestamptz not null`;
- `recipient_user_id uuid not null`;
- `recipient_seat_no int not null`;
- `recipient_joined_at timestamptz not null`;
- `table_id uuid not null`;
- `gift_key text not null`;
- `amount_ch bigint not null` with positive safe-value constraint for CH V1;
- `created_at timestamptz not null default timezone('utc', now())`.

Do **not** FK `table_id` to `poker_tables`: closed-table cleanup must not erase/block purchase receipts needed for audit/future collection statistics. Do not couple recipient identity to `auth.users`, because bot UUID recipients are legal.

Enable RLS and expose no anon/authenticated mutation/read policy. Backend only.

Add only narrow access paths actually needed by V1:

- buyer/table + recent `created_at` for authoritative 3-second cooldown;
- table + recipient identity/seat/participation for active session gift aggregation.

Update the exhaustive Production migration inventory/manifest according to current repository rules. Prepare the Production-equivalent schema if required by that contract, but **do not apply Production without separate owner authorization**.

Publishing the source migration intentionally permits ordinary automatic DB Stage Apply PR. Record that Stage effect in SpecKit before push. The migration creates schema/indexes/RLS only: zero receipts, zero ledger transactions, zero CH changes.

### 3. Authoritative purchase operation

Add:

- `shared/poker-domain/gift-purchase.mjs`

Primary operation:

- `executePokerGiftPurchase({ beginSql, postTransaction, tableId, buyerUserId, requestId, giftKey, recipientSeatNo, nowMs })`

Keep it one DB transaction.

Required order:

1. Normalize/bound IDs and resolve `giftKey` through server catalog.
2. Derive a bounded deterministic `purchase_key` from `tableId + buyerUserId + requestId`; client input never supplies a price or payment reference.
3. Acquire a transaction-scoped advisory lock for `tableId + buyerUserId` so simultaneous sockets cannot bypass the 3-second cooldown.
4. Look up `purchase_key` first:
   - exact same immutable payload → replay the existing receipt with **zero new BURN**;
   - same key with different gift/recipient/table/buyer → fail `gift_idempotency_conflict`.
5. Check latest committed purchase for that buyer/table; reject `gift_rate_limited` inside 3,000 ms.
6. Lock/read the OPEN table and the ACTIVE sender/recipient seat rows in deterministic seat order.
7. Require sender row to match `buyerUserId`, be human (`is_bot=false`), and capture exact `joined_at`.
8. Require recipient seat to exist ACTIVE at the same table; other humans and bots are accepted; reject recipient.user_id === sender.user_id as gift_target_unavailable before postTransaction (zero BURN/receipt); capture exact `user_id` and `joined_at`.
9. Call the existing `postTransaction()` inside the same SQL transaction:
   - `txType: "BURN"`;
   - `userId: buyerUserId`;
   - USER entry `-priceCh`;
   - SYSTEM `GENESIS` entry `+priceCh`;
   - `createdBy: buyerUserId`;
   - deterministic gift purchase idempotency key;
   - minimal audit metadata: purpose, tableId, giftKey, recipient seat/user, amountCh.
10. Insert the single purchase receipt with the ledger transaction ID as `payment_reference`.
11. Commit atomically.

If BURN fails (including insufficient funds), receipt creation rolls back. If receipt creation fails, BURN rolls back. No state where a completed DB transaction contains only one side.

Do not touch table ESCROW, poker stacks, settlement state, bot funding, bankroll pools or gameplay state.

### 4. WS persistence adapter

Add:

- `ws-server/shared/poker-domain/gift-purchase-deps.mjs` following the existing shared-dependency bridge pattern; reuse `netlify/functions/_shared/chips-ledger.mjs::postTransaction`.
- `ws-server/poker/persistence/gift-purchase-adapter.mjs`

Adapter responsibilities:

- supply `beginSqlWs`;
- call `executePokerGiftPurchase`;
- map known DB/domain failures to stable gift reasons;
- expose a read-only `loadActiveTableGiftState(tableId)` that joins receipts to current ACTIVE `poker_seats` on recipient user + seat + exact `joined_at`, then returns only aggregated counts by seat/gift key.

The active gift-state query is presentation recovery, not poker state. It must not mutate `poker_state`, snapshots, stream log or seat stacks.

Guest/file-backed tables return gift-shop unavailable and perform zero DB writes.

### 5. WS command and protocol

Add a small handler:

- `ws-server/poker/handlers/gift.mjs`
- `handleGiftSendCommand(...)`

Update `ws-server/server.mjs`:

- add `gift_send` to `PROTECTED_MESSAGE_TYPES` and `REQUEST_ID_REQUIRED_TYPES`;
- reject `connState.session.identityMode !== "user"`;
- resolve the table through the existing room/association rules;
- require the buyer to be currently seated as a human;
- payload accepts only:
  - `tableId`
  - `giftKey`
  - `targetSeatNo`
- never accept client `priceCh`, recipient userId, payment source or payment reference;
- call the purchase adapter;
- send normal `commandResult`;
- on accepted **new** purchase only (`outcome.replayed !== true`), broadcast:
  - `table_gift: { eventId, senderSeatNo, recipientSeatNo, giftKey }`
- an idempotent replay returns `commandResult=accepted` with zero new BURN/receipt and **no `table_gift` or animation**;
- both new purchases and replay load/broadcast current `table_gift_state` to reconcile durable session badges;
- client eventId dedupe is supplementary; server replay suppression prevents replaying an old animation after reload, cache eviction or seat reassignment. A commit-before-broadcast crash recovers badges through current state, without replaying the animation or introducing an outbox.
- do not write gift events to poker `streamLog` or gameplay persistence.

Add read-model recovery frame:

- `table_gift_state: { seats: [{ seatNo, gifts: [{ giftKey, count }] }] }`

Send it after successful authenticated table subscription/join/resync using the existing table association lifecycle. This restores session gift badges after WS reconnect/full page reload while the same `poker_seats.joined_at` participation remains active. Leaving and later rejoining gets a new `joined_at`, so old session gifts do not reappear.

Update `docs/ws-poker-protocol.md` with the two additive frame types and `gift_send` command.

### 6. Poker WS browser client

Update `poker/poker-ws-client.js` only through its existing global/JSP-compatible API:

- accept callbacks `onGift` and `onGiftState`;
- route `table_gift` / `table_gift_state`;
- add `sendGift(giftKey, targetSeatNo, requestId)` using `sendCommand("gift_send", ...)`;
- no modules/imports and no second socket.

Do not make the browser responsible for purchase idempotency beyond reusing the WS requestId for a retry.

### 7. Poker V2 UI

Update:

- `poker/table-v2.html`
- `poker/poker-v2.js`
- `poker/poker-v2.css`
- `js/i18n.js`

UI behavior:

- Add one 🎁 Gift Shop control in the existing top-right social rail, visible only to an authenticated seated human account.
- Small hidden panel/modal with the six accepted gifts and CH prices.
- Recipient selector is built only from the current authoritative rendered seat list; other humans and bots allowed; exclude the current user.
- Disable Send until one valid gift and one valid current recipient are selected.
- While one purchase is pending, prevent duplicate click; a server rate-limit result keeps UI controlled.
- On accepted purchase dispatch the existing `chips:tx-complete` DOM event so the global chip badge refreshes; do not add another balance endpoint.
- Controlled messages for insufficient CH, rate limit, target unavailable, shop unavailable and generic failure.
- `handleTableGift(event)`:
  - validate stable event ID/key/seats;
  - bounded dedupe set;
  - increment recipient session gift counts;
  - enqueue a short fly animation/notification;
  - never block cards/actions/turn clock.
- `applyTableGiftState(state)` replaces local aggregate counts from authoritative active-participation recovery.
- Render beside each occupied recipient avatar:
  - maximum 3 gift types;
  - duplicates as `emoji ×N`;
  - compact overflow for additional types.
- Ordinary `renderSeats()` rebuilds must re-render current local gift aggregates so state patches do not erase badges.
- Remove a seat's local gifts when the authoritative seat disappears/changes participation; recovered state remains final authority after reconnect.
- Respect `prefers-reduced-motion`: keep gift badge + short text feedback, skip fly motion.
- V1 uses emoji only; no image/CDN/audio assets.
- All JS remains JSP-compatible.
- CSS must remain one physical line per selector.
- No inline script is expected. If implementation unexpectedly adds one, update CSP SHA allowlisting in the same change.

### 8. Localization

Extend existing PL/EN dictionary in `js/i18n.js` for:

- Gift Shop / Send / recipient selection;
- six gift names;
- sent notification;
- insufficient chips;
- rate limited;
- target unavailable;
- shop unavailable / purchase failed.

Do not create a gift-specific i18n system.

## Error / rejection contract

Use small stable reasons:

- `gift_shop_unavailable`
- `gift_invalid`
- `gift_target_unavailable`
- `gift_rate_limited`
- `gift_insufficient_chips`
- `gift_idempotency_conflict`
- `gift_purchase_failed`
- existing `not_seated` / `invalid_sender` where appropriate.

Do not leak DB, account, ledger or auth internals in client-facing messages.

## Fundamental tests only

No new broad UI/CSS/JSP/Playwright suite for #1042.

### Migration / accounting

Extend existing:

- `tests/chips/chips.migration.test.mjs`
- `tests/chips-ledger.test.mjs`

Prove only fundamentals:

- receipt table constraints/RLS/narrow indexes;
- CH BURN shape is USER(-) + GENESIS(+), balanced and atomic;
- insufficient funds creates zero receipt and zero committed BURN;
- no recipient USER credit;
- no ESCROW/TREASURY/HOUSE/bot-pool entry.

### Purchase domain

Add one focused deterministic suite only if no existing suite fits cleanly:

- `shared/poker-domain/gift-purchase.behavior.test.mjs`

Cover:

- valid human → other human/bot purchase; self-target rejects before postTransaction with zero BURN/receipt;
- server catalog price overrides any absent/client notion of price;
- stale/inactive recipient rejection;
- guest/non-human buyer rejection at boundary;
- exact idempotent replay → one BURN/one receipt;
- same request identity with changed payload → conflict;
- 3-second authoritative cooldown;
- leave/rejoin `joined_at` prevents old gift state from attaching to the new participation;
- DB/ledger failure rolls back receipt.

### WS runtime

Add/extend only critical runtime tests:

- `ws-server/poker/handlers/gift.behavior.test.mjs` for command validation/reasons;
- nearest focused cases in `ws-server/server.behavior.test.mjs` for accepted purchase → `commandResult` + `table_gift`, one BURN/receipt, no second event on accepted replay, and current `table_gift_state` recovery.

Do not add tests asserting HTML structure, CSS classes, animation pixels or modal layout.

## Verification / rollout

Because this changes `ws-server/**` and the WS/browser protocol:

1. Run focused fundamental suites plus repository syntax/guard/check suites.
2. Confirm Stage source migration effect is intentional before publishing; automatic DB Stage Apply PR may create only the new empty receipt schema/indexes/RLS.
3. Review whole diff for accidental gameplay/accounting changes.
4. Run **WS Preview Deploy** for the exact latest runtime-affecting SHA.
5. Verify installed `RELEASE_SHA == DEPLOY_REF`.
6. Mandatory authenticated Deploy Preview → WS Preview Stage smoke:
   - open Gift Shop at a normal seated human table;
   - send each representative cheap/premium gift to other human/bot; confirm self-target rejection;
   - confirm exact CH decrement and balanced BURN ledger;
   - insufficient-CH rejection;
   - immediate duplicate/retry cannot double-burn or double-count;
   - 3-second cooldown;
   - gift badges survive ordinary state renders and WS reconnect/resync;
   - leave/rejoin clears prior participation gifts;
   - mobile readability + reduced-motion behavior;
   - poker actions/settlement continue normally.
7. Green CI alone is not runtime proof.
8. Production schema/migration remains a separate explicit owner authorization. Because merge to `main` can deploy Production WS/browser code, do **not** merge a runtime/UI Gift Shop that depends on a schema absent from Production. Apply/verify the approved Production-equivalent empty schema before the Production-deploying merge, or keep the implementation unmerged.
9. No Production gift purchase/BURN smoke without separate explicit authorization.

## Task breakdown

- [x] **T001 — SpecKit baseline reconciliation.** Re-read live #1042, #786, `agents.md`, `skills.md`, current ledger/WS/Poker V2 code; create/update `specs/1042-poker-gift-shop-v1/` artifacts from this accepted issue without broadening scope.
- [x] **T002 — Catalog contract.** Add `shared/poker-domain/gift-catalog.mjs` with exactly the six accepted keys/prices and small normalization helpers.
- [x] **T003 — Receipt migration.** Generate the forward-only `poker_gift_purchases` Stage migration, RLS and two narrow indexes; update current Production migration inventory/manifest as required. Declare shared Stage auto-apply effect. No data/CH mutation.
- [x] **T004 — Purchase core.** Add `shared/poker-domain/gift-purchase.mjs::executePokerGiftPurchase()` with advisory cooldown/idempotency lock, active seat/participation validation, atomic existing-ledger BURN and receipt.
- [x] **T005 — WS persistence adapter.** Add gift purchase deps/adapter, known-error mapping and active-participation gift summary loader. Guest/file-store path fails closed with zero DB mutation.
- [x] **T006 — WS handler/protocol.** Add `handleGiftSendCommand`, `gift_send`, `table_gift`, `table_gift_state`; wire protected/requestId lists, broadcast and subscription/join/resync recovery in `ws-server/server.mjs`.
- [x] **T007 — Browser WS client.** Extend `poker/poker-ws-client.js` with `sendGift`, `onGift`, `onGiftState`; preserve one socket and JSP globals.
- [x] **T008 — V1 UI.** Add Gift Shop control/panel in `poker/table-v2.html`; implement catalog/recipient selection, purchase state, gift event/state handlers, bounded event dedupe/animation queue and avatar gift aggregates in `poker/poker-v2.js`.
- [x] **T009 — CSS/i18n.** Add minimal responsive/reduced-motion gift styles in `poker/poker-v2.css` (one line per selector) and PL/EN strings in `js/i18n.js`. No asset/CDN/audio work.
- [x] **T010 — Fundamental accounting/migration tests.** Extend migration/ledger suites for receipt contract, RLS/indexes and exact USER→GENESIS BURN/no-recipient-credit invariants.
- [x] **T011 — Fundamental domain/WS tests.** Add only the focused gift purchase/handler/runtime cases listed above. No UI/CSS/glue suite.
- [x] **T012 — Full verification/refactor.** Run focused + required repo checks; review/refactor touched code for the smallest implementation; verify no second ledger/payment/event framework and no gameplay mutation.
- [ ] **T013 — Exact-SHA Preview gate.** Deploy latest runtime-affecting SHA with WS Preview Deploy, verify release metadata/health, then perform the mandatory Stage smoke above.
- [ ] **T014 — Production handoff.** Prepare/verify the Production-equivalent empty receipt schema according to current manifest rules and STOP for owner authorization before any Production DB mutation. Do not merge Production-deploying runtime while required Production schema is absent.
- [ ] **T015 — Final handoff.** Record exact runtime SHA, Stage migration/apply evidence, CI, WS Preview deploy, smoke evidence, any Production schema status and breaking impacts. Only call merge-ready when repository Definition of Done is satisfied.

## Out of scope

- Whole-table gifts.
- Persistent profile collections/statistics (#1043).
- Gift leaderboards (#1044).
- Bots as purchasers/senders (#1045).
- Google Play, Stripe, web checkout or other real-money provider (#1046).
- Selling/minting poker CH for real money.
- Inventory/trading/refunds between players.
- XP or gameplay bonuses.
- DB/Admin-managed catalog/pricing.
- Generic payment framework.
- Seasonal scheduling.
- New animation framework.

## Breaking impacts

Intentional/additive:

- New backend-only `poker_gift_purchases` schema.
- New CH sink using existing `BURN`; each completed V1 purchase permanently removes the exact catalog price from the buyer's circulating CH.
- New WS command/frame vocabulary: `gift_send`, `table_gift`, `table_gift_state`.
- Production must have the compatible empty receipt schema before Production-deploying Gift Shop runtime/UI is merged/deployed.

Unchanged:

- Poker stacks, table ESCROW, settlement, stakes, bot funding, progression, matchmaking, XP and recipient CH balances.
- Existing reaction protocol/behavior.
- Human/bot gameplay strategy.

## SpecKit notes / implementation constraints

1. This is a complex cross-layer task; use deep review and verify all required paths before implementation.
2. Keep code as simple and condensed as possible; eliminate unnecessary abstraction without changing functionality.
3. Reuse existing packages/classes/functions and patterns; do not create a second ledger, socket, payment framework, poker engine or generic event bus.
4. Explicitly call out any breaking impact found during implementation, especially ledger/protocol/migration/Production rollout effects.
5. Any browser JavaScript must remain JSP-compatible: global/IIFE style, no browser modules/imports.
6. Any CSS added must keep one physical line per selector; no declaration line wrapping.
7. Double-check and refactor before final handoff; green CI alone is insufficient for WS/runtime correctness.
8. If an inline/browser script is unexpectedly added, update the CSP script SHA allowlist in the same change. No inline script is expected by this plan.
9. Use `klog` for diagnostics; never add `console.log`.
10. Write only fundamental deterministic tests. No broad/speculative UI/CSS/layout/JSP/simple-glue test expansion.
11. Do not add generic ignore/tooling/dependency cleanup unless explicitly required by this issue.


Implementation reconciliation: T003 requires updating hardcoded inventory counts in scripts/check-db-migrations.mjs (54 missing, 33 needs-production-equivalent). No unrelated tooling changes.

T012 requires registering the two focused gift suites in scripts/test-all.mjs and classifying the two gift diagnostics in ws-server/poker/observability/poker-log-policy.mjs. Existing vitest-only tests/chips-ledger.test.mjs is not runnable with installed repo dependencies; extend the existing Node canonical-ledger suite tests/chips-ledger.human.buyin.unit.test.mjs instead. Receipt migration constraints/RLS/indexes are exercised with existing PGlite in the focused domain suite; external migration DB suite remains gated by CHIPS_MIGRATIONS_TEST_DB_URL. No new framework/dependency.


## Manual smoke amendment — custom Gift Shop UI and HUD dependency

Manual authenticated smoke found three presentation requirements that must be addressed before #1042 can complete.

### Confirmed defect

Persistent received gifts are currently appended inside `.poker-seat-avatar`, while that element has `overflow:hidden`. The badge is positioned at `top:100%`, so the received-gift indicator is clipped. Do **not** fix this with another z-index/offset patch.

The stable three-slot received-gift presentation is now owned by #1048 — **Poker Table HUD: collision-free seat layout and CH account HUD**.

#1042 remains responsible for gift state/delivery and must consume the stable gift slots from #1048 before final acceptance/merge.

### T012A — Replace native gift selector with custom Gift picker

Update:

- `poker/table-v2.html`
- `poker/poker-v2.js::bindGiftShop()`
- `poker/poker-v2.js::syncGiftShop()`
- `poker/poker-v2.css`
- `js/i18n.js` only if new accessible copy is required

Requirements:

- remove the native `<select id="pokerGiftSelect">`;
- render the six existing V1 gifts as Arcade-styled custom selectable items/cards using ordinary buttons/list semantics;
- each item shows emoji, localized name and CH price;
- one selected gift at a time;
- selected/disabled/pending states are visually explicit;
- keyboard/focus behavior must remain accessible;
- server catalog remains authoritative; this is presentation only;
- do not add a UI framework or new dependency.

### T012B — Replace native recipient selector with custom player list

Update the same existing Gift Shop code; do not create a second recipient system.

Requirements:

- remove the native `<select id="pokerGiftRecipient">`;
- render a custom Arcade-styled recipient list from current authoritative `state.seats`;
- show enough identity to distinguish seats: existing avatar/display name/seat number using already available presentation data;
- other human and bot targets remain valid; own seat is excluded, and backend rejects new self-target purchases;
- one selected recipient at a time;
- reconcile recipient buttons by `seatNo + userId` (store both data attributes); stale/removed/replaced occupants disappear on normal `syncGiftShop()` refresh;
- when the selected occupant changes, clear recipient selection and its uncertain giftRetry; create a new button/avatar, preserving renderSeatAvatar's fresh-element assumption;
- changing gift/recipient still clears uncertain retry identity exactly as current code does;
- purchase payload remains only `giftKey + targetSeatNo`.

### T012C — Guest-visible disabled Gift Shop

Current code hides `#pokerGiftShopButton` whenever `giftShopAvailable()` is false. Change only the guest/signed-out presentation policy:

- guest/signed-out Poker Table still displays the Gift Shop control;
- control is visibly disabled/locked/struck-through rather than disappearing;
- tooltip/accessibility copy explains that Gift Shop is available only to signed-in players;
- clicking/activating it must not open the purchase panel or send WS traffic;
- authenticated but temporarily unavailable states such as reconnect/pending seat may remain controlled by existing availability logic;
- no backend/auth relaxation: guests still cannot call a successful `gift_send`.

### T012D — Integrate persistent received gifts with #1048 HUD

Do not implement a competing layout inside #1042.

After #1048 exposes the stable per-seat gift-slot container/anchor:

- change `renderGiftBadges()` to render into that dedicated seat HUD gift area, not inside `.poker-seat-avatar`;
- preserve existing `giftsBySeat`, `table_gift_state`, replay suppression and exact participation recovery;
- use exactly three visible stable slots;
- duplicate gift types remain aggregated (for example `🍺 ×4`);
- additional types use the already accepted compact overflow representation;
- ordinary seat re-render/reconnect must rebind to the new HUD slot without losing authoritative gift state.

#1042 is blocked from final merge until #1048 provides this stable placement and the integrated Gift Shop smoke passes.

### Verification after correction

Do not add broad UI/CSS/JSP tests.

Run existing required/fundamental checks, then perform real Deploy Preview / WS Preview smoke for:

- custom gift picker on desktop/mobile;
- custom recipient list excluding self and allowing other human/bot targets;
- guest-visible disabled/locked Gift Shop with explanatory tooltip;
- successful purchase still charges the exact server-authoritative amount;
- existing cooldown/insufficient-CH/retry behavior unchanged;
- after #1048 integration, gifts remain visibly present in the three reserved HUD slots through ordinary renders/reconnect;
- leave/rejoin still clears previous participation gifts;
- no overlap with avatar/cards/dealer/stack in representative HUD layouts.

If the correction touches only browser presentation before #1048, WS redeploy is not needed unless `ws-server/**`, shared WS runtime dependencies, protocol, or deployable runtime configuration change. A browser Deploy Preview smoke is still required.

### Task status amendment

- [x] **T012A — Custom gift picker**
- [x] **T012B — Custom recipient picker**
- [x] **T012C — Guest-visible disabled Gift Shop**
- [ ] **T012D — Consume #1048 stable three-slot gift HUD** — BLOCKED on #1048
- [ ] **T013 — Final authenticated Stage smoke after T012A–T012E**
- [ ] **T014 — Production owner GO/schema apply**
- [ ] **T015 — Final handoff / merge-ready gate**

Existing T001–T012 implementation work remains valid; these are smoke-discovered corrective tasks, not a rewrite of the gift accounting/WS mechanism.


## T012E — Quick Gift per seat + no self-gifting

This is one shared gift purchase flow, not a second shop/payment path.

#### E1 — No self-gifting

Implement immediately in the existing #1047 branch:

- `shared/poker-domain/gift-purchase.mjs::executePokerGiftPurchase()` must reject when the ACTIVE recipient resolves to the same buyer/current sender participation, before `postTransaction()`;
- use a small stable controlled reason (prefer existing `gift_target_unavailable` if that keeps the public contract minimal; add a new public reason only if genuinely needed);
- rejection must produce **zero BURN and zero receipt**;
- `poker/poker-v2.js::giftEligibleSeats()` / recipient reconciliation must exclude the current user's own seat;
- main Gift Shop must therefore list only other occupied humans/bots;
- add/adjust only the focused purchase-domain fundamental test for self-gift rejection. Do not add a UI test.

#### E2 — Per-seat Quick Gift

Behavior remains owned by #1042 but visual placement depends on #1048.

After #1048 exposes a stable per-seat quick-action slot:

- show a small 🎁 quick-action button beside every **other** occupied seat for an authenticated seated human buyer;
- never show the button beside the buyer's own avatar;
- targets may be another human or bot;
- guests/signed-out users do not get active per-seat purchase actions;
- clicking 🎁 opens a small custom six-gift picker anchored in the reserved seat quick-action area;
- picker shows the same emoji/localized name/server-mirrored CH prices as the main Gift Shop;
- clicking one gift sends it **immediately** to that seat — no second recipient step and no extra Send confirmation;
- if target occupant disappears/changes, close the quick picker and invalidate any target-scoped retry identity;
- pending/cooldown/insufficient-CH/stale-target feedback reuses the existing Gift Shop behavior.

Refactor only as much as necessary so both entry points call one existing purchase helper in `poker/poker-v2.js` (for example one internal function taking `giftKey + targetSeatNo`). Keep exactly one request-id/idempotency/retry path, one `wsClient.sendGift()` path, one `chips:tx-complete` refresh path and one error mapping.

Do not create:

- a second WS command;
- another gift catalog;
- a second retry state machine;
- a separate payment/purchase service;
- a temporary absolute-position/z-index overlay while #1048 is pending.

Quick Gift placement is blocked on #1048; E1 no-self can and should be completed now.
